import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RepositoryEffectiveConfigurationService,
  type ConfigurationSettingDefinition,
  type ConfigurationValueCandidate,
} from '../src/index.ts';

const definition: ConfigurationSettingDefinition<number> = {
  settingKey: 'workflow.concurrentCases',
  overrideMode: 'BOUNDED',
  allowedOverrideLevels: ['PLAN', 'TENANT'],
  validateOverride({ current, candidate }) {
    return candidate.value <= current.value
      ? { allowed: true, code: 'WITHIN_LIMIT', reason: 'Within limit.' }
      : { allowed: false, code: 'EXCEEDS_LIMIT', reason: 'Exceeds limit.' };
  },
};

class Definitions {
  value: ConfigurationSettingDefinition | null = definition;
  reads = 0;
  async findDefinition() {
    this.reads += 1;
    return this.value;
  }
}

class Values {
  values: readonly ConfigurationValueCandidate[] = [
    {
      level: 'PLATFORM',
      recordId: 'platform-limit',
      version: 1,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      value: 100,
      evidenceRefs: ['platform:limit'],
    },
    {
      level: 'TENANT',
      scopeId: 'tenant-a',
      recordId: 'tenant-a-limit',
      version: 1,
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      value: 60,
      evidenceRefs: ['tenant:a'],
    },
  ];
  reads = 0;
  lastInput: unknown;
  async listCandidates(input: unknown) {
    this.reads += 1;
    this.lastInput = input;
    return this.values;
  }
}

test('resolves through repositories and the canonical scoped resolver', async () => {
  const values = new Values();
  const result = await new RepositoryEffectiveConfigurationService({
    definitions: new Definitions(),
    values,
  }).resolve({
    settingKey: definition.settingKey,
    context: { tenantId: 'tenant-a' },
    effectiveAt: '2026-08-25T15:00:00.000Z',
  });

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 60);
  assert.equal(result.source.recordId, 'tenant-a-limit');
  assert.deepEqual(values.lastInput, {
    settingKey: definition.settingKey,
    context: { tenantId: 'tenant-a' },
    effectiveAt: '2026-08-25T15:00:00.000Z',
  });
});

test('does not query values when the governed definition is absent', async () => {
  const definitions = new Definitions();
  definitions.value = null;
  const values = new Values();

  const result = await new RepositoryEffectiveConfigurationService({
    definitions,
    values,
  }).resolve({
    settingKey: 'unknown.setting',
    context: { tenantId: 'tenant-a' },
    effectiveAt: '2026-08-25T15:00:00.000Z',
  });

  assert.deepEqual(result, {
    status: 'DENIED',
    settingKey: 'unknown.setting',
    code: 'CONFIGURATION_DEFINITION_NOT_FOUND',
    reason: 'Configuration definition unknown.setting was not found.',
    trace: [],
  });
  assert.equal(values.reads, 0);
});

test('fails closed on a candidate from a sibling context', async () => {
  const values = new Values();
  values.values = [
    values.values[0]!,
    {
      ...values.values[1]!,
      scopeId: 'tenant-b',
      recordId: 'tenant-b-limit',
    },
  ];

  const result = await new RepositoryEffectiveConfigurationService({
    definitions: new Definitions(),
    values,
  }).resolve({
    settingKey: definition.settingKey,
    context: { tenantId: 'tenant-a' },
    effectiveAt: '2026-08-25T15:00:00.000Z',
  });

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 100);
  assert.equal(result.trace[1]?.code, 'CONFIGURATION_SCOPE_MISMATCH');
});
