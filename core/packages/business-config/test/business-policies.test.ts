import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessPolicyCatalogue,
  type BusinessPolicyCatalogue,
} from '../src/index.ts';

const concepts = new Set(['customer', 'appointment']);
const catalogue: BusinessPolicyCatalogue = {
  policies: [{
    policyKey: 'appointment_confirmation',
    label: 'Appointment confirmation',
    statement: 'Confirm an appointment before service begins.',
    disposition: 'MANDATORY',
    appliesToConceptKeys: ['appointment'],
  }],
};

test('validates declarative policies over known ontology concepts', () => {
  assert.deepEqual(
    validateBusinessPolicyCatalogue(catalogue, concepts),
    { valid: true, issues: [] },
  );
});

test('rejects duplicate and unknown concept targets', () => {
  const result = validateBusinessPolicyCatalogue({
    policies: [{
      ...catalogue.policies[0]!,
      appliesToConceptKeys: ['appointment', 'appointment', 'unknown'],
    }],
  }, concepts);

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_POLICY_TARGET_DUPLICATE',
      'BUSINESS_POLICY_TARGET_UNKNOWN',
    ]),
  );
});

test('requires canonical policy identity, text, and at least one target', () => {
  const result = validateBusinessPolicyCatalogue({
    policies: [{
      policyKey: 'Appointment Confirmation',
      label: '',
      statement: '',
      disposition: 'ADVISORY',
      appliesToConceptKeys: [],
    }],
  }, concepts);

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_POLICY_KEY_INVALID',
      'BUSINESS_POLICY_TEXT_REQUIRED',
      'BUSINESS_POLICY_TARGET_REQUIRED',
    ]),
  );
});
