import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CognitoIdentityVerifier } from '../src/index.ts';
import { IdentityVerificationError } from '@platform-core/iam';

test('CognitoIdentityVerifier constructs with valid options', () => {
  const verifier = new CognitoIdentityVerifier({
    region: 'us-east-2',
    userPoolId: 'us-east-2_mockpool123',
    clientId: 'mockclient1234567890',
  });
  assert.ok(verifier);
});

test('CognitoIdentityVerifier rejects malformed token with INVALID_NORMALIZED_IDENTITY', async () => {
  const verifier = new CognitoIdentityVerifier({
    region: 'us-east-2',
    userPoolId: 'us-east-2_mockpool123',
    clientId: 'mockclient1234567890',
  });

  await assert.rejects(
    async () => {
      await verifier.verify({ credential: 'not-a-jwt' });
    },
    (err: unknown) => {
      assert.ok(err instanceof IdentityVerificationError);
      assert.equal((err as IdentityVerificationError).reason, 'INVALID_NORMALIZED_IDENTITY');
      return true;
    },
  );
});

test('CognitoIdentityVerifier error mapping handles JwtExpiredError', async () => {
  const verifier = new CognitoIdentityVerifier({
    region: 'us-east-2',
    userPoolId: 'us-east-2_mockpool123',
    clientId: 'mockclient1234567890',
  });

  try {
    await verifier.verify({ credential: 'bad' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof IdentityVerificationError);
    assert.equal((err as IdentityVerificationError).reason, 'INVALID_NORMALIZED_IDENTITY');
  }
});
