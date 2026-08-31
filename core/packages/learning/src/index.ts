export const COURSE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const COURSE_VISIBILITIES = ['PRIVATE', 'TENANT', 'PUBLIC'] as const;
export type CourseVisibility = (typeof COURSE_VISIBILITIES)[number];

export const COURSE_VERSION_STATES = [
  'DRAFT',
  'IN_REVIEW',
  'PUBLISHED',
  'SUPERSEDED',
  'ARCHIVED',
] as const;
export type CourseVersionState = (typeof COURSE_VERSION_STATES)[number];

export const LEARNING_ACTIVITY_TYPES = [
  'TEXT',
  'VIDEO',
  'AUDIO',
  'DOCUMENT',
  'PRESENTATION',
  'INTERACTIVE',
  'QUIZ',
  'EXAM',
  'ASSIGNMENT',
  'SURVEY',
  'DISCUSSION',
  'LIVE_SESSION',
  'PRACTICAL_ASSESSMENT',
  'EXTERNAL',
] as const;
export type LearningActivityType = (typeof LEARNING_ACTIVITY_TYPES)[number];

export interface LearningLessonInput {
  readonly lessonKey: string;
  readonly title: string;
  readonly activityType: LearningActivityType;
  readonly position: number;
  readonly required: boolean;
  readonly estimatedMinutes: number | null;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface LearningModuleInput {
  readonly moduleKey: string;
  readonly title: string;
  readonly position: number;
  readonly lessons: readonly LearningLessonInput[];
}

export interface CourseDraftInput {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly language: string;
  readonly visibility: CourseVisibility;
  readonly estimatedMinutes: number | null;
  readonly learningObjectives: readonly string[];
  readonly modules: readonly LearningModuleInput[];
}

export interface ValidatedCourseDraft {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly language: string;
  readonly visibility: CourseVisibility;
  readonly estimatedMinutes: number | null;
  readonly learningObjectives: readonly string[];
  readonly modules: readonly LearningModuleInput[];
}

export class LearningValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningValidationError';
    this.field = field;
    this.code = code;
  }
}

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function nonBlank(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearningValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new LearningValidationError(field, 'TOO_LONG', `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    throw new LearningValidationError(field, 'INVALID_TEXT', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new LearningValidationError(field, 'TOO_LONG', `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function positiveMinutes(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 100000) {
    throw new LearningValidationError(
      field,
      'INVALID_DURATION',
      `${field} must be a positive integer number of minutes.`,
    );
  }
  return Number(value);
}

function stableKey(value: unknown, field: string): string {
  const key = nonBlank(value, field, 120).toLowerCase();
  if (!KEY.test(key)) {
    throw new LearningValidationError(
      field,
      'INVALID_KEY',
      `${field} must contain lowercase letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return key;
}

function position(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new LearningValidationError(field, 'INVALID_POSITION', `${field} must be a positive integer.`);
  }
  return Number(value);
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningValidationError(field, 'INVALID_OBJECT', `${field} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

function uniqueOrderedPositions(values: readonly number[], field: string): void {
  const seen = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new LearningValidationError(field, 'DUPLICATE_POSITION', `${field} positions must be unique.`);
    }
    seen.add(value);
  }
}

function uniqueKeys(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new LearningValidationError(field, 'DUPLICATE_KEY', `${field} keys must be unique.`);
  }
}

export function validateCourseKey(value: unknown): string {
  return stableKey(value, 'courseKey');
}

export function validateCourseDraft(value: unknown): ValidatedCourseDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningValidationError('course', 'INVALID_OBJECT', 'Course draft must be an object.');
  }
  const input = value as Record<string, unknown>;
  const visibilityRaw = input.visibility ?? 'TENANT';
  if (
    typeof visibilityRaw !== 'string'
    || !(COURSE_VISIBILITIES as readonly string[]).includes(visibilityRaw)
  ) {
    throw new LearningValidationError('visibility', 'INVALID_VISIBILITY', 'Unknown course visibility.');
  }

  const language = nonBlank(input.language ?? 'en', 'language', 32);
  if (!LANGUAGE.test(language)) {
    throw new LearningValidationError('language', 'INVALID_LANGUAGE', 'language must be a BCP-47 style tag.');
  }

  const objectivesRaw = input.learningObjectives ?? [];
  if (!Array.isArray(objectivesRaw)) {
    throw new LearningValidationError(
      'learningObjectives',
      'INVALID_LIST',
      'learningObjectives must be an array.',
    );
  }
  const learningObjectives = objectivesRaw.map((objective, index) =>
    nonBlank(objective, `learningObjectives[${index}]`, 500),
  );
  if (new Set(learningObjectives.map((objective) => objective.toLowerCase())).size !== learningObjectives.length) {
    throw new LearningValidationError(
      'learningObjectives',
      'DUPLICATE_OBJECTIVE',
      'Learning objectives must be unique.',
    );
  }

  const modulesRaw = input.modules ?? [];
  if (!Array.isArray(modulesRaw)) {
    throw new LearningValidationError('modules', 'INVALID_LIST', 'modules must be an array.');
  }

  const modules = modulesRaw.map((moduleValue, moduleIndex): LearningModuleInput => {
    if (moduleValue === null || typeof moduleValue !== 'object' || Array.isArray(moduleValue)) {
      throw new LearningValidationError(
        `modules[${moduleIndex}]`,
        'INVALID_OBJECT',
        'Each module must be an object.',
      );
    }
    const module = moduleValue as Record<string, unknown>;
    const lessonsRaw = module.lessons ?? [];
    if (!Array.isArray(lessonsRaw)) {
      throw new LearningValidationError(
        `modules[${moduleIndex}].lessons`,
        'INVALID_LIST',
        'lessons must be an array.',
      );
    }
    const lessons = lessonsRaw.map((lessonValue, lessonIndex): LearningLessonInput => {
      if (lessonValue === null || typeof lessonValue !== 'object' || Array.isArray(lessonValue)) {
        throw new LearningValidationError(
          `modules[${moduleIndex}].lessons[${lessonIndex}]`,
          'INVALID_OBJECT',
          'Each lesson must be an object.',
        );
      }
      const lesson = lessonValue as Record<string, unknown>;
      const activityTypeRaw = lesson.activityType ?? 'TEXT';
      if (
        typeof activityTypeRaw !== 'string'
        || !(LEARNING_ACTIVITY_TYPES as readonly string[]).includes(activityTypeRaw)
      ) {
        throw new LearningValidationError(
          `modules[${moduleIndex}].lessons[${lessonIndex}].activityType`,
          'INVALID_ACTIVITY_TYPE',
          'Unknown learning activity type.',
        );
      }
      return {
        lessonKey: stableKey(
          lesson.lessonKey,
          `modules[${moduleIndex}].lessons[${lessonIndex}].lessonKey`,
        ),
        title: nonBlank(
          lesson.title,
          `modules[${moduleIndex}].lessons[${lessonIndex}].title`,
          300,
        ),
        activityType: activityTypeRaw as LearningActivityType,
        position: position(
          lesson.position,
          `modules[${moduleIndex}].lessons[${lessonIndex}].position`,
        ),
        required: lesson.required !== false,
        estimatedMinutes: positiveMinutes(
          lesson.estimatedMinutes,
          `modules[${moduleIndex}].lessons[${lessonIndex}].estimatedMinutes`,
        ),
        content: record(
          lesson.content,
          `modules[${moduleIndex}].lessons[${lessonIndex}].content`,
        ),
      };
    });
    uniqueKeys(
      lessons.map((lesson) => lesson.lessonKey),
      `modules[${moduleIndex}].lessons`,
    );
    uniqueOrderedPositions(
      lessons.map((lesson) => lesson.position),
      `modules[${moduleIndex}].lessons`,
    );
    return {
      moduleKey: stableKey(module.moduleKey, `modules[${moduleIndex}].moduleKey`),
      title: nonBlank(module.title, `modules[${moduleIndex}].title`, 300),
      position: position(module.position, `modules[${moduleIndex}].position`),
      lessons,
    };
  });

  uniqueKeys(modules.map((module) => module.moduleKey), 'modules');
  uniqueOrderedPositions(modules.map((module) => module.position), 'modules');

  return {
    title: nonBlank(input.title, 'title', 300),
    summary: optionalText(input.summary, 'summary', 1000),
    description: optionalText(input.description, 'description', 20000),
    language,
    visibility: visibilityRaw as CourseVisibility,
    estimatedMinutes: positiveMinutes(input.estimatedMinutes, 'estimatedMinutes'),
    learningObjectives,
    modules,
  };
}

