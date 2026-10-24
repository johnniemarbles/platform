import assert from 'node:assert/strict';
import test from 'node:test';
import {
  businessConfigurationIdentityKey,
  validateBusinessConfigurationChangeset,
  type BusinessConfigurationChangeset,
  type BusinessConfigurationObject,
} from '../src/index.ts';

const terminology: BusinessConfigurationObject = {
  kind: 'TERMINOLOGY',
  key: 'customer-labels',
  version: 1,
  scope: { kind: 'VERTICAL', verticalKey: 'dental' },
  label: 'Dental customer terminology',
  state: 'DRAFT',
  payload: { customer: 'Patient' },
  dependencies: [],
  authoredBySubjectId: 'config-admin-1',
  authoredAt: '2026-08-25T14:30:00.000Z',
};

const ontology: BusinessConfigurationObject = {
  kind: 'ONTOLOGY',
  key: 'dental-directory',
  version: 1,
  scope: terminology.scope,
  label: 'Dental directory ontology',
  state: 'DRAFT',
  payload: { entityTypes: ['Practice', 'Clinician'] },
  dependencies: [{
    kind: terminology.kind,
    key: terminology.key,
    version: terminology.version,
  }],
  authoredBySubjectId: 'config-admin-1',
  authoredAt: '2026-08-25T14:30:00.000Z',
};

const changeset: BusinessConfigurationChangeset = {
  changesetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  scope: terminology.scope,
  expectedBaseRevision: 0,
  changes: [ontology, terminology],
  authoredBySubjectId: 'config-admin-1',
  authoredAt: '2026-08-25T14:30:00.000Z',
  reason: 'Introduce the first vertical-neutral configuration boundary.',
  evidenceRefs: ['architecture:p0-e'],
};

test('uses a stable kind, key, and version identity', () => {
  assert.equal(
    businessConfigurationIdentityKey(ontology),
    'ONTOLOGY:dental-directory@1',
  );
});

test('accepts dependencies created in the same atomic changeset', () => {
  assert.deepEqual(
    validateBusinessConfigurationChangeset(changeset, []),
    { valid: true, issues: [] },
  );
});

test('accepts an already-published scope-resolved dependency', () => {
  const policy = {
    ...ontology,
    kind: 'POLICY' as const,
    key: 'directory-access',
    dependencies: [{
      kind: 'ROLE' as const,
      key: 'directory-reviewer',
      version: 2,
    }],
  };

  assert.equal(
    validateBusinessConfigurationChangeset(
      { ...changeset, changes: [policy] },
      [{ kind: 'ROLE', key: 'directory-reviewer', version: 2 }],
    ).valid,
    true,
  );
});

test('rejects missing, duplicate, and self dependencies as one validation result', () => {
  const invalid = {
    ...ontology,
    dependencies: [
      { kind: 'ROLE' as const, key: 'missing', version: 1 },
      { kind: 'ROLE' as const, key: 'missing', version: 1 },
      { kind: ontology.kind, key: ontology.key, version: ontology.version },
    ],
  };

  const result = validateBusinessConfigurationChangeset(
    { ...changeset, changes: [invalid] },
    [],
  );

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.some((entry) => entry.code === 'CONFIG_DEPENDENCY_MISSING'),
    true,
  );
  assert.equal(
    result.issues.some((entry) => entry.code === 'CONFIG_DEPENDENCY_DUPLICATE'),
    true,
  );
  assert.equal(
    result.issues.some((entry) => entry.code === 'CONFIG_DEPENDENCY_SELF_REFERENCE'),
    true,
  );
});

test('rejects duplicate identities, scope drift, and published objects in a draft', () => {
  const result = validateBusinessConfigurationChangeset({
    ...changeset,
    changes: [
      ontology,
      {
        ...ontology,
        scope: { kind: 'TENANT', tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        state: 'PUBLISHED',
      },
    ],
  }, []);

  assert.equal(result.valid, false);
  if (result.valid) return;
  const codes = new Set(result.issues.map((entry) => entry.code));
  assert.equal(codes.has('CONFIG_OBJECT_DUPLICATE'), true);
  assert.equal(codes.has('CONFIG_OBJECT_SCOPE_MISMATCH'), true);
  assert.equal(codes.has('CONFIG_OBJECT_NOT_DRAFT'), true);
});
