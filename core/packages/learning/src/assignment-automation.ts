import {
  LEARNER_AUDIENCE_TYPES,
  type LearnerAudienceType,
} from './enrollment.ts';

export const LEARNING_ASSIGNMENT_TARGET_TYPES = ['COURSE', 'PROGRAM'] as const;
export type LearningAssignmentTargetType =
  (typeof LEARNING_ASSIGNMENT_TARGET_TYPES)[number];

export interface LearningAssignmentConditions {
  readonly audienceTypes: readonly LearnerAudienceType[];
  readonly subjectRequired: boolean;
  readonly metadataEquals: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LearningAssignmentRuleDraft {
  readonly name: string;
  readonly description: string;
  readonly targetType: LearningAssignmentTargetType;
  readonly courseId: string | null;
  readonly programId: string | null;
  readonly dueDays: number | null;
  readonly conditions: LearningAssignmentConditions;
}

export interface LearningAssignmentLearnerProjection {
  readonly audienceType: LearnerAudienceType;
  readonly subjectId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LearningAssignmentValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningAssignmentValidationError';
    this.field = field;
    this.code = code;
  }
}

function text(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    throw new LearningAssignmentValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (typeof value !== 'string') {
    throw new LearningAssignmentValidationError(field, 'INVALID_TEXT', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (required && normalized === '') {
    throw new LearningAssignmentValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (normalized.length > max) {
    throw new LearningAssignmentValidationError(field, 'TOO_LONG', `${field} is too long.`);
  }
  return normalized;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value, field, 100);
  if (!UUID.test(normalized)) {
    throw new LearningAssignmentValidationError(field, 'INVALID_IDENTIFIER', `${field} must be a UUID.`);
  }
  return normalized;
}

function optionalDueDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 3650) {
    throw new LearningAssignmentValidationError(
      'dueDays',
      'INVALID_DUE_DAYS',
      'dueDays must be a positive integer no greater than 3650.',
    );
  }
  return Number(value);
}

function audienceTypes(value: unknown): readonly LearnerAudienceType[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new LearningAssignmentValidationError(
      'conditions.audienceTypes',
      'INVALID_LIST',
      'audienceTypes must be an array.',
    );
  }
  const normalized = value.map((item) => {
    if (
      typeof item !== 'string'
      || !(LEARNER_AUDIENCE_TYPES as readonly string[]).includes(item)
    ) {
      throw new LearningAssignmentValidationError(
        'conditions.audienceTypes',
        'INVALID_AUDIENCE_TYPE',
        'Unknown learner audience type.',
      );
    }
    return item as LearnerAudienceType;
  });
  return [...new Set(normalized)];
}

function metadataEquals(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAssignmentValidationError(
      'conditions.metadataEquals',
      'INVALID_OBJECT',
      'metadataEquals must be an object.',
    );
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (key === '' || key.length > 120) {
      throw new LearningAssignmentValidationError(
        'conditions.metadataEquals',
        'INVALID_METADATA_KEY',
        'Metadata keys must be non-empty and no longer than 120 characters.',
      );
    }
    if (
      rawValue !== null
      && typeof rawValue !== 'string'
      && typeof rawValue !== 'number'
      && typeof rawValue !== 'boolean'
    ) {
      throw new LearningAssignmentValidationError(
        `conditions.metadataEquals.${key}`,
        'INVALID_METADATA_VALUE',
        'Metadata rule values must be scalar JSON values.',
      );
    }
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      throw new LearningAssignmentValidationError(
        `conditions.metadataEquals.${key}`,
        'INVALID_METADATA_VALUE',
        'Metadata numeric values must be finite.',
      );
    }
    out[key] = rawValue as string | number | boolean | null;
  }
  return out;
}

export function validateLearningAssignmentRuleDraft(
  value: unknown,
): LearningAssignmentRuleDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAssignmentValidationError(
      'rule',
      'INVALID_OBJECT',
      'Assignment rule must be an object.',
    );
  }
  const input = value as Record<string, unknown>;
  const targetRaw = input.targetType;
  if (
    typeof targetRaw !== 'string'
    || !(LEARNING_ASSIGNMENT_TARGET_TYPES as readonly string[]).includes(targetRaw)
  ) {
    throw new LearningAssignmentValidationError(
      'targetType',
      'INVALID_TARGET_TYPE',
      'targetType must be COURSE or PROGRAM.',
    );
  }
  const targetType = targetRaw as LearningAssignmentTargetType;
  const courseId = optionalUuid(input.courseId, 'courseId');
  const programId = optionalUuid(input.programId, 'programId');
  const dueDays = optionalDueDays(input.dueDays);

  if (targetType === 'COURSE' && (courseId === null || programId !== null)) {
    throw new LearningAssignmentValidationError(
      'target',
      'COURSE_TARGET_INVALID',
      'COURSE target requires only courseId.',
    );
  }
  if (targetType === 'PROGRAM' && (programId === null || courseId !== null)) {
    throw new LearningAssignmentValidationError(
      'target',
      'PROGRAM_TARGET_INVALID',
      'PROGRAM target requires only programId.',
    );
  }
  if (targetType === 'PROGRAM' && dueDays !== null) {
    throw new LearningAssignmentValidationError(
      'dueDays',
      'PROGRAM_DUE_DAYS_UNSUPPORTED',
      'dueDays is only supported for course assignments.',
    );
  }

  const conditionsRaw =
    input.conditions !== null
    && typeof input.conditions === 'object'
    && !Array.isArray(input.conditions)
      ? input.conditions as Record<string, unknown>
      : {};

  return {
    name: text(input.name, 'name', 300),
    description: text(input.description, 'description', 10000, false),
    targetType,
    courseId,
    programId,
    dueDays,
    conditions: {
      audienceTypes: audienceTypes(conditionsRaw.audienceTypes),
      subjectRequired: conditionsRaw.subjectRequired === true,
      metadataEquals: metadataEquals(conditionsRaw.metadataEquals),
    },
  };
}

export function matchesLearningAssignmentRule(
  conditions: LearningAssignmentConditions,
  learner: LearningAssignmentLearnerProjection,
): boolean {
  if (
    conditions.audienceTypes.length > 0
    && !conditions.audienceTypes.includes(learner.audienceType)
  ) {
    return false;
  }
  if (conditions.subjectRequired && learner.subjectId === null) return false;

  for (const [key, expected] of Object.entries(conditions.metadataEquals)) {
    if (!Object.prototype.hasOwnProperty.call(learner.metadata, key)) return false;
    if (learner.metadata[key] !== expected) return false;
  }
  return true;
}
