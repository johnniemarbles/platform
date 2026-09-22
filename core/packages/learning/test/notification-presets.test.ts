import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEARNING_NOTIFICATION_PRESETS,
  findLearningNotificationPreset,
  isLearningNotificationPresetKey,
} from '../src/notification-presets.ts';

test('Learning notification presets cover learner lifecycle milestones', () => {
  assert.deepEqual(
    LEARNING_NOTIFICATION_PRESETS.map((preset) => preset.eventType),
    [
      'learning.enrollment.created',
      'learning.course.completed',
      'learning.course.certificate.issued',
      'learning.assignment.graded',
      'learning.assignment.returned',
      'learning.credential.issued',
      'learning.credential.expiring',
      'learning.credential.expired',
    ],
  );
  for (const preset of LEARNING_NOTIFICATION_PRESETS) {
    assert.equal(preset.channel, 'email');
    assert.equal(preset.purpose, 'transactional');
    assert.equal(preset.consentRequired, false);
    assert.equal(preset.recipient.email.kind, 'AGGREGATE_FIELD');
    assert.equal(preset.recipient.email.key, 'learnerEmail');
    assert.match(preset.ruleKey, /^learning\.notify\./);
    assert.match(preset.triggerKey, /^learning\./);
    assert.ok(preset.requiredVariables.length > 0);
  }
});

test('preset key guard is exact and deterministic', () => {
  assert.equal(isLearningNotificationPresetKey('learning.course.completed.email'), true);
  assert.equal(isLearningNotificationPresetKey('learning.course.completed.sms'), false);
  assert.equal(
    findLearningNotificationPreset('learning.assignment.graded.email').eventType,
    'learning.assignment.graded',
  );
});
