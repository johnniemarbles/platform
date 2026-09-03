import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IdentityNormalizationError,
  chooseSurvivor,
  classifyMatch,
  matchConfidence,
  normalizeEmailKey,
  normalizeNameKey,
  normalizePhoneKey,
  planContactMerge,
  type MergeableContact,
} from '../src/index.ts';

const hasCode = (code: string) => (e: unknown) => (e as { code?: string }).code === code;

test('email keys lowercase/trim; invalids reject', () => {
  assert.equal(normalizeEmailKey('  Ada@Example.COM '), 'ada@example.com');
  assert.throws(() => normalizeEmailKey('nope'), hasCode('EMAIL_INVALID'));
  assert.throws(() => normalizeEmailKey(''), hasCode('EMAIL_INVALID'));
  assert.throws(() => normalizeEmailKey(null), hasCode('EMAIL_REQUIRED'));
  // Conservative: plus-tags and dots are NOT stripped (distinct people stay distinct).
  assert.notEqual(normalizeEmailKey('a.b+tag@example.com'), normalizeEmailKey('ab@example.com'));
});

test('phone keys keep digits and a leading plus, reject junk lengths', () => {
  assert.equal(normalizePhoneKey(' +1 (415) 555-2671 '), '+14155552671');
  assert.equal(normalizePhoneKey('415.555.2671'), '4155552671');
  assert.equal(normalizePhoneKey('12345'), null);
  assert.equal(normalizePhoneKey(''), null);
  assert.equal(normalizePhoneKey(undefined), null);
});

test('name keys are order-insensitive and punctuation-insensitive', () => {
  assert.equal(normalizeNameKey('Ada', 'Lovelace'), normalizeNameKey('Lovelace', 'Ada'));
  assert.equal(normalizeNameKey('  ADA ', 'lovelace'), 'ada lovelace');
  assert.equal(normalizeNameKey('', ''), null);
});

test('only exact email auto-links; other signals go to review', () => {
  const a = { emailKey: 'x@y.com', phoneKey: '+14155550000', nameKey: 'ada lovelace' };
  assert.equal(classifyMatch(a, { emailKey: 'x@y.com' }).decision, 'AUTO_LINK');
  assert.equal(classifyMatch(a, { phoneKey: '+14155550000' }).decision, 'REVIEW');
  assert.equal(classifyMatch(a, { nameKey: 'ada lovelace' }).decision, 'REVIEW');
  assert.equal(classifyMatch(a, { emailKey: 'other@y.com' }).decision, 'NONE');
  // A different email never auto-links even if phone AND name also match —
  // high confidence still routes to review, never a silent merge.
  const strong = classifyMatch(a, { emailKey: 'other@y.com', phoneKey: '+14155550000', nameKey: 'ada lovelace' });
  assert.equal(strong.decision, 'REVIEW');
  assert.equal(strong.confidence, 1);
  assert.equal(strong.signals.emailExact, false);
});

test('confidence is deterministic and email is decisive', () => {
  assert.equal(matchConfidence({ emailExact: true, phoneExact: false, nameExact: false }), 1);
  assert.equal(matchConfidence({ emailExact: false, phoneExact: true, nameExact: false }), 0.7);
  assert.equal(matchConfidence({ emailExact: false, phoneExact: true, nameExact: true }), 1);
  assert.equal(matchConfidence({ emailExact: false, phoneExact: false, nameExact: false }), 0);
});

const base: MergeableContact = {
  contactId: 'a', tenantId: 't', organizationId: 'o', status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z', email: 'a@b.com', phone: null, firstName: 'Ada', lastName: null,
};

test('merge plan fills survivor blanks, keeps survivor values, and is reversible-safe', () => {
  const dup: MergeableContact = { ...base, contactId: 'b', createdAt: '2026-02-01T00:00:00Z', email: 'other@b.com', phone: '+14155550000', lastName: 'Lovelace' };
  const { survivor, duplicate } = chooseSurvivor(base, dup);
  assert.equal(survivor.contactId, 'a', 'older record survives');
  const plan = planContactMerge(survivor, duplicate);
  assert.equal(plan.survivorContactId, 'a');
  assert.equal(plan.mergedContactId, 'b');
  assert.equal(plan.fieldUpdates.phone, '+14155550000', 'blank phone is filled');
  assert.equal(plan.fieldUpdates.lastName, 'Lovelace', 'blank last name is filled');
  assert.ok(!('email' in plan.fieldUpdates), 'survivor email is kept, not overwritten');
});

test('merge invariants refuse self, cross-org, and non-active merges', () => {
  assert.throws(() => planContactMerge(base, base), hasCode('MERGE_SELF'));
  assert.throws(() => planContactMerge(base, { ...base, contactId: 'b', organizationId: 'other' }), hasCode('MERGE_CROSS_SCOPE'));
  assert.throws(() => planContactMerge(base, { ...base, contactId: 'b', status: 'MERGED' }), hasCode('MERGE_NOT_ACTIVE'));
});
