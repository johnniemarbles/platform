/**
 * Content publishing governance policy.
 *
 * A node's effective publishing policy is resolved by walking GOVERNANCE_PARENT
 * edges upward (see closure.ts) and taking the nearest ancestor — including the
 * node itself — that has an explicit policy configured. This mirrors the
 * database function platform.resolve_publishing_policy() in migration 0170;
 * both must agree on the default fallback.
 */

export const CONTENT_PUBLISHING_POLICIES = [
  'DIRECT_AUTONOMOUS',
  'LOCAL_ADMIN_SIGN_OFF',
  'STATE_MASTER_SIGN_OFF',
  'COUNTRY_BRAND_MANDATORY',
] as const;

export type ContentPublishingPolicy = (typeof CONTENT_PUBLISHING_POLICIES)[number];

/** The policy assumed when no node in the governance chain has configured one. */
export const DEFAULT_PUBLISHING_POLICY: ContentPublishingPolicy = 'COUNTRY_BRAND_MANDATORY';

/**
 * Repository interface — implemented by the infrastructure layer.
 * The domain package depends on this interface; it does not import pg or fetch.
 */
export interface GovernancePolicyRepository {
  /**
   * Returns the nearest ancestor's explicitly configured publishing policy for
   * nodeId (self first, then walking GOVERNANCE_PARENT edges upward), or null
   * if no node in the chain has one configured.
   */
  resolveConfiguredPolicy(
    nodeId: string,
    tenantId: string,
  ): Promise<ContentPublishingPolicy | null>;
}

/**
 * Resolves the effective publishing policy for a node, applying the system
 * default when no ancestor has configured one explicitly.
 */
export async function resolveEffectivePublishingPolicy(
  repo: GovernancePolicyRepository,
  input: { readonly nodeId: string; readonly tenantId: string },
): Promise<ContentPublishingPolicy> {
  const configured = await repo.resolveConfiguredPolicy(input.nodeId, input.tenantId);
  return configured ?? DEFAULT_PUBLISHING_POLICY;
}

export interface ApprovalRoutingResult {
  readonly targetApproverNodeId: string;
  readonly policyApplied: ContentPublishingPolicy;
}

/**
 * The ascending-lookup slice of ClosureRepository this decision needs.
 * Declared as a Pick here (rather than importing the full closure.ts
 * interface) to keep this module's dependency surface to exactly what it uses.
 */
export interface ApprovalRoutingClosure {
  governanceRoot(nodeId: string, tenantId: string): Promise<string>;
  territorialAuthority(nodeId: string, tenantId: string): Promise<string | null>;
}

/**
 * Decides which entity node's approval queue a staged action should route to,
 * given the resolved publishing policy for the node that initiated it:
 *
 *  - COUNTRY_BRAND_MANDATORY: routes to the ultimate governance root, however
 *    far up the tree that is -- even an action from a Unit routes all the
 *    way to Brand HQ.
 *  - STATE_MASTER_SIGN_OFF: routes to the initiating node's direct
 *    territorial authority. Falls back to the initiating node itself if none
 *    is configured, rather than silently routing nowhere.
 *  - LOCAL_ADMIN_SIGN_OFF / DIRECT_AUTONOMOUS: the initiating node is its own
 *    approver (DIRECT_AUTONOMOUS callers are expected not to stage an
 *    approval at all; this function only decides *where*, not *whether*).
 */
export async function routeApprovalTarget(
  policyRepo: GovernancePolicyRepository,
  closureRepo: ApprovalRoutingClosure,
  input: { readonly nodeId: string; readonly tenantId: string },
): Promise<ApprovalRoutingResult> {
  const policyApplied = await resolveEffectivePublishingPolicy(policyRepo, input);

  switch (policyApplied) {
    case 'COUNTRY_BRAND_MANDATORY': {
      const root = await closureRepo.governanceRoot(input.nodeId, input.tenantId);
      return { targetApproverNodeId: root, policyApplied };
    }
    case 'STATE_MASTER_SIGN_OFF': {
      const authority = await closureRepo.territorialAuthority(input.nodeId, input.tenantId);
      return { targetApproverNodeId: authority ?? input.nodeId, policyApplied };
    }
    case 'LOCAL_ADMIN_SIGN_OFF':
    case 'DIRECT_AUTONOMOUS':
      return { targetApproverNodeId: input.nodeId, policyApplied };
    default: {
      const exhaustiveCheck: never = policyApplied;
      throw new Error(`Unhandled publishing policy: ${String(exhaustiveCheck)}`);
    }
  }
}
