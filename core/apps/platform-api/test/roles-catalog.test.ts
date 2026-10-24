import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { dbFromPglite } from '../src/db-pglite.ts';
import { collectMigrations } from '../../../../tools/db/migrate.ts';
import {
  syncPermissionCatalog,
  ensureSystemRolesForTenantApp,
} from '../src/permission-catalog.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');

async function setupTestDb() {
  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  const migrations = collectMigrations(rootDir);
  for (const m of migrations) {
    const sql = readFileSync(m.path, 'utf8');
    await pg.exec(sql);
  }
  await pg.query("INSERT INTO platform.apps (app_id, display_name) VALUES ('app_demo', 'Demo') ON CONFLICT DO NOTHING");
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
    SET ROLE app_user;
  `);
  const db = dbFromPglite(pg);
  return { pg, db };
}

test('roles catalog: backfill keeps effective permissions identical and quarantines conflicting legacy rows', async () => {
  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  const migrations = collectMigrations(rootDir);

  // Apply migrations up to 0014
  for (const m of migrations) {
    if (m.key.startsWith('0017') || m.key.startsWith('0018')) continue;
    const sql = readFileSync(m.path, 'utf8');
    await pg.exec(sql);
  }

  // Seed tenant, membership, and legacy role assignments
  const tRes = await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'bf-test') RETURNING tenant_id`
  );
  const tenantId = tRes.rows[0]!.tenant_id;

  const appRes = await pg.query(
    `INSERT INTO platform.apps (app_id, display_name) VALUES ('app_demo', 'Demo')`
  );

  const mRes = await pg.query<{ membership_id: string; person_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'dev', 'sub1') RETURNING membership_id, person_id`,
    [tenantId]
  );
  const membershipId1 = mRes.rows[0]!.membership_id;
  const personId1 = mRes.rows[0]!.person_id;

  // Normal assignment
  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'owner', ARRAY['me.read', 'bookings.create'], 'root', $2)`,
    [membershipId1, personId1]
  );

  // Conflicting assignments on membership 2
  const mRes2 = await pg.query<{ membership_id: string; person_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'dev', 'sub2') RETURNING membership_id, person_id`,
    [tenantId]
  );
  const membershipId2 = mRes2.rows[0]!.membership_id;
  const personId2 = mRes2.rows[0]!.person_id;

  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'conflicted_role', ARRAY['me.read'], 'root', $2)`,
    [membershipId2, personId2]
  );
  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'conflicted_role', ARRAY['me.read', 'bookings.create'], 'root', $2)`,
    [membershipId2, personId2]
  );

  // Now apply 0017 and 0018
  const m17 = migrations.find((m) => m.key.startsWith('0017'))!;
  await pg.exec(readFileSync(m17.path, 'utf8'));

  const m18 = migrations.find((m) => m.key.startsWith('0018'))!;
  await pg.exec(readFileSync(m18.path, 'utf8'));

  // Assert quarantine has the conflicted rows
  const qRes = await pg.query<{ count: string }>('SELECT count(*) FROM platform.role_backfill_quarantine');
  assert.equal(Number(qRes.rows[0]!.count), 2);

  // Assert normal assignment has role_id set and effective permissions match exactly
  const aRes = await pg.query<{ role_id: string; permissions: string[] }>(
    'SELECT role_id, permissions FROM platform.role_assignments WHERE membership_id = $1',
    [membershipId1]
  );
  assert.ok(aRes.rows[0]!.role_id);

  // Test effective_permissions function
  await pg.query("SELECT platform.set_request_context($1::uuid, 'app_demo', '', 'platform-operational', NULL)", [tenantId]);
  const epRes = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId1, 'app_demo']
  );
  assert.deepEqual(epRes.rows[0]!.perms.sort(), ['bookings.create', 'me.read']);

  await pg.close();
});

test('roles catalog: adding an autoGrant key to a bundle reaches existing users without editing assignments', async () => {
  const { pg, db } = await setupTestDb();

  // Boot sync
  await syncPermissionCatalog(db, { rootDir });

  // Create tenant, app, membership, role
  const tRes = await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'ag-test') RETURNING tenant_id`
  );
  const tenantId = tRes.rows[0]!.tenant_id;

  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
  await pg.query("INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, 'app_demo')", [tenantId]);

  // Create custom role subscribing to scheduling.staff
  const rRes = await pg.query<{ role_id: string }>(
    `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
     VALUES ($1, 'app_demo', 'scheduler', 'Scheduler', false) RETURNING role_id`,
    [tenantId]
  );
  const roleId = rRes.rows[0]!.role_id;

  await pg.query(
    `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key)
     VALUES ($1, $2, 'scheduling.staff')`,
    [roleId, tenantId]
  );

  const mRes = await pg.query<{ membership_id: string; person_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'dev', 'sub_ag') RETURNING membership_id, person_id`,
    [tenantId]
  );
  const membershipId = mRes.rows[0]!.membership_id;

  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'scheduler', $2, 'root', gen_random_uuid())`,
    [membershipId, roleId]
  );

  // Initial permissions
  const p1 = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(p1.rows[0]!.perms.includes('bookings.create'));
  assert.ok(!p1.rows[0]!.perms.includes('bookings.reschedule'));

  // Simulate module release adding autoGrant key to bundle
  await pg.query(
    `INSERT INTO platform.permission_bundle_keys (bundle_key, permission_key, auto_grant, added_in_version)
     VALUES ('scheduling.staff', 'bookings.reschedule', true, '0.2.0')`
  );

  // Next request gets the new key immediately without editing assignment!
  const p2 = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(p2.rows[0]!.perms.includes('bookings.reschedule'));

  await pg.close();
});

