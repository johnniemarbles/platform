/**
 * Single migration runner for the platform monorepo.
 * Order: core → hub → app packs. Keys: bare filename (core, hub), "<slug>/<file>" (app packs).
 * Serialised with a Postgres advisory lock, so hub-api and platform-api can both run it on boot.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK_KEY = 727274001;

export interface MigrationFile { readonly key: string; readonly path: string; }

export function collectMigrations(root = ROOT): MigrationFile[] {
  const sqlIn = (dir: string) => existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  const coreDir = join(root, 'core', 'infra', 'db', 'migrations');
  const hubDir = join(root, 'hub', 'infra', 'db', 'migrations');
  const core = sqlIn(coreDir), hub = sqlIn(hubDir);
  const clash = core.filter((f) => hub.includes(f));
  if (clash.length) throw new Error(`same migration filename in core and hub: ${clash.join(', ')}`);
  const out: MigrationFile[] = [
    ...core.map((f) => ({ key: f, path: join(coreDir, f) })),
    ...hub.map((f) => ({ key: f, path: join(hubDir, f) })),
  ];
  const packsDir = join(root, 'core', 'app-packs');
  if (existsSync(packsDir)) {
    for (const slug of readdirSync(packsDir).sort()) {
      const dir = join(packsDir, slug, 'migrations');
      for (const f of sqlIn(dir)) out.push({ key: `${slug}/${f}`, path: join(dir, f) });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS platform;
      CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL)`);
    for (const m of collectMigrations()) {
      const sql = readFileSync(m.path, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prev = await client.query<{ checksum: string }>('SELECT checksum FROM platform.schema_migrations WHERE filename = $1', [m.key]);
      if (prev.rows[0]) {
        if (prev.rows[0].checksum !== checksum) throw new Error(`${m.key} was applied with a different checksum; never edit applied migrations`);
        continue;
      }
      process.stdout.write(`applying ${m.key} ... `);
      await client.query(sql);
      await client.query('INSERT INTO platform.schema_migrations (filename, checksum) VALUES ($1, $2)', [m.key, checksum]);
      process.stdout.write('ok\n');
    }
    console.log('migrations complete');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release(); await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
