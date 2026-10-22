/**
 * Location unit — physical site overlay on a UNIT or LOCATION entity node.
 *
 * A location unit carries the physical facts about a site: where it is,
 * what its hours are, and what operational state it is in.
 *
 * Operational status follows a lifecycle. PERMANENTLY_CLOSED is terminal:
 * a closed location cannot be reopened. Open a new node for a replacement site.
 */

export const OPERATIONAL_STATUSES = [
  'PLANNED',
  'FIT_OUT',
  'OPEN',
  'TEMPORARILY_CLOSED',
  'PERMANENTLY_CLOSED',
] as const;

export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** Legal transitions between operational states. */
export const OPERATIONAL_TRANSITIONS: Readonly<Record<OperationalStatus, readonly OperationalStatus[]>> = {
  PLANNED:             ['FIT_OUT', 'PERMANENTLY_CLOSED'],
  FIT_OUT:             ['OPEN', 'PLANNED', 'PERMANENTLY_CLOSED'],
  OPEN:                ['TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED'],
  TEMPORARILY_CLOSED:  ['OPEN', 'PERMANENTLY_CLOSED'],
  PERMANENTLY_CLOSED:  [],
};

export function isLegalTransition(from: OperationalStatus, to: OperationalStatus): boolean {
  return (OPERATIONAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

export interface LocationUnit {
  readonly locationId: string;
  readonly tenantId: string;
  readonly nodeId: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly stateProvince: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string | null;
  readonly operatingHours: Readonly<Record<string, unknown>>;
  readonly phone: string | null;
  readonly email: string | null;
  readonly operationalStatus: OperationalStatus;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLocationUnitRequest {
  readonly tenantId: string;
  readonly nodeId: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly stateProvince?: string;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timezone?: string;
  readonly operatingHours?: Readonly<Record<string, unknown>>;
  readonly phone?: string;
  readonly email?: string;
  readonly createdBy: string;
}

export function validateCreateLocationUnit(
  req: CreateLocationUnitRequest,
): readonly string[] {
  const errors: string[] = [];

  if (typeof req.addressLine1 !== 'string' || req.addressLine1.trim() === '') {
    errors.push('addressLine1 must be a non-empty string');
  }
  if (typeof req.city !== 'string' || req.city.trim() === '') {
    errors.push('city must be a non-empty string');
  }
  if (!/^[A-Z]{2}$/.test(req.countryCode)) {
    errors.push('countryCode must be an ISO 3166-1 alpha-2 code (e.g. US, GB, AU)');
  }
  if (req.latitude !== undefined && (req.latitude < -90 || req.latitude > 90)) {
    errors.push('latitude must be between -90 and 90');
  }
  if (req.longitude !== undefined && (req.longitude < -180 || req.longitude > 180)) {
    errors.push('longitude must be between -180 and 180');
  }
  if ((req.latitude === undefined) !== (req.longitude === undefined)) {
    errors.push('latitude and longitude must both be provided or both omitted');
  }

  return errors;
}
