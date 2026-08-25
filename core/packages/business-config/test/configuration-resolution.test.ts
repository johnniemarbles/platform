import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveConfigurationValue,
  resolveScopedConfigurationValue,
  type ConfigurationSettingDefinition,
  type ConfigurationValueCandidate,
} from '../src/index.ts';

const candidates: readonly ConfigurationValueCandidate<number>[] = [
  {
    level: 'PLATFORM',
    recordId: 'platform-limit',
    version: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    value: 100,
    evidenceRefs: ['policy:platform'],
  },
  {
    level: 'PLAN',
    recordId: 'plan-limit',
    version: 1,
    effectiveFrom: '2026-02-01T00:00:00.000Z',
    value: 80,
    evidenceRefs: ['plan:enterprise'],
  },
  {
    level: 'VERTICAL',
    scopeId: 'dental',
    recordId: 'vertical-limit',
    version: 1,
    effectiveFrom: '2026-03-01T00:00:00.000Z',
    value: 70,
    evidenceRefs: ['vertical:dental'],
  },
  {
    level: 'TENANT',
    scopeId: 'tenant-1',
    recordId: 'tenant-limit',
    version: 1,
    effectiveFrom: '2026-04-01T00:00:00.000Z',
    value: 60,
    evidenceRefs: ['tenant:1'],
  },
];

const bounded: ConfigurationSettingDefinition<number> = {
  settingKey: 'workflow.concurrentCases',
  overrideMode: 'BOUNDED',
  allowedOverrideLevels: ['PLAN', 'VERTICAL', 'TENANT', 'BRAND', 'WORKSPACE'],
  validateOverride({ current, candidate }) {
    return candidate.value <= current.value
      ? { allowed: true, code: 'WITHIN_PARENT_LIMIT', reason: 'Within limit.' }
      : { allowed: false, code: 'EXCEEDS_PARENT_LIMIT', reason: 'Exceeds limit.' };
  },
};

test('resolves canonical precedence and returns source provenance', () => {
  const result = resolveConfigurationValue(
    bounded,
    candidates,
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 60);
  assert.equal(result.source.level, 'TENANT');
  assert.equal(result.source.recordId, 'tenant-limit');
  assert.equal(result.overridden, true);
  assert.deepEqual(
    result.trace.filter((entry) => entry.outcome === 'APPLIED')
      .map((entry) => entry.level),
    ['PLATFORM', 'PLAN', 'VERTICAL', 'TENANT'],
  );
});

test('rejects a lower scope that exceeds its effective parent bound', () => {
  const result = resolveConfigurationValue(
    bounded,
    [...candidates, {
      level: 'WORKSPACE',
      scopeId: 'workspace-1',
      recordId: 'workspace-limit',
      version: 1,
      effectiveFrom: '2026-05-01T00:00:00.000Z',
      value: 90,
      evidenceRefs: ['workspace:1'],
    }],
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 60);
  assert.equal(
    result.trace.at(-1)?.code,
    'EXCEEDS_PARENT_LIMIT',
  );
});

test('never permits an override of a locked system invariant', () => {
  const result = resolveConfigurationValue(
    {
      settingKey: 'security.tenantIsolation',
      overrideMode: 'LOCKED',
      allowedOverrideLevels: [],
    },
    [
      {
        level: 'SYSTEM_INVARIANT',
        recordId: 'system-isolation',
        version: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        value: true,
        evidenceRefs: ['system:security'],
      },
      {
        level: 'TENANT',
        recordId: 'tenant-isolation',
        version: 1,
        effectiveFrom: '2026-02-01T00:00:00.000Z',
        value: false,
        evidenceRefs: ['tenant:unsafe'],
      },
    ],
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, true);
  assert.equal(result.source.level, 'SYSTEM_INVARIANT');
  assert.equal(result.trace[1]?.code, 'CONFIGURATION_LOCKED');
});

