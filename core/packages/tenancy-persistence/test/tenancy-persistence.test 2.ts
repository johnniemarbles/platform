import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextResolutionError, type IdentityContext } from '@platform-core/tenancy';
import {
  bindEffectiveContext,
  databaseSessionSettings,
  resolveEffectiveContextFromRepository,
  type MembershipRepository,
  type TransactionContextBinder,
} from '../src/index.ts';

const identity: IdentityContext = { subjectId: 'user-123', actorKind: 'user', issuer: 'oidc:test' };

const repository: MembershipRepository = {
  async listActiveMemberships() {
    return [
      {
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        workspaceIds: ['workspace-a'],
        operatingUnitIds: ['unit-a'],
      },
    ];
  },
};

test('repository-backed resolution still fails closed through tenancy core', async () => {
  await assert.rejects(
    () => resolveEffectiveContextFromRepository(repository, {
      identity,
      tenantId: 'tenant-b',
      organizationId: 'org-b',
    }),
    (error: unknown) => error instanceof ContextResolutionError && error.reason === 'NO_MEMBERSHIP',
  );
});

test('verified persisted membership resolves scoped effective context', async () => {
  const context = await resolveEffectiveContextFromRepository(repository, {
    identity,
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    workspaceId: 'workspace-a',
    operatingUnitId: 'unit-a',
    correlationId: 'corr-1',
  });

  assert.equal(context.tenantId, 'tenant-a');
  assert.equal(context.organizationId, 'org-a');
  assert.equal(context.workspaceId, 'workspace-a');
  assert.equal(context.operatingUnitId, 'unit-a');
});

test('database settings are derived only from already verified effective context', async () => {
  const context = await resolveEffectiveContextFromRepository(repository, {
    identity,
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    workspaceId: 'workspace-a',
  });
  const settings = databaseSessionSettings(context);
  assert.deepEqual(settings.map((entry) => entry.key), [
    'app.tenant_id',
    'app.subject_id',
    'app.organization_id',
    'app.workspace_id',
  ]);
});

test('binder applies settings transaction-locally through a narrow adapter contract', async () => {
  const context = await resolveEffectiveContextFromRepository(repository, {
    identity,
    tenantId: 'tenant-a',
    organizationId: 'org-a',
  });
  const applied: Array<[string, string]> = [];
  const binder: TransactionContextBinder = {
    async setLocal(key, value) {
      applied.push([key, value]);
    },
  };

  await bindEffectiveContext(binder, context);
  assert.deepEqual(applied, [
    ['app.tenant_id', 'tenant-a'],
    ['app.subject_id', 'user-123'],
    ['app.organization_id', 'org-a'],
  ]);
});
