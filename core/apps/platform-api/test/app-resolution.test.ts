import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { dbFromPglite } from '../src/db-pglite.ts';
import { DevIdentityVerifier, signDevToken } from '@platform-core/iam-dev';
import { makeDispatcher, type PlatformApiConfig } from '../src/handler.ts';
import type { RouteDefinition } from '@platform-core/route-kit';
import { makeHostResolver } from '../src/host-router.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEV_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function setupTestDb() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS platform;

    CREATE OR REPLACE FUNCTION platform.current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

    CREATE OR REPLACE FUNCTION platform.current_app_id() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.app_id', true), '') $$;

    CREATE OR REPLACE FUNCTION platform.current_hierarchy_scope() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.hierarchy_scope', true), '') $$;

    CREATE OR REPLACE FUNCTION platform.current_credential_class() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.credential_class', true), '') $$;

    CREATE OR REPLACE FUNCTION platform.current_grant_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.grant_id', true), '')::uuid $$;

    CREATE OR REPLACE FUNCTION platform.set_request_context(
      p_tenant_id uuid,
      p_app_id text,
      p_hierarchy_scope text,
      p_credential_class text,
      p_grant_id uuid
    ) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
      PERFORM set_config('app.app_id', p_app_id, true);
      PERFORM set_config('app.hierarchy_scope', p_hierarchy_scope, true);
      PERFORM set_config('app.credential_class', p_credential_class, true);
      PERFORM set_config('app.grant_id', COALESCE(p_grant_id::text, ''), true);
    END $$;

    CREATE TABLE IF NOT EXISTS platform.apps (
      app_id text PRIMARY KEY,
      display_name text NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS platform.app_clients (
      client_id text PRIMARY KEY,
      app_id text NOT NULL REFERENCES platform.apps(app_id) ON DELETE CASCADE,
      identity_provider text NOT NULL,
      identity_pool_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS platform.tenants (
      tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      country text NOT NULL,
      region text NOT NULL,
      workspace_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, country)
    );

    CREATE TABLE IF NOT EXISTS platform.tenant_apps (
      tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
      app_id text NOT NULL REFERENCES platform.apps(app_id) ON DELETE CASCADE,
      activated_at timestamptz NOT NULL DEFAULT now(),
      deactivated_at timestamptz,
      PRIMARY KEY (tenant_id, app_id)
    );

    CREATE TABLE IF NOT EXISTS platform.memberships (
      membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
      person_id uuid NOT NULL,
      identity_provider text NOT NULL,
      identity_pool_id text NOT NULL,
      identity_subject_id text NOT NULL,
      state text NOT NULL DEFAULT 'ACTIVE',
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      UNIQUE (identity_pool_id, identity_subject_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS platform.role_assignments (
      assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      membership_id uuid NOT NULL REFERENCES platform.memberships(membership_id) ON DELETE CASCADE,
      app_id text NOT NULL,
      role_key text NOT NULL,
      permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
      hierarchy_scope text NOT NULL,
      granted_by uuid NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      revoked_at timestamptz
    );

    -- Seed apps and clients
    INSERT INTO platform.apps (app_id, display_name) VALUES
      ('app_alpha', 'Alpha App'),
      ('app_beta', 'Beta App');

    INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id) VALUES
      ('client-alpha', 'app_alpha', 'dev', 'platform-dev'),
      ('client-beta', 'app_beta', 'dev', 'platform-dev');
  `);
  return pg;
}

function dispatch(dispatcher: ReturnType<typeof makeDispatcher>, req: Partial<IncomingMessage>) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) {
        resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) });
      },
    } as unknown as ServerResponse;
    dispatcher(req as IncomingMessage, mockRes);
  });
}

test('app resolution: token with aud of an unregistered client -> 403 APP_UNKNOWN', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };
  const dummyRoute: RouteDefinition[] = [
    { method: 'GET', path: '/v1/me', appId: '*', requires: [], handler: async () => ({ ok: true }) },
  ];
  const dispatcher = makeDispatcher(dummyRoute, config);

  const token = signDevToken({ sub: 'usr_1', iss: 'platform-dev', aud: 'unknown-client' }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'APP_UNKNOWN');
  await db.close();
});

test('app resolution: aud listing clients of two different apps -> 403 APP_UNKNOWN', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };
  const dummyRoute: RouteDefinition[] = [
    { method: 'GET', path: '/v1/me', appId: '*', requires: [], handler: async () => ({ ok: true }) },
  ];
  const dispatcher = makeDispatcher(dummyRoute, config);

  const token = signDevToken({ sub: 'usr_1', iss: 'platform-dev', aud: ['client-alpha', 'client-beta'] }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'APP_UNKNOWN');
  await db.close();
});

test('app resolution: app_beta token on an app_alpha-owned route -> 404', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');

    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_beta');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };

  const testRoutes: RouteDefinition[] = [
    { method: 'GET', path: '/v1/alpha-only', appId: 'app_alpha', requires: [], handler: async () => ({ ok: true }) },
  ];
  const dispatcher = makeDispatcher(testRoutes, config);

  const token = signDevToken({ sub: 'usr_1', iss: 'platform-dev', aud: 'client-beta' }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/alpha-only',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'REFUSED');
  await db.close();
});

test('app resolution: app_beta token on a "*" route while beta is not activated for the tenant -> 403 APP_NOT_ACTIVATED', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');
    -- Note: app_beta is NOT inserted into platform.tenant_apps
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };

  const testRoutes: RouteDefinition[] = [
    { method: 'GET', path: '/v1/shared', appId: '*', requires: [], handler: async () => ({ ok: true }) },
  ];
  const dispatcher = makeDispatcher(testRoutes, config);

  const token = signDevToken({ sub: 'usr_1', iss: 'platform-dev', aud: 'client-beta' }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/shared',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'APP_NOT_ACTIVATED');
  await db.close();
});

test('app resolution: membership has role assignments only for app_alpha -> app_beta request on "*" route -> 403 TOKEN_SCOPE_MISMATCH', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');

    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES
      ('${tenantId}', 'app_alpha'),
      ('${tenantId}', 'app_beta');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_alpha_user');

    -- Role assignment only for app_alpha
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships LIMIT 1),
            'app_alpha', 'admin', ARRAY['test.read'], 'root', '${personId}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };

  const testRoutes: RouteDefinition[] = [
    { method: 'GET', path: '/v1/shared', appId: '*', requires: ['test.read'], handler: async () => ({ ok: true }) },
  ];
  const dispatcher = makeDispatcher(testRoutes, config);

  // Requesting as app_beta
  const token = signDevToken({ sub: 'usr_alpha_user', iss: 'platform-dev', aud: 'client-beta' }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/shared',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TOKEN_SCOPE_MISMATCH');
  await db.close();
});

test('app resolution: GET /v1/me?x=1 resolves correctly with query string', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', gen_random_uuid(), 'US', 'us-east-1', 'acme');

    INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ('${tenantId}', 'app_alpha');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_alpha_user');

    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships LIMIT 1),
            'app_alpha', 'admin', ARRAY['me.read'], 'root', '${personId}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = { db, identity: verifier, resolveTenantFromHost: makeHostResolver(db) };

  const testRoutes: RouteDefinition[] = [
    {
      method: 'GET',
      path: '/v1/me',
      appId: '*',
      requires: ['me.read'],
      handler: async (ctx) => ({ ok: true, queryParamX: ctx.url.searchParams.get('x') }),
    },
  ];
  const dispatcher = makeDispatcher(testRoutes, config);

  const token = signDevToken({ sub: 'usr_alpha_user', iss: 'platform-dev', aud: 'client-alpha' }, DEV_SECRET);
  const res = await dispatch(dispatcher, {
    method: 'GET',
    url: '/v1/me?x=1',
    headers: { authorization: `Bearer ${token}`, host: 'acme.platform.test' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.queryParamX, '1');
  await db.close();
});
