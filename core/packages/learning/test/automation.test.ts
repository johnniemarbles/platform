import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateLearningAutomationRuleDraft,
  validateLearningAutomationRuleKey,
} from '../src/automation.ts';

test('Learning automation accepts only learning events and proven executors', () => {
  assert.deepEqual(validateLearningAutomationRuleDraft({
    eventType: 'learning.course.completed',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.course.review',
    policyKeys: [],
    configuration: { title: 'Review completion' },
  }), {
    eventType: 'learning.course.completed',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.course.review',
    enabled: true,
    policyKeys: [],
    configuration: { title: 'Review completion' },
  });

  assert.throws(() => validateLearningAutomationRuleDraft({
    eventType: 'Treatment.Discharged',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.bad',
    configuration: {},
  }), /learning\.\*/);

  assert.throws(() => validateLearningAutomationRuleDraft({
    eventType: 'learning.course.completed',
    executorClass: 'AI_ACTION',
    actionKey: 'learning.bad',
    configuration: {},
  }), /CREATE_TASK, COMMUNICATE, or SCHEDULE/);
});

test('policy-bearing rules cannot be enabled before a policy evaluator exists', () => {
  assert.throws(() => validateLearningAutomationRuleDraft({
    eventType: 'learning.course.completed',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.course.review',
    enabled: true,
    policyKeys: ['manager-approval'],
    configuration: { title: 'Review completion' },
  }), /must remain disabled/);

  assert.equal(validateLearningAutomationRuleDraft({
    eventType: 'learning.course.completed',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.course.review',
    enabled: false,
    policyKeys: ['manager-approval'],
    configuration: { title: 'Review completion' },
  }).enabled, false);
});

test('rule and policy keys are stable and unique', () => {
  assert.equal(
    validateLearningAutomationRuleKey('Learning.Course.Review'),
    'learning.course.review',
  );
  assert.throws(() => validateLearningAutomationRuleDraft({
    eventType: 'learning.course.completed',
    executorClass: 'CREATE_TASK',
    actionKey: 'learning.course.review',
    policyKeys: ['one', 'one'],
    configuration: {},
  }), /unique/);
});
