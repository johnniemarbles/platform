import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { ActorKind } from '@platform-core/tenancy';
import {
  IdentityVerificationError,
  type IdentityVerificationRequest,
  type IdentityVerifier,
  type VerifiedIdentity,
} from '@platform-core/iam';

export interface CognitoVerifierOptions {
  readonly region: string;      // 'us-east-2', 'ap-south-1', ...
  readonly userPoolId: string;  // 'us-east-2_abc123'
  readonly clientId: string | readonly string[];
}

/**
 * Prod IdentityVerifier backed by AWS Cognito. One instance per region
 * (plan rule 7: one pool per region). Verifies tokens offline using
 * aws-jwt-verify, which caches the JWKS; no outbound call per request
 * after the first.
 */
export class CognitoIdentityVerifier implements IdentityVerifier {
  readonly #verifier: {
    verify(jwt: string): Promise<Record<string, unknown>>;
  };

  constructor(options: CognitoVerifierOptions) {
    const clientId = typeof options.clientId === 'string'
      ? options.clientId
      : [...options.clientId];
    this.#verifier = CognitoJwtVerifier.create({
      userPoolId: options.userPoolId,
      clientId,
      tokenUse: 'id',
    }) as unknown as { verify(jwt: string): Promise<Record<string, unknown>> };
  }

  async verify(request: IdentityVerificationRequest): Promise<VerifiedIdentity> {
    try {
      const payload = await this.#verifier.verify(request.credential);
      const actorKind: ActorKind =
        typeof payload['custom:actor_kind'] === 'string'
          && (payload['custom:actor_kind'] === 'user'
              || payload['custom:actor_kind'] === 'workload')
          ? (payload['custom:actor_kind'] as ActorKind)
          : 'user';

      const aud = payload['aud'];
      const audiences: readonly string[] | undefined =
        typeof aud === 'string'
          ? [aud]
          : Array.isArray(aud)
            ? aud.filter((x): x is string => typeof x === 'string')
            : undefined;

      const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
      const iss = typeof payload['iss'] === 'string' ? payload['iss'] : '';
      const iat = typeof payload['iat'] === 'number' ? new Date(payload['iat'] * 1000) : undefined;
      const exp = typeof payload['exp'] === 'number' ? new Date(payload['exp'] * 1000) : undefined;

      const identity: VerifiedIdentity = {
        providerKey: 'cognito',
        subjectId: sub,
        issuer: iss,
        actorKind,
        ...(audiences !== undefined ? { audiences } : {}),
        ...(iat !== undefined ? { issuedAt: iat } : {}),
        ...(exp !== undefined ? { expiresAt: exp } : {}),
      };
      return identity;
    } catch (e: unknown) {
      const reason = (e as { name?: string } | null)?.name;
      if (reason === 'JwtExpiredError') throw new IdentityVerificationError('IDENTITY_EXPIRED');
      if (reason === 'JwtInvalidClaimError') throw new IdentityVerificationError('AUDIENCE_MISMATCH');
      throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
    }
  }
}
