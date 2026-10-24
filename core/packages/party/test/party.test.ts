import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAccountInput,
  validateContactInput,
  PartyValidationError,
  ACCOUNT_LIFECYCLE_STAGES,
} from '../src/index.ts';

test('a valid account normalizes domain and defaults the stage', () => {
  const account = validateAccountInput({ name: '  Acme Corp ', domain: 'ACME.com' });
  assert.equal(account.name, 'Acme Corp');
  assert.equal(account.domain, 'acme.com');
  assert.equal(account.lifecycleStage, 'PROSPECT');
});

test('account name is required and bounded', () => {
  assert.throws(() => validateAccountInput({ name: '' }), PartyValidationError);
  assert.throws(() => validateAccountInput({ name: 'x'.repeat(201) }), /1–200/);
});

test('account domain rejects an email or URL but accepts a bare domain', () => {
  assert.throws(() => validateAccountInput({ name: 'Acme', domain: 'joe@acme.com' }), /bare domain/);
  assert.throws(() => validateAccountInput({ name: 'Acme', domain: 'https://acme.com' }), /bare domain/);
  assert.equal(validateAccountInput({ name: 'Acme', domain: 'sub.acme.co.uk' }).domain, 'sub.acme.co.uk');
});

test('account lifecycle stage must be known', () => {
  assert.throws(() => validateAccountInput({ name: 'Acme', lifecycleStage: 'WIZARD' }), /lifecycle stage/);
  for (const stage of ACCOUNT_LIFECYCLE_STAGES) {
    assert.equal(validateAccountInput({ name: 'Acme', lifecycleStage: stage }).lifecycleStage, stage);
  }
});

test('a contact needs a name and at least one identifier', () => {
  assert.throws(() => validateContactInput({ fullName: 'Jane Doe' }), /email, a phone number, or an account/);
  const contact = validateContactInput({ fullName: ' Jane Doe ', email: 'JANE@Acme.com' });
  assert.equal(contact.fullName, 'Jane Doe');
  assert.equal(contact.email, 'jane@acme.com');
});

test('a contact email must be well-formed', () => {
  assert.throws(() => validateContactInput({ fullName: 'Jane', email: 'not-an-email' }), /valid email/);
});

test('a contact accountId must be a uuid when present', () => {
  assert.throws(() => validateContactInput({ fullName: 'Jane', accountId: 'nope' }), /valid identifier/);
});
