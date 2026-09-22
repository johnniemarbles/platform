export const QUESTION_TYPES = [
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
] as const;
export type LearningQuestionType = (typeof QUESTION_TYPES)[number];

export const ASSESSMENT_TYPES = ['QUIZ', 'EXAM', 'PRACTICE'] as const;
export type LearningAssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const ASSESSMENT_COMPLETION_REQUIREMENTS = ['OPTIONAL', 'REQUIRED'] as const;
export type LearningAssessmentCompletionRequirement =
  (typeof ASSESSMENT_COMPLETION_REQUIREMENTS)[number];

export const ASSESSMENT_VERSION_STATES = [
  'DRAFT',
  'PUBLISHED',
  'SUPERSEDED',
  'ARCHIVED',
] as const;
export type LearningAssessmentVersionState =
  (typeof ASSESSMENT_VERSION_STATES)[number];

export interface LearningChoiceOption {
  readonly key: string;
  readonly label: string;
}

export interface LearningQuestionDraft {
  readonly prompt: string;
  readonly type: LearningQuestionType;
  readonly options: readonly LearningChoiceOption[];
  readonly answerKey: Readonly<Record<string, unknown>>;
  readonly explanation: string;
}

export interface LearningAssessmentItemDraft {
  readonly questionVersionId: string;
  readonly position: number;
  readonly points: number;
}

export interface LearningAssessmentDraft {
  readonly title: string;
  readonly instructions: string;
  readonly type: LearningAssessmentType;
  readonly passPercent: number;
  readonly maxAttempts: number;
  readonly timeLimitSeconds: number | null;
  readonly courseVersionId: string | null;
  readonly completionRequirement: LearningAssessmentCompletionRequirement;
  readonly items: readonly LearningAssessmentItemDraft[];
}

export interface GradeQuestionInput {
  readonly type: LearningQuestionType;
  readonly answerKey: Readonly<Record<string, unknown>>;
  readonly response: unknown;
  readonly points: number;
}

export interface GradeQuestionResult {
  readonly correct: boolean;
  readonly awardedPoints: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class LearningAssessmentValidationError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningAssessmentValidationError';
    this.field = field;
    this.code = code;
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearningAssessmentValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new LearningAssessmentValidationError(field, 'TOO_LONG', `${field} is too long.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  return text(value, field, max);
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (!UUID.test(normalized)) {
    throw new LearningAssessmentValidationError(field, 'INVALID_IDENTIFIER', `${field} must be a UUID.`);
  }
  return normalized;
}

function positiveInteger(
  value: unknown,
  field: string,
  max: number,
): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new LearningAssessmentValidationError(field, 'INVALID_INTEGER', `${field} is invalid.`);
  }
  return Number(value);
}

function positivePoints(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000) {
    throw new LearningAssessmentValidationError(field, 'INVALID_POINTS', `${field} must be positive.`);
  }
  return Math.round(value * 100) / 100;
}

function percentage(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new LearningAssessmentValidationError(field, 'INVALID_PERCENT', `${field} must be between 0 and 100.`);
  }
  return Math.round(value * 100) / 100;
}

function optionKey(value: unknown, field: string): string {
  const key = text(value, field, 80).toLowerCase();
  if (!KEY.test(key)) {
    throw new LearningAssessmentValidationError(field, 'INVALID_OPTION_KEY', `${field} is invalid.`);
  }
  return key;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAssessmentValidationError(field, 'INVALID_OBJECT', `${field} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

export function validateQuestionDraft(value: unknown): LearningQuestionDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAssessmentValidationError('question', 'INVALID_OBJECT', 'Question must be an object.');
  }
  const input = value as Record<string, unknown>;
  const typeRaw = input.type;
  if (typeof typeRaw !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(typeRaw)) {
    throw new LearningAssessmentValidationError('type', 'INVALID_QUESTION_TYPE', 'Unknown question type.');
  }
  const type = typeRaw as LearningQuestionType;

