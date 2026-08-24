import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextResolutionError, resolveEffectiveContext } from '../src/index.ts';

const identity = { subjectId: 'user-1', actorKind: 'user' as const, issuer: 'issuer' };
const membership = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  workspaceIds: ['workspace-1'],
  operatingUnitIds: ['unit-1'],
};

test('resolves a context only through a matching membership', () => {
  const context = resolveEffectiveContext({
    identity,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    operatingUnitId: 'unit-1',
    memberships: [membership],
  });
  assert.equal(context.organizationId, 'org-1');
  assert.equal(context.operatingUnitId, 'unit-1');
});

test('rejects a caller-selected organization without membership', () => {
  assert.throws(
    () =>
      resolveEffectiveContext({
        identity,
        tenantId: 'tenant-1',
        organizationId: 'org-2',
        memberships: [membership],
      }),
    (error: unknown) =>
      error instanceof ContextResolutionError && error.reason === 'NO_MEMBERSHIP',
  );
});

test('rejects an operating unit outside the membership boundary', () => {
  assert.throws(
    () =>
      resolveEffectiveContext({
        identity,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        operatingUnitId: 'unit-2',
        memberships: [membership],
      }),
    (error: unknown) =>
      error instanceof ContextResolutionError && error.reason === 'OPERATING_UNIT_OUT_OF_SCOPE',
  );
});
