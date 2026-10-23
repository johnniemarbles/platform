import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { dbFromPglite } from '../src/db-pglite.ts';
import { DevIdentityVerifier, signDevToken } from '@platform-core/iam-dev';
import { makeDispatcher, type PlatformApiConfig } from '../src/handler.ts';
import { routesFor } from '../src/routes.ts';
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

    CREATE TABLE IF NOT EXISTS platform.tenants (
      tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      country text NOT NULL,
      region text NOT NULL,
      workspace_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, country)
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
  `);
  return pg;
}

test('pipeline: /health passes without auth', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  const dispatcher = makeDispatcher(routesFor('app_dentex'), config);

  const req = {
    method: 'GET',
    url: '/health',
    headers: {},
  } as unknown as IncomingMessage;

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(req, mockRes);
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  await db.close();
});

test('pipeline: dev identity token + no membership -> TOKEN_SCOPE_MISMATCH', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', '33333333-3333-3333-3333-333333333333', 'IN', 'ap-south-1', 'acme');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  const dispatcher = makeDispatcher(routesFor('app_dentex'), config);

  const token = signDevToken({ sub: 'usr_stranger', iss: 'platform-dev' }, DEV_SECRET);
  const req = {
    method: 'GET',
    url: '/v1/me',
    headers: {
      authorization: `Bearer ${token}`,
      host: 'acme.platform.test',
    },
  } as unknown as IncomingMessage;

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(req, mockRes);
  });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TOKEN_SCOPE_MISMATCH');
  await db.close();
});

test('pipeline: dev identity + seeded membership + role -> /v1/me returns membership shape', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personId = '22222222-2222-2222-2222-222222222222';

  await pg.exec(`
    INSERT INTO platform.tenants (tenant_id, account_id, country, region, workspace_name)
    VALUES ('${tenantId}', '33333333-3333-3333-3333-333333333333', 'IN', 'ap-south-1', 'acme');

    INSERT INTO platform.memberships (membership_id, tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES (gen_random_uuid(), '${tenantId}', '${personId}', 'dev', 'platform-dev', 'usr_42');

    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
    VALUES ((SELECT membership_id FROM platform.memberships LIMIT 1),
            'app_dentex', 'clinician',
            ARRAY['me.read'], 'brand/acme', '${personId}');
  `);

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  const dispatcher = makeDispatcher(routesFor('app_dentex'), config);

  const token = signDevToken({ sub: 'usr_42', iss: 'platform-dev' }, DEV_SECRET);
  const req = {
    method: 'GET',
    url: '/v1/me',
    headers: {
      authorization: `Bearer ${token}`,
      host: 'acme.platform.test',
    },
  } as unknown as IncomingMessage;

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(req, mockRes);
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.person.id, personId);
  assert.equal(res.body.result.tenant.id, tenantId);
  assert.equal(res.body.result.tenant.country, 'IN');
  assert.equal(res.body.result.tenant.region, 'ap-south-1');
  assert.equal(res.body.result.app, 'app_dentex');
  assert.deepEqual(res.body.result.permissions, ['me.read']);
  await db.close();
});

test('pipeline: identity token with bad signature -> 401 TOKEN_SIGNATURE_INVALID', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  const dispatcher = makeDispatcher(routesFor('app_dentex'), config);

  const badToken = signDevToken({ sub: 'usr_42' }, 'wrongsecret0123456789abcdef0123456789abcdef');
  const req = {
    method: 'GET',
    url: '/v1/me',
    headers: {
      authorization: `Bearer ${badToken}`,
      host: 'acme.platform.test',
    },
  } as unknown as IncomingMessage;

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(req, mockRes);
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'TOKEN_SIGNATURE_INVALID');
  await db.close();
});
