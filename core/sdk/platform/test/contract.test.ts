import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHarness } from '../../../apps/platform-api/test/helpers/harness.ts';
import type { Transport } from '@platform-sdk/transport';
import { assertShape } from '../../transport/src/test-utils.ts';
import { platformClient } from '../src/index.ts';

test('platform sdk: me() contract test against real platform-api', async () => {
  const harness = await setupHarness('dentex');
  const owner = await harness.asRole('owner');

  const transport: Transport = {
    async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
      const res = await owner.request(method, path, body);
      if (res.status >= 400) {
        throw new Error(`request failed with status ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return res.body.result;
    },
  };

  const client = platformClient(transport);
  const me = await client.me();

  assertShape(me, {
    person: 'object',
    identity: 'object',
    tenant: 'object',
    app: 'string',
    permissions: 'array',
    hierarchyScope: 'string',
  });
  assertShape(me.person, { id: 'string' });
  assertShape(me.identity, { provider: 'string', subject: 'string' });
  assertShape(me.tenant, { id: 'string', country: 'string', region: 'string' });

  assert.equal(me.app, 'app_dentex');
  assert.ok(me.permissions.includes('me.read'));

  // Test admin.catalog()
  const catalog = await client.admin.catalog();
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length > 0);
  assertShape(catalog[0], {
    bundleKey: 'string',
    description: 'string',
    source: 'string',
    keys: 'array',
  });

  // Test admin.roles.list()
  const roles = await client.admin.roles.list();
  assert.ok(Array.isArray(roles));
  assert.ok(roles.length > 0);
  assertShape(roles[0], {
    roleId: 'string',
    roleKey: 'string',
    displayName: 'string',
    isSystem: 'boolean',
    bundles: 'array',
    overrides: 'array',
    optedInKeys: 'array',
    effectivePermissions: 'array',
  });

  // Test admin.roles.create()
  const newRole = await client.admin.roles.create({
    roleKey: 'test_assistant',
    displayName: 'Test Assistant',
    bundles: ['platform.member'],
  });
  assertShape(newRole, {
    roleId: 'string',
    roleKey: 'string',
    displayName: 'string',
    isSystem: 'boolean',
  });
  assert.equal(newRole.roleKey, 'test_assistant');

  // Test admin.roles.update()
  const updatedRole = await client.admin.roles.update(newRole.roleId, {
    displayName: 'Senior Test Assistant',
  });
  assert.equal(updatedRole.displayName, 'Senior Test Assistant');

  // Test admin.members.search()
  const members = await client.admin.members.search({ email: 'usr_owner_acme' });
  assert.ok(Array.isArray(members));

  // Test admin.assignments.grant()
  const assign = await client.admin.assignments.grant({
    membershipId: (await harness.pg.query<{ membership_id: string }>('SELECT membership_id FROM platform.memberships LIMIT 1')).rows[0]!.membership_id,
    roleId: newRole.roleId,
    hierarchyScope: 'root',
  });
  assertShape(assign, {
    assignmentId: 'string',
    membershipId: 'string',
    roleId: 'string',
    hierarchyScope: 'string',
  });

  // Test admin.assignments.revoke()
  const revokeRes = await client.admin.assignments.revoke(assign.assignmentId);
  assert.equal(revokeRes.revoked, true);

  await harness.close();
});
