/**
 * Purpose-specific closure resolution.
 *
 * Each closure function answers a different authorization question.
 * The caller must specify which purpose they are evaluating.
 *
 * This is the critical design invariant:
 *   Authorization must route to the correct closure for the access purpose.
 *   Using governance_closure() to answer a commercial visibility question
 *   is a logic error, not just an API mistake. The wrong closure produces
 *   wrong answers silently.
 *
 * Examples:
 *   "Can Brand HQ see this unit's leads?" → governance_closure(brand_hq_node_id)
 *   "Can this operator see its fleet?"    → commercial_closure(operator_node_id)
 *   "What units are in this territory?"   → territorial_closure(state_master_id)
 *   "What is in this operational tree?"   → operational_closure(root_node_id)
 */

export type ClosurePurpose = 'GOVERNANCE' | 'COMMERCIAL' | 'TERRITORIAL' | 'OPERATIONAL';

export interface ClosureNode {
  readonly nodeId: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly nodeType: string;
  readonly displayName: string;
}

/** Territorial closure returns a flat set (not a tree), with effective date. */
export interface TerritorialNode {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly displayName: string;
  readonly effectiveFrom: string;
}

/**
 * Repository interface — implemented by the infrastructure layer.
 * The domain package depends on this interface; it does not import pg or fetch.
 */
export interface ClosureRepository {
  /**
   * Traverses GOVERNANCE_PARENT edges from root downward.
   * Returns all nodes for which rootNodeId is the governance ancestor.
   */
  governanceClosure(rootNodeId: string, tenantId: string): Promise<readonly ClosureNode[]>;

  /**
   * Traverses COMMERCIAL_PARENT edges from root downward.
   * Returns all nodes in the commercial fleet of rootNodeId.
   */
  commercialClosure(rootNodeId: string, tenantId: string): Promise<readonly ClosureNode[]>;

  /**
   * Returns all nodes under the territorial jurisdiction of authorityNodeId.
   * This is a flat set — territorial jurisdiction is not a recursive tree.
   */
  territorialClosure(authorityNodeId: string, tenantId: string): Promise<readonly TerritorialNode[]>;

  /**
   * Traverses OPERATIONAL_PARENT edges from root downward.
   */
  operationalClosure(rootNodeId: string, tenantId: string): Promise<readonly ClosureNode[]>;

  /**
   * Returns true if candidateNodeId is reachable from rootNodeId
   * via the specified closure type.
   * Used as a boolean authorization predicate.
   */
  isReachable(
    rootNodeId: string,
    candidateNodeId: string,
    purpose: ClosurePurpose,
    tenantId: string,
  ): Promise<boolean>;
}

/**
 * Authorization helper — resolves whether a principal node can access
 * a target node for a given purpose.
 *
 * The principal is the node that represents the requesting entity (e.g., the
 * organization's entity node). The target is the node being accessed.
 * The purpose determines which closure is used.
 *
 * Returns: { allowed: boolean, reason: string }
 */
export async function resolveEntityAccess(
  repo: ClosureRepository,
  input: {
    readonly principalNodeId: string;
    readonly targetNodeId: string;
    readonly purpose: ClosurePurpose;
    readonly tenantId: string;
  },
): Promise<{ readonly allowed: boolean; readonly reason: string }> {
  // A node always has access to itself.
  if (input.principalNodeId === input.targetNodeId) {
    return { allowed: true, reason: 'same node' };
  }

  const reachable = await repo.isReachable(
    input.principalNodeId,
    input.targetNodeId,
    input.purpose,
    input.tenantId,
  );

  if (reachable) {
    return {
      allowed: true,
      reason: `target is within the principal's ${input.purpose.toLowerCase()} closure`,
    };
  }

  return {
    allowed: false,
    reason: `target is not within the principal's ${input.purpose.toLowerCase()} closure`,
  };
}
