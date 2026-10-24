import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRequestContextSql, assertServerContext } from '../src/index.ts';

const TENANT = '11111111-1111-1111-1111-111111111111';
const GRANT = '22222222-2222-2222-2222-222222222222';

test('a complete context becomes a parameterised set_request_context call', () => {
  const { sql, params } = setRequestContextSql({
    tenantId: TENANT, appId: 'app_dentex', hierarchyScope: 'brand/acme',
    credentialClass: 'tenant-byok', grantId: GRANT,
  });
  assert.equal(sql, 'SELECT platform.set_request_context($1, $2, $3, $4, $5)');
  assert.deepEqual(params, [TENANT, 'app_dentex', 'brand/acme', 'tenant-byok', GRANT]);
});

test('platform-operational contexts omit the grant', () => {
  const { params } = setRequestContextSql({
    tenantId: TENANT, appId: 'app_dentex', hierarchyScope: 'brand/acme',
    credentialClass: 'platform-operational',
  });
  assert.equal(params[4], null);
});

test('a non-UUID tenantId is refused at the type boundary', () => {
  assert.throws(() => assertServerContext({ tenantId: 'tnt_A', appId: 'app', hierarchyScope: 'h', credentialClass: 'platform-operational' } as never));
});

test('a tenant-byok context without a grant is refused', () => {
  assert.throws(() => assertServerContext({ tenantId: TENANT, appId: 'a', hierarchyScope: 'h', credentialClass: 'tenant-byok' } as never));
});

test('an unknown credentialClass is refused', () => {
  assert.throws(() => assertServerContext({ tenantId: TENANT, appId: 'a', hierarchyScope: 'h', credentialClass: 'what' as 'platform-operational' }));
});

test('hierarchyScope with org/<uuid> derives organizationId and produces 6-arg set_request_context call', () => {
  const ORG = '33333333-3333-3333-3333-333333333333';
  const { sql, params } = setRequestContextSql({
    tenantId: TENANT, appId: 'app_dentex', hierarchyScope: `org/${ORG}`,
    credentialClass: 'platform-operational',
  });
  assert.equal(sql, 'SELECT platform.set_request_context($1, $2, $3, $4, $5, $6)');
  assert.deepEqual(params, [TENANT, 'app_dentex', `org/${ORG}`, 'platform-operational', null, ORG]);
});

test('explicit valid organizationId produces 6-arg call while invalid UUID is rejected', () => {
  const ORG = '33333333-3333-3333-3333-333333333333';
  const { sql, params } = setRequestContextSql({
    tenantId: TENANT, appId: 'app_dentex', hierarchyScope: 'tenant/all',
    credentialClass: 'platform-operational', organizationId: ORG,
  });
  assert.equal(sql, 'SELECT platform.set_request_context($1, $2, $3, $4, $5, $6)');
  assert.deepEqual(params, [TENANT, 'app_dentex', 'tenant/all', 'platform-operational', null, ORG]);

  assert.throws(() => assertServerContext({
    tenantId: TENANT, appId: 'app_dentex', hierarchyScope: 'tenant/all',
    credentialClass: 'platform-operational', organizationId: 'not-a-uuid',
  }));
});
