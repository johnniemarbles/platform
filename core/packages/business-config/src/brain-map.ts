import type {
  BusinessConfigurationObject,
} from './index.ts';

export const BRAIN_SOURCE_PRECEDENCE = [
  'PLATFORM_INVARIANT',
  'JURISDICTION_POLICY',
  'TENANT_POLICY',
  'APPROVED_DECISION',
  'ACTIVE_PRIORITY',
  'VERIFIED_FACT',
  'APPROVED_CAPABILITY',
  'UNREVIEWED_PROPOSAL',
] as const;

export type BrainSourceKind = (typeof BRAIN_SOURCE_PRECEDENCE)[number];
export type BrainSourceStatus =
  | 'APPROVED'
  | 'UNREVIEWED'
  | 'SUPERSEDED'
  | 'RETIRED';

export interface BrainMapSource {
  readonly sourceId: string;
  readonly kind: BrainSourceKind;
  readonly status: BrainSourceStatus;
  readonly sourceReference: string;
  readonly contentDigest: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly classifications: readonly string[];
}

export interface BrainMapSlice {
  readonly sliceKey: string;
  readonly purposeKeys: readonly string[];
  readonly sourceIds: readonly string[];
  readonly maxItems: number;
}

export type BrainMapPayload = Readonly<{
  tenantId: string;
  precedence: readonly BrainSourceKind[];
  sources: readonly BrainMapSource[];
  slices: readonly BrainMapSlice[];
}> & Readonly<Record<string, unknown>>;

export type BrainMapIssueCode =
  | 'BRAIN_MAP_KIND_INVALID'
  | 'BRAIN_MAP_SCOPE_INVALID'
  | 'BRAIN_MAP_TENANT_MISMATCH'
  | 'BRAIN_MAP_PRECEDENCE_INVALID'
  | 'BRAIN_MAP_SOURCE_INVALID'
  | 'BRAIN_MAP_SOURCE_DUPLICATE'
  | 'BRAIN_MAP_SOURCE_STATUS_INVALID'
  | 'BRAIN_MAP_SLICE_INVALID'
  | 'BRAIN_MAP_SLICE_DUPLICATE'
  | 'BRAIN_MAP_PURPOSE_DUPLICATE'
  | 'BRAIN_MAP_SLICE_SOURCE_MISSING'
  | 'BRAIN_MAP_UNREVIEWED_SOURCE_EXPOSED'
  | 'BRAIN_MAP_UNEXPECTED_FIELD';

export interface BrainMapIssue {
  readonly code: BrainMapIssueCode;
  readonly path: string;
  readonly message: string;
}

export type BrainMapValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly BrainMapIssue[] };

