import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessCompetencyCatalogue,
  type BusinessCompetencyCatalogue,
} from '../src/index.ts';

const catalogue: BusinessCompetencyCatalogue = {
  skills: [{
    skillKey: 'customer_intake',
    label: 'Customer intake',
    description: 'Collects and verifies intake information.',
  }],
  certifications: [{
    certificationKey: 'privacy_training',
    label: 'Privacy training',
    validityDays: 365,
  }],
};

test('validates domain-neutral skills and renewable certifications', () => {
  assert.deepEqual(
    validateBusinessCompetencyCatalogue(catalogue),
    { valid: true, issues: [] },
  );
});

test('allows a non-expiring certification definition', () => {
  assert.deepEqual(
    validateBusinessCompetencyCatalogue({
      skills: [],
      certifications: [{
        certificationKey: 'foundational',
        label: 'Foundational certification',
      }],
    }),
    { valid: true, issues: [] },
  );
});

test('rejects duplicate keys, missing text, and invalid validity windows', () => {
  const result = validateBusinessCompetencyCatalogue({
    skills: [
      { skillKey: 'triage', label: 'Triage', description: 'Prioritizes work.' },
      { skillKey: 'triage', label: '', description: '' },
    ],
    certifications: [
      {
        certificationKey: 'annual_review',
        label: 'Annual review',
        validityDays: 0,
      },
      {
        certificationKey: 'annual_review',
        label: '',
        validityDays: 1.5,
      },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_SKILL_KEY_DUPLICATE',
      'BUSINESS_SKILL_TEXT_REQUIRED',
      'BUSINESS_CERTIFICATION_KEY_DUPLICATE',
      'BUSINESS_CERTIFICATION_LABEL_REQUIRED',
      'BUSINESS_CERTIFICATION_VALIDITY_INVALID',
    ]),
  );
});
