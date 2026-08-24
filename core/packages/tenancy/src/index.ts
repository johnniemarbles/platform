export type ActorKind = 'user' | 'party' | 'service' | 'agent';

export interface IdentityContext {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
}

export interface MembershipContext {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceIds?: readonly string[];
  readonly operatingUnitIds?: readonly string[];
}

export interface ResolveEffectiveContextInput {
  readonly identity: IdentityContext;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly memberships: readonly MembershipContext[];
  readonly correlationId?: string;
}

export interface EffectiveContext {
  readonly subjectId: string;
  readonly actorKind: ActorKind;
  readonly issuer?: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly correlationId?: string;
}

export type ContextResolutionFailure =
  | 'NO_MEMBERSHIP'
  | 'WORKSPACE_OUT_OF_SCOPE'
  | 'OPERATING_UNIT_OUT_OF_SCOPE';

export class ContextResolutionError extends Error {
  readonly reason: ContextResolutionFailure;

  constructor(reason: ContextResolutionFailure) {
    super(reason);
    this.name = 'ContextResolutionError';
    this.reason = reason;
  }
}

export function resolveEffectiveContext(input: ResolveEffectiveContextInput): EffectiveContext {
  const membership = input.memberships.find(
    (candidate) =>
      candidate.tenantId === input.tenantId && candidate.organizationId === input.organizationId,
  );
  if (!membership) throw new ContextResolutionError('NO_MEMBERSHIP');

  if (
    input.workspaceId !== undefined &&
    membership.workspaceIds !== undefined &&
    !membership.workspaceIds.includes(input.workspaceId)
  ) {
    throw new ContextResolutionError('WORKSPACE_OUT_OF_SCOPE');
  }

  if (
    input.operatingUnitId !== undefined &&
    membership.operatingUnitIds !== undefined &&
    !membership.operatingUnitIds.includes(input.operatingUnitId)
  ) {
    throw new ContextResolutionError('OPERATING_UNIT_OUT_OF_SCOPE');
  }

  return {
    subjectId: input.identity.subjectId,
    actorKind: input.identity.actorKind,
    ...(input.identity.issuer !== undefined ? { issuer: input.identity.issuer } : {}),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.operatingUnitId !== undefined ? { operatingUnitId: input.operatingUnitId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  };
}