  const optionsRaw = input.options ?? [];
  if (!Array.isArray(optionsRaw)) {
    throw new LearningAssessmentValidationError('options', 'INVALID_LIST', 'options must be an array.');
  }
  const options = optionsRaw.map((raw, index): LearningChoiceOption => {
    const item = record(raw, `options[${index}]`);
    return {
      key: optionKey(item.key, `options[${index}].key`),
      label: text(item.label, `options[${index}].label`, 500),
    };
  });
  if (new Set(options.map((option) => option.key)).size !== options.length) {
    throw new LearningAssessmentValidationError('options', 'DUPLICATE_OPTION_KEY', 'Option keys must be unique.');
  }

  if (type === 'TRUE_FALSE') {
    if (
      options.length !== 2
      || !options.some((o) => o.key === 'true')
      || !options.some((o) => o.key === 'false')
    ) {
      throw new LearningAssessmentValidationError(
        'options',
        'TRUE_FALSE_OPTIONS_INVALID',
        'TRUE_FALSE requires true and false options.',
      );
    }
  } else if (options.length < 2) {
    throw new LearningAssessmentValidationError(
      'options',
      'CHOICE_OPTIONS_REQUIRED',
      'Choice questions require at least two options.',
    );
  }

  const answerKey = record(input.answerKey, 'answerKey');
  validateAnswerKey(type, answerKey, options);

  return {
    prompt: text(input.prompt, 'prompt', 10000),
    type,
    options,
    answerKey,
    explanation: optionalText(input.explanation, 'explanation', 10000),
  };
}

function validateAnswerKey(
  type: LearningQuestionType,
  answerKey: Readonly<Record<string, unknown>>,
  options: readonly LearningChoiceOption[],
): void {
  const keys = new Set(options.map((option) => option.key));

  if (type === 'MULTIPLE_CHOICE') {
    const answers = answerKey.answers;
    if (
      !Array.isArray(answers)
      || answers.length === 0
      || answers.some((answer) => typeof answer !== 'string' || !keys.has(answer))
      || new Set(answers).size !== answers.length
    ) {
      throw new LearningAssessmentValidationError(
        'answerKey',
        'ANSWER_KEY_INVALID',
        'MULTIPLE_CHOICE answerKey requires unique valid answers.',
      );
    }
    return;
  }

  const answer = answerKey.answer;
  if (typeof answer !== 'string' || !keys.has(answer)) {
    throw new LearningAssessmentValidationError(
      'answerKey',
      'ANSWER_KEY_INVALID',
      'answerKey must reference a valid option.',
    );
  }
}

export function publicQuestion(
  draft: LearningQuestionDraft,
): Omit<LearningQuestionDraft, 'answerKey' | 'explanation'> {
  return {
    prompt: draft.prompt,
    type: draft.type,
    options: draft.options.map((option) => ({ ...option })),
  };
}

