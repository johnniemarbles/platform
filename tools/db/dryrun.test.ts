import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { collectMigrations, type MigrationFile } from './migrate.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const newDb = () => PGlite.create({ extensions: { pgcrypto, btree_gist } });

async function initSchemaMigrations(db: PGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS platform;
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text NOT NULL
    );
  `);
}

async function applyAllMigrations(db: PGlite, migrations: MigrationFile[]) {
  await initSchemaMigrations(db);
  for (const m of migrations) {
    const prev = await db.query<{ filename: string }>(
      'SELECT filename FROM platform.schema_migrations WHERE filename = $1',
      [m.key]
    );
    if (prev.rows.length > 0) continue;

    const sql = readFileSync(m.path, 'utf8');
    try {
      await db.exec(sql);
      await db.query(
        'INSERT INTO platform.schema_migrations (filename, checksum) VALUES ($1, $2)',
        [m.key, 'test-checksum']
      );
    } catch (e) {
      (e as { migration?: string }).migration = m.key;
      throw e;
    }
  }
}

test('1 & 2. apply collectMigrations() in order to an empty database; assert every file applies', async () => {
  const migrations = collectMigrations(ROOT);
  assert.ok(migrations.length >= 10, `expected migrations, found ${migrations.length}`);

  const db = await newDb();
  await applyAllMigrations(db, migrations);

  const applied = await db.query<{ count: string }>('SELECT count(*) as count FROM platform.schema_migrations');
  assert.equal(Number(applied.rows[0]?.count), migrations.length);
  await db.close();
});

test('3. Staging-shaped test: apply 0000_hub_core_stubs.sql alone, then the full sequence (F2 regression test)', async () => {
  const db = await newDb();
  const hubStubSql = readFileSync(join(ROOT, 'hub', 'infra', 'db', 'migrations', '0000_hub_core_stubs.sql'), 'utf8');
  await db.exec(hubStubSql);

  const migrations = collectMigrations(ROOT);
  await applyAllMigrations(db, migrations);

  const res = await db.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name = 'tenants'
    ORDER BY column_name;
  `);
  const columns = res.rows.map((r) => r.column_name);
  assert.ok(columns.includes('workspace_name'), '0009 should upgrade tenants table to have workspace_name');
  assert.ok(columns.includes('account_id'), '0009 should upgrade tenants table to have account_id');

  await db.close();
});

test('4. Re-apply the full sequence; files must be idempotent or skipped', async () => {
  const db = await newDb();
  const migrations = collectMigrations(ROOT);
  await applyAllMigrations(db, migrations);
  // Re-run
  await applyAllMigrations(db, migrations);

  const applied = await db.query<{ count: string }>('SELECT count(*) as count FROM platform.schema_migrations');
  assert.equal(Number(applied.rows[0]?.count), migrations.length);
  await db.close();
});

test('5. app_may_use_connector enforces the three credential classes correctly', async () => {
  const db = await newDb();
  const migrations = collectMigrations(ROOT);
  await applyAllMigrations(db, migrations);

  // Fixture: two tenants, two apps, three connectors
  await db.exec(`
    INSERT INTO platform.tenants (account_id, country, region, workspace_name, tenant_id)
    VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'US', 'us-east-1', 'tenant-a', '11111111-1111-1111-1111-111111111111'),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'US', 'us-east-1', 'tenant-b', '22222222-2222-2222-2222-222222222222');

    INSERT INTO platform.connectors
      (connector_id, connector_key, provider_type, provider_key, ownership_scope, tenant_id)
    VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ses.platform', 'email', 'ses', 'PLATFORM', NULL),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'twilio.A.byok', 'sms', 'twilio', 'TENANT', '11111111-1111-1111-1111-111111111111'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'twilio.A.prov', 'sms', 'twilio', 'TENANT', '11111111-1111-1111-1111-111111111111');

    INSERT INTO platform.connector_grants
      (tenant_id, app_id, connector_id, credential_class, granted_by)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 'app_dentex',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-byok',
       '99999999-9999-9999-9999-999999999999');
  `);

  const check = async (tenant: string, app: string, connector: string, cls: string) => {
    const res = await db.query<{ ok: boolean }>(
      `SELECT platform.app_may_use_connector($1, $2, $3, $4) AS ok`,
      [tenant, app, connector, cls],
    );
    return res.rows[0]?.ok ?? false;
  };

  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_dentex', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'platform-operational'), true);
  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_dentex', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'platform-operational'), false);
  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_dentex', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant-byok'), false);
  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_dentex', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-byok'), true);
  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_dentex', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'tenant-byok'), false);
  assert.equal(await check('22222222-2222-2222-2222-222222222222', 'app_dentex', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-byok'), false);
  assert.equal(await check('11111111-1111-1111-1111-111111111111', 'app_insurance', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant-byok'), false);

  await db.close();
});

test('5b. set_request_context sets LOCAL GUCs that roll back at commit', async () => {
  const db = await newDb();
  const migrations = collectMigrations(ROOT);
  await applyAllMigrations(db, migrations);

  const tenant = '11111111-1111-1111-1111-111111111111';
  await db.exec('BEGIN');
  await db.query(`SELECT platform.set_request_context($1, $2, $3, $4, NULL)`,
    [tenant, 'app_dentex', 'brand/acme', 'platform-operational']);
  const inTx = await db.query<{ v: string | null }>(`SELECT platform.current_tenant_id()::text AS v`);
  assert.equal(inTx.rows[0]?.v, tenant);
  await db.exec('COMMIT');

  await db.exec('BEGIN');
  const after = await db.query<{ v: string | null }>(`SELECT platform.current_tenant_id()::text AS v`);
  assert.equal(after.rows[0]?.v, null);
  await db.exec('COMMIT');

  await db.close();
});
