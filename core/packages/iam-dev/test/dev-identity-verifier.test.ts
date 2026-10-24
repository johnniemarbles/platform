import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevIdentityVerifier, signDevToken, generateDevSecret } from '../src/index.ts';
import { IdentityVerificationError, verifyIdentity } from '@platform-core/iam';

const SECRET = 'a'.repeat(64);

test('a valid dev token round-trips through verify()', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET });
  const token = signDevToken({ sub: 'usr_42', iss: 'platform-dev', actor_kind: 'user' }, SECRET);
  const id = await v.verify({ credential: token });
  assert.equal(id.subjectId, 'usr_42');
  assert.equal(id.providerKey, 'dev');
  assert.equal(id.actorKind, 'user');
  assert.ok(id.issuedAt instanceof Date);
  assert.ok(id.expiresAt instanceof Date);
});

test('a token signed by someone else is rejected', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET });
  const token = signDevToken({ sub: 'usr_x' }, 'b'.repeat(64));
  await assert.rejects(v.verify({ credential: token }), (e: unknown) => e instanceof IdentityVerificationError && (e as IdentityVerificationError).reason === 'INVALID_NORMALIZED_IDENTITY');
});

test('an expired token raises IDENTITY_EXPIRED', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET, now: () => new Date(10_000_000 * 1000) });
  const token = signDevToken({ sub: 'u', exp: 9_000_000 }, SECRET);
  await assert.rejects(v.verify({ credential: token }), (e: unknown) => e instanceof IdentityVerificationError && (e as IdentityVerificationError).reason === 'IDENTITY_EXPIRED');
});

test('audience mismatch is rejected when expectedAudience is set', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET });
  const token = signDevToken({ sub: 'u', aud: 'platform-dev' }, SECRET);
  await assert.rejects(v.verify({ credential: token, expectedAudience: 'other' }), (e: unknown) => e instanceof IdentityVerificationError && (e as IdentityVerificationError).reason === 'AUDIENCE_MISMATCH');
});

test('audience configured on the verifier is enforced', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET, audience: 'platform-dev' });
  const token = signDevToken({ sub: 'u' }, SECRET); // no aud claim
  await assert.rejects(v.verify({ credential: token }), (e: unknown) => e instanceof IdentityVerificationError && (e as IdentityVerificationError).reason === 'AUDIENCE_MISMATCH');
});

test('garbage credentials are rejected safely', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET });
  for (const bad of ['not-a-token', '', 'a.b', 'a.b.c.d', '....', '====']) {
    await assert.rejects(v.verify({ credential: bad }));
  }
});

test('short secrets are refused at construction time', () => {
  assert.throws(() => new DevIdentityVerifier({ secret: 'too-short' }));
  assert.throws(() => signDevToken({ sub: 'u' }, 'too-short'));
});

test('the production guard refuses construction when NODE_ENV=production', () => {
  const prev = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  try {
    assert.throws(() => new DevIdentityVerifier({ secret: SECRET }));
    // The 'allow' escape hatch exists only for tests of the guard itself.
    assert.doesNotThrow(() => new DevIdentityVerifier({ secret: SECRET, productionGuard: 'allow' }));
  } finally {
    if (prev === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev;
  }
});

test('verifyIdentity() in @platform-core/iam wraps the dev verifier correctly', async () => {
  const v = new DevIdentityVerifier({ secret: SECRET });
  const token = signDevToken({ sub: 'u' }, SECRET);
  const id = await verifyIdentity(v, { credential: token });
  assert.equal(id.subjectId, 'u');
});

test('generateDevSecret() returns a 64-char hex string suitable for the verifier', () => {
  const s = generateDevSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.doesNotThrow(() => new DevIdentityVerifier({ secret: s }));
});
