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
