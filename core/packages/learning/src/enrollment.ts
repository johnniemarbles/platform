export const LEARNER_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type LearnerStatus = (typeof LEARNER_STATUSES)[number];

export const LEARNER_AUDIENCE_TYPES = [
  'INTERNAL',
  'PARTNER',
  'CUSTOMER',
  'EXTERNAL',
] as const;
export type LearnerAudienceType = (typeof LEARNER_AUDIENCE_TYPES)[number];

export const ENROLLMENT_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ENROLLMENT_SOURCES = [
  'MANUAL',
  'RULE',
  'PROGRAM',
  'SELF',
  'IMPORT',
] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

export const LESSON_PROGRESS_STATUSES = [
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type LessonProgressStatus = (typeof LESSON_PROGRESS_STATUSES)[number];

export interface LearningLearnerInput {
  readonly subjectId: string | null;
  readonly contactId: string | null;
  readonly externalRef: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly audienceType: LearnerAudienceType;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LearningEnrollmentInput {
  readonly assignmentKey: string;
  readonly learnerId: string;
  readonly courseId: string;
  readonly sourceType: EnrollmentSource;
  readonly sourceRef: string | null;
  readonly dueAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGNMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('LEARNING_' + field.toUpperCase() + '_REQUIRED');
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new Error('LEARNING_' + field.toUpperCase() + '_TOO_LONG');
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, max);
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (!UUID.test(normalized)) throw new Error('LEARNING_' + field.toUpperCase() + '_INVALID');
  return normalized;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

function instant(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value, field, 100);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error('LEARNING_' + field.toUpperCase() + '_INVALID');
  }
  return new Date(normalized).toISOString();
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LEARNING_METADATA_INVALID');
  }
  return { ...(value as Record<string, unknown>) };
}

export function validateLearningLearnerInput(value: unknown): LearningLearnerInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LEARNING_LEARNER_INVALID');
  }
  const input = value as Record<string, unknown>;
  const subjectId = optionalText(input.subjectId, 'subject_id', 300);
  const contactId = optionalUuid(input.contactId, 'contact_id');
  const externalRef = optionalText(input.externalRef, 'external_ref', 300);

  if (subjectId === null && contactId === null && externalRef === null) {
    throw new Error('LEARNING_LEARNER_IDENTITY_REQUIRED');
  }

  const audienceRaw = input.audienceType ?? 'INTERNAL';
  if (
    typeof audienceRaw !== 'string'
    || !(LEARNER_AUDIENCE_TYPES as readonly string[]).includes(audienceRaw)
  ) {
    throw new Error('LEARNING_AUDIENCE_TYPE_INVALID');
  }

  const email = optionalText(input.email, 'email', 320);
  if (email !== null && !EMAIL.test(email)) throw new Error('LEARNING_EMAIL_INVALID');

  return {
    subjectId,
    contactId,
    externalRef,
    fullName: text(input.fullName, 'full_name', 200),
    email,
    audienceType: audienceRaw as LearnerAudienceType,
    metadata: object(input.metadata),
  };
}

export function validateLearningEnrollmentInput(value: unknown): LearningEnrollmentInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LEARNING_ENROLLMENT_INVALID');
  }
  const input = value as Record<string, unknown>;
  const assignmentKey = text(input.assignmentKey, 'assignment_key', 160);
  if (!ASSIGNMENT_KEY.test(assignmentKey)) throw new Error('LEARNING_ASSIGNMENT_KEY_INVALID');

  const sourceRaw = input.sourceType ?? 'MANUAL';
  if (
    typeof sourceRaw !== 'string'
    || !(ENROLLMENT_SOURCES as readonly string[]).includes(sourceRaw)
  ) {
    throw new Error('LEARNING_ENROLLMENT_SOURCE_INVALID');
  }

  return {
    assignmentKey,
    learnerId: uuid(input.learnerId, 'learner_id'),
    courseId: uuid(input.courseId, 'course_id'),
    sourceType: sourceRaw as EnrollmentSource,
    sourceRef: optionalText(input.sourceRef, 'source_ref', 500),
    dueAt: instant(input.dueAt, 'due_at'),
  };
}

export function enrollmentAllowsProgress(status: EnrollmentStatus): boolean {
  return status === 'ASSIGNED' || status === 'IN_PROGRESS';
}

export function completionPercent(
  totalRequired: number,
  completedRequired: number,
): number {
  if (!Number.isInteger(totalRequired) || totalRequired <= 0) return 0;
  if (!Number.isInteger(completedRequired) || completedRequired < 0) return 0;
  return Math.min(100, Math.round((completedRequired / totalRequired) * 10000) / 100);
}
