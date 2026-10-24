import assert from 'node:assert/strict';
import test from 'node:test';
import type { EffectiveContext } from '@platform-core/tenancy';
import {
  authorize,
  denySelfApprovalRule,
  type AuthorizationInput,
  type ResourceDescriptor,
  type RoleAssignment,
} from '../src/index.ts';

const context: EffectiveContext = {
  subjectId: 'user-1',
  actorKind: 'user',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  operatingUnitId: 'unit-local',
};

const baseAssignment: RoleAssignment = {
  roleKey: 'regional-operator',
  capabilities: [
    { action: 'read', resourceType: 'case' },
    { action: 'approve', resourceType: 'case', blockedStates: ['closed'] },
  ],
  actionScope: {
    tenantId: 'tenant-1',
    organizationIds: ['org-1'],
    operatingUnitIds: ['unit-local'],
  },
  visibilityScope: {
    tenantId: 'tenant-1',
    organizationIds: ['org-1'],
    operatingUnitIds: ['unit-local', 'unit-child'],
  },
  clearances: ['sensitive'],
  sensitiveCompartments: ['compliance'],
};

function resource(overrides: Partial<ResourceDescriptor> = {}): ResourceDescriptor {
  return {
    type: 'case',
    id: 'case-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    operatingUnitId: 'unit-local',
    state: 'review',
    classification: 'internal',
    ...overrides,
  };
}

function input(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    context,
    query: { action: 'read', intent: 'read', resource: resource() },
    assignments: [baseAssignment],
    ...overrides,
  };
}

test('rejects cross-tenant resources before role evaluation', () => {
  const decision = authorize(
    input({
      query: {
        action: 'read',
        intent: 'read',
        resource: resource({ tenantId: 'tenant-2' }),
      },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, 'TENANT');
});

test('allows broader visibility without granting broader mutation scope', () => {
  const child = resource({ operatingUnitId: 'unit-child' });

  const read = authorize(
    input({ query: { action: 'read', intent: 'read', resource: child } }),
  );
  assert.equal(read.allowed, true);

  const approve = authorize(
    input({ query: { action: 'approve', intent: 'act', resource: child } }),
  );
  assert.equal(approve.allowed, false);
  assert.equal(approve.stage, 'SCOPE');
});

test('enforces resource state before approval', () => {
  const decision = authorize(
    input({
      query: {
        action: 'approve',
        intent: 'act',
        resource: resource({ state: 'closed' }),
      },
    }),
  );
  assert.equal(decision.stage, 'RESOURCE_STATE');
});

test('enforces sensitive compartments', () => {
  const decision = authorize(
    input({
      query: {
        action: 'read',
        intent: 'read',
        resource: resource({ classification: 'sensitive', compartment: 'finance' }),
      },
    }),
  );
  assert.equal(decision.stage, 'CLASSIFICATION');
});

test('requires configured entitlements when requested by the operation', () => {
  const decision = authorize(
    input({
      query: {
        action: 'read',
        intent: 'read',
        resource: resource(),
        requiredEntitlement: 'cases.read',
      },
      entitlements: new Set(),
    }),
  );
  assert.equal(decision.stage, 'ENTITLEMENT');
});

test('restrictions subtract authority', () => {
  const decision = authorize(
    input({
      restrictions: [
        {
          key: 'LEGAL_HOLD',
          action: 'read',
          resourceId: 'case-1',
          reason: 'Legal hold.',
        },
      ],
    }),
  );
  assert.equal(decision.stage, 'RESTRICTION');
  assert.equal(decision.reasonKey, 'LEGAL_HOLD');
});

test('SoD is a final veto and never a grant', () => {
  const owned = resource({ ownerSubjectId: 'user-1' });
  const decision = authorize(
    input({
      query: { action: 'approve', intent: 'act', resource: owned },
      sodRules: [denySelfApprovalRule()],
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, 'SOD');
  assert.equal(decision.vetoedBy, 'SELF_APPROVAL_DENIED');
});
