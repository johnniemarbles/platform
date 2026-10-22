/**
 * Genesis bootstrap domain — the first-user onboarding state machine.
 *
 * Genesis is a one-time, tenant-scoped operation that:
 *   1. Claims genesis authority (wins a DB-level race via unique constraint)
 *   2. Creates the TENANT_OWNER membership (unblocking resolveBrandContext)
 *   3. Creates the root BRAND_HQ entity node
 *   4. Expires genesis authority (root_entity_id is now non-NULL)
 *
 * After step 4, the normal governed approval process applies to all
 * subsequent entity creation, profile configuration, and governance setup.
 *
 * The state machine:
 *   GENESIS_BOOTSTRAPPED → ROOT_ENTITY_CREATED → GOVERNANCE_CONFIGURED → ACTIVE
 *
 * Each state transition is recorded in the genesis_claims.step_log JSONB column.
 */

export const BOOTSTRAP_STATES = [
  'GENESIS_BOOTSTRAPPED',
  'ROOT_ENTITY_CREATED',
  'GOVERNANCE_CONFIGURED',
  'ACTIVE',
] as const;

export type BootstrapState = (typeof BOOTSTRAP_STATES)[number];

export interface GenesisClaim {
  readonly claimId: string;
  readonly tenantId: string;
  readonly claimedBy: string;
  readonly claimedAt: string;
  readonly bootstrapState: BootstrapState;
  readonly rootEntityId: string | null;
  readonly bootstrapCompletedAt: string | null;
  readonly idempotencyKey: string | null;
  readonly stepLog: readonly BootstrapStepRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BootstrapStepRecord {
  readonly step: BootstrapState;
  readonly at: string;
  readonly entityId?: string;
  readonly detail?: string;
}

export interface GenesisBootstrapRequest {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly brandDisplayName: string;
  readonly idempotencyKey?: string;
}

export interface GenesisBootstrapResult {
  readonly claimId: string;
  readonly bootstrapState: BootstrapState;
  readonly rootEntityId: string;
  readonly alreadyExisted: boolean;
}

/**
 * Genesis authority is valid only while:
 *   - the claim exists for this tenant
 *   - it belongs to this subject
 *   - root_entity_id is NULL (root not yet created)
 *   - bootstrap_completed_at is NULL
 */
export function genesisAuthorityIsActive(
  claim: Pick<GenesisClaim, 'claimedBy' | 'rootEntityId' | 'bootstrapCompletedAt'>,
  subjectId: string,
): boolean {
  return (
    claim.claimedBy === subjectId &&
    claim.rootEntityId === null &&
    claim.bootstrapCompletedAt === null
  );
}

/**
 * Returns whether the next bootstrap state transition is legal.
 * States must be traversed in order; skipping is not permitted.
 */
export function isLegalBootstrapTransition(
  from: BootstrapState,
  to: BootstrapState,
): boolean {
  const order = BOOTSTRAP_STATES;
  const fromIdx = order.indexOf(from);
  const toIdx   = order.indexOf(to);
  return toIdx === fromIdx + 1;
}

export type GenesisErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'GENESIS_EXPIRED'
  | 'GENESIS_CLAIMED'
  | 'ALREADY_BOOTSTRAPPED';

export class GenesisError extends Error {
  readonly code: GenesisErrorCode;
  constructor(code: GenesisErrorCode, message: string) {
    super(message);
    this.name = 'GenesisError';
    this.code = code;
  }
}
