import { createServer } from 'node:http';
import { Pool } from 'pg';
import { dbFromPool } from './db-pg.ts';
import { makeDispatcher, type PlatformApiConfig } from './handler.ts';
import { routesFor } from './routes.ts';
import { identityFromEnv } from './identity.ts';
import { signerFromEnv } from './scope-token.ts';
import { makeHostResolver } from './host-router.ts';

const required = (name: string): string => {
  const v = process.env[name]; if (!v) throw new Error(`${name} is required`); return v;
};

const appId = process.env['PLATFORM_APP_ID'] ?? 'app_dentex';
// Kept wired so Wave 1b flips on with one route-table change rather than a server rewrite.
export const hubBaseUrl = process.env['HUB_BASE_URL'] ?? 'http://localhost:3000';
export const scopeTokenSigner = process.env['SCOPE_TOKEN_HS256_SECRET'] ? signerFromEnv() : undefined;

const pool = new Pool({ connectionString: required('DATABASE_URL') });
const db = dbFromPool(pool);
const config: PlatformApiConfig = {
  db,
  identity: identityFromEnv(),
  resolveTenantFromHost: makeHostResolver(db),
};
const handler = makeDispatcher(routesFor(appId, { signerConfig: scopeTokenSigner, hubBaseUrl }), config);

const port = Number(process.env['PORT'] ?? '3031');
if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid port: ${port}`);
const server = createServer((req, res) => {
  handler(req, res).catch((e) => {
    res.statusCode = 500; res.end(JSON.stringify({ ok: false, code: 'REFUSED' }));
    console.error('[platform-api] uncaught', e);
  });
});
server.listen(port, () => console.log(`[platform-api] listening on :${port}`));