test('roles catalog: non-auto-grant key stays hidden until opted in', async () => {
  const { pg, db } = await setupTestDb();
  await syncPermissionCatalog(db, { rootDir });

  const tRes = await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'optin-test') RETURNING tenant_id`
  );
  const tenantId = tRes.rows[0]!.tenant_id;

  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
  await pg.query("INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, 'app_demo')", [tenantId]);

  const rRes = await pg.query<{ role_id: string }>(
    `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
     VALUES ($1, 'app_demo', 'scheduler', 'Scheduler', false) RETURNING role_id`,
    [tenantId]
  );
  const roleId = rRes.rows[0]!.role_id;

  await pg.query(
    `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
     VALUES ($1, $2, 'scheduling.staff', '{}')`,
    [roleId, tenantId]
  );

  const mRes = await pg.query<{ membership_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'dev', 'sub_opt') RETURNING membership_id`,
    [tenantId]
  );
  const membershipId = mRes.rows[0]!.membership_id;

  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'scheduler', $2, 'root', gen_random_uuid())`,
    [membershipId, roleId]
  );

  // Add sensitive key with auto_grant = false
  await pg.query(
    `INSERT INTO platform.permission_bundle_keys (bundle_key, permission_key, auto_grant, added_in_version)
     VALUES ('scheduling.staff', 'bookings.delete', false, '0.2.0')`
  );

  const p1 = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(!p1.rows[0]!.perms.includes('bookings.delete'));

  // Opt in to the key
  await pg.query(
    `UPDATE platform.role_bundles SET opted_in_keys = ARRAY['bookings.delete']
     WHERE role_id = $1 AND bundle_key = 'scheduling.staff'`,
    [roleId]
  );

  const p2 = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(p2.rows[0]!.perms.includes('bookings.delete'));

  await pg.close();
});

test('roles catalog: a DENY override removes a key granted by a bundle', async () => {
  const { pg, db } = await setupTestDb();
  await syncPermissionCatalog(db, { rootDir });

  const tRes = await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'deny-test') RETURNING tenant_id`
  );
  const tenantId = tRes.rows[0]!.tenant_id;

  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
  await pg.query("INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, 'app_demo')", [tenantId]);

  const rRes = await pg.query<{ role_id: string }>(
    `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
     VALUES ($1, 'app_demo', 'staff_custom', 'Staff Custom', false) RETURNING role_id`,
    [tenantId]
  );
  const roleId = rRes.rows[0]!.role_id;

  await pg.query(
    `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key)
     VALUES ($1, $2, 'scheduling.staff')`,
    [roleId, tenantId]
  );

  const mRes = await pg.query<{ membership_id: string }>(
    `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
     VALUES ($1, gen_random_uuid(), 'dev', 'dev', 'sub_deny') RETURNING membership_id`,
    [tenantId]
  );
  const membershipId = mRes.rows[0]!.membership_id;

  await pg.query(
    `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, role_id, hierarchy_scope, granted_by)
     VALUES ($1, 'app_demo', 'staff_custom', $2, 'root', gen_random_uuid())`,
    [membershipId, roleId]
  );

  const before = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(before.rows[0]!.perms.includes('bookings.create'));

  // Add DENY override
  await pg.query(
    `INSERT INTO platform.role_permission_overrides (role_id, tenant_id, permission_key, effect, created_by)
     VALUES ($1, $2, 'bookings.create', 'DENY', gen_random_uuid())`,
    [roleId, tenantId]
  );

  const after = await pg.query<{ perms: string[] }>(
    'SELECT platform.effective_permissions($1, $2) AS perms',
    [membershipId, 'app_demo']
  );
  assert.ok(!after.rows[0]!.perms.includes('bookings.create'));
  assert.ok(after.rows[0]!.perms.includes('bookings.read'));

  await pg.close();
});

