/**
 * Governed relationship edges.
 *
 * Six relationship types, each with distinct cardinality semantics.
 * The application layer enforces cardinality here; the database trigger
 * enforces it at the storage layer. Both must agree.
 *
 * Key design invariant: a relationship edge is NEVER an authorization input
 * on its own. Authorization requires resolving the purpose-specific closure
 * function for the requested access type, then checking whether the requesting
 * principal's node appears in that closure. An edge existing is not sufficient;
 * the closure traversal is the authorization check.
 */

export const RELATIONSHIP_TYPES = [
  'COMMERCIAL_PARENT',
  'OPERATIONAL_PARENT',
  'TERRITORIAL_JURISDICTION',
  'GOVERNANCE_PARENT',
  'LOCATED_IN',
  'OWNERSHIP',
  'LEGACY',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * Relationship types that allow only one active edge per target node.
 * Creating a new singleton edge requires terminating the existing one first.
 */
export const SINGLETON_RELATIONSHIP_TYPES = new Set<RelationshipType>([
  'COMMERCIAL_PARENT',
  'OPERATIONAL_PARENT',
  'TERRITORIAL_JURISDICTION',
  'GOVERNANCE_PARENT',
]);

export function isSingletonRelationship(type: RelationshipType): boolean {
  return SINGLETON_RELATIONSHIP_TYPES.has(type);
}

export const RELATIONSHIP_STATUSES = ['ACTIVE', 'SUPERSEDED', 'TERMINATED'] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export interface EntityRelationship {
  readonly relationshipId: string;
  readonly tenantId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationshipType: RelationshipType;
  readonly effectiveFrom: string;  // ISO date
  readonly effectiveTo: string | null;
  readonly status: RelationshipStatus;
  readonly evidenceRef: string | null;
  readonly approvedBy: string | null;
  readonly createdBy: string;
  readonly notes: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface CreateRelationshipRequest {
  readonly tenantId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationshipType: RelationshipType;
  readonly effectiveFrom?: string;
  readonly evidenceRef?: string;
  readonly approvedBy?: string;
  readonly notes?: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
}

export interface TerminateRelationshipRequest {
  readonly relationshipId: string;
  readonly tenantId: string;
  readonly effectiveTo: string;
  readonly terminatedBy: string;
  readonly reason: string;
}

/**
 * Pure validation — does not check the database for existing active edges.
 * The database trigger is the enforcement point for cardinality.
 * This validates the request shape before it reaches the database.
 */
export function validateCreateRelationship(
  req: CreateRelationshipRequest,
): readonly string[] {
  const errors: string[] = [];

  if (!RELATIONSHIP_TYPES.includes(req.relationshipType as RelationshipType)) {
    errors.push(`relationshipType '${req.relationshipType}' is not valid`);
  }
  if (req.relationshipType === 'LEGACY') {
    errors.push(
      'LEGACY relationships cannot be created directly. '
      + 'They exist only as migrated historical records.',
    );
  }
  if (req.sourceNodeId === req.targetNodeId) {
    errors.push('A node cannot have a relationship with itself');
  }
  if (req.effectiveFrom !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(req.effectiveFrom)) {
    errors.push('effectiveFrom must be an ISO date string (YYYY-MM-DD)');
  }

  return errors;
}

/**
 * Relationship type semantics — used in UI and API documentation.
 *
 * Source → Target:
 *   COMMERCIAL_PARENT:       Target's commercial authority is Source
 *   OPERATIONAL_PARENT:      Target reports operationally to Source
 *   TERRITORIAL_JURISDICTION: Source holds territorial authority over Target
 *   GOVERNANCE_PARENT:       Target's governance authority is Source
 *   LOCATED_IN:              Target is physically located within Source (geography)
 *   OWNERSHIP:               Source holds an ownership interest in Target
 *                            (use ownership_interests for percentage splits)
 */
export const RELATIONSHIP_SEMANTICS: Readonly<Record<RelationshipType, {
  readonly label: string;
  readonly description: string;
  readonly sourceRole: string;
  readonly targetRole: string;
}>> = {
  COMMERCIAL_PARENT: {
    label: 'Commercial parent',
    description: 'The source is the commercial authority of the target — royalties and commercial terms flow through this edge.',
    sourceRole: 'Commercial authority',
    targetRole: 'Commercially governed unit',
  },
  OPERATIONAL_PARENT: {
    label: 'Operational parent',
    description: 'The target reports operationally to the source.',
    sourceRole: 'Operational authority',
    targetRole: 'Operationally governed entity',
  },
  TERRITORIAL_JURISDICTION: {
    label: 'Territorial jurisdiction',
    description: 'The source holds territorial development rights over the target\'s geography.',
    sourceRole: 'Territory holder',
    targetRole: 'Unit within territory',
  },
  GOVERNANCE_PARENT: {
    label: 'Governance authority',
    description: 'The source sets compliance standards, audit rights, and governance rules for the target.',
    sourceRole: 'Governance authority',
    targetRole: 'Governed entity',
  },
  LOCATED_IN: {
    label: 'Located in',
    description: 'The target is physically located within the source geography (city, state, country).',
    sourceRole: 'Geographic container',
    targetRole: 'Located entity',
  },
  OWNERSHIP: {
    label: 'Ownership',
    description: 'The source holds an ownership interest in the target. Use ownership_interests for percentage details.',
    sourceRole: 'Owner',
    targetRole: 'Owned entity',
  },
  LEGACY: {
    label: 'Legacy (unclassified)',
    description: 'Migrated from a prior free-form relationship_key. Requires manual reclassification.',
    sourceRole: 'Unknown',
    targetRole: 'Unknown',
  },
};
