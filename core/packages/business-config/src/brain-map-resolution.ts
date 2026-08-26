import {
  BRAIN_SOURCE_PRECEDENCE,
  validateBrainMapConfiguration,
  type BrainMapPayload,
  type BrainMapSource,
} from './brain-map.ts';
import type { BusinessConfigurationObject } from './index.ts';

export type BrainMapResolutionErrorCode =
  | 'BRAIN_MAP_CONFIGURATION_INVALID'
  | 'BRAIN_MAP_NOT_PUBLISHED'
  | 'BRAIN_MAP_RESOLUTION_REQUEST_INVALID'
  | 'BRAIN_MAP_PURPOSE_NOT_FOUND'
  | 'BRAIN_MAP_NO_ACTIVE_SOURCES';

export class BrainMapResolutionError extends Error {
  readonly code: BrainMapResolutionErrorCode;

  constructor(code: BrainMapResolutionErrorCode, message: string) {
    super(message);
    this.name = 'BrainMapResolutionError';
    this.code = code;
  }
}

export interface BrainMapResolutionRequest {
  readonly tenantId: string;
  readonly purposeKey: string;
  readonly effectiveAt: string;
}

export interface ResolvedBrainSource {
  readonly sourceId: string;
  readonly kind: BrainMapSource['kind'];
  readonly sourceReference: string;
  readonly contentDigest: string;
  readonly classifications: readonly string[];
}

export interface ResolvedBrainSlice {
  readonly tenantId: string;
  readonly brainMapKey: string;
  readonly brainMapVersion: number;
  readonly purposeKey: string;
  readonly sliceKey: string;
  readonly effectiveAt: string;
  readonly sources: readonly ResolvedBrainSource[];
  readonly sourceReferences: readonly string[];
}

export function resolveBrainMapSlice(
  configuration: BusinessConfigurationObject<BrainMapPayload>,
  request: BrainMapResolutionRequest,
): ResolvedBrainSlice {
  const validation = validateBrainMapConfiguration(configuration);
  if (!validation.valid) {
    throw new BrainMapResolutionError(
      'BRAIN_MAP_CONFIGURATION_INVALID',
      'Company Brain resolution requires a valid governed map.',
    );
  }
  if (configuration.state !== 'PUBLISHED') {
    throw new BrainMapResolutionError(
      'BRAIN_MAP_NOT_PUBLISHED',
      'Only published Company Brain maps may resolve executable context.',
    );
  }
  if (
    request.tenantId !== configuration.payload.tenantId
    || !stable(request.purposeKey)
    || !instant(request.effectiveAt)
  ) {
    throw new BrainMapResolutionError(
      'BRAIN_MAP_RESOLUTION_REQUEST_INVALID',
      'Resolution requires the exact tenant, a stable purpose, and a valid effective time.',
    );
  }

  const slice = configuration.payload.slices.find(
    (candidate) => candidate.purposeKeys.includes(request.purposeKey),
  );
  if (slice === undefined) {
    throw new BrainMapResolutionError(
      'BRAIN_MAP_PURPOSE_NOT_FOUND',
      'The published map does not declare a slice for this purpose.',
    );
  }

  const allowedIds = new Set(slice.sourceIds);
  const sources = configuration.payload.sources
    .filter((source) =>
      allowedIds.has(source.sourceId)
      && source.status === 'APPROVED'
      && Date.parse(source.effectiveFrom) <= Date.parse(request.effectiveAt)
      && (source.effectiveTo === null
        || Date.parse(request.effectiveAt) < Date.parse(source.effectiveTo)))
    .sort((left, right) => {
      const precedence = BRAIN_SOURCE_PRECEDENCE.indexOf(left.kind)
        - BRAIN_SOURCE_PRECEDENCE.indexOf(right.kind);
      return precedence === 0 ? left.sourceId.localeCompare(right.sourceId) : precedence;
    })
    .slice(0, slice.maxItems)
    .map((source): ResolvedBrainSource => ({
      sourceId: source.sourceId,
      kind: source.kind,
      sourceReference: source.sourceReference,
      contentDigest: source.contentDigest,
      classifications: [...source.classifications],
    }));

  if (sources.length === 0) {
    throw new BrainMapResolutionError(
      'BRAIN_MAP_NO_ACTIVE_SOURCES',
      'The selected slice has no approved sources effective at the requested time.',
    );
  }

  return {
    tenantId: request.tenantId,
    brainMapKey: configuration.key,
    brainMapVersion: configuration.version,
    purposeKey: request.purposeKey,
    sliceKey: slice.sliceKey,
    effectiveAt: request.effectiveAt,
    sources,
    sourceReferences: sources.map((source) => source.sourceReference),
  };
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}
