import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLearningProgramPublishable,
  credentialStatusAt,
  validateLearningCertificationDraft,
  validateLearningProgramDraft,
} from '../src/program-certification.ts';

test('program requirements pin exactly one typed version target', () => {
  const draft = validateLearningProgramDraft({
    title: 'Clinical onboarding',
    items: [
      {
        type: 'COURSE',
        courseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        position: 1,
        required: true,
      },
      {
        type: 'ASSESSMENT',
        assessmentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        position: 2,
        required: true,
      },
    ],
  });
  assert.equal(draft.items.length, 2);
  assert.doesNotThrow(() => assertLearningProgramPublishable(draft));
});

test('program publication requires at least one required item', () => {
  const draft = validateLearningProgramDraft({
    title: 'Optional only',
    items: [{
      type: 'COURSE',
      courseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      position: 1,
      required: false,
    }],
  });
  assert.throws(() => assertLearningProgramPublishable(draft), /required item/i);
});

test('certification renewal window must fit inside validity', () => {
  assert.deepEqual(validateLearningCertificationDraft({
    title: 'Privacy Certified',
    programVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    validityDays: 365,
    renewalWindowDays: 30,
  }), {
    title: 'Privacy Certified',
    description: '',
    programVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    validityDays: 365,
    renewalWindowDays: 30,
  });

  assert.throws(() => validateLearningCertificationDraft({
    title: 'Invalid',
    programVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    validityDays: 30,
    renewalWindowDays: 30,
  }), /shorter/);
});

test('credential status derives deterministically from renewal and expiry dates', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(credentialStatusAt({
    currentStatus: 'ACTIVE',
    renewalDueAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-10-01T00:00:00.000Z',
  }, now), 'EXPIRING');
  assert.equal(credentialStatusAt({
    currentStatus: 'ACTIVE',
    renewalDueAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
  }, now), 'EXPIRED');
  assert.equal(credentialStatusAt({
    currentStatus: 'REVOKED',
    renewalDueAt: null,
    expiresAt: '2026-08-31T00:00:00.000Z',
  }, now), 'REVOKED');
});
