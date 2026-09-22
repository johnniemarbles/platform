import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessActorCatalogue,
  type BusinessActorCatalogue,
} from '../src/index.ts';

const catalogue: BusinessActorCatalogue = {
  personas: [
    {
      personaKey: 'service_coordinator',
      label: 'Service coordinator',
      description: 'Coordinates customer service activity.',
    },
    {
      personaKey: 'specialist',
      label: 'Specialist',
      description: 'Performs specialist work.',
    },
  ],
  roles: [{
    roleKey: 'case_owner',
    label: 'Case owner',
    personaKeys: ['service_coordinator', 'specialist'],
  }],
};

test('validates persona-backed operational role profiles', () => {
  assert.deepEqual(
    validateBusinessActorCatalogue(catalogue),
    { valid: true, issues: [] },
  );
});

test('rejects duplicate and unknown persona references', () => {
  const result = validateBusinessActorCatalogue({
    personas: catalogue.personas,
    roles: [{
      roleKey: 'case_owner',
      label: 'Case owner',
      personaKeys: ['specialist', 'specialist', 'unknown'],
    }],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_ROLE_PERSONA_DUPLICATE',
      'BUSINESS_ROLE_PERSONA_UNKNOWN',
    ]),
  );
});

test('requires canonical keys and descriptive persona text', () => {
  const result = validateBusinessActorCatalogue({
    personas: [{
      personaKey: 'Service Coordinator',
      label: '',
      description: '',
    }],
    roles: [{
      roleKey: 'Case Owner',
      label: '',
      personaKeys: [],
    }],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_PERSONA_KEY_INVALID',
      'BUSINESS_PERSONA_TEXT_REQUIRED',
      'BUSINESS_ROLE_KEY_INVALID',
      'BUSINESS_ROLE_LABEL_REQUIRED',
      'BUSINESS_ROLE_PERSONA_REQUIRED',
    ]),
  );
});
