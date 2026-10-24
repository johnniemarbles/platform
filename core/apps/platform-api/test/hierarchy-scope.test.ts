import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { collectMigrations } from '../../../../tools/db/migrate.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');

async function setupHierarchyDb() {
  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  const migrations = collectMigrations(rootDir);
  for (const m of migrations) {
    const sql = readFileSync(m.path, 'utf8');
    await pg.exec(sql);
  }

  // Ensure test table with RLS using current_context_can_access_organization
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS platform.test_hierarchy_records (
      record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
      organization_id uuid NOT NULL REFERENCES platform.organizations(organization_id) ON DELETE CASCADE,
      title text NOT NULL
    );
    ALTER TABLE platform.test_hierarchy_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE platform.test_hierarchy_records FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS test_hierarchy_records_isolation ON platform.test_hierarchy_records;
    CREATE POLICY test_hierarchy_records_isolation ON platform.test_hierarchy_records
      FOR ALL
      USING (
        tenant_id = platform.current_tenant_id()
        AND platform.current_context_can_access_organization(tenant_id, organization_id)
      )
      WITH CHECK (
        tenant_id = platform.current_tenant_id()
        AND platform.current_context_can_access_organization(tenant_id, organization_id)
      );

    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
      END IF;
    END $$;

    GRANT ALL ON SCHEMA platform TO app_user;
    GRANT ALL ON ALL TABLES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA platform TO app_user;
  `);

  return pg;
}

test('hierarchy-scope: closure maintenance, cross-hierarchy denial, parent access, and tenant-wide access', async () => {
  const pg = await setupHierarchyDb();

  // 1. Seed Tenant 1
  const t1Res = await pg.query<{ tenant_id: string }>(`
    INSERT INTO platform.tenants (account_id, country, region, workspace_name)
    VALUES (gen_random_uuid(), 'US', 'us-east-1', 'acme')
    RETURNING tenant_id
  `);
  const tenant1Id = t1Res.rows[0]!.tenant_id;

  // 2. Seed Tenant 2 (cross-tenant test)
  const t2Res = await pg.query<{ tenant_id: string }>(`
    INSERT INTO platform.tenants (account_id, country, region, workspace_name)
    VALUES (gen_random_uuid(), 'US', 'us-east-1', 'globex')
    RETURNING tenant_id
  `);
  const tenant2Id = t2Res.rows[0]!.tenant_id;

  // 3. Seed Hierarchy in Tenant 1:
  //    HQ
  //    ├── Region A
  //    │   └── Branch A1
  //    └── Region B
  //        └── Branch B1
  const hqRes = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, name)
    VALUES ($1, 'HQ')
    RETURNING organization_id
  `, [tenant1Id]);
  const hqId = hqRes.rows[0]!.organization_id;

  const regARes = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, parent_organization_id, name)
    VALUES ($1, $2, 'Region A')
    RETURNING organization_id
  `, [tenant1Id, hqId]);
  const regAId = regARes.rows[0]!.organization_id;

  const brA1Res = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, parent_organization_id, name)
    VALUES ($1, $2, 'Branch A1')
    RETURNING organization_id
  `, [tenant1Id, regAId]);
  const brA1Id = brA1Res.rows[0]!.organization_id;

  const regBRes = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, parent_organization_id, name)
    VALUES ($1, $2, 'Region B')
    RETURNING organization_id
  `, [tenant1Id, hqId]);
  const regBId = regBRes.rows[0]!.organization_id;

  const brB1Res = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, parent_organization_id, name)
    VALUES ($1, $2, 'Branch B1')
    RETURNING organization_id
  `, [tenant1Id, regBId]);
  const brB1Id = brB1Res.rows[0]!.organization_id;

  // Verify closure table contents
  const closureRows = await pg.query<{ ancestor_organization_id: string; descendant_organization_id: string; depth: number }>(`
    SELECT ancestor_organization_id, descendant_organization_id, depth
    FROM platform.organization_closure
    WHERE tenant_id = $1
    ORDER BY depth, ancestor_organization_id
  `, [tenant1Id]);

  // HQ should have depth 0 to HQ, depth 1 to Reg A & Reg B, depth 2 to Br A1 & Br B1
  const hqDescendants = closureRows.rows.filter(r => r.ancestor_organization_id === hqId);
  assert.equal(hqDescendants.length, 5, 'HQ has 5 closure entries (self + 4 descendants)');

  // Region A closure entries: self (depth 0) and Branch A1 (depth 1)
  const regADescendants = closureRows.rows.filter(r => r.ancestor_organization_id === regAId);
  assert.equal(regADescendants.length, 2, 'Region A has 2 closure entries (self + Branch A1)');
  assert.ok(regADescendants.some(r => r.descendant_organization_id === brA1Id && r.depth === 1));
  assert.ok(!regADescendants.some(r => r.descendant_organization_id === brB1Id), 'Region A closure does NOT contain Branch B1');

  // Cycle prevention: attempting to set HQ parent to Branch A1 must fail
  await assert.rejects(async () => {
    await pg.query(`
      UPDATE platform.organizations
      SET parent_organization_id = $1
      WHERE organization_id = $2
    `, [brA1Id, hqId]);
  }, /organization hierarchy cycle rejected/);

  // 4. Insert records across all organizations
  await pg.query(`
    INSERT INTO platform.test_hierarchy_records (tenant_id, organization_id, title) VALUES
      ($1, $2, 'HQ Record'),
      ($1, $3, 'Region A Record'),
      ($1, $4, 'Branch A1 Record'),
      ($1, $5, 'Region B Record'),
      ($1, $6, 'Branch B1 Record')
  `, [tenant1Id, hqId, regAId, brA1Id, regBId, brB1Id]);

  // Also insert a record for Tenant 2
  const t2OrgRes = await pg.query<{ organization_id: string }>(`
    INSERT INTO platform.organizations (tenant_id, name)
    VALUES ($1, 'T2 Org')
    RETURNING organization_id
  `, [tenant2Id]);
  const t2OrgId = t2OrgRes.rows[0]!.organization_id;
  await pg.query(`
    INSERT INTO platform.test_hierarchy_records (tenant_id, organization_id, title)
    VALUES ($1, $2, 'Tenant 2 Record')
  `, [tenant2Id, t2OrgId]);

  // Switch to app_user to enforce RLS
  await pg.exec('SET ROLE app_user;');

  // --- Scenario 1: User scoped to Organization A (Region A) ---
  // Must read Region A and Branch A1. CANNOT read Branch B1 (child of sibling) or HQ or Tenant 2.
  await pg.query('BEGIN;');
  await pg.query(`
    SELECT platform.set_request_context(
      $1::uuid,
      'app_demo',
      $2,
      'platform-operational',
      NULL,
      $3::uuid
    )
  `, [tenant1Id, `org/${regAId}`, regAId]);

  const regARead = await pg.query<{ title: string; organization_id: string }>(`
    SELECT title, organization_id FROM platform.test_hierarchy_records ORDER BY title
  `);
  await pg.query('COMMIT;');
  const regATitles = regARead.rows.map(r => r.title);
  assert.deepEqual(regATitles, ['Branch A1 Record', 'Region A Record']);
  assert.ok(!regATitles.includes('Branch B1 Record'), 'User scoped to Org A cannot read Branch B1 (child of sibling)');
  assert.ok(!regATitles.includes('HQ Record'), 'User scoped to Org A cannot read ancestor HQ');
  assert.ok(!regATitles.includes('Tenant 2 Record'), 'Cannot read cross-tenant record');

  // --- Scenario 2: User scoped to Parent (HQ) ---
  // Must read HQ and all child descendants (Region A, Branch A1, Region B, Branch B1)
  await pg.query('BEGIN;');
  await pg.query(`
    SELECT platform.set_request_context(
      $1::uuid,
      'app_demo',
      $2,
      'platform-operational',
      NULL,
      $3::uuid
    )
  `, [tenant1Id, `org/${hqId}`, hqId]);

  const hqRead = await pg.query<{ title: string }>(`
    SELECT title FROM platform.test_hierarchy_records ORDER BY title
  `);
  await pg.query('COMMIT;');
  const hqTitles = hqRead.rows.map(r => r.title);
  assert.deepEqual(hqTitles, [
    'Branch A1 Record',
    'Branch B1 Record',
    'HQ Record',
    'Region A Record',
    'Region B Record',
  ]);

  // --- Scenario 3: Tenant-scoped user (tenant-wide, organization_id is NULL) ---
  // Must read all rows within Tenant 1
  await pg.query('BEGIN;');
  await pg.query(`
    SELECT platform.set_request_context(
      $1::uuid,
      'app_demo',
      $2,
      'platform-operational',
      NULL,
      NULL
    )
  `, [tenant1Id, `tenant/${tenant1Id}`]);

  const tenantWideRead = await pg.query<{ title: string }>(`
    SELECT title FROM platform.test_hierarchy_records ORDER BY title
  `);
  await pg.query('COMMIT;');
  const tenantWideTitles = tenantWideRead.rows.map(r => r.title);
  assert.deepEqual(tenantWideTitles, [
    'Branch A1 Record',
    'Branch B1 Record',
    'HQ Record',
    'Region A Record',
    'Region B Record',
  ]);
  assert.ok(!tenantWideTitles.includes('Tenant 2 Record'), 'Tenant-scoped user still cannot see another tenant');

  // --- Scenario 4: Cross-tenant isolation under Tenant 2 ---
  await pg.query('BEGIN;');
  await pg.query(`
    SELECT platform.set_request_context(
      $1::uuid,
      'app_demo',
      $2,
      'platform-operational',
      NULL,
      NULL
    )
  `, [tenant2Id, `tenant/${tenant2Id}`]);

  const t2Read = await pg.query<{ title: string }>(`
    SELECT title FROM platform.test_hierarchy_records
  `);
  await pg.query('COMMIT;');
  assert.equal(t2Read.rows.length, 1);
  assert.equal(t2Read.rows[0]?.title, 'Tenant 2 Record');

  // Cleanup
  await pg.exec('RESET ROLE;');
  await pg.close();
});
