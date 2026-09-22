/**
 * Ownership interests — normalized JV economics.
 *
 * Separate from relationship edges because ownership is a participation set
 * with cardinality-constrained percentage enforcement, not a binary directed edge.
 *
 * A Canada JV with three partners each holding 33.33% of a UNIT node is three
 * ownership_interest rows summing to 99.99% (or 100.00% with rounding rules).
 * That cannot be modelled as three OWNERSHIP relationship edges without losing
 * the sum constraint and the effective period non-overlap requirement.
 *
 * The 100% enforcement is a trigger in the database (migration 0123).
 * The pure functions here validate shapes and detect problems before the
 * database sees the request, producing better error messages.
 */

export interface OwnershipInterest {
  readonly interestId: string;
  readonly tenantId: string;
  readonly ownedNodeId: string;
  readonly owningNodeId: string;
  readonly percentage: number;
  readonly shareClass: string | null;
  readonly effectiveFrom: string;  // ISO date
  readonly effectiveTo: string | null;
  readonly distributionNodeId: string | null;
  readonly partnerRef: string | null;
  readonly evidenceRef: string | null;
  readonly agreementDate: string | null;
  readonly status: 'ACTIVE' | 'TRANSFERRED' | 'LAPSED' | 'DISPUTED';
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateOwnershipInterestRequest {
  readonly tenantId: string;
  readonly ownedNodeId: string;
  readonly owningNodeId: string;
  readonly percentage: number;
  readonly shareClass?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly distributionNodeId?: string;
  readonly partnerRef?: string;
  readonly evidenceRef?: string;
  readonly agreementDate?: string;
  readonly createdBy: string;
}

export function validateCreateOwnershipInterest(
  req: CreateOwnershipInterestRequest,
): readonly string[] {
  const errors: string[] = [];

  if (req.ownedNodeId === req.owningNodeId) {
    errors.push('A node cannot own itself');
  }
  if (typeof req.percentage !== 'number' || req.percentage <= 0 || req.percentage > 100) {
    errors.push('percentage must be between 0 (exclusive) and 100 (inclusive)');
  }
  if (req.effectiveFrom !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(req.effectiveFrom)) {
    errors.push('effectiveFrom must be an ISO date string (YYYY-MM-DD)');
  }
  if (req.effectiveTo !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.effectiveTo)) {
      errors.push('effectiveTo must be an ISO date string (YYYY-MM-DD)');
    }
    if (req.effectiveFrom !== undefined && req.effectiveTo <= req.effectiveFrom) {
      errors.push('effectiveTo must be after effectiveFrom');
    }
  }

  return errors;
}

/**
 * Checks whether adding a new interest would cause the active total to exceed 100%.
 * Call this with all currently active interests for the owned node before inserting.
 *
 * @param existingActiveInterests - currently active interests for the owned node
 * @param newPercentage           - the percentage being added
 * @param excludeInterestId       - exclude this ID (for updates to an existing interest)
 */
export function wouldExceedHundredPercent(
  existingActiveInterests: readonly Pick<OwnershipInterest, 'interestId' | 'percentage'>[],
  newPercentage: number,
  excludeInterestId?: string,
): { exceeded: boolean; currentTotal: number; projectedTotal: number } {
  const currentTotal = existingActiveInterests
    .filter((i) => i.interestId !== excludeInterestId)
    .reduce((sum, i) => sum + i.percentage, 0);

  const projectedTotal = currentTotal + newPercentage;
  // Allow a 0.01% rounding tolerance for cases like 33.33 + 33.33 + 33.34.
  return {
    exceeded: projectedTotal > 100.01,
    currentTotal: Math.round(currentTotal * 100) / 100,
    projectedTotal: Math.round(projectedTotal * 100) / 100,
  };
}

/**
 * Checks whether two ownership periods overlap for the same owner/owned pair.
 * Used to detect conflicts before inserting.
 */
export function periodsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  // A and B overlap unless A ends before B starts or B ends before A starts.
  const aEndsBeforeB = aTo !== null && aTo <= bFrom;
  const bEndsBeforeA = bTo !== null && bTo <= aFrom;
  return !aEndsBeforeB && !bEndsBeforeA;
}

/**
 * Summarises current ownership for display purposes.
 * Returns: total percentage, remaining unallocated, warning if over 100%.
 */
export function ownershipSummary(
  activeInterests: readonly Pick<OwnershipInterest, 'percentage'>[],
): { total: number; unallocated: number; overallocated: boolean } {
  const total = activeInterests.reduce((sum, i) => sum + i.percentage, 0);
  const rounded = Math.round(total * 100) / 100;
  return {
    total: rounded,
    unallocated: Math.max(0, Math.round((100 - rounded) * 100) / 100),
    overallocated: rounded > 100.01,
  };
}
