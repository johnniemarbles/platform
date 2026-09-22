/**
 * Entity node — the typed actor in the graph.
 *
 * Eight node types, each with distinct semantic meaning. The type is
 * immutable after creation: changing an entity's type requires dissolving
 * the node and creating a new one with a relationship edge linking them.
 *
 * Node types form a loose hierarchy in franchise networks:
 *
 *   BRAND_HQ
 *     └─ COUNTRY
 *          └─ STATE_MASTER (territorial)
 *               └─ UNIT (operated by MULTI_UNIT or directly)
 *         MULTI_UNIT (commercial, may span STATE_MASTERs)
 *               └─ UNIT
 *   LEGAL_ENTITY   (overlays any of the above)
 *   LOCATION       (overlays UNIT)
 *   JV_PARTNER     (economic participant only)
 *
 * But "hierarchy" is the wrong mental model. Use the relationship edges
 * for structure. The node types describe what an actor IS; the edges
 * describe how actors RELATE.
 */

export const NODE_TYPES = [
  'BRAND_HQ',
  'COUNTRY',
  'STATE_MASTER',
  'MULTI_UNIT',
  'UNIT',
  'LEGAL_ENTITY',
  'LOCATION',
  'JV_PARTNER',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'DISSOLVED'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface EntityNode {
  readonly nodeId: string;
  readonly tenantId: string;
  readonly nodeType: NodeType;
  readonly displayName: string;
  readonly externalRef: string | null;
  readonly organizationId: string | null;
  readonly status: NodeStatus;
  readonly dissolvedAt: string | null;
  readonly dissolvedBy: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEntityNodeRequest {
  readonly tenantId: string;
  readonly nodeType: NodeType;
  readonly displayName: string;
  readonly externalRef?: string;
  readonly organizationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
}

export interface DissolveEntityNodeRequest {
  readonly nodeId: string;
  readonly tenantId: string;
  readonly dissolvedBy: string;
  readonly reason: string;
}

/**
 * Validates a CreateEntityNodeRequest without any I/O.
 * Returns a list of validation errors, empty if valid.
 */
export function validateCreateEntityNode(
  req: CreateEntityNodeRequest,
): readonly string[] {
  const errors: string[] = [];

  if (!NODE_TYPES.includes(req.nodeType as NodeType)) {
    errors.push(`nodeType '${req.nodeType}' is not a valid node type`);
  }
  if (typeof req.displayName !== 'string' || req.displayName.trim() === '') {
    errors.push('displayName must be a non-empty string');
  }
  if (req.displayName && req.displayName.length > 255) {
    errors.push('displayName must not exceed 255 characters');
  }
  if (req.externalRef !== undefined && req.externalRef.trim() === '') {
    errors.push('externalRef must not be blank when provided');
  }

  return errors;
}

/**
 * A BRAND_HQ node is the root of a tenant's entity graph.
 * At most one active BRAND_HQ node per tenant (enforced by DB unique index).
 */
export function isBrandHq(node: EntityNode): boolean {
  return node.nodeType === 'BRAND_HQ';
}

/**
 * Nodes that can have a territorial jurisdiction edge as their TARGET.
 * STATE_MASTER, COUNTRY, and BRAND_HQ can hold territorial authority.
 * UNIT and LOCATION are typically the targets of such edges (the thing
 * being governed), not the holders of authority.
 */
export function canHoldTerritorialAuthority(nodeType: NodeType): boolean {
  return nodeType === 'STATE_MASTER' || nodeType === 'COUNTRY' || nodeType === 'BRAND_HQ';
}

/**
 * Nodes that are eligible to be named as a COMMERCIAL_PARENT.
 */
export function canBeCommercialParent(nodeType: NodeType): boolean {
  return nodeType === 'MULTI_UNIT' || nodeType === 'COUNTRY' || nodeType === 'BRAND_HQ';
}

/**
 * Nodes that represent operating locations (can have a LocationUnit overlay).
 */
export function canHaveLocationOverlay(nodeType: NodeType): boolean {
  return nodeType === 'UNIT' || nodeType === 'LOCATION';
}
