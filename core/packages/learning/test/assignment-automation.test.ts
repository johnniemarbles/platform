import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesLearningAssignmentRule,
  validateLearningAssignmentRuleDraft,
} from '../src/assignment-automation.ts';

test('assignment rule validates deterministic course targeting and predicates', () => {
  const rule = validateLearningAssignmentRuleDraft({
    name: 'Internal Ontario onboarding',
    targetType: 'COURSE',
    courseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    dueDays: 30,
    conditions: {
      audienceTypes: ['INTERNAL'],
      subjectRequired: true,
      metadataEquals: {
        region: 'ON',
        licensed: true,
      },
    },
  });

  assert.equal(rule.targetType, 'COURSE');
  assert.equal(rule.dueDays, 30);
  assert.equal(matchesLearningAssignmentRule(rule.conditions, {
    audienceType: 'INTERNAL',
    subjectId: 'user_123',
    metadata: { region: 'ON', licensed: true },
  }), true);
  assert.equal(matchesLearningAssignmentRule(rule.conditions, {
    audienceType: 'PARTNER',
    subjectId: 'user_123',
    metadata: { region: 'ON', licensed: true },
  }), false);
});

test('metadata matching is exact and missing keys do not match', () => {
  const rule = validateLearningAssignmentRuleDraft({
    name: 'Partner program',
    targetType: 'PROGRAM',
    programId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    conditions: {
      metadataEquals: { tier: 2 },
    },
  });

  assert.equal(matchesLearningAssignmentRule(rule.conditions, {
    audienceType: 'PARTNER',
    subjectId: null,
    metadata: { tier: 2 },
  }), true);
  assert.equal(matchesLearningAssignmentRule(rule.conditions, {
    audienceType: 'PARTNER',
    subjectId: null,
    metadata: { tier: '2' },
  }), false);
  assert.equal(matchesLearningAssignmentRule(rule.conditions, {
    audienceType: 'PARTNER',
    subjectId: null,
    metadata: {},
  }), false);
});

test('program rules reject course due dates and ambiguous targets', () => {
  assert.throws(() => validateLearningAssignmentRuleDraft({
    name: 'Invalid',
    targetType: 'PROGRAM',
    programId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    dueDays: 10,
  }), /only supported for course/i);

  assert.throws(() => validateLearningAssignmentRuleDraft({
    name: 'Invalid',
    targetType: 'COURSE',
    courseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    programId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }), /requires only courseId/i);
});
