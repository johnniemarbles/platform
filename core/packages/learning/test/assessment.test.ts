import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAssessmentPublishable,
  gradeQuestion,
  publicQuestion,
  scorePercent,
  validateAssessmentDraft,
  validateQuestionDraft,
} from '../src/assessment.ts';

test('question validation requires explicit non-leaking answer keys', () => {
  const question = validateQuestionDraft({
    prompt: 'Which option is correct?',
    type: 'SINGLE_CHOICE',
    options: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    answerKey: { answer: 'b' },
    explanation: 'B is correct.',
  });
  assert.equal(question.answerKey.answer, 'b');
  assert.deepEqual(publicQuestion(question), {
    prompt: 'Which option is correct?',
    type: 'SINGLE_CHOICE',
    options: [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
  });
});

test('multiple choice grading requires exact answer set', () => {
  const key = { answers: ['a', 'c'] };
  assert.deepEqual(gradeQuestion({
    type: 'MULTIPLE_CHOICE',
    answerKey: key,
    response: ['c', 'a'],
    points: 2,
  }), { correct: true, awardedPoints: 2 });

  assert.deepEqual(gradeQuestion({
    type: 'MULTIPLE_CHOICE',
    answerKey: key,
    response: ['a'],
    points: 2,
  }), { correct: false, awardedPoints: 0 });
});

test('true/false and single choice grading are deterministic', () => {
  assert.equal(gradeQuestion({
    type: 'TRUE_FALSE',
    answerKey: { answer: 'true' },
    response: 'TRUE',
    points: 1,
  }).correct, true);

  assert.equal(gradeQuestion({
    type: 'SINGLE_CHOICE',
    answerKey: { answer: 'b' },
    response: 'a',
    points: 3,
  }).awardedPoints, 0);
});

test('assessment publication requires unique pinned question versions', () => {
  const draft = validateAssessmentDraft({
    title: 'Privacy exam',
    type: 'EXAM',
    passPercent: 80,
    maxAttempts: 2,
    items: [{
      questionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      position: 1,
      points: 2,
    }],
  });
  assert.doesNotThrow(() => assertAssessmentPublishable(draft));

  assert.throws(
    () => validateAssessmentDraft({
      title: 'Duplicate',
      items: [
        { questionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', position: 1, points: 1 },
        { questionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', position: 2, points: 1 },
      ],
    }),
    /unique/,
  );
});

test('score percentage is bounded and stable', () => {
  assert.equal(scorePercent(4, 5), 80);
  assert.equal(scorePercent(2, 3), 66.67);
  assert.equal(scorePercent(9, 5), 100);
});
