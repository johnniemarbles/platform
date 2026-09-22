export const PROGRAM_ITEM_TYPES = ['COURSE', 'ASSESSMENT'] as const;
export type LearningProgramItemType = (typeof PROGRAM_ITEM_TYPES)[number];

export const PROGRAM_ENROLLMENT_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type LearningProgramEnrollmentStatus =
  (typeof PROGRAM_ENROLLMENT_STATUSES)[number];

export const CREDENTIAL_STATUSES = [
  'ACTIVE',
  'EXPIRING',
  'EXPIRED',
  'REVOKED',
] as const;
export type LearningCredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export interface LearningProgramItemDraft {
  readonly type: LearningProgramItemType;
  readonly courseVersionId: string | null;
  readonly assessmentVersionId: string | null;
  readonly position: number;
  readonly required: boolean;
}

export interface LearningProgramDraft {
  readonly title: string;
  readonly description: string;
  readonly items: readonly LearningProgramItemDraft[];
}

export interface LearningCertificationDraft {
  readonly title: string;
  readonly description: string;
  readonly programVersionId: string;
  readonly validityDays: number | null;
  readonly renewalWindowDays: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LearningProgramValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningProgramValidationError';
    this.field = field;
    this.code = code;
  }
}

function text(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    throw new LearningProgramValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (typeof value !== 'string') {
    throw new LearningProgramValidationError(field, 'INVALID_TEXT', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (required && normalized === '') {
    throw new LearningProgramValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (normalized.length > max) {
    throw new LearningProgramValidationError(field, 'TOO_LONG', `${field} is too long.`);
  }
  return normalized;
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (!UUID.test(normalized)) {
    throw new LearningProgramValidationError(field, 'INVALID_IDENTIFIER', `${field} must be a UUID.`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string, max: number): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new LearningProgramValidationError(field, 'INVALID_INTEGER', `${field} is invalid.`);
  }
  return Number(value);
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
  max: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return positiveInteger(value, field, max);
}

export function validateLearningProgramDraft(value: unknown): LearningProgramDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningProgramValidationError('program', 'INVALID_OBJECT', 'Program must be an object.');
  }
  const input = value as Record<string, unknown>;
  const itemsRaw = input.items;
  if (!Array.isArray(itemsRaw)) {
    throw new LearningProgramValidationError('items', 'INVALID_LIST', 'items must be an array.');
  }

  const items = itemsRaw.map((raw, index): LearningProgramItemDraft => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LearningProgramValidationError(
        `items[${index}]`,
        'INVALID_OBJECT',
        'Program item must be an object.',
      );
    }
    const item = raw as Record<string, unknown>;
    const typeRaw = item.type;
    if (
      typeof typeRaw !== 'string'
      || !(PROGRAM_ITEM_TYPES as readonly string[]).includes(typeRaw)
    ) {
      throw new LearningProgramValidationError(
        `items[${index}].type`,
        'INVALID_PROGRAM_ITEM_TYPE',
        'Unknown program item type.',
      );
    }
    const type = typeRaw as LearningProgramItemType;
    const courseVersionId = item.courseVersionId === undefined || item.courseVersionId === null || item.courseVersionId === ''
      ? null
      : uuid(item.courseVersionId, `items[${index}].courseVersionId`);
    const assessmentVersionId = item.assessmentVersionId === undefined || item.assessmentVersionId === null || item.assessmentVersionId === ''
      ? null
      : uuid(item.assessmentVersionId, `items[${index}].assessmentVersionId`);

    if (type === 'COURSE' && (courseVersionId === null || assessmentVersionId !== null)) {
      throw new LearningProgramValidationError(
        `items[${index}]`,
        'COURSE_ITEM_INVALID',
        'COURSE item requires only courseVersionId.',
      );
    }
    if (type === 'ASSESSMENT' && (assessmentVersionId === null || courseVersionId !== null)) {
      throw new LearningProgramValidationError(
        `items[${index}]`,
        'ASSESSMENT_ITEM_INVALID',
        'ASSESSMENT item requires only assessmentVersionId.',
      );
    }

    return {
      type,
      courseVersionId,
      assessmentVersionId,
      position: positiveInteger(item.position, `items[${index}].position`, 100000),
      required: item.required !== false,
    };
  });

  if (new Set(items.map((item) => item.position)).size !== items.length) {
    throw new LearningProgramValidationError('items', 'DUPLICATE_POSITION', 'Program positions must be unique.');
  }
  const targetKeys = items.map((item) =>
    item.type === 'COURSE'
      ? `COURSE:${item.courseVersionId}`
      : `ASSESSMENT:${item.assessmentVersionId}`,
  );
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new LearningProgramValidationError('items', 'DUPLICATE_REQUIREMENT', 'Program requirements must be unique.');
  }

  return {
    title: text(input.title, 'title', 300),
    description: text(input.description, 'description', 20000, false),
    items,
  };
}

export function assertLearningProgramPublishable(draft: LearningProgramDraft): void {
  if (draft.items.length === 0) {
    throw new LearningProgramValidationError(
      'items',
      'PUBLISH_REQUIRES_REQUIREMENT',
      'A published program requires at least one requirement.',
    );
  }
  if (!draft.items.some((item) => item.required)) {
    throw new LearningProgramValidationError(
      'items',
      'PUBLISH_REQUIRES_REQUIRED_ITEM',
      'A published program requires at least one required item.',
    );
  }
}

export function validateLearningCertificationDraft(
  value: unknown,
): LearningCertificationDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningProgramValidationError(
      'certification',
      'INVALID_OBJECT',
      'Certification must be an object.',
    );
  }
  const input = value as Record<string, unknown>;
  const validityDays = optionalPositiveInteger(input.validityDays, 'validityDays', 36500);
  const renewalWindowDays = optionalPositiveInteger(
    input.renewalWindowDays,
    'renewalWindowDays',
    36500,
  );

  if (
    validityDays === null
    && renewalWindowDays !== null
  ) {
    throw new LearningProgramValidationError(
      'renewalWindowDays',
      'RENEWAL_REQUIRES_VALIDITY',
      'A renewal window requires a finite validity period.',
    );
  }
  if (
    validityDays !== null
    && renewalWindowDays !== null
    && renewalWindowDays >= validityDays
  ) {
    throw new LearningProgramValidationError(
      'renewalWindowDays',
      'RENEWAL_WINDOW_INVALID',
      'Renewal window must be shorter than credential validity.',
    );
  }

  return {
    title: text(input.title, 'title', 300),
    description: text(input.description, 'description', 20000, false),
    programVersionId: uuid(input.programVersionId, 'programVersionId'),
    validityDays,
    renewalWindowDays,
  };
}

export function credentialStatusAt(
  input: {
    readonly currentStatus: LearningCredentialStatus;
    readonly expiresAt: string | null;
    readonly renewalDueAt: string | null;
  },
  now = new Date(),
): LearningCredentialStatus {
  if (input.currentStatus === 'REVOKED') return 'REVOKED';
  const nowMs = now.getTime();
  if (input.expiresAt !== null && nowMs >= Date.parse(input.expiresAt)) return 'EXPIRED';
  if (input.renewalDueAt !== null && nowMs >= Date.parse(input.renewalDueAt)) return 'EXPIRING';
  return 'ACTIVE';
}
