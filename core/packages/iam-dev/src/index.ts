/**
 * Development IdentityVerifier.
 *
 * Dev-only implementation of @platform-core/iam's IdentityVerifier. Verifies
 * HS256-signed JWTs minted inside this process; no network, no external provider.
 * In production the identity adapter is backed by AWS Cognito (plan rule 7); this
 * package must not ship to any production region.
 *
 * The runtime check against process.env.NODE_ENV refuses to construct the verifier
 * when NODE_ENV === 'production', so a stray wiring mistake fails loudly.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { ActorKind } from '@platform-core/tenancy';
import {
  IdentityVerificationError,
  type IdentityVerificationRequest,
  type IdentityVerifier,
  type VerifiedIdentity,
} from '@platform-core/iam';

export interface DevIdentityVerifierOptions {
  /** HMAC key. Any string ≥ 32 bytes. Must not be the empty default in CI. */
  readonly secret: string;
  /** Expected `iss` claim; defaults to 'platform-dev'. */
  readonly issuer?: string;
  /** Expected `aud` claim; verify() checks the request's expectedAudience against it. */
  readonly audience?: string;
  /** Clock, injectable for tests. */
  readonly now?: () => Date;
  /** Guard rail: refuse to build in production. Set 'allow' only inside tests. */
  readonly productionGuard?: 'enforce' | 'allow';
}

interface JwtHeader {
  readonly alg: 'HS256';
  readonly typ: 'JWT';
}

export interface DevClaims {
  readonly sub: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly iat?: number;
  readonly exp?: number;
  readonly nbf?: number;
  readonly sid?: string;
  readonly actor_kind?: ActorKind;
}

const base64url = (input: Buffer | string): string =>
  (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const base64urlDecode = (input: string): Buffer => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
};

/** Mint a dev JWT. Only call from tests and local dev sign-in. */
export function signDevToken(claims: DevClaims, secret: string): string {
  if (secret.length < 32) throw new Error('dev-token secret must be at least 32 bytes');
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 60 * 60, ...claims };
  const headerB = base64url(JSON.stringify(header));
  const payloadB = base64url(JSON.stringify(payload));
  const sig = base64url(createHmac('sha256', secret).update(`${headerB}.${payloadB}`).digest());
  return `${headerB}.${payloadB}.${sig}`;
}

export class DevIdentityVerifier implements IdentityVerifier {
  readonly #secret: string;
  readonly #issuer: string;
  readonly #audience: string | undefined;
  readonly #now: () => Date;

  constructor(options: DevIdentityVerifierOptions) {
    const guard = options.productionGuard ?? 'enforce';
    // Refuse construction in production regardless of secret quality, so a mis-wiring is caught at boot.
    if (guard === 'enforce' && process.env['NODE_ENV'] === 'production') {
      throw new Error('DevIdentityVerifier must not be used in production (NODE_ENV=production)');
    }
    if (options.secret.length < 32) throw new Error('DevIdentityVerifier secret must be at least 32 bytes');
    this.#secret = options.secret;
    this.#issuer = options.issuer ?? 'platform-dev';
    this.#audience = options.audience;
    this.#now = options.now ?? (() => new Date());
  }

  async verify(request: IdentityVerificationRequest): Promise<VerifiedIdentity> {
    const parts = request.credential.split('.');
    if (parts.length !== 3) throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    const [h, p, s] = parts as [string, string, string];

    // Signature must verify in constant time.
    const expected = base64url(createHmac('sha256', this.#secret).update(`${h}.${p}`).digest());
    const given = Buffer.from(s);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }

    let header: JwtHeader;
    let claims: DevClaims;
    try {
      header = JSON.parse(base64urlDecode(h).toString('utf8')) as JwtHeader;
      claims = JSON.parse(base64urlDecode(p).toString('utf8')) as DevClaims;
    } catch {
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }

    const nowSec = Math.floor(this.#now().getTime() / 1000);
    if (claims.nbf !== undefined && nowSec < claims.nbf) {
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }
    if (claims.exp !== undefined && nowSec >= claims.exp) {
      throw new IdentityVerificationError('IDENTITY_EXPIRED');
    }

    const audiences = claims.aud === undefined ? undefined
      : Array.isArray(claims.aud) ? [...claims.aud]
      : [claims.aud];
    if (
      request.expectedAudience !== undefined
      && audiences?.includes(request.expectedAudience) !== true
    ) {
      throw new IdentityVerificationError('AUDIENCE_MISMATCH');
    }
    if (
      this.#audience !== undefined
      && audiences?.includes(this.#audience) !== true
    ) {
      throw new IdentityVerificationError('AUDIENCE_MISMATCH');
    }

    const identity: VerifiedIdentity = {
      providerKey: 'dev',
      subjectId: claims.sub,
      issuer: claims.iss ?? this.#issuer,
      actorKind: claims.actor_kind ?? 'user',
      ...(audiences !== undefined ? { audiences } : {}),
      ...(claims.iat !== undefined ? { issuedAt: new Date(claims.iat * 1000) } : {}),
      ...(claims.exp !== undefined ? { expiresAt: new Date(claims.exp * 1000) } : {}),
      ...(claims.sid !== undefined ? { sessionId: claims.sid } : {}),
    };
    return identity;
  }
}

/** Convenience for sign-in handlers in dev: returns a fresh HMAC-safe secret. */
export const generateDevSecret = (): string => randomBytes(32).toString('hex');
