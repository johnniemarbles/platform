import type { EffectiveContext } from '@platform-core/tenancy';

export type AuthorizationIntent = 'read' | 'act';
export type DataClassification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'sensitive';

export type AuthorizationStage =
  | 'TENANT'
  | 'CAPABILITY'
  | 'ENTITLEMENT'
  | 'SCOPE'
  | 'RESOURCE_STATE'
  | 'CLASSIFICATION'
  | 'RELATIONSHIP'
  | 'RESTRICTION'
  | 'SOD';

export interface ScopeGrant {
  readonly tenantId: string;
  readonly organizationIds?: readonly string[];
  readonly operatingUnitIds?: readonly string[];
  readonly resourceIds?: readonly string[];
}

export interface CapabilityGrant {
  readonly action: string;
  readonly resourceType: string;
  readonly blockedStates?: readonly string[];
}

export interface RoleAssignment {
  readonly roleKey: string;
  readonly capabilities: readonly CapabilityGrant[];
  readonly actionScope: ScopeGrant;
  readonly visibilityScope?: ScopeGrant;
  readonly clearances?: readonly DataClassification[];
  readonly sensitiveCompartments?: readonly string[];
}

export interface ResourceDescriptor {
  readonly type: string;
  readonly id: string;
  readonly tenantId: string;
  readonly organizationId?: string;
  readonly operatingUnitId?: string;
  readonly state?: string;
  readonly classification?: DataClassification;
  readonly compartment?: string;
  readonly ownerSubjectId?: string;
  readonly relationships?: readonly string[];
}

export interface AuthorizationQuery {
  readonly action: string;
  readonly intent: AuthorizationIntent;
  readonly resource: ResourceDescriptor;
  readonly requiredEntitlement?: string;
  readonly requiredRelationship?: string;
}

export interface AuthorizationRestriction {
  readonly key: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly reason: string;
}

export interface SodRule {
  readonly key: string;
  readonly description: string;
  readonly veto: (input: SodRuleInput) => boolean;
}

export interface SodRuleInput {
  readonly context: EffectiveContext;
  readonly query: AuthorizationQuery;
  readonly assignment: RoleAssignment;
}

export interface AuthorizationInput {
  readonly context: EffectiveContext;
  readonly query: AuthorizationQuery;
  readonly assignments: readonly RoleAssignment[];
  readonly entitlements?: ReadonlySet<string>;
  readonly restrictions?: readonly AuthorizationRestriction[];
  readonly sodRules?: readonly SodRule[];
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonKey: string;
  readonly reason: string;
  readonly stage?: AuthorizationStage;
  readonly viaRole?: string;
  readonly vetoedBy?: string;
}

const CLASSIFICATION_RANK: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  sensitive: 4,
};

