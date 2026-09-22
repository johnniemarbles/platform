export const LESSON_CONTENT_SCHEMA_VERSION = 1 as const;

export const LESSON_CONTENT_BLOCK_TYPES = [
  'RICH_TEXT',
  'HEADING',
  'CALLOUT',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'DOCUMENT',
  'RESOURCE',
  'EMBED',
  'CODE',
  'CHECKPOINT',
  'ASSIGNMENT',
  'DISCUSSION_PROMPT',
  'LIVE_SESSION',
  'SCORM',
  'EXTENSION',
] as const;

export type LessonContentBlockType = (typeof LESSON_CONTENT_BLOCK_TYPES)[number];

export interface LessonContentBlock {
  readonly id: string;
  readonly type: LessonContentBlockType;
  readonly position: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly accessibility?: Readonly<{
    label?: string;
    description?: string;
    decorative?: boolean;
    transcriptAssetId?: string;
    captionsAssetId?: string;
  }>;
}

export interface LessonContentDocument {
  readonly schemaVersion: typeof LESSON_CONTENT_SCHEMA_VERSION;
  readonly blocks: readonly LessonContentBlock[];
}

export class LessonContentValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LessonContentValidationError';
    this.field = field;
    this.code = code;
  }
}

const BLOCK_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION_KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const SAFE_PROTOCOLS = new Set(['https:', 'mailto:']);
const MAX_BLOCKS = 500;
const MAX_TEXT = 100_000;
const MAX_DATA_BYTES = 250_000;

function fail(field: string, code: string, message: string): never {
  throw new LessonContentValidationError(field, code, message);
}

