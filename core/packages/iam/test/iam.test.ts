import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextResolutionError } from '@platform-core/tenancy';
import {
  authenticateAndResolveContext,
  IdentityVerificationError,
  verifyIdentity,
} from '../src/index.ts';

const now = new Date('2026-08-25T02:10:00.000Z');

function verifiedIdentity() {
  return {
    providerKey: 'clerk',
    subjectId: 'user-123',
    issuer: 'https://identity.expadio.test',
    actorKind: 'user' as const,
    audiences: ['expadio-api'],
    expiresAt: new Date('2026-08-25T03:10:00.000Z'),
  };
}

test('empty credential fails before provider verifier is called', async () => {
  let calls = 0;
  await assert.rejects(
    verifyIdentity(
      {
        async verify() {
          calls += 1;
          return verifiedIdentity();
        },
      },
      { credential: '   ' },
      now,
    ),
    (error: unknown) =>
      error instanceof IdentityVerificationError && error.reason === 'EMPTY_CREDENTIAL',
  );
  assert.equal(calls, 0);
});

test('expected audience is enforced after provider verification', async () => {
  await assert.rejects(
    verifyIdentity(
      { async verify() { return verifiedIdentity(); } },
      { credential: 'opaque-token', expectedAudience: 'other-api' },
      now,
    ),
    (error: unknown) =>
      error instanceof IdentityVerificationError && error.reason === 'AUDIENCE_MISMATCH',
  );
});

test('expired normalized identity fails closed', async () => {
  await assert.rejects(
    verifyIdentity(
      {
        async verify() {
          return { ...verifiedIdentity(), expiresAt: new Date('2026-08-25T02:09:59.000Z') };
        },
      },
      { credential: 'opaque-token', expectedAudience: 'expadio-api' },
      now,
    ),
    (error: unknown) =>
      error instanceof IdentityVerificationError && error.reason === 'IDENTITY_EXPIRED',
  );
});

test('verified identity resolves effective context only through persisted membership', async () => {
  const context = await authenticateAndResolveContext(
    {
      identityVerifier: { async verify() { return verifiedIdentity(); } },
      membershipRepository: {
        async listActiveMemberships(identity) {
          assert.equal(identity.subjectId, 'user-123');
          assert.equal(identity.issuer, 'https://identity.expadio.test');
          return [{
            tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            organizationId: '11111111-1111-1111-1111-111111111111',
            workspaceIds: ['workspace-1'],
          }];
        },
      },
    },
    {
      credential: 'opaque-token',
      expectedAudience: 'expadio-api',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      organizationId: '11111111-1111-1111-1111-111111111111',
      workspaceId: 'workspace-1',
      correlationId: 'corr-1',
    },
    now,
  );

  assert.deepEqual(context, {
    subjectId: 'user-123',
    actorKind: 'user',
    issuer: 'https://identity.expadio.test',
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    organizationId: '11111111-1111-1111-1111-111111111111',
    workspaceId: 'workspace-1',
    correlationId: 'corr-1',
  });
});

test('caller-selected tenant is rejected when membership does not prove it', async () => {
  await assert.rejects(
    authenticateAndResolveContext(
      {
        identityVerifier: { async verify() { return verifiedIdentity(); } },
        membershipRepository: {
          async listActiveMemberships() {
            return [{
              tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              organizationId: '11111111-1111-1111-1111-111111111111',
            }];
          },
        },
      },
      {
        credential: 'opaque-token',
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        organizationId: '22222222-2222-2222-2222-222222222222',
      },
      now,
    ),
    (error: unknown) =>
      error instanceof ContextResolutionError && error.reason === 'NO_MEMBERSHIP',
  );
});
