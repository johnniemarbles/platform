import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateIndustryProfile,
  type IndustryProfile,
} from '../src/index.ts';

const profile: IndustryProfile = {
  industryKey: 'health_services',
  label: 'Health services',
  components: [
    { kind: 'ONTOLOGY', key: 'service_ontology', version: 2 },
    { kind: 'TERMINOLOGY', key: 'service_terms', version: 3 },
    { kind: 'POLICY', key: 'appointment_policy', version: 1 },
    { kind: 'LIFECYCLE', key: 'appointment_lifecycle', version: 4 },
  ],
};

test('validates an industry as versioned configuration composition', () => {
  assert.deepEqual(
    validateIndustryProfile(profile),
    { valid: true, issues: [] },
  );
});

test('requires ontology and terminology foundations', () => {
  const result = validateIndustryProfile({
    industryKey: 'retail',
    label: 'Retail',
    components: [{ kind: 'POLICY', key: 'returns', version: 1 }],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.filter((issue) =>
      issue.code === 'INDUSTRY_FOUNDATION_REQUIRED'
    ).length,
    2,
  );
});

test('rejects duplicate, invalid, and unversioned component identities', () => {
  const result = validateIndustryProfile({
    industryKey: 'Health Services',
    label: '',
    components: [
      { kind: 'ONTOLOGY', key: 'service ontology', version: 0 },
      { kind: 'TERMINOLOGY', key: 'terms', version: 1 },
      { kind: 'TERMINOLOGY', key: 'terms', version: 1 },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'INDUSTRY_KEY_INVALID',
      'INDUSTRY_LABEL_REQUIRED',
      'INDUSTRY_COMPONENT_KEY_INVALID',
      'INDUSTRY_COMPONENT_VERSION_INVALID',
      'INDUSTRY_COMPONENT_DUPLICATE',
    ]),
  );
});