test('applies user preferences only when explicitly permitted', () => {
  const result = resolveConfigurationValue(
    {
      settingKey: 'display.density',
      overrideMode: 'OVERRIDABLE',
      allowedOverrideLevels: ['TENANT', 'USER_PREFERENCE'],
    },
    [
      {
        level: 'PLATFORM',
        recordId: 'platform-density',
        version: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        value: 'comfortable',
        evidenceRefs: ['platform:display'],
      },
      {
        level: 'USER_PREFERENCE',
        scopeId: 'user-1',
        recordId: 'user-density',
        version: 1,
        effectiveFrom: '2026-02-01T00:00:00.000Z',
        value: 'compact',
        evidenceRefs: ['user:preference'],
      },
    ],
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 'compact');
  assert.equal(result.source.level, 'USER_PREFERENCE');
});

test('ignores future values and reports an unresolved empty chain', () => {
  const future = resolveConfigurationValue(
    bounded,
    [{
      ...candidates[0]!,
      effectiveFrom: '2027-01-01T00:00:00.000Z',
    }],
    '2026-08-25T15:00:00.000Z',
  );
  assert.equal(future.status, 'UNRESOLVED');
  assert.equal(future.trace[0]?.outcome, 'NOT_EFFECTIVE');

  assert.deepEqual(
    resolveConfigurationValue(bounded, [], '2026-08-25T15:00:00.000Z'),
    {
      status: 'UNRESOLVED',
      settingKey: bounded.settingKey,
      validation: 'NO_EFFECTIVE_VALUE',
      trace: [],
    },
  );
});

test('selects the newest effective version within one level', () => {
  const result = resolveConfigurationValue(
    bounded,
    [
      candidates[0]!,
      {
        ...candidates[3]!,
        recordId: 'tenant-limit-v1',
        version: 1,
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        value: 60,
      },
      {
        ...candidates[3]!,
        recordId: 'tenant-limit-v2',
        version: 2,
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        value: 70,
      },
    ],
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 70);
  assert.equal(result.source.recordId, 'tenant-limit-v2');
  assert.equal(
    result.trace.some((entry) => entry.code === 'CONFIGURATION_VERSION_SUPERSEDED'),
    true,
  );
});

test('rejects sibling tenant values even when their precedence is higher', () => {
  const result = resolveScopedConfigurationValue(
    bounded,
    [
      candidates[0]!,
      {
        ...candidates[3]!,
        scopeId: 'tenant-a',
        recordId: 'tenant-a-limit',
        value: 60,
      },
      {
        ...candidates[3]!,
        scopeId: 'tenant-b',
        recordId: 'tenant-b-limit',
        value: 50,
      },
    ],
    { tenantId: 'tenant-a' },
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 60);
  assert.equal(result.source.recordId, 'tenant-a-limit');
  assert.equal(
    result.trace.some((entry) =>
      entry.recordId === 'tenant-b-limit'
      && entry.code === 'CONFIGURATION_SCOPE_MISMATCH'
    ),
    true,
  );
});

test('requires exact workspace and user context identifiers', () => {
  const result = resolveScopedConfigurationValue(
    {
      settingKey: 'display.density',
      overrideMode: 'OVERRIDABLE',
      allowedOverrideLevels: ['WORKSPACE', 'USER_PREFERENCE'],
    },
    [
      {
        level: 'PLATFORM',
        recordId: 'platform-density',
        version: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        value: 'comfortable',
        evidenceRefs: ['platform:display'],
      },
      {
        level: 'WORKSPACE',
        scopeId: 'workspace-b',
        recordId: 'workspace-b-density',
        version: 1,
        effectiveFrom: '2026-02-01T00:00:00.000Z',
        value: 'compact',
        evidenceRefs: ['workspace:b'],
      },
      {
        level: 'USER_PREFERENCE',
        scopeId: 'user-b',
        recordId: 'user-b-density',
        version: 1,
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        value: 'dense',
        evidenceRefs: ['user:b'],
      },
    ],
    { workspaceId: 'workspace-a', userSubjectId: 'user-a' },
    '2026-08-25T15:00:00.000Z',
  );

  assert.equal(result.status, 'RESOLVED');
  if (result.status !== 'RESOLVED') return;
  assert.equal(result.effectiveValue, 'comfortable');
  assert.equal(
    result.trace.filter((entry) => entry.code === 'CONFIGURATION_SCOPE_MISMATCH').length,
    2,
  );
});