function object(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(field, 'INVALID_OBJECT', `${field} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredText(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(field, 'REQUIRED', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    return fail(field, 'TOO_LONG', `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max = 2_000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return fail(field, 'INVALID_TEXT', `${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length > max) return fail(field, 'TOO_LONG', `${field} exceeds ${max} characters.`);
  return normalized || undefined;
}

function positivePosition(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    return fail(field, 'INVALID_POSITION', `${field} must be a positive integer.`);
  }
  return Number(value);
}

function assetId(value: unknown, field: string): string {
  const id = requiredText(value, field, 64);
  if (!ASSET_ID.test(id)) return fail(field, 'INVALID_ASSET_ID', `${field} must be a UUID asset reference.`);
  return id;
}

function safeUrl(value: unknown, field: string): string {
  const raw = requiredText(value, field, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail(field, 'INVALID_URL', `${field} must be an absolute URL.`);
  }
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    return fail(field, 'UNSAFE_URL', `${field} uses a prohibited URL protocol.`);
  }
  return parsed.toString();
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  field: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) fail(`${field}.${unexpected}`, 'UNKNOWN_FIELD', `${field} contains an unknown field.`);
}

function validateAccessibility(
  value: unknown,
  field: string,
): LessonContentBlock['accessibility'] {
  if (value === undefined || value === null) return undefined;
  const input = object(value, field);
  rejectUnknownKeys(input, ['label', 'description', 'decorative', 'transcriptAssetId', 'captionsAssetId'], field);
  if (input.decorative !== undefined && typeof input.decorative !== 'boolean') {
    fail(`${field}.decorative`, 'INVALID_BOOLEAN', 'decorative must be a boolean.');
  }
  const result: Record<string, unknown> = {};
  const label = optionalText(input.label, `${field}.label`, 500);
  if (label !== undefined) result.label = label;
  
  const description = optionalText(input.description, `${field}.description`, 2_000);
  if (description !== undefined) result.description = description;
  
  if (input.decorative !== undefined) result.decorative = input.decorative === true;
  
  if (input.transcriptAssetId !== undefined) {
    result.transcriptAssetId = assetId(input.transcriptAssetId, `${field}.transcriptAssetId`);
  }
  
  if (input.captionsAssetId !== undefined) {
    result.captionsAssetId = assetId(input.captionsAssetId, `${field}.captionsAssetId`);
  }
  
  return result as LessonContentBlock['accessibility'];
}

function validateData(
  type: LessonContentBlockType,
  raw: unknown,
  field: string,
  accessibility: LessonContentBlock['accessibility'],
): Readonly<Record<string, unknown>> {
  const data = object(raw, field);
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return fail(field, 'NOT_SERIALIZABLE', `${field} must be JSON serializable.`);
  }
  if (serialized.length > MAX_DATA_BYTES) {
    return fail(field, 'TOO_LARGE', `${field} exceeds the block payload limit.`);
  }

  switch (type) {
    case 'RICH_TEXT':
      rejectUnknownKeys(data, ['text', 'marks'], field);
      return { text: requiredText(data.text, `${field}.text`), ...(data.marks === undefined ? {} : { marks: data.marks }) };
    case 'HEADING': {
      rejectUnknownKeys(data, ['text', 'level'], field);
      const level = Number(data.level ?? 2);
      if (![2, 3, 4].includes(level)) fail(`${field}.level`, 'INVALID_HEADING_LEVEL', 'Heading level must be 2, 3, or 4.');
      return { text: requiredText(data.text, `${field}.text`, 500), level };
    }
    case 'CALLOUT':
      rejectUnknownKeys(data, ['text', 'tone'], field);
      if (data.tone !== undefined && !['INFO', 'SUCCESS', 'WARNING', 'DANGER'].includes(String(data.tone))) {
        fail(`${field}.tone`, 'INVALID_TONE', 'Unknown callout tone.');
      }
      return { text: requiredText(data.text, `${field}.text`), tone: data.tone ?? 'INFO' };
    case 'IMAGE':
      rejectUnknownKeys(data, ['assetId'], field);
      if (accessibility?.decorative !== true && !accessibility?.label) {
        fail('accessibility.label', 'IMAGE_ALT_REQUIRED', 'Non-decorative images require an accessibility label.');
      }
      return { assetId: assetId(data.assetId, `${field}.assetId`) };
    case 'VIDEO':
    case 'AUDIO':
      rejectUnknownKeys(data, ['assetId', 'externalUrl'], field);
      if (data.assetId === undefined && data.externalUrl === undefined) {
        fail(field, 'MEDIA_SOURCE_REQUIRED', 'Media requires an assetId or externalUrl.');
      }
      if (data.assetId !== undefined && data.externalUrl !== undefined) {
        fail(field, 'MEDIA_SOURCE_CONFLICT', 'Media must use exactly one source.');
      }
      return data.assetId !== undefined
        ? { assetId: assetId(data.assetId, `${field}.assetId`) }
        : { externalUrl: safeUrl(data.externalUrl, `${field}.externalUrl`) };
    case 'DOCUMENT':
    case 'RESOURCE':
      rejectUnknownKeys(data, ['assetId', 'title'], field);
      return {
        assetId: assetId(data.assetId, `${field}.assetId`),
        title: requiredText(data.title, `${field}.title`, 500),
      };
    case 'EMBED':
      rejectUnknownKeys(data, ['url', 'title'], field);
      return {
        url: safeUrl(data.url, `${field}.url`),
        title: requiredText(data.title, `${field}.title`, 500),
      };
    case 'CODE':
      rejectUnknownKeys(data, ['code', 'language'], field);
      return {
        code: requiredText(data.code, `${field}.code`),
        language: requiredText(data.language, `${field}.language`, 80),
      };
    case 'CHECKPOINT':
    case 'ASSIGNMENT':
      rejectUnknownKeys(data, ['definitionId', 'title'], field);
      return {
        definitionId: requiredText(data.definitionId, `${field}.definitionId`, 120),
        title: optionalText(data.title, `${field}.title`, 500),
      };
    case 'DISCUSSION_PROMPT':
      rejectUnknownKeys(data, ['prompt'], field);
      return { prompt: requiredText(data.prompt, `${field}.prompt`) };
    case 'LIVE_SESSION':
      rejectUnknownKeys(data, ['title', 'startsAt', 'joinUrl'], field);
      if (Number.isNaN(Date.parse(String(data.startsAt)))) {
        fail(`${field}.startsAt`, 'INVALID_DATE', 'startsAt must be an ISO date-time.');
      }
      return {
        title: requiredText(data.title, `${field}.title`, 500),
        startsAt: new Date(String(data.startsAt)).toISOString(),
        joinUrl: safeUrl(data.joinUrl, `${field}.joinUrl`),
      };
    case 'SCORM':
      rejectUnknownKeys(data, ['assetId', 'standard'], field);
      if (!['SCORM_1_2', 'SCORM_2004'].includes(String(data.standard))) {
        fail(`${field}.standard`, 'INVALID_SCORM_STANDARD', 'Unknown SCORM standard.');
      }
      return { assetId: assetId(data.assetId, `${field}.assetId`), standard: data.standard };
    case 'EXTENSION': {
      rejectUnknownKeys(data, ['extensionKey', 'payload'], field);
      const extensionKey = requiredText(data.extensionKey, `${field}.extensionKey`, 120).toLowerCase();
      if (!EXTENSION_KEY.test(extensionKey)) {
        fail(`${field}.extensionKey`, 'INVALID_EXTENSION_KEY', 'extensionKey must be namespaced.');
      }
      return { extensionKey, payload: object(data.payload, `${field}.payload`) };
    }
  }
}

export function isLessonContentDocument(value: unknown): value is LessonContentDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.schemaVersion !== undefined || input.blocks !== undefined;
}

export function validateLessonContentDocument(value: unknown): LessonContentDocument {
  const input = object(value, 'content');
  rejectUnknownKeys(input, ['schemaVersion', 'blocks'], 'content');
  if (input.schemaVersion !== LESSON_CONTENT_SCHEMA_VERSION) {
    fail('content.schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION', 'Unsupported lesson content schema version.');
  }
  if (!Array.isArray(input.blocks)) fail('content.blocks', 'INVALID_LIST', 'content.blocks must be an array.');
  if (input.blocks.length > MAX_BLOCKS) fail('content.blocks', 'TOO_MANY_BLOCKS', `A lesson supports at most ${MAX_BLOCKS} blocks.`);

  const ids = new Set<string>();
  const positions = new Set<number>();
  const blocks = input.blocks.map((raw, index): LessonContentBlock => {
    const field = `content.blocks[${index}]`;
    const block = object(raw, field);
    rejectUnknownKeys(block, ['id', 'type', 'position', 'data', 'accessibility'], field);
    const id = requiredText(block.id, `${field}.id`, 120);
    if (!BLOCK_ID.test(id)) fail(`${field}.id`, 'INVALID_BLOCK_ID', 'Block id is not stable.');
    if (ids.has(id)) fail(`${field}.id`, 'DUPLICATE_BLOCK_ID', 'Block ids must be unique.');
    ids.add(id);

    if (typeof block.type !== 'string' || !(LESSON_CONTENT_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      fail(`${field}.type`, 'INVALID_BLOCK_TYPE', 'Unknown lesson content block type.');
    }
    const position = positivePosition(block.position, `${field}.position`);
    if (positions.has(position)) fail(`${field}.position`, 'DUPLICATE_POSITION', 'Block positions must be unique.');
    positions.add(position);

    const accessibility = validateAccessibility(block.accessibility, `${field}.accessibility`);
    const type = block.type as LessonContentBlockType;
    return {
      id,
      type,
      position,
      data: validateData(type, block.data, `${field}.data`, accessibility),
      ...(accessibility ? { accessibility } : {}),
    };
  });

  return { schemaVersion: LESSON_CONTENT_SCHEMA_VERSION, blocks };
}
