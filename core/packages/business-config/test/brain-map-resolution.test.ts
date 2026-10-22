import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAIN_SOURCE_PRECEDENCE,
  BrainMapResolutionError,
  resolveBrainMapSlice,
  type BrainMapPayload,
  type BusinessConfigurationObject,
} from '../src/index.ts';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const configuration: BusinessConfigurationObject<BrainMapPayload> = {
  kind: 'BRAIN_MAP',
  key: 'company-brain',
  version: 3,
  scope: { kind: 'TENANT', tenantId: 'tenant-1' },
  label: 'Published Company Brain',
  state: 'PUBLISHED',
  dependencies: [],
  authoredBySubjectId: 'architect-1',
  authoredAt: '2026-08-26T00:00:00.000Z',
  payload: {
    tenantId: 'tenant-1',
    precedence: BRAIN_SOURCE_PRECEDENCE,
    sources: [
      {
        sourceId: 'fact-1', kind: 'VERIFIED_FACT', status: 'APPROVED',
        sourceReference: 'knowledge://fact/1', contentDigest: digest('a'),
        effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
        classifications: ['INTERNAL'],
      },
      {
        sourceId: 'policy-1', kind: 'TENANT_POLICY', status: 'APPROVED',
        sourceReference: 'config://policy/1', contentDigest: digest('b'),
        effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
        classifications: ['RESTRICTED'],
      },
      {
        sourceId: 'future-1', kind: 'VERIFIED_FACT', status: 'APPROVED',
        sourceReference: 'knowledge://fact/future', contentDigest: digest('c'),
        effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveTo: null,
        classifications: ['INTERNAL'],
      },
    ],
    slices: [{
      sliceKey: 'engineering', purposeKeys: ['architecture.review'],
      sourceIds: ['fact-1', 'future-1', 'policy-1'], maxItems: 2,
    }],
  },
};

test('resolves only effective sources in governed precedence order', () => {
  const result = resolveBrainMapSlice(configuration, {
    tenantId: 'tenant-1',
    purposeKey: 'architecture.review',
    effectiveAt: '2026-08-26T00:00:00.000Z',
  });
  assert.deepEqual(result.sourceReferences, [
    'config://policy/1',
    'knowledge://fact/1',
  ]);
  assert.equal(result.brainMapVersion, 3);
});

test('fails closed for a draft map', () => {
  assert.throws(
    () => resolveBrainMapSlice({ ...configuration, state: 'DRAFT' }, {
      tenantId: 'tenant-1', purposeKey: 'architecture.review',
      effectiveAt: '2026-08-26T00:00:00.000Z',
    }),
    (error) => error instanceof BrainMapResolutionError
      && error.code === 'BRAIN_MAP_NOT_PUBLISHED',
  );
});

test('fails closed for an undeclared purpose', () => {
  assert.throws(
    () => resolveBrainMapSlice(configuration, {
      tenantId: 'tenant-1', purposeKey: 'sales.outreach',
      effectiveAt: '2026-08-26T00:00:00.000Z',
    }),
    (error) => error instanceof BrainMapResolutionError
      && error.code === 'BRAIN_MAP_PURPOSE_NOT_FOUND',
  );
});

test('fails closed when no source is effective', () => {
  assert.throws(
    () => resolveBrainMapSlice(configuration, {
      tenantId: 'tenant-1', purposeKey: 'architecture.review',
      effectiveAt: '2026-07-01T00:00:00.000Z',
    }),
    (error) => error instanceof BrainMapResolutionError
      && error.code === 'BRAIN_MAP_NO_ACTIVE_SOURCES',
  );
});
