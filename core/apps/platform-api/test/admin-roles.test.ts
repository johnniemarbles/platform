import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { dbFromPglite } from '../src/db-pglite.ts';
import { DevIdentityVerifier, signDevToken } from '@platform-core/iam-dev';
import { makeDispatcher, type PlatformApiConfig } from '../src/handler.ts';
import { platformV1Routes } from '../src/modules/platform/v1/routes.ts';
import { makeHostResolver } from '../src/host-router.ts';
import { syncPermissionCatalog, ensureSystemRolesForTenantApp } from '../src/permission-catalog.ts';
import { verifyAuditChain, type AuditChainEvent } from '@platform-core/audit';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEV_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function setupTestDb() {
  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  const rootDir = resolve(import.meta.dirname, '../../../..');
  const migrationsDir = resolve(rootDir, 'core/infra/db/migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    const sql = readFileSync(resolve(migrationsDir, f), 'utf8');
    await pg.exec(sql);
  }

  const db = dbFromPglite(pg);
  await syncPermissionCatalog(db, { rootDir });

  // App & Client
  await pg.query("INSERT INTO platform.apps (app_id, display_name) VALUES ('app_dentex', 'Dentex') ON CONFLICT DO NOTHING");
  await pg.query(
    "INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id) VALUES ('dev-dentex', 'app_dentex', 'dev', 'platform-dev') ON CONFLICT DO NOTHING"
  );

  // Create app_user role and permissions
  await pg.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER;
      END IF;
    END
    $$;
    GRANT ALL ON SCHEMA platform TO app_user;
    GRANT ALL ON ALL TABLES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL ROUTINES IN SCHEMA platform TO app_user;
  `);

  return { pg, db };
}

function makeRequestHelper(dispatcher: any) {
  return async (method: string, path: string, subject: string, body?: unknown) => {
    const token = signDevToken({ sub: subject, iss: 'platform-dev', aud: 'dev-dentex' }, DEV_SECRET);
    const [pathname, search] = path.split('?');
    const req = {
      method,
      url: path,
      headers: {
        authorization: `Bearer ${token}`,
        host: 'acme.platform.test',
      },
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) {
          yield Buffer.from(JSON.stringify(body));
        }
      },
    } as unknown as IncomingMessage;

    return new Promise<{ status: number; body: any }>((resolve) => {
      const mockRes = {
        statusCode: 200,
        setHeader() {},
        end(chunk: string) {
          resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) });
        },
      } as unknown as ServerResponse;
      dispatcher(req, mockRes);
    });
  };
}

test('admin-roles: grant beyond authority is refused (bundle, override, opt-in and assignment paths)', async () => {
  const { pg, db } = await setupTestDb();
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const adminPersonId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', '33333333-3333-3333-3333-333333333333', 'US', 'us-east-1', 'acme');
    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_dentex');
  `);

  await ensureSystemRolesForTenantApp(db, tenantId, 'app_dentex');

  // Seed caller membership as an admin with LIMITED permissions:
  // has admin.role.manage, admin.role.read, admin.member.assign, me.read, BUT lacks bookings.create!
  await pg.exec(`
    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${adminPersonId}', 'dev', 'platform-dev', 'usr_admin');

    INSERT INTO platform.roles (role_id, tenant_id, app_id, role_key, display_name, is_system)
    VALUES (gen_random_uuid(), '${tenantId}', 'app_dentex', 'limited_admin', 'Limited Admin', false);

    INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
    VALUES ((SELECT role_id FROM platform.roles WHERE role_key = 'limited_admin'), '${tenantId}', 'platform.admin', '{}');

    INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
    VALUES ((SELECT role_id FROM platform.roles WHERE role_key = 'limited_admin'), '${tenantId}', 'platform.member', '{}');

    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships WHERE identity_subject_id = 'usr_admin'),
            'app_dentex', 'limited_admin',
            (SELECT role_id FROM platform.roles WHERE role_key = 'limited_admin'),
            '{}', 'root', '${adminPersonId}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  await pg.exec('SET ROLE app_user');
  const dispatcher = makeDispatcher(platformV1Routes(), config);
  const request = makeRequestHelper(dispatcher);

  // 1. POST /v1/admin/roles trying to include bundle 'scheduling.staff' which caller does not hold -> GRANT_EXCEEDS_AUTHORITY
  const postRoleRes = await request('POST', '/v1/admin/roles', 'usr_admin', {
    roleKey: 'scheduler',
    displayName: 'Scheduler',
    bundles: ['scheduling.staff'],
  });
  assert.equal(postRoleRes.status, 403);
  assert.equal(postRoleRes.body.code, 'GRANT_EXCEEDS_AUTHORITY');

  // 2. Create custom role with bundles caller DOES hold -> success
  const validRoleRes = await request('POST', '/v1/admin/roles', 'usr_admin', {
    roleKey: 'custom_viewer',
    displayName: 'Custom Viewer',
    bundles: ['platform.member'],
  });
  assert.equal(validRoleRes.status, 200);
  const customRoleId = validRoleRes.body.result.roleId;

  // 3. PATCH /v1/admin/roles/:id trying to add GRANT override for 'bookings.create' -> GRANT_EXCEEDS_AUTHORITY
  const patchOverrideRes = await request('PATCH', `/v1/admin/roles/${customRoleId}`, 'usr_admin', {
    overrides: [{ permissionKey: 'bookings.create', effect: 'GRANT' }],
  });
  assert.equal(patchOverrideRes.status, 403);
  assert.equal(patchOverrideRes.body.code, 'GRANT_EXCEEDS_AUTHORITY');

  // 4. PATCH /v1/admin/roles/:id trying to opt in to a non-auto-grant key caller does not hold -> GRANT_EXCEEDS_AUTHORITY
  const patchOptInRes = await request('PATCH', `/v1/admin/roles/${customRoleId}`, 'usr_admin', {
    optedInKeys: ['sensitive.unheld.permission'],
  });
  assert.equal(patchOptInRes.status, 403);
  assert.equal(patchOptInRes.body.code, 'GRANT_EXCEEDS_AUTHORITY');

  // 5. POST /v1/admin/role-assignments with hierarchy scope outside caller scope -> GRANT_EXCEEDS_AUTHORITY
  // Set caller hierarchy scope to 'brand/alpha'
  await pg.query("UPDATE platform.role_assignments SET hierarchy_scope = 'brand/alpha' WHERE role_key = 'limited_admin'");

  const memId = (await pg.query<{ membership_id: string }>('SELECT membership_id FROM platform.memberships WHERE identity_subject_id = $1', ['usr_admin'])).rows[0]!.membership_id;

  const assignScopeRes = await request('POST', '/v1/admin/role-assignments', 'usr_admin', {
    membershipId: memId,
    roleId: customRoleId,
    hierarchyScope: 'brand/beta', // Outside caller's scope 'brand/alpha'
  });
  assert.equal(assignScopeRes.status, 403);
  assert.equal(assignScopeRes.body.code, 'GRANT_EXCEEDS_AUTHORITY');

  await db.close();
});

test('admin-roles: search never returns a person from another tenant even with identical email', async () => {
  const { pg, db } = await setupTestDb();
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const personA = '33333333-3333-3333-3333-333333333333';
  const personB = '44444444-4444-4444-4444-444444444444';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantA}', gen_random_uuid(), 'US', 'us-east-1', 'acme'),
           ('${tenantB}', gen_random_uuid(), 'US', 'us-east-1', 'other');
    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantA}', 'app_dentex'), ('${tenantB}', 'app_dentex');

    -- Tenant A admin
    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantA}', '${personA}', 'dev', 'platform-dev', 'admin_a');

    -- Tenant A member with shared email
    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantA}', gen_random_uuid(), 'dev', 'platform-dev', 'common@example.com');

    -- Tenant B member with IDENTICAL email
    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantB}', '${personB}', 'dev', 'platform-dev', 'common@example.com');
  `);

  await ensureSystemRolesForTenantApp(db, tenantA, 'app_dentex');
  await pg.exec(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships WHERE identity_subject_id = 'admin_a'),
            'app_dentex', 'owner',
            (SELECT role_id FROM platform.roles WHERE tenant_id = '${tenantA}' AND role_key = 'owner'),
            '{}', 'root', '${personA}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  await pg.exec('SET ROLE app_user');
  const dispatcher = makeDispatcher(platformV1Routes(), config);
  const request = makeRequestHelper(dispatcher);

  const searchRes = await request('POST', '/v1/admin/members/search', 'admin_a', { email: 'common@example.com' });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.result.length, 1);
  assert.notEqual(searchRes.body.result[0].personId, personB); // Must NOT be tenant B person

  await db.close();
});

