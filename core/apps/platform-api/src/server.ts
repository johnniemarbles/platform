import { createServer } from 'node:http';
import { Pool } from 'pg';
import { dbFromPool } from './db-pg.ts';
import { makeDispatcher, type PlatformApiConfig } from './handler.ts';
import { routes } from './routes.ts';
import { identityFromEnv } from './identity.ts';
import { makeHostResolver } from './host-router.ts';
import { syncAppRegistry } from './app-registry.ts';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

export const hubBaseUrl = process.env['HUB_BASE_URL'] ?? 'http://localhost:3000';

const pool = new Pool({ connectionString: required('DATABASE_URL') });
const db = dbFromPool(pool);

await syncAppRegistry(db);

const config: PlatformApiConfig = {
  db,
  identity: identityFromEnv(),
  resolveTenantFromHost: makeHostResolver(db),
};

const handler = makeDispatcher(routes(), config);

const port = Number(process.env['PORT'] ?? '3031');
if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid port: ${port}`);
const server = createServer((req, res) => {
  handler(req, res).catch((e) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, code: 'REFUSED' }));
    console.error('[platform-api] uncaught', e);
  });
});
server.listen(port, () => console.log(`[platform-api] listening on :${port}`));
