import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LearningValidationError,
  assertCoursePublishable,
  assertCourseVersionTransition,
  validateCourseDraft,
  validateCourseKey,
} from '../src/index.ts';

const publishable = () => validateCourseDraft({
  title: 'Privacy Fundamentals',
  summary: 'Core privacy learning.',
  language: 'en-CA',
  visibility: 'TENANT',
  learningObjectives: ['Recognize personal information'],
  modules: [{
    moduleKey: 'privacy-basics',
    title: 'Privacy basics',
    position: 1,
    lessons: [{
      lessonKey: 'introduction',
      title: 'Introduction',
      activityType: 'TEXT',
      position: 1,
      required: true,
      estimatedMinutes: 10,
      content: { body: 'Approved training content reference.' },
    }],
  }],
});

test('course keys are stable machine identifiers', () => {
  assert.equal(validateCourseKey('privacy.fundamentals'), 'privacy.fundamentals');
  assert.throws(() => validateCourseKey('Privacy Fundamentals'), LearningValidationError);
});

test('draft authoring normalizes and validates nested modules and lessons', () => {
  const draft = publishable();
  assert.equal(draft.title, 'Privacy Fundamentals');
  assert.equal(draft.modules[0]?.lessons[0]?.activityType, 'TEXT');
  assert.doesNotThrow(() => assertCoursePublishable(draft));
});

test('course operational settings are explicit and bounded', () => {
  const draft = validateCourseDraft({
    ...publishable(),
    enrollmentMode: 'APPROVAL_REQUIRED',
    certificateEnabled: true,
    passingScore: 85,
  });
  assert.equal(draft.enrollmentMode, 'APPROVAL_REQUIRED');
  assert.equal(draft.certificateEnabled, true);
  assert.equal(draft.passingScore, 85);

  const defaults = publishable();
  assert.equal(defaults.enrollmentMode, 'ASSIGNED_ONLY');
  assert.equal(defaults.certificateEnabled, false);
  assert.equal(defaults.passingScore, null);

  assert.throws(
    () => validateCourseDraft({ ...publishable(), enrollmentMode: 'AUTO' }),
    /Unknown course enrollment mode/,
  );
  assert.throws(
    () => validateCourseDraft({ ...publishable(), passingScore: 101 }),
    /integer from 0 to 100/,
  );
});

test('publication requires objectives, modules, and lessons', () => {
  assert.throws(
    () => assertCoursePublishable(validateCourseDraft({
      title: 'Empty',
      language: 'en',
      learningObjectives: [],
      modules: [],
    })),
    /learning objective/,
  );

  assert.throws(
    () => assertCoursePublishable(validateCourseDraft({
      title: 'Module only',
      language: 'en',
      learningObjectives: ['Know one thing'],
      modules: [{ moduleKey: 'm1', title: 'M1', position: 1, lessons: [] }],
    })),
    /at least one lesson/,
  );
});

test('positions and machine keys are unique within each parent', () => {
  assert.throws(
    () => validateCourseDraft({
      title: 'Bad order',
      language: 'en',
      modules: [
        { moduleKey: 'm1', title: 'M1', position: 1, lessons: [] },
        { moduleKey: 'm2', title: 'M2', position: 1, lessons: [] },
      ],
    }),
    /positions must be unique/,
  );
});

test('published versions can only be superseded or archived', () => {
  assert.doesNotThrow(() => assertCourseVersionTransition('DRAFT', 'PUBLISHED'));
  assert.doesNotThrow(() => assertCourseVersionTransition('PUBLISHED', 'SUPERSEDED'));
  assert.throws(
    () => assertCourseVersionTransition('PUBLISHED', 'DRAFT'),
    /cannot transition/,
  );
  assert.throws(
    () => assertCourseVersionTransition('ARCHIVED', 'PUBLISHED'),
    /cannot transition/,
  );
});