test('admin-roles: system role bundles cannot be removed', async () => {
  const { pg, db } = await setupTestDb();
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_dentex');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_owner');
  `);

  await ensureSystemRolesForTenantApp(db, tenantId, 'app_dentex');
  await pg.exec(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships WHERE identity_subject_id = 'usr_owner'),
            'app_dentex', 'owner',
            (SELECT role_id FROM platform.roles WHERE tenant_id = '${tenantId}' AND role_key = 'owner'),
            '{}', 'root', '${personId}');
  `);

  const ownerRoleId = (
    await pg.query<{ role_id: string }>(
      "SELECT role_id FROM platform.roles WHERE tenant_id = $1 AND role_key = 'owner'",
      [tenantId]
    )
  ).rows[0]!.role_id;

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  await pg.exec('SET ROLE app_user');
  const dispatcher = makeDispatcher(platformV1Routes(), config);
  const request = makeRequestHelper(dispatcher);

  // Try to remove bundles from system role 'owner' (e.g. set bundles to empty array) -> refused
  const patchRes = await request('PATCH', `/v1/admin/roles/${ownerRoleId}`, 'usr_owner', {
    bundles: [],
  });
  assert.equal(patchRes.status, 403);
  assert.equal(patchRes.body.code, 'REFUSED');
  assert.ok(patchRes.body.message.includes('cannot remove bundles from system role'));

  await db.close();
});

