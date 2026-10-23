import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionPercent,
  enrollmentAllowsProgress,
  validateLearningEnrollmentInput,
  validateLearningLearnerInput,
} from '../src/enrollment.ts';

test('learner requires at least one durable identity binding', () => {
  assert.throws(
    () => validateLearningLearnerInput({ fullName: 'No Identity' }),
    /IDENTITY_REQUIRED/,
  );

  const learner = validateLearningLearnerInput({
    subjectId: 'user_123',
    fullName: 'Internal Learner',
    email: 'learner@example.com',
    audienceType: 'INTERNAL',
  });
  assert.equal(learner.subjectId, 'user_123');
  assert.equal(learner.audienceType, 'INTERNAL');
});

test('CRM/external learner identities remain supported without duplicating IAM', () => {
  const contact = validateLearningLearnerInput({
    contactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Customer Learner',
    audienceType: 'CUSTOMER',
  });
  assert.equal(contact.contactId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  const external = validateLearningLearnerInput({
    externalRef: 'partner:abc:42',
    fullName: 'Partner Learner',
    audienceType: 'PARTNER',
  });
  assert.equal(external.externalRef, 'partner:abc:42');
});

test('enrollment requires a stable idempotency assignment key', () => {
  const value = validateLearningEnrollmentInput({
    assignmentKey: 'manual:privacy:user_123:2026',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    courseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sourceType: 'MANUAL',
  });
  assert.equal(value.assignmentKey, 'manual:privacy:user_123:2026');
  assert.equal(value.sourceType, 'MANUAL');
  assert.throws(
    () => validateLearningEnrollmentInput({
      assignmentKey: 'not valid with spaces',
      learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      courseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }),
    /ASSIGNMENT_KEY_INVALID/,
  );
});

test('progress is allowed only for active learning journeys', () => {
  assert.equal(enrollmentAllowsProgress('ASSIGNED'), true);
  assert.equal(enrollmentAllowsProgress('IN_PROGRESS'), true);
  assert.equal(enrollmentAllowsProgress('COMPLETED'), false);
  assert.equal(enrollmentAllowsProgress('CANCELLED'), false);
});

test('completion percentage is deterministic and bounded', () => {
  assert.equal(completionPercent(2, 1), 50);
  assert.equal(completionPercent(3, 2), 66.67);
  assert.equal(completionPercent(2, 3), 100);
  assert.equal(completionPercent(0, 0), 0);
});