export function authorize(input: AuthorizationInput): AuthorizationDecision {
  const { context, query } = input;

  if (query.resource.tenantId !== context.tenantId) {
    return deny(
      'TENANT',
      'TENANT_MISMATCH',
      'The resource is outside the effective tenant context.',
    );
  }

  const capabilityCandidates = input.assignments.filter((assignment) =>
    assignment.capabilities.some(
      (grant) => grant.action === query.action && grant.resourceType === query.resource.type,
    ),
  );

  if (capabilityCandidates.length === 0) {
    return deny(
      'CAPABILITY',
      'CAPABILITY_NOT_GRANTED',
      `No assignment grants ${query.action} on ${query.resource.type}.`,
    );
  }

  if (
    query.requiredEntitlement !== undefined &&
    !(input.entitlements ?? new Set<string>()).has(query.requiredEntitlement)
  ) {
    return deny(
      'ENTITLEMENT',
      'ENTITLEMENT_REQUIRED',
      `Missing entitlement ${query.requiredEntitlement}.`,
    );
  }

  let furthest: AuthorizationDecision = deny(
    'SCOPE',
    'SCOPE_MISMATCH',
    'The resource is outside the allowed scope.',
  );

  for (const assignment of capabilityCandidates) {
    const scope =
      query.intent === 'read' && assignment.visibilityScope !== undefined
        ? assignment.visibilityScope
        : assignment.actionScope;

    if (!withinScope(query.resource, scope)) continue;

    const capability = assignment.capabilities.find(
      (grant) => grant.action === query.action && grant.resourceType === query.resource.type,
    )!;

    if (
      query.resource.state !== undefined &&
      capability.blockedStates?.includes(query.resource.state)
    ) {
      furthest = deny(
        'RESOURCE_STATE',
        'RESOURCE_STATE_BLOCKED',
        `${query.action} is not allowed while the resource is ${query.resource.state}.`,
      );
      continue;
    }

    if (!classificationAllowed(assignment, query.resource)) {
      furthest = deny(
        'CLASSIFICATION',
        'CLASSIFICATION_NOT_CLEARED',
        'The assignment is not cleared for this data classification or compartment.',
      );
      continue;
    }

    if (
      query.requiredRelationship !== undefined &&
      !query.resource.relationships?.includes(query.requiredRelationship)
    ) {
      furthest = deny(
        'RELATIONSHIP',
        'RELATIONSHIP_REQUIRED',
        `The resource does not satisfy relationship ${query.requiredRelationship}.`,
      );
      continue;
    }

    const restriction = input.restrictions?.find(
      (candidate) =>
        (candidate.action === undefined || candidate.action === query.action) &&
        (candidate.resourceType === undefined || candidate.resourceType === query.resource.type) &&
        (candidate.resourceId === undefined || candidate.resourceId === query.resource.id),
    );

    if (restriction) {
      furthest = deny('RESTRICTION', restriction.key, restriction.reason);
      continue;
    }

    const veto = input.sodRules?.find((rule) =>
      rule.veto({ context, query, assignment }),
    );

    if (veto) {
      return {
        allowed: false,
        stage: 'SOD',
        reasonKey: veto.key,
        reason: veto.description,
        vetoedBy: veto.key,
      };
    }

    return {
      allowed: true,
      reasonKey: 'GRANTED',
      reason: 'Authorization granted.',
      viaRole: assignment.roleKey,
    };
  }

  return furthest;
}

export function denySelfApprovalRule(action = 'approve'): SodRule {
  return {
    key: 'SELF_APPROVAL_DENIED',
    description: 'The resource owner cannot approve their own resource.',
    veto: ({ context, query }) =>
      query.action === action && query.resource.ownerSubjectId === context.subjectId,
  };
}

function withinScope(resource: ResourceDescriptor, scope: ScopeGrant): boolean {
  if (scope.tenantId !== resource.tenantId) return false;

  if (
    resource.organizationId !== undefined &&
    scope.organizationIds !== undefined &&
    !scope.organizationIds.includes(resource.organizationId)
  ) {
    return false;
  }

  if (
    resource.operatingUnitId !== undefined &&
    scope.operatingUnitIds !== undefined &&
    !scope.operatingUnitIds.includes(resource.operatingUnitId)
  ) {
    return false;
  }

  if (scope.resourceIds !== undefined && !scope.resourceIds.includes(resource.id)) {
    return false;
  }

  return true;
}

function classificationAllowed(
  assignment: RoleAssignment,
  resource: ResourceDescriptor,
): boolean {
  const classification = resource.classification;
  if (classification === undefined || classification === 'public') return true;

  const clearances = assignment.clearances ?? [];
  if (
    !clearances.some(
      (clearance) =>
        CLASSIFICATION_RANK[clearance] >= CLASSIFICATION_RANK[classification],
    )
  ) {
    return false;
  }

  if (classification === 'sensitive' && resource.compartment !== undefined) {
    return assignment.sensitiveCompartments?.includes(resource.compartment) === true;
  }

  return true;
}

function deny(
  stage: AuthorizationStage,
  reasonKey: string,
  reason: string,
): AuthorizationDecision {
  return { allowed: false, stage, reasonKey, reason };
}