test('admin-roles: refusing to revoke last admin assignment with admin.role.manage', async () => {
  const { pg, db } = await setupTestDb();
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_dentex');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_only_admin');
  `);

  await ensureSystemRolesForTenantApp(db, tenantId, 'app_dentex');
  await pg.exec(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships WHERE identity_subject_id = 'usr_only_admin'),
            'app_dentex', 'owner',
            (SELECT role_id FROM platform.roles WHERE tenant_id = '${tenantId}' AND role_key = 'owner'),
            '{}', 'root', '${personId}');
  `);

  const assignId = (
    await pg.query<{ assignment_id: string }>(
      "SELECT assignment_id FROM platform.role_assignments WHERE app_id = 'app_dentex' LIMIT 1"
    )
  ).rows[0]!.assignment_id;

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  await pg.exec('SET ROLE app_user');
  const dispatcher = makeDispatcher(platformV1Routes(), config);
  const request = makeRequestHelper(dispatcher);

  // Try to revoke the ONLY active admin assignment in this tenant
  const delRes = await request('DELETE', `/v1/admin/role-assignments/${assignId}`, 'usr_only_admin');
  assert.equal(delRes.status, 403);
  assert.equal(delRes.body.code, 'REFUSED');
  assert.ok(delRes.body.message.includes('cannot revoke last admin assignment'));

  await db.close();
});

test('admin-roles: audit chain integrity and RLS immutability on access_change_events', async () => {
  const { pg, db } = await setupTestDb();
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_dentex');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_audit');
  `);

  await ensureSystemRolesForTenantApp(db, tenantId, 'app_dentex');
  await pg.exec(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships WHERE identity_subject_id = 'usr_audit'),
            'app_dentex', 'owner',
            (SELECT role_id FROM platform.roles WHERE tenant_id = '${tenantId}' AND role_key = 'owner'),
            '{}', 'root', '${personId}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  await pg.exec('SET ROLE app_user');
  const dispatcher = makeDispatcher(platformV1Routes(), config);
  const request = makeRequestHelper(dispatcher);

  // Perform multiple admin actions that record audit events
  const r1 = await request('POST', '/v1/admin/roles', 'usr_audit', {
    roleKey: 'audit_role_1',
    displayName: 'Audit Role 1',
    bundles: ['platform.member'],
  });
  assert.equal(r1.status, 200);

  const r2 = await request('PATCH', `/v1/admin/roles/${r1.body.result.roleId}`, 'usr_audit', {
    displayName: 'Audit Role Renamed',
  });
  assert.equal(r2.status, 200);

  // Set session tenant context for direct query
  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);

  // Read access change events
  const events = await pg.query<{
    event_id: string;
    tenant_id: string;
    sequence: string;
    action: string;
    actor_person_id: string;
    subject: any;
    previous_hash: string;
    event_hash: string;
    occurred_at: string;
  }>('SELECT * FROM platform.access_change_events ORDER BY sequence ASC');

  assert.equal(events.rows.length, 2);

  const chainEvents: AuditChainEvent[] = events.rows.map((r) => ({
    tenantId: r.tenant_id,
    sequence: Number(r.sequence),
    eventId: r.event_id,
    eventType: r.action,
    objectReference: { type: 'access_control', id: r.event_id },
    actor: { kind: 'HUMAN', subjectId: r.actor_person_id },
    purpose: 'tenant_admin',
    reason: r.action,
    occurredAt: new Date(r.occurred_at).toISOString(),
    recordedAt: new Date(r.occurred_at).toISOString(),
    correlationId: r.event_id,
    evidenceRefs: [`access_change:${r.event_id}`],
    details: r.subject,
    previousHash: r.previous_hash,
    hash: r.event_hash,
  }));

  // verifyAuditChain verifies hash chain continuity and event contents
  const verification = verifyAuditChain(chainEvents);
  assert.equal(verification.valid, true);

  // Test RLS immutability: UPDATE and DELETE affect 0 rows
  const updRes = await pg.query('UPDATE platform.access_change_events SET action = $1', ['TAMPERED']);
  assert.equal(updRes.affectedRows, 0);

  const delRes = await pg.query('DELETE FROM platform.access_change_events');
  assert.equal(delRes.affectedRows, 0);

  await db.close();
});