export function assertCoursePublishable(draft: ValidatedCourseDraft): void {
  if (draft.learningObjectives.length === 0) {
    throw new LearningValidationError(
      'learningObjectives',
      'PUBLISH_REQUIRES_OBJECTIVES',
      'A published course requires at least one learning objective.',
    );
  }
  if (draft.modules.length === 0) {
    throw new LearningValidationError(
      'modules',
      'PUBLISH_REQUIRES_MODULE',
      'A published course requires at least one module.',
    );
  }
  if (draft.modules.some((module) => module.lessons.length === 0)) {
    throw new LearningValidationError(
      'modules',
      'PUBLISH_REQUIRES_LESSONS',
      'Every published module requires at least one lesson.',
    );
  }
}

export function canTransitionCourseVersion(
  from: CourseVersionState,
  to: CourseVersionState,
): boolean {
  if (from === to) return true;
  switch (from) {
    case 'DRAFT':
      return to === 'IN_REVIEW' || to === 'PUBLISHED' || to === 'ARCHIVED';
    case 'IN_REVIEW':
      return to === 'DRAFT' || to === 'PUBLISHED' || to === 'ARCHIVED';
    case 'PUBLISHED':
      return to === 'SUPERSEDED' || to === 'ARCHIVED';
    case 'SUPERSEDED':
      return to === 'ARCHIVED';
    case 'ARCHIVED':
      return false;
  }
}

export function assertCourseVersionTransition(
  from: CourseVersionState,
  to: CourseVersionState,
): void {
  if (!canTransitionCourseVersion(from, to)) {
    throw new LearningValidationError(
      'state',
      'INVALID_VERSION_TRANSITION',
      `Course version cannot transition from ${from} to ${to}.`,
    );
  }
}

export * from './enrollment.ts';

export * from './assessment.ts';

export * from './program-certification.ts';

export * from './competency.ts';

export * from './assignment-automation.ts';
