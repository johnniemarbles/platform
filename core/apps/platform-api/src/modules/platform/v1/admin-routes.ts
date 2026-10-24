import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { HandlerContext, RouteDefinition } from '@platform-core/route-kit';
import { refusal } from '@platform-hub/contracts';
import { createAuditChainEvent, AUDIT_CHAIN_GENESIS, type AuditChainEventBody } from '@platform-core/audit';

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>);
}

async function recordAccessChangeEvent(
  tx: any,
  params: {
    tenantId: string;
    appId: string;
    actorPersonId: string;
    action: string;
    subjectId: string;
    subject: Record<string, any>;
    traceId: string;
  }
) {
  const lastRes = await tx.query(
    `SELECT sequence, event_hash
     FROM platform.access_change_events
     WHERE tenant_id = $1
     ORDER BY sequence DESC
     LIMIT 1`,
    [params.tenantId]
  );

  const lastSeq = lastRes.rows[0] ? Number(lastRes.rows[0].sequence) : 0;
  const lastHash = lastRes.rows[0] ? lastRes.rows[0].event_hash : AUDIT_CHAIN_GENESIS;
  const nextSeq = lastSeq + 1;
  const eventId = randomUUID();
  const nowIso = new Date().toISOString();

  const body: AuditChainEventBody = {
    tenantId: params.tenantId,
    sequence: nextSeq,
    eventId,
    eventType: params.action,
    objectReference: { type: 'access_control', id: eventId },
    actor: { kind: 'HUMAN', subjectId: params.actorPersonId },
    purpose: 'tenant_admin',
    reason: params.action,
    occurredAt: nowIso,
    recordedAt: nowIso,
    correlationId: eventId,
    evidenceRefs: [`access_change:${eventId}`],
    details: params.subject,
    previousHash: lastHash,
  };

  const chained = createAuditChainEvent(body);

  await tx.query(
    `INSERT INTO platform.access_change_events (
       event_id, tenant_id, app_id, actor_person_id, action,
       subject, sequence, previous_hash, event_hash, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      eventId,
      params.tenantId,
      params.appId,
      params.actorPersonId,
      params.action,
      JSON.stringify(params.subject),
      nextSeq,
      lastHash,
      chained.hash,
      nowIso,
    ]
  );
}

function checkAuthority(callerPermissions: readonly string[], targetKeys: readonly string[]): boolean {
  const callerSet = new Set(callerPermissions);
  for (const k of targetKeys) {
    if (!callerSet.has(k)) return false;
  }
  return true;
}

function isScopeWithin(callerScope: string, targetScope: string): boolean {
  if (callerScope === 'root') return true;
  if (targetScope === callerScope) return true;
  return targetScope.startsWith(`${callerScope}/`);
}

async function getRoleEffectivePermissions(tx: any, roleId: string): Promise<string[]> {
  const bRes = await tx.query(
    `SELECT k.permission_key
     FROM platform.role_bundles rb
     JOIN platform.permission_bundle_keys k ON k.bundle_key = rb.bundle_key
     WHERE rb.role_id = $1 AND (k.auto_grant OR k.permission_key = ANY(rb.opted_in_keys))`,
    [roleId]
  );
  const oRes = await tx.query(
    `SELECT permission_key, effect
     FROM platform.role_permission_overrides
     WHERE role_id = $1`,
    [roleId]
  );

  const keys = new Set<string>();
  for (const r of bRes.rows) keys.add(r.permission_key);
  for (const r of oRes.rows) {
    if (r.effect === 'GRANT') keys.add(r.permission_key);
    else if (r.effect === 'DENY') keys.delete(r.permission_key);
  }
  return Array.from(keys).sort();
}

async function previewEffectivePermissions(
  tx: any,
  bundleKeys: string[],
  optedInKeys: string[],
  overrides: { permissionKey: string; effect: 'GRANT' | 'DENY' }[]
): Promise<string[]> {
  const keys = new Set<string>();
  if (bundleKeys.length > 0) {
    const bRes = await tx.query(
      `SELECT permission_key, auto_grant
       FROM platform.permission_bundle_keys
       WHERE bundle_key = ANY($1)`,
      [bundleKeys]
    );
    const optedInSet = new Set(optedInKeys);
    for (const r of bRes.rows) {
      if (r.auto_grant || optedInSet.has(r.permission_key)) {
        keys.add(r.permission_key);
      }
    }
  }
  for (const o of overrides) {
    if (o.effect === 'GRANT') keys.add(o.permissionKey);
    else if (o.effect === 'DENY') keys.delete(o.permissionKey);
  }
  return Array.from(keys).sort();
}

export function adminRoutes(): readonly RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/v1/admin/permission-catalog',
      appId: '*',
      requires: ['admin.role.read'],
      handler: async (ctx: HandlerContext) => {
        // Fetch bundles available
        const bRes = await ctx.tx.query(
          `SELECT bundle_key, description, source
           FROM platform.permission_bundles
           ORDER BY bundle_key ASC`
        );

        const bundles = [];
        for (const b of bRes.rows) {
          const kRes = await ctx.tx.query(
            `SELECT permission_key, auto_grant, added_in_version
             FROM platform.permission_bundle_keys
             WHERE bundle_key = $1
             ORDER BY permission_key ASC`,
            [b.bundle_key]
          );

          // Find opted-in roles
          const optRes = await ctx.tx.query(
            `SELECT role_id, opted_in_keys
             FROM platform.role_bundles
             WHERE bundle_key = $1`,
            [b.bundle_key]
          );

          const keys = kRes.rows.map((k: any) => {
            const optedInRoleIds = optRes.rows
              .filter((r: any) => r.opted_in_keys && r.opted_in_keys.includes(k.permission_key))
              .map((r: any) => r.role_id);
            return {
              key: k.permission_key,
              autoGrant: k.auto_grant,
              since: k.added_in_version,
              optedInRoleIds,
            };
          });

          bundles.push({
            bundleKey: b.bundle_key,
            description: b.description,
            source: b.source,
            keys,
          });
        }

        return bundles;
      },
    },
    {
      method: 'GET',
      path: '/v1/admin/roles',
      appId: '*',
      requires: ['admin.role.read'],
      handler: async (ctx: HandlerContext) => {
        const rRes = await ctx.tx.query(
          `SELECT role_id, role_key, display_name, is_system
           FROM platform.roles
           WHERE app_id = $1
           ORDER BY is_system DESC, role_key ASC`,
          [ctx.membership.appId]
        );

        const roles = [];
        for (const r of rRes.rows) {
          const bRes = await ctx.tx.query(
            `SELECT bundle_key, opted_in_keys
             FROM platform.role_bundles
             WHERE role_id = $1`,
            [r.role_id]
          );
          const oRes = await ctx.tx.query(
            `SELECT permission_key, effect
             FROM platform.role_permission_overrides
             WHERE role_id = $1`,
            [r.role_id]
          );

          const bundles = bRes.rows.map((b: any) => b.bundle_key);
          const optedInKeys = Array.from(new Set(bRes.rows.flatMap((b: any) => b.opted_in_keys ?? [])));
          const overrides = oRes.rows.map((o: any) => ({
            permissionKey: o.permission_key,
            effect: o.effect,
          }));

          const effectivePermissions = await getRoleEffectivePermissions(ctx.tx, r.role_id);

          roles.push({
            roleId: r.role_id,
            roleKey: r.role_key,
            displayName: r.display_name,
            isSystem: r.is_system,
            bundles,
            overrides,
            optedInKeys,
            effectivePermissions,
          });
        }

        return roles;
      },
    },
    {
      method: 'POST',
      path: '/v1/admin/roles',
      appId: '*',
      requires: ['admin.role.manage'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const { roleKey, displayName, bundles = [] } = body;

        if (!roleKey || !displayName) {
          return refusal('REFUSED', ctx.traceId, 'missing roleKey or displayName');
        }

        // Preview effective permissions and enforce Authority Guard
        const targetKeys = await previewEffectivePermissions(ctx.tx, bundles, [], []);
        if (!checkAuthority(ctx.membership.permissions, targetKeys)) {
          return refusal('GRANT_EXCEEDS_AUTHORITY', ctx.traceId, 'grant exceeds caller authority');
        }

        const roleId = randomUUID();
        await ctx.tx.query(
          `INSERT INTO platform.roles (role_id, tenant_id, app_id, role_key, display_name, is_system)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [roleId, ctx.membership.tenantId, ctx.membership.appId, roleKey, displayName]
        );

        for (const b of bundles) {
          await ctx.tx.query(
            `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
             VALUES ($1, $2, $3, '{}')`,
            [roleId, ctx.membership.tenantId, b]
          );
        }

        await recordAccessChangeEvent(ctx.tx, {
          tenantId: ctx.membership.tenantId,
          appId: ctx.membership.appId,
          actorPersonId: ctx.membership.personId,
          action: 'ROLE_CREATED',
          subjectId: roleId,
          subject: { roleKey, displayName, bundles },
          traceId: ctx.traceId,
        });

        return {
          roleId,
          roleKey,
          displayName,
          isSystem: false,
          bundles,
          overrides: [],
          optedInKeys: [],
          effectivePermissions: targetKeys,
        };
      },
    },
    {
      method: 'PATCH',
      path: '/v1/admin/roles/:id',
      pattern: /^\/v1\/admin\/roles\/([0-9a-fA-F-]+)$/,
      appId: '*',
      requires: ['admin.role.manage'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const roleId = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);

        const rRes = await ctx.tx.query(
          `SELECT role_id, role_key, display_name, is_system
           FROM platform.roles
           WHERE role_id = $1 AND app_id = $2`,
          [roleId, ctx.membership.appId]
        );
        if (!rRes.rows[0]) {
          return refusal('REFUSED', ctx.traceId, 'role not found');
        }
        const currentRole = rRes.rows[0];

        // Fetch current bundles, overrides, opt-ins
        const currBRes = await ctx.tx.query(
          `SELECT bundle_key, opted_in_keys FROM platform.role_bundles WHERE role_id = $1`,
          [roleId]
        );
        const currORes = await ctx.tx.query(
          `SELECT permission_key, effect FROM platform.role_permission_overrides WHERE role_id = $1`,
          [roleId]
        );

        const currentBundles: string[] = currBRes.rows.map((b: any) => b.bundle_key);
        const nextBundles: string[] = body.bundles ?? currentBundles;

        // System role bundle check: bundles can be added, not removed
        if (currentRole.is_system && body.bundles !== undefined) {
          const removedBundles = currentBundles.filter((b) => !nextBundles.includes(b));
          if (removedBundles.length > 0) {
            return refusal('REFUSED', ctx.traceId, 'cannot remove bundles from system role');
          }
        }

        const nextOptedInKeys: string[] = body.optedInKeys ?? currBRes.rows.flatMap((b: any) => b.opted_in_keys ?? []);
        const nextOverrides: { permissionKey: string; effect: 'GRANT' | 'DENY' }[] =
          body.overrides ?? currORes.rows.map((o: any) => ({ permissionKey: o.permission_key, effect: o.effect }));

        // Authority Guard
        for (const k of nextOptedInKeys) {
          if (!ctx.membership.permissions.includes(k)) {
            return refusal('GRANT_EXCEEDS_AUTHORITY', ctx.traceId, `cannot opt in to key '${k}' beyond caller authority`);
          }
        }

        const targetKeys = await previewEffectivePermissions(ctx.tx, nextBundles, nextOptedInKeys, nextOverrides);
        if (!checkAuthority(ctx.membership.permissions, targetKeys)) {
          return refusal('GRANT_EXCEEDS_AUTHORITY', ctx.traceId, 'grant exceeds caller authority');
        }

        // Apply updates
        if (body.displayName) {
          await ctx.tx.query(
            `UPDATE platform.roles SET display_name = $1, updated_at = now() WHERE role_id = $2`,
            [body.displayName, roleId]
          );
        }

        if (body.bundles !== undefined) {
          await ctx.tx.query(`DELETE FROM platform.role_bundles WHERE role_id = $1`, [roleId]);
          for (const b of nextBundles) {
            await ctx.tx.query(
              `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
               VALUES ($1, $2, $3, $4)`,
              [roleId, ctx.membership.tenantId, b, nextOptedInKeys]
            );
          }
        } else if (body.optedInKeys !== undefined) {
          await ctx.tx.query(
            `UPDATE platform.role_bundles SET opted_in_keys = $1 WHERE role_id = $2`,
            [nextOptedInKeys, roleId]
          );
        }

        if (body.overrides !== undefined) {
          await ctx.tx.query(`DELETE FROM platform.role_permission_overrides WHERE role_id = $1`, [roleId]);
          for (const o of nextOverrides) {
            await ctx.tx.query(
              `INSERT INTO platform.role_permission_overrides (role_id, tenant_id, permission_key, effect, created_by)
               VALUES ($1, $2, $3, $4, $5)`,
              [roleId, ctx.membership.tenantId, o.permissionKey, o.effect, ctx.membership.personId]
            );
          }
        }

        await recordAccessChangeEvent(ctx.tx, {
          tenantId: ctx.membership.tenantId,
          appId: ctx.membership.appId,
          actorPersonId: ctx.membership.personId,
          action: 'ROLE_UPDATED',
          subjectId: roleId,
          subject: {
            roleKey: currentRole.role_key,
            displayName: body.displayName ?? currentRole.display_name,
            bundles: nextBundles,
            optedInKeys: nextOptedInKeys,
            overrides: nextOverrides,
          },
          traceId: ctx.traceId,
        });

        return {
          roleId,
          roleKey: currentRole.role_key,
          displayName: body.displayName ?? currentRole.display_name,
          isSystem: currentRole.is_system,
          bundles: nextBundles,
          overrides: nextOverrides,
          optedInKeys: nextOptedInKeys,
          effectivePermissions: targetKeys,
        };
      },
    },
    {
      method: 'POST',
      path: '/v1/admin/members/search',
      appId: '*',
      requires: ['admin.member.search'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const { email, phone } = body;

        if (!email && !phone) {
          return refusal('REFUSED', ctx.traceId, 'must provide email or phone');
        }

        // Exact match within caller's tenant only (Plan Rule 4)
        const q = email
          ? `SELECT m.membership_id, m.person_id, m.identity_subject_id
             FROM platform.memberships m
             WHERE m.tenant_id = $1 AND m.identity_subject_id = $2`
          : `SELECT m.membership_id, m.person_id, m.identity_subject_id
             FROM platform.memberships m
             WHERE m.tenant_id = $1 AND m.identity_subject_id = $2`;

        const targetSubject = email ? email.trim().toLowerCase() : phone.trim();
        const mRes = await ctx.tx.query(q, [ctx.membership.tenantId, targetSubject]);

        const members = [];
        for (const m of mRes.rows) {
          const rRes = await ctx.tx.query(
            `SELECT role_key
             FROM platform.role_assignments
             WHERE membership_id = $1 AND app_id = $2 AND revoked_at IS NULL`,
            [m.membership_id, ctx.membership.appId]
          );

          members.push({
            membershipId: m.membership_id,
            personId: m.person_id,
            displayName: m.identity_subject_id,
            email: email ? targetSubject : undefined,
            phone: phone ? targetSubject : undefined,
            roles: rRes.rows.map((r: any) => r.role_key),
          });
        }

        return members;
      },
    },
    {
      method: 'POST',
      path: '/v1/admin/role-assignments',
      appId: '*',
      requires: ['admin.member.assign'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const { membershipId, roleId, hierarchyScope = 'root' } = body;

        if (!membershipId || !roleId) {
          return refusal('REFUSED', ctx.traceId, 'missing membershipId or roleId');
        }

        // Scope Authority Guard
        if (!isScopeWithin(ctx.membership.hierarchyScope, hierarchyScope)) {
          return refusal('GRANT_EXCEEDS_AUTHORITY', ctx.traceId, 'hierarchy scope exceeds caller authority');
        }

        // Verify membership belongs to caller's tenant
        const memRes = await ctx.tx.query(
          `SELECT membership_id FROM platform.memberships WHERE membership_id = $1 AND tenant_id = $2`,
          [membershipId, ctx.membership.tenantId]
        );
        if (!memRes.rows[0]) {
          return refusal('REFUSED', ctx.traceId, 'membership not found in tenant');
        }

        // Role Authority Guard
        const roleRes = await ctx.tx.query(
          `SELECT role_key FROM platform.roles WHERE role_id = $1 AND app_id = $2`,
          [roleId, ctx.membership.appId]
        );
        if (!roleRes.rows[0]) {
          return refusal('REFUSED', ctx.traceId, 'role not found in app');
        }

        const roleKeys = await getRoleEffectivePermissions(ctx.tx, roleId);
        if (!checkAuthority(ctx.membership.permissions, roleKeys)) {
          return refusal('GRANT_EXCEEDS_AUTHORITY', ctx.traceId, 'role permissions exceed caller authority');
        }

        const assignmentId = randomUUID();
        await ctx.tx.query(
          `INSERT INTO platform.role_assignments (
             assignment_id, membership_id, app_id, role_key, role_id,
             hierarchy_scope, granted_by, permissions
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, '{}')`,
          [
            assignmentId,
            membershipId,
            ctx.membership.appId,
            roleRes.rows[0].role_key,
            roleId,
            hierarchyScope,
            ctx.membership.personId,
          ]
        );

        await recordAccessChangeEvent(ctx.tx, {
          tenantId: ctx.membership.tenantId,
          appId: ctx.membership.appId,
          actorPersonId: ctx.membership.personId,
          action: 'ASSIGNMENT_GRANTED',
          subjectId: assignmentId,
          subject: { membershipId, roleId, hierarchyScope },
          traceId: ctx.traceId,
        });

        return {
          assignmentId,
          membershipId,
          roleId,
          hierarchyScope,
        };
      },
    },
    {
      method: 'DELETE',
      path: '/v1/admin/role-assignments/:id',
      pattern: /^\/v1\/admin\/role-assignments\/([0-9a-fA-F-]+)$/,
      appId: '*',
      requires: ['admin.member.assign'],
      handler: async (ctx: HandlerContext) => {
        const assignmentId = ctx.url.pathname.split('/').pop()!;

        const aRes = await ctx.tx.query(
          `SELECT ra.assignment_id, ra.membership_id, ra.role_id, ra.role_key
           FROM platform.role_assignments ra
           JOIN platform.memberships m ON m.membership_id = ra.membership_id
           WHERE ra.assignment_id = $1 AND m.tenant_id = $2 AND ra.app_id = $3 AND ra.revoked_at IS NULL`,
          [assignmentId, ctx.membership.tenantId, ctx.membership.appId]
        );
        if (!aRes.rows[0]) {
          return refusal('REFUSED', ctx.traceId, 'assignment not found');
        }

        const assignment = aRes.rows[0];

        // Check if revoking last admin assignment with admin.role.manage
        const roleKeys = await getRoleEffectivePermissions(ctx.tx, assignment.role_id);
        if (roleKeys.includes('admin.role.manage')) {
          // Count active assignments with admin.role.manage in this app
          const activeAdmins = await ctx.tx.query(
            `SELECT count(DISTINCT ra.assignment_id) as c
             FROM platform.role_assignments ra
             JOIN platform.memberships m ON m.membership_id = ra.membership_id
             JOIN platform.role_bundles rb ON rb.role_id = ra.role_id
             JOIN platform.permission_bundle_keys pbk ON pbk.bundle_key = rb.bundle_key
             WHERE m.tenant_id = $1 AND ra.app_id = $2 AND ra.revoked_at IS NULL
               AND pbk.permission_key = 'admin.role.manage'`,
            [ctx.membership.tenantId, ctx.membership.appId]
          );
          if (parseInt(activeAdmins.rows[0]?.c ?? '0', 10) <= 1) {
            return refusal('REFUSED', ctx.traceId, 'cannot revoke last admin assignment');
          }
        }

        await ctx.tx.query(
          `UPDATE platform.role_assignments SET revoked_at = now() WHERE assignment_id = $1`,
          [assignmentId]
        );

        await recordAccessChangeEvent(ctx.tx, {
          tenantId: ctx.membership.tenantId,
          appId: ctx.membership.appId,
          actorPersonId: ctx.membership.personId,
          action: 'ASSIGNMENT_REVOKED',
          subjectId: assignmentId,
          subject: { assignmentId },
          traceId: ctx.traceId,
        });

        return { revoked: true };
      },
    },
  ];
}
