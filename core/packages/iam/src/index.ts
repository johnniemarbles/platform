import type {
  ActorKind,
  EffectiveContext,
  IdentityContext,
} from '@platform-core/tenancy';
import {
  resolveEffectiveContextFromRepository,
  type MembershipRepository,
} from '@platform-core/tenancy-persistence';

export interface IdentityVerificationRequest {
  /** Opaque provider credential. Never log, persist or place in domain events. */
  readonly credential: string;
  readonly expectedAudience?: string;
}

export interface VerifiedIdentity {
  readonly providerKey: string;
  readonly subjectId: string;
  readonly issuer: string;
  readonly actorKind: ActorKind;
  readonly audiences?: readonly string[];
  readonly issuedAt?: Date;
  readonly expiresAt?: Date;
  readonly sessionId?: string;
}

/** Provider adapters (Clerk, Supabase Auth, enterprise OIDC, etc.) implement this. */
export interface IdentityVerifier {
  verify(request: IdentityVerificationRequest): Promise<VerifiedIdentity>;
}

export type IdentityVerificationFailure =
  | 'EMPTY_CREDENTIAL'
  | 'INVALID_NORMALIZED_IDENTITY'
  | 'IDENTITY_EXPIRED'
  | 'AUDIENCE_MISMATCH';

export class IdentityVerificationError extends Error {
  readonly reason: IdentityVerificationFailure;

  constructor(reason: IdentityVerificationFailure) {
    super(reason);
    this.name = 'IdentityVerificationError';
    this.reason = reason;
  }
}

export async function verifyIdentity(
  verifier: IdentityVerifier,
  request: IdentityVerificationRequest,
  now: Date = new Date(),
): Promise<VerifiedIdentity> {
  if (request.credential.trim().length === 0) {
    throw new IdentityVerificationError('EMPTY_CREDENTIAL');
  }

  const identity = await verifier.verify(request);
  validateNormalizedIdentity(identity, now);

  if (
    request.expectedAudience !== undefined &&
    identity.audiences?.includes(request.expectedAudience) !== true
  ) {
    throw new IdentityVerificationError('AUDIENCE_MISMATCH');
  }

  return identity;
}

export function toIdentityContext(identity: VerifiedIdentity): IdentityContext {
  return {
    subjectId: identity.subjectId,
    issuer: identity.issuer,
    actorKind: identity.actorKind,
  };
}

export interface AuthenticateContextInput extends IdentityVerificationRequest {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly correlationId?: string;
}

export interface AuthenticateContextDependencies {
  readonly identityVerifier: IdentityVerifier;
  readonly membershipRepository: MembershipRepository;
}

/**
 * Canonical request bootstrap:
 * provider verification -> normalized IdentityContext -> persisted membership
 * verification -> EffectiveContext. No caller-selected tenant becomes trusted
 * until the membership resolver accepts it.
 */
export async function authenticateAndResolveContext(
  dependencies: AuthenticateContextDependencies,
  input: AuthenticateContextInput,
  now: Date = new Date(),
): Promise<EffectiveContext> {
  const verified = await verifyIdentity(dependencies.identityVerifier, input, now);
  const identity = toIdentityContext(verified);

  return resolveEffectiveContextFromRepository(
    dependencies.membershipRepository,
    {
      identity,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.operatingUnitId !== undefined
        ? { operatingUnitId: input.operatingUnitId }
        : {}),
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    },
  );
}

function validateNormalizedIdentity(identity: VerifiedIdentity, now: Date): void {
  if (
    !isNormalizedToken(identity.providerKey) ||
    !isNormalizedToken(identity.subjectId) ||
    !isNormalizedToken(identity.issuer)
  ) {
    throw new IdentityVerificationError('INVALID_NORMALIZED_IDENTITY');
  }

  if (identity.expiresAt !== undefined && identity.expiresAt.getTime() <= now.getTime()) {
    throw new IdentityVerificationError('IDENTITY_EXPIRED');
  }
}

function isNormalizedToken(value: string): boolean {
  return value.trim().length > 0 && value === value.trim() && !/[\r\n\t]/u.test(value);
}
