import type { VerifiedIdentity } from '@platform-core/iam';
import type { DbClient } from './db.ts';

export interface ResolvedMembership {
  readonly membershipId: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly country: string;
  readonly region: string;
  readonly appId: string;
  readonly permissions: readonly string[];
  readonly hierarchyScope: string;
}

/**
 * Given a verified identity and the app the request is for, returns the
 * membership + the permissions the role grant yields. Deliberately returns a
 * flat row — the caller mints a scope token from it.
 *
 * Returns null when the identity has no live membership in the given tenant.
 */
export async function resolveMembership(
  db: DbClient,
  identity: VerifiedIdentity,
  options: { tenantId: string; appId: string },
): Promise<ResolvedMembership | null> {
  const r = await db.query<{
    membership_id: string; person_id: string; tenant_id: string;
    country: string; region: string;
    permissions: string[] | null; hierarchy_scope: string | null;
  }>(
    `SELECT m.membership_id::text, m.person_id::text, m.tenant_id::text,
            t.country, t.region,
            COALESCE(
              (SELECT array_agg(DISTINCT p) FROM platform.role_assignments ra,
                     LATERAL unnest(ra.permissions) p
                WHERE ra.membership_id = m.membership_id
                  AND ra.app_id        = $4
                  AND ra.revoked_at IS NULL
                  AND (ra.expires_at IS NULL OR ra.expires_at > now())),
              ARRAY[]::text[]) AS permissions,
            (SELECT ra.hierarchy_scope
               FROM platform.role_assignments ra
              WHERE ra.membership_id = m.membership_id
                AND ra.app_id = $4
                AND ra.revoked_at IS NULL
                AND (ra.expires_at IS NULL OR ra.expires_at > now())
              ORDER BY ra.granted_at ASC LIMIT 1) AS hierarchy_scope
       FROM platform.memberships m
       JOIN platform.tenants t ON t.tenant_id = m.tenant_id
      WHERE m.identity_pool_id    = $1
        AND m.identity_subject_id = $2
        AND m.tenant_id           = $3
        AND m.state               = 'ACTIVE'`,
    [identity.issuer, identity.subjectId, options.tenantId, options.appId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    membershipId: row.membership_id,
    personId: row.person_id,
    tenantId: row.tenant_id,
    country: row.country,
    region: row.region,
    appId: options.appId,
    permissions: row.permissions ?? [],
    hierarchyScope: row.hierarchy_scope ?? '',
  };
}