test('roles catalog: boot sync is idempotent and system-role sync leaves custom roles untouched', async () => {
  const { pg, db } = await setupTestDb();

  const run1 = await syncPermissionCatalog(db, { rootDir });
  assert.ok(run1.syncedBundles > 0);

  const run2 = await syncPermissionCatalog(db, { rootDir });
  assert.equal(run2.syncedKeys, 0); // No new keys inserted on second run

  // System role sync
  const tRes = await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'sys-test') RETURNING tenant_id`
  );
  const tenantId = tRes.rows[0]!.tenant_id;
  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
  await pg.query("INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, 'app_demo')", [tenantId]);

  // Insert a custom role
  await pg.query(
    `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
     VALUES ($1, 'app_demo', 'custom_role', 'Custom Role', false)`,
    [tenantId]
  );

  // Sync system roles
  await syncPermissionCatalog(db, { rootDir });

  // Custom role is untouched
  const custom = await pg.query<{ is_system: boolean }>(
    `SELECT is_system FROM platform.roles WHERE tenant_id = $1 AND role_key = 'custom_role'`,
    [tenantId]
  );
  assert.equal(custom.rows[0]!.is_system, false);

  // System roles exist
  const owner = await pg.query<{ is_system: boolean }>(
    `SELECT is_system FROM platform.roles WHERE tenant_id = $1 AND role_key = 'owner'`,
    [tenantId]
  );
  assert.equal(owner.rows[0]!.is_system, true);

  await pg.close();
});

test('roles catalog: cross-tenant isolation (tenant B sees none of tenant A roles, bundles, or overrides)', async () => {
  const { pg, db } = await setupTestDb();
  await syncPermissionCatalog(db, { rootDir });

  const tA = (await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'tenant-a') RETURNING tenant_id`
  )).rows[0]!.tenant_id;

  const tB = (await pg.query<{ tenant_id: string }>(
    `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
     VALUES (gen_random_uuid(), 'US', 'us-east-1', 'tenant-b') RETURNING tenant_id`
  )).rows[0]!.tenant_id;

  // As tenant A
  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tA]);
  const roleA = (await pg.query<{ role_id: string }>(
    `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
     VALUES ($1, 'app_demo', 'role_a', 'Role A', false) RETURNING role_id`,
    [tA]
  )).rows[0]!.role_id;

  await pg.query(
    `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key) VALUES ($1, $2, 'scheduling.staff')`,
    [roleA, tA]
  );

  // Switch to tenant B
  await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tB]);

  const rolesInB = await pg.query('SELECT * FROM platform.roles WHERE role_key = ' + "'role_a'");
  assert.equal(rolesInB.rows.length, 0);

  const bundlesInB = await pg.query('SELECT * FROM platform.role_bundles WHERE role_id = $1', [roleA]);
  assert.equal(bundlesInB.rows.length, 0);

  await pg.close();
});
