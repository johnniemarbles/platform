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

    CREATE TABLE IF NOT EXISTS platform.bookings (
      booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
      app_id text NOT NULL,
      patient_name text NOT NULL,
      patient_email text NOT NULL,
      patient_phone text,
      service_key text NOT NULL DEFAULT 'general-checkup',
      chair_id text NOT NULL DEFAULT 'chair-1',
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'CONFIRMED',
      chief_complaint text,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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

test('pipeline: /v1/bookings without bookings.create permission -> TOKEN_SCOPE_MISMATCH', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };
  const dispatcher = makeDispatcher(routesFor('app_dentex'), config);

  const tenantRes = await pg.query<{ tenant_id: string }>(`
    INSERT INTO platform.tenants (account_id, country, region, workspace_name)
    VALUES (gen_random_uuid(), 'US', 'us-east-1', 'acme')
    RETURNING tenant_id;
  `);
  const tenantId = tenantRes.rows[0]!.tenant_id;
  const personId = '33333333-3333-3333-3333-333333333333';

  const memRes = await pg.query<{ membership_id: string }>(`
    INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES ($1, $2, 'dev', 'platform-dev', 'usr_42')
    RETURNING membership_id;
  `, [tenantId, personId]);
  const membershipId = memRes.rows[0]!.membership_id;

  // Granted only 'me.read', missing 'bookings.create'
  await pg.query(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
    VALUES ($1, 'app_dentex', 'reader', ARRAY['me.read']::text[], 'org/1', $2);
  `, [membershipId, personId]);

  const token = signDevToken({ sub: 'usr_42', iss: 'platform-dev' }, DEV_SECRET);
  const req = {
    method: 'POST',
    url: '/v1/bookings',
    headers: {
      authorization: `Bearer ${token}`,
      host: 'acme.platform.test',
      'content-type': 'application/json',
    },
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({
        patientName: 'Jane Doe',
        patientEmail: 'jane@example.com',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
      }));
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

test('pipeline: /v1/bookings creates booking and dispatches confirmation', async () => {
  const pg = await setupTestDb();
  const db = dbFromPglite(pg);
  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };

  let emailDispatched = false;
  const dispatcher = makeDispatcher(routesFor('app_dentex', {
    signerConfig: { algorithm: 'HS256', hs256Secret: DEV_SECRET },
    dispatchEmail: async (options) => {
      emailDispatched = true;
      assert.equal(options.to, 'patient@example.com');
      assert.equal(options.templateKey, 'sched.appointment.confirmed');
      return { ok: true };
    },
  }), config);

  const tenantRes = await pg.query<{ tenant_id: string }>(`
    INSERT INTO platform.tenants (account_id, country, region, workspace_name)
    VALUES (gen_random_uuid(), 'US', 'us-east-1', 'acme')
    RETURNING tenant_id;
  `);
  const tenantId = tenantRes.rows[0]!.tenant_id;
  const personId = '44444444-4444-4444-4444-444444444444';

  const memRes = await pg.query<{ membership_id: string }>(`
    INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
    VALUES ($1, $2, 'dev', 'platform-dev', 'usr_dentist')
    RETURNING membership_id;
  `, [tenantId, personId]);
  const membershipId = memRes.rows[0]!.membership_id;

  await pg.query(`
    INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
    VALUES ($1, 'app_dentex', 'dentist', ARRAY['me.read', 'bookings.create', 'bookings.read']::text[], 'org/1', $2);
  `, [membershipId, personId]);

  const token = signDevToken({ sub: 'usr_dentist', iss: 'platform-dev' }, DEV_SECRET);
  const now = Date.now();
  const startsAt = new Date(now + 86400000).toISOString();
  const endsAt = new Date(now + 90000000).toISOString();

  // 1. Create Booking
  const createReq = {
    method: 'POST',
    url: '/v1/bookings',
    headers: {
      authorization: `Bearer ${token}`,
      host: 'acme.platform.test',
      'content-type': 'application/json',
    },
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({
        patientName: 'John Patient',
        patientEmail: 'patient@example.com',
        patientPhone: '+15551234567',
        serviceKey: 'root-canal',
        chairId: 'chair-2',
        startsAt,
        endsAt,
        chiefComplaint: 'Tooth pain lower left',
      }));
    },
  } as unknown as IncomingMessage;

  const createRes = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(createReq, mockRes);
  });

  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.ok, true);
  assert.equal(createRes.body.result.patientName, 'John Patient');
  assert.equal(createRes.body.result.patientEmail, 'patient@example.com');
  assert.equal(createRes.body.result.serviceKey, 'root-canal');
  assert.equal(createRes.body.result.chairId, 'chair-2');
  assert.equal(createRes.body.result.status, 'CONFIRMED');
  assert.ok(createRes.body.result.bookingId);
  assert.equal(emailDispatched, true);

  // 2. Query Bookings
  const getReq = {
    method: 'GET',
    url: '/v1/bookings',
    headers: {
      authorization: `Bearer ${token}`,
      host: 'acme.platform.test',
    },
  } as unknown as IncomingMessage;

  const getRes = await new Promise<{ status: number; body: any }>((resolve) => {
    const mockRes = {
      statusCode: 200,
      setHeader() {},
      end(chunk: string) { resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) }); },
    } as unknown as ServerResponse;
    dispatcher(getReq, mockRes);
  });

  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.ok, true);
  assert.equal(Array.isArray(getRes.body.result), true);
  assert.equal(getRes.body.result.length, 1);
  assert.equal(getRes.body.result[0].patientName, 'John Patient');
  assert.equal(getRes.body.result[0].serviceKey, 'root-canal');

  await db.close();
});

