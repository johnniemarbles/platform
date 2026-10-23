export const LEARNING_INTEROPERABILITY_PACKAGE_STANDARDS = [
  'SCORM_1_2',
  'SCORM_2004',
  'LTI_1_3',
  'XAPI',
] as const;
export type LearningInteroperabilityPackageStandard =
  (typeof LEARNING_INTEROPERABILITY_PACKAGE_STANDARDS)[number];

export const LEARNING_INTEROPERABILITY_PACKAGE_STATES = [
  'REGISTERED',
  'VALIDATING',
  'AVAILABLE',
  'REJECTED',
  'RETIRED',
] as const;
export type LearningInteroperabilityPackageState =
  (typeof LEARNING_INTEROPERABILITY_PACKAGE_STATES)[number];

export interface LearningInteroperabilityPackageRegistration {
  readonly packageKey: string;
  readonly standard: LearningInteroperabilityPackageStandard;
  readonly title: string;
  readonly description: string;
  readonly assetId: string | null;
  readonly launchUrl: string | null;
  readonly xapiActivityId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export class LearningInteroperabilityValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningInteroperabilityValidationError';
    this.field = field;
    this.code = code;
  }
}

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_METADATA_KEYS = new Set([
  'tenantid',
  'organizationid',
  'credential',
  'credentials',
  'password',
  'secret',
  'storagecredential',
  'token',
  'apikey',
]);

function fail(field: string, code: string, message: string): never {
  throw new LearningInteroperabilityValidationError(field, code, message);
}

function object(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(field, 'INVALID_OBJECT', `${field} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(field, 'REQUIRED', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    return fail(field, 'TOO_LONG', `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, max);
}

function stableKey(value: unknown, field: string): string {
  const key = text(value, field, 160).toLowerCase();
  if (!KEY.test(key)) {
    return fail(
      field,
      'INVALID_KEY',
      `${field} must contain lowercase letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return key;
}

function optionalUuid(value: unknown, field: string): string | null {
  const id = optionalText(value, field, 64);
  if (id === null) return null;
  if (!UUID.test(id)) return fail(field, 'INVALID_UUID', `${field} must be a UUID.`);
  return id;
}

function optionalHttpsUrl(value: unknown, field: string): string | null {
  const raw = optionalText(value, field, 2_048);
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail(field, 'INVALID_URL', `${field} must be an absolute URL.`);
  }
  if (parsed.protocol !== 'https:') {
    return fail(field, 'UNSAFE_URL', `${field} must use https.`);
  }
  return parsed.toString();
}

function optionalXapiActivityId(value: unknown, field: string): string | null {
  const raw = optionalText(value, field, 2_048);
  if (raw === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail(field, 'INVALID_IRI', `${field} must be an absolute IRI.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'urn:') {
    return fail(field, 'UNSAFE_IRI', `${field} must use https or urn.`);
  }
  return parsed.toString();
}

function reservedMetadataPath(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const reserved = reservedMetadataPath(item, `${path}[${index}]`);
      if (reserved !== null) return reserved;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (RESERVED_METADATA_KEYS.has(key.toLowerCase())) return nextPath;
    const reserved = reservedMetadataPath(item, nextPath);
    if (reserved !== null) return reserved;
  }
  return null;
}

function metadata(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  const input = object(value, 'metadata');
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return fail('metadata', 'NOT_SERIALIZABLE', 'metadata must be JSON serializable.');
  }
  if (serialized.length > 50_000) {
    return fail('metadata', 'TOO_LARGE', 'metadata exceeds the package metadata limit.');
  }
  const reserved = reservedMetadataPath(input, 'metadata');
  if (reserved !== null) {
    return fail(
      reserved,
      'RESERVED_METADATA_KEY',
      'Package metadata must not contain tenant, organization, credential, secret, or token authority.',
    );
  }
  return { ...input };
}

export function validateLearningInteroperabilityPackageRegistration(
  value: unknown,
): LearningInteroperabilityPackageRegistration {
  const input = object(value, 'package');
  const standard = text(input.standard, 'standard', 40);
  if (
    !(LEARNING_INTEROPERABILITY_PACKAGE_STANDARDS as readonly string[])
      .includes(standard)
  ) {
    return fail('standard', 'INVALID_STANDARD', 'Unknown learning package standard.');
  }

  const assetId = optionalUuid(input.assetId, 'assetId');
  const launchUrl = optionalHttpsUrl(input.launchUrl, 'launchUrl');
  const xapiActivityId = optionalXapiActivityId(input.xapiActivityId, 'xapiActivityId');

  if (standard === 'SCORM_1_2' || standard === 'SCORM_2004') {
    if (assetId === null) {
      return fail('assetId', 'SCORM_ASSET_REQUIRED', 'SCORM packages require a governed content asset.');
    }
    if (launchUrl !== null || xapiActivityId !== null) {
      return fail('standard', 'SCORM_FIELD_CONFLICT', 'SCORM packages must not carry LTI or xAPI launch authority.');
    }
  }

  if (standard === 'LTI_1_3') {
    if (launchUrl === null) {
      return fail('launchUrl', 'LTI_LAUNCH_URL_REQUIRED', 'LTI 1.3 packages require an HTTPS launch URL.');
    }
    if (assetId !== null || xapiActivityId !== null) {
      return fail('standard', 'LTI_FIELD_CONFLICT', 'LTI packages must not carry SCORM assets or xAPI activity ids.');
    }
  }

  if (standard === 'XAPI') {
    if (xapiActivityId === null) {
      return fail('xapiActivityId', 'XAPI_ACTIVITY_ID_REQUIRED', 'xAPI packages require an activity IRI.');
    }
    if (assetId !== null || launchUrl !== null) {
      return fail('standard', 'XAPI_FIELD_CONFLICT', 'xAPI packages must not carry SCORM assets or LTI launch URLs.');
    }
  }

  return {
    packageKey: stableKey(input.packageKey, 'packageKey'),
    standard: standard as LearningInteroperabilityPackageStandard,
    title: text(input.title, 'title', 300),
    description: optionalText(input.description, 'description', 2_000) ?? '',
    assetId,
    launchUrl,
    xapiActivityId,
    metadata: metadata(input.metadata),
  };
}
