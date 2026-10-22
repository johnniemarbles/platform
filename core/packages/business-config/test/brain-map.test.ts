import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAIN_SOURCE_PRECEDENCE, validateBrainMapConfiguration, type BrainMapPayload, type BusinessConfigurationObject } from '../src/index.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const configuration: BusinessConfigurationObject<BrainMapPayload> = {
  kind: 'BRAIN_MAP', key: 'company-brain', version: 1,
  scope: { kind: 'TENANT', tenantId: 'tenant-1' }, label: 'Company Brain', state: 'DRAFT',
  dependencies: [], authoredBySubjectId: 'architect-1', authoredAt: '2026-08-26T00:00:00.000Z',
  payload: {
    tenantId: 'tenant-1', precedence: BRAIN_SOURCE_PRECEDENCE,
    sources: [{ sourceId: 'policy-1', kind: 'TENANT_POLICY', status: 'APPROVED', sourceReference: 'config://policy/1', contentDigest: digest, effectiveFrom: '2026-08-26T00:00:00.000Z', effectiveTo: null, classifications: ['INTERNAL'] }],
    slices: [{ sliceKey: 'engineering', purposeKeys: ['architecture.review'], sourceIds: ['policy-1'], maxItems: 20 }],
  },
};

test('accepts a tenant-scoped reference-only Company Brain map', () => {
  assert.deepEqual(validateBrainMapConfiguration(configuration), { valid: true, issues: [] });
});

test('rejects undeclared fields so protected content cannot enter the map', () => {
  const result = validateBrainMapConfiguration({ ...configuration, payload: { ...configuration.payload, rawContent: 'secret' } });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.issues.some((issue) => issue.code === 'BRAIN_MAP_UNEXPECTED_FIELD'), true);
});

test('rejects cross-tenant identity and precedence drift', () => {
  const result = validateBrainMapConfiguration({
    ...configuration,
    scope: { kind: 'TENANT', tenantId: 'tenant-2' },
    payload: {
      ...configuration.payload,
      precedence: [...BRAIN_SOURCE_PRECEDENCE].reverse(),
    },
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert.equal(codes.has('BRAIN_MAP_TENANT_MISMATCH'), true);
  assert.equal(codes.has('BRAIN_MAP_PRECEDENCE_INVALID'), true);
});

test('keeps unreviewed correction proposals out of executable slices', () => {
  const proposal = {
    ...configuration.payload.sources[0]!,
    sourceId: 'proposal-1',
    kind: 'UNREVIEWED_PROPOSAL' as const,
    status: 'UNREVIEWED' as const,
  };
  const result = validateBrainMapConfiguration({
    ...configuration,
    payload: {
      ...configuration.payload,
      sources: [proposal],
      slices: [{
        ...configuration.payload.slices[0]!,
        sourceIds: [proposal.sourceId],
      }],
    },
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.some((issue) => issue.code === 'BRAIN_MAP_UNREVIEWED_SOURCE_EXPOSED'),
    true,
  );
});

test('rejects missing source references and invalid digests', () => {
  const result = validateBrainMapConfiguration({
    ...configuration,
    payload: {
      ...configuration.payload,
      sources: [{ ...configuration.payload.sources[0]!, contentDigest: 'raw-content' }],
      slices: [{ ...configuration.payload.slices[0]!, sourceIds: ['missing-source'] }],
    },
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert.equal(codes.has('BRAIN_MAP_SOURCE_INVALID'), true);
  assert.equal(codes.has('BRAIN_MAP_SLICE_SOURCE_MISSING'), true);
});