export function validateBrainMapConfiguration(
  configuration: BusinessConfigurationObject<BrainMapPayload>,
): BrainMapValidationResult {
  const issues: BrainMapIssue[] = [];
  const payload = configuration.payload;

  if (configuration.kind !== 'BRAIN_MAP') {
    add(issues, 'BRAIN_MAP_KIND_INVALID', 'kind', 'Company Brain maps require BRAIN_MAP kind.');
  }
  if (configuration.scope.kind !== 'TENANT') {
    add(issues, 'BRAIN_MAP_SCOPE_INVALID', 'scope', 'Company Brain maps must be tenant scoped.');
  } else if (configuration.scope.tenantId !== payload.tenantId) {
    add(issues, 'BRAIN_MAP_TENANT_MISMATCH', 'payload.tenantId', 'Payload tenant must match configuration scope.');
  }

  rejectUnexpected(payload, ['tenantId', 'precedence', 'sources', 'slices'], 'payload', issues);
  if (!same(payload.precedence, BRAIN_SOURCE_PRECEDENCE)) {
    add(issues, 'BRAIN_MAP_PRECEDENCE_INVALID', 'payload.precedence', 'Precedence must preserve the governed safety-first order.');
  }

  const sourceIds = new Set<string>();
  const sources = new Map<string, BrainMapSource>();
  payload.sources.forEach((source, index) => {
    const path = `payload.sources[${index}]`;
    rejectUnexpected(source, [
      'sourceId', 'kind', 'status', 'sourceReference', 'contentDigest',
      'effectiveFrom', 'effectiveTo', 'classifications',
    ], path, issues);
    if (
      !stable(source.sourceId)
      || !stable(source.sourceReference)
      || !/^sha256:[a-f0-9]{64}$/u.test(source.contentDigest)
      || !instant(source.effectiveFrom)
      || (source.effectiveTo !== null && (
        !instant(source.effectiveTo)
        || Date.parse(source.effectiveTo) < Date.parse(source.effectiveFrom)
      ))
      || source.classifications.length === 0
      || source.classifications.some((value) => !stable(value))
    ) {
      add(issues, 'BRAIN_MAP_SOURCE_INVALID', path, 'Sources require stable references, a SHA-256 digest, valid effectivity, and classifications.');
    }
    if (sourceIds.has(source.sourceId)) {
      add(issues, 'BRAIN_MAP_SOURCE_DUPLICATE', `${path}.sourceId`, 'Source identifiers must be unique.');
    }
    sourceIds.add(source.sourceId);
    sources.set(source.sourceId, source);
    const unreviewed = source.kind === 'UNREVIEWED_PROPOSAL';
    if ((unreviewed && source.status !== 'UNREVIEWED') || (!unreviewed && source.status === 'UNREVIEWED')) {
      add(issues, 'BRAIN_MAP_SOURCE_STATUS_INVALID', `${path}.status`, 'Only proposal sources may be unreviewed, and proposals cannot be approved as truth.');
    }
  });

  const sliceKeys = new Set<string>();
  const purposeKeys = new Set<string>();
  payload.slices.forEach((slice, index) => {
    const path = `payload.slices[${index}]`;
    rejectUnexpected(slice, ['sliceKey', 'purposeKeys', 'sourceIds', 'maxItems'], path, issues);
    if (
      !stable(slice.sliceKey)
      || slice.purposeKeys.length === 0
      || slice.purposeKeys.some((value) => !stable(value))
      || slice.sourceIds.length === 0
      || !Number.isInteger(slice.maxItems)
      || slice.maxItems < 1
    ) {
      add(issues, 'BRAIN_MAP_SLICE_INVALID', path, 'Slices require a key, purposes, sources, and a positive item limit.');
    }
    if (sliceKeys.has(slice.sliceKey)) {
      add(issues, 'BRAIN_MAP_SLICE_DUPLICATE', `${path}.sliceKey`, 'Slice keys must be unique.');
    }
    sliceKeys.add(slice.sliceKey);
    slice.purposeKeys.forEach((purposeKey, purposeIndex) => {
      if (purposeKeys.has(purposeKey)) {
        add(
          issues,
          'BRAIN_MAP_PURPOSE_DUPLICATE',
          `${path}.purposeKeys[${purposeIndex}]`,
          'A purpose can resolve to only one progressive context slice.',
        );
      }
      purposeKeys.add(purposeKey);
    });
    const sliceSourceIds = new Set<string>();
    slice.sourceIds.forEach((sourceId, sourceIndex) => {
      const sourcePath = `${path}.sourceIds[${sourceIndex}]`;
      const source = sources.get(sourceId);
      if (!stable(sourceId) || sliceSourceIds.has(sourceId) || source === undefined) {
        add(issues, 'BRAIN_MAP_SLICE_SOURCE_MISSING', sourcePath, 'Slice sources must be unique identifiers declared by this map.');
      } else if (source.kind === 'UNREVIEWED_PROPOSAL' || source.status !== 'APPROVED') {
        add(issues, 'BRAIN_MAP_UNREVIEWED_SOURCE_EXPOSED', sourcePath, 'Only approved authoritative sources may enter an executable context slice.');
      }
      sliceSourceIds.add(sourceId);
    });
  });

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}

function rejectUnexpected(
  value: object,
  allowed: readonly string[],
  path: string,
  issues: BrainMapIssue[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      add(issues, 'BRAIN_MAP_UNEXPECTED_FIELD', `${path}.${key}`, 'Brain maps are reference-only and reject undeclared fields.');
    }
  }
}

function add(
  issues: BrainMapIssue[],
  code: BrainMapIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}
