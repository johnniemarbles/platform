import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideCapturePromote,
  normalizePersonMatchKeys,
  resolveOpenLead,
} from '../src/person-resolution.ts';

test('normalizes email and E.164 phone; drops junk', () => {
  const keys = normalizePersonMatchKeys({
    email: '  Alex@Example.COM ',
    phone: '+1 (647) 619-0871',
    socialUserId: ' ',
  });
  assert.equal(keys.email, 'alex@example.com');
  assert.equal(keys.phone, '+16476190871');
  assert.equal(keys.socialUserId, null);
  assert.equal(normalizePersonMatchKeys({ phone: 'not-a-valid-phone' }).phone, null);
  assert.equal(normalizePersonMatchKeys({ phone: '+16476190871' }).phone, '+16476190871');
});

test('reuses one open lead matched on email', () => {
  const keys = normalizePersonMatchKeys({ email: 'a@b.com' });
  const decision = resolveOpenLead(keys, [
    { leadId: 'L1', stage: 'NEW', contactEmail: 'a@b.com', contactPhone: null, socialUserId: null },
    { leadId: 'L2', stage: 'WON', contactEmail: 'a@b.com', contactPhone: null, socialUserId: null },
  ]);
  assert.deepEqual(decision, { action: 'reuse', leadId: 'L1', matchedOn: 'email' });
});

test('opens new when no open match', () => {
  const keys = normalizePersonMatchKeys({ email: 'new@b.com' });
  const decision = resolveOpenLead(keys, [
    { leadId: 'L1', stage: 'LOST', contactEmail: 'new@b.com', contactPhone: null, socialUserId: null },
  ]);
  assert.equal(decision.action, 'open-new');
});

test('ambiguous when two open leads match different keys', () => {
  const keys = normalizePersonMatchKeys({ email: 'a@b.com', phone: '+16476190871' });
  const decision = resolveOpenLead(keys, [
    { leadId: 'L1', stage: 'NEW', contactEmail: 'a@b.com', contactPhone: null, socialUserId: null },
    { leadId: 'L2', stage: 'QUALIFIED', contactEmail: null, contactPhone: '+16476190871', socialUserId: null },
  ]);
  assert.equal(decision.action, 'ambiguous');
});

test('meta and unverified email stay in review', () => {
  const keys = normalizePersonMatchKeys({ email: 'a@b.com' });
  assert.equal(
    decideCapturePromote({
      inlet: 'web_form',
      emailVerified: true,
      keys,
      suppressed: false,
      channelConsentOk: true,
    }),
    'auto-convert',
  );
  assert.equal(
    decideCapturePromote({
      inlet: 'meta_leadgen',
      emailVerified: true,
      keys,
      suppressed: false,
      channelConsentOk: true,
    }),
    'review',
  );
  assert.equal(
    decideCapturePromote({
      inlet: 'web_form',
      emailVerified: false,
      keys,
      suppressed: false,
      channelConsentOk: true,
    }),
    'review',
  );
});
