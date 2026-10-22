/**
 * Legal entity — incorporated business overlay on an entity node.
 *
 * Not every entity node has a legal entity. Not every legal entity
 * maps 1:1 to a node. A MULTI_UNIT operator company may be the
 * legal entity behind multiple UNIT nodes it operates.
 */

export const LEGAL_FORMS = [
  'LLC', 'LTD', 'CORP', 'PTE_LTD', 'GMBH', 'SAS', 'SA',
  'PARTNERSHIP', 'SOLE_TRADER', 'FRANCHISE_AGREEMENT', 'COOPERATIVE', 'OTHER',
] as const;

export type LegalForm = (typeof LEGAL_FORMS)[number];

export const LEGAL_ENTITY_STATUSES = ['ACTIVE', 'DORMANT', 'STRUCK_OFF', 'LIQUIDATED'] as const;
export type LegalEntityStatus = (typeof LEGAL_ENTITY_STATUSES)[number];

export interface LegalEntity {
  readonly legalEntityId: string;
  readonly tenantId: string;
  readonly nodeId: string;
  readonly registeredName: string;
  readonly tradingName: string | null;
  readonly registrationNumber: string | null;
  readonly registrationJurisdiction: string | null;
  readonly legalForm: LegalForm | null;
  readonly incorporatedAt: string | null;
  readonly taxIdentifier: string | null;
  readonly taxJurisdiction: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly stateProvince: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly status: LegalEntityStatus;
  readonly struckOffAt: string | null;
  readonly evidenceRef: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLegalEntityRequest {
  readonly tenantId: string;
  readonly nodeId: string;
  readonly registeredName: string;
  readonly tradingName?: string;
  readonly registrationNumber?: string;
  readonly registrationJurisdiction?: string;
  readonly legalForm?: LegalForm;
  readonly incorporatedAt?: string;
  readonly taxIdentifier?: string;
  readonly taxJurisdiction?: string;
  readonly address?: {
    readonly line1?: string;
    readonly line2?: string;
    readonly city?: string;
    readonly stateProvince?: string;
    readonly postalCode?: string;
    readonly countryCode?: string;
  };
  readonly evidenceRef?: string;
  readonly createdBy: string;
}

export function validateCreateLegalEntity(
  req: CreateLegalEntityRequest,
): readonly string[] {
  const errors: string[] = [];

  if (typeof req.registeredName !== 'string' || req.registeredName.trim() === '') {
    errors.push('registeredName must be a non-empty string');
  }
  if (req.legalForm !== undefined && !LEGAL_FORMS.includes(req.legalForm as LegalForm)) {
    errors.push(`legalForm '${req.legalForm}' is not valid`);
  }
  if (req.address?.countryCode !== undefined) {
    if (!/^[A-Z]{2}$/.test(req.address.countryCode)) {
      errors.push('countryCode must be an ISO 3166-1 alpha-2 code (e.g. US, GB, CA)');
    }
  }
  if (req.incorporatedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(req.incorporatedAt)) {
    errors.push('incorporatedAt must be an ISO date string (YYYY-MM-DD)');
  }

  return errors;
}
