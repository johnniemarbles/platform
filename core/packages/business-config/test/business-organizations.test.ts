import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessOrganizationCatalogue,
  type BusinessOrganizationCatalogue,
} from '../src/index.ts';

const roles = new Set(['coordinator', 'specialist', 'manager']);

const catalogue: BusinessOrganizationCatalogue = {
  teams: [{
    teamKey: 'service_team',
    label: 'Service team',
    roleKeys: ['coordinator', 'specialist'],
  }],
  relationships: [
    {
      relationshipKey: 'coordinator_manager',
      label: 'Coordinator reports to manager',
      kind: 'REPORTS_TO',
      fromRoleKey: 'coordinator',
      toRoleKey: 'manager',
    },
    {
      relationshipKey: 'coordinator_specialist',
      label: 'Coordinator collaborates with specialist',
      kind: 'COLLABORATES_WITH',
      fromRoleKey: 'coordinator',
      toRoleKey: 'specialist',
    },
  ],
};

test('validates teams and operational role relationships', () => {
  assert.deepEqual(
    validateBusinessOrganizationCatalogue(catalogue, roles),
    { valid: true, issues: [] },
  );
});

test('rejects unknown and duplicate team roles', () => {
  const result = validateBusinessOrganizationCatalogue({
    teams: [{
      teamKey: 'service_team',
      label: 'Service team',
      roleKeys: ['coordinator', 'coordinator', 'unknown'],
    }],
    relationships: [],
  }, roles);

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_TEAM_ROLE_DUPLICATE',
      'BUSINESS_ROLE_REFERENCE_UNKNOWN',
    ]),
  );
});

test('rejects self relationships and reporting cycles', () => {
  const result = validateBusinessOrganizationCatalogue({
    teams: [],
    relationships: [
      {
        relationshipKey: 'coordinator_manager',
        label: 'Coordinator reports to manager',
        kind: 'REPORTS_TO',
        fromRoleKey: 'coordinator',
        toRoleKey: 'manager',
      },
      {
        relationshipKey: 'manager_coordinator',
        label: 'Manager reports to coordinator',
        kind: 'REPORTS_TO',
        fromRoleKey: 'manager',
        toRoleKey: 'coordinator',
      },
      {
        relationshipKey: 'specialist_self',
        label: 'Invalid self relation',
        kind: 'SERVES',
        fromRoleKey: 'specialist',
        toRoleKey: 'specialist',
      },
    ],
  }, roles);

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_RELATIONSHIP_SELF_REFERENCE',
      'BUSINESS_REPORTING_CYCLE',
    ]),
  );
});