export function validateAssessmentDraft(value: unknown): LearningAssessmentDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAssessmentValidationError('assessment', 'INVALID_OBJECT', 'Assessment must be an object.');
  }
  const input = value as Record<string, unknown>;
  const typeRaw = input.type ?? 'QUIZ';
  if (typeof typeRaw !== 'string' || !(ASSESSMENT_TYPES as readonly string[]).includes(typeRaw)) {
    throw new LearningAssessmentValidationError('type', 'INVALID_ASSESSMENT_TYPE', 'Unknown assessment type.');
  }

  const itemsRaw = input.items ?? [];
  if (!Array.isArray(itemsRaw)) {
    throw new LearningAssessmentValidationError('items', 'INVALID_LIST', 'items must be an array.');
  }
  const items = itemsRaw.map((raw, index): LearningAssessmentItemDraft => {
    const item = record(raw, `items[${index}]`);
    return {
      questionVersionId: uuid(item.questionVersionId, `items[${index}].questionVersionId`),
      position: positiveInteger(item.position, `items[${index}].position`, 100000),
      points: positivePoints(item.points, `items[${index}].points`),
    };
  });
  if (new Set(items.map((item) => item.position)).size !== items.length) {
    throw new LearningAssessmentValidationError('items', 'DUPLICATE_POSITION', 'Assessment item positions must be unique.');
  }
  if (new Set(items.map((item) => item.questionVersionId)).size !== items.length) {
    throw new LearningAssessmentValidationError('items', 'DUPLICATE_QUESTION', 'Question versions must be unique.');
  }

  const courseVersionIdRaw = input.courseVersionId;
  const courseVersionId = courseVersionIdRaw === undefined || courseVersionIdRaw === null || courseVersionIdRaw === ''
    ? null
    : uuid(courseVersionIdRaw, 'courseVersionId');

  const completionRequirementRaw = input.completionRequirement ?? 'OPTIONAL';
  if (
    typeof completionRequirementRaw !== 'string'
    || !(ASSESSMENT_COMPLETION_REQUIREMENTS as readonly string[]).includes(completionRequirementRaw)
  ) {
    throw new LearningAssessmentValidationError(
      'completionRequirement',
      'INVALID_COMPLETION_REQUIREMENT',
      'completionRequirement must be OPTIONAL or REQUIRED.',
    );
  }
  if (completionRequirementRaw === 'REQUIRED' && courseVersionId === null) {
    throw new LearningAssessmentValidationError(
      'completionRequirement',
      'REQUIRED_ASSESSMENT_NEEDS_COURSE',
      'A required assessment must be linked to a course version.',
    );
  }

  const timeLimitRaw = input.timeLimitSeconds;
  const timeLimitSeconds = timeLimitRaw === undefined || timeLimitRaw === null || timeLimitRaw === ''
    ? null
    : positiveInteger(timeLimitRaw, 'timeLimitSeconds', 604800);

  return {
    title: text(input.title, 'title', 300),
    instructions: optionalText(input.instructions, 'instructions', 20000),
    type: typeRaw as LearningAssessmentType,
    passPercent: percentage(input.passPercent ?? 70, 'passPercent'),
    maxAttempts: positiveInteger(input.maxAttempts ?? 1, 'maxAttempts', 100),
    timeLimitSeconds,
    courseVersionId,
    completionRequirement: completionRequirementRaw as LearningAssessmentCompletionRequirement,
    items,
  };
}

export function assertAssessmentPublishable(draft: LearningAssessmentDraft): void {
  if (draft.items.length === 0) {
    throw new LearningAssessmentValidationError(
      'items',
      'PUBLISH_REQUIRES_QUESTION',
      'A published assessment requires at least one question.',
    );
  }
}

function responseKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

export function gradeQuestion(input: GradeQuestionInput): GradeQuestionResult {
  const points = positivePoints(input.points, 'points');

  if (input.type === 'MULTIPLE_CHOICE') {
    const expected = input.answerKey.answers;
    if (!Array.isArray(expected) || expected.some((v) => typeof v !== 'string')) {
      throw new LearningAssessmentValidationError('answerKey', 'ANSWER_KEY_INVALID', 'Answer key is invalid.');
    }
    const response = input.response;
    if (!Array.isArray(response)) return { correct: false, awardedPoints: 0 };
    const actual = response
      .map(responseKey)
      .filter((value): value is string => value !== null);
    if (new Set(actual).size !== actual.length) return { correct: false, awardedPoints: 0 };

    const expectedSorted = [...expected].sort();
    const actualSorted = [...actual].sort();
    const correct =
      expectedSorted.length === actualSorted.length
      && expectedSorted.every((value, index) => value === actualSorted[index]);
    return { correct, awardedPoints: correct ? points : 0 };
  }

  const expected = input.answerKey.answer;
  if (typeof expected !== 'string') {
    throw new LearningAssessmentValidationError('answerKey', 'ANSWER_KEY_INVALID', 'Answer key is invalid.');
  }
  const correct = responseKey(input.response) === expected;
  return { correct, awardedPoints: correct ? points : 0 };
}

export function scorePercent(awardedPoints: number, maxPoints: number): number {
  if (!Number.isFinite(awardedPoints) || !Number.isFinite(maxPoints) || maxPoints <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((awardedPoints / maxPoints) * 10000) / 100));
}
