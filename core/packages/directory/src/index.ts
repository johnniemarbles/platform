export type ListingClaimStatus = 'UNCLAIMED' | 'PENDING' | 'CLAIMED';
export type ListingStatus = 'ACTIVE' | 'HIDDEN' | 'ARCHIVED';

export interface Listing {
  readonly listingId: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly kind: string;
  readonly name: string;
  readonly slug: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly regionCode: string | null;
  readonly country: string | null;
  readonly postalCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly attributes: Record<string, unknown>;
  readonly attributesSchema: string | null;
  readonly externalProvider: string | null;
  readonly externalRef: string | null;
  readonly claimStatus: ListingClaimStatus;
  readonly ownerPersonId: string | null;
  readonly status: ListingStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListingInput {
  readonly kind: string;
  readonly name: string;
  readonly slug?: string;
  readonly addressLine?: string | null;
  readonly city?: string | null;
  readonly regionCode?: string | null;
  readonly country?: string | null;
  readonly postalCode?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly attributes?: Record<string, unknown>;
  readonly attributesSchema?: string | null;
  readonly externalProvider?: string | null;
  readonly externalRef?: string | null;
  readonly status?: ListingStatus | undefined;
}

export interface FeaturedSlot {
  readonly slotId: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly listingId: string;
  readonly placement: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'listing').slice(0, 120);
}

export class DirectoryValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'DirectoryValidationError';
    this.field = field;
  }
}

const KIND_RE = /^[a-z][a-z0-9_]{1,39}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function validateListingInput(raw: unknown): ListingInput {
  if (!raw || typeof raw !== 'object') {
    throw new DirectoryValidationError('body', 'Listing input must be an object');
  }
  const obj = raw as Record<string, unknown>;

  const kind = typeof obj.kind === 'string' ? obj.kind.trim() : '';
  if (!KIND_RE.test(kind)) {
    throw new DirectoryValidationError('kind', 'kind must match ^[a-z][a-z0-9_]{1,39}$');
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (name.length < 1 || name.length > 200) {
    throw new DirectoryValidationError('name', 'name must be between 1 and 200 characters');
  }

  const slug = typeof obj.slug === 'string' && obj.slug.trim() ? obj.slug.trim() : slugify(name);
  if (!SLUG_RE.test(slug)) {
    throw new DirectoryValidationError('slug', 'slug must match ^[a-z0-9][a-z0-9-]{0,119}$');
  }

  const country = typeof obj.country === 'string' && obj.country.trim() ? obj.country.trim().toUpperCase() : null;
  if (country && !COUNTRY_RE.test(country)) {
    throw new DirectoryValidationError('country', 'country must be an ISO 3166-1 alpha-2 code');
  }

  const latitude = typeof obj.latitude === 'number' && Number.isFinite(obj.latitude) ? obj.latitude : null;
  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new DirectoryValidationError('latitude', 'latitude must be between -90 and 90');
  }

  const longitude = typeof obj.longitude === 'number' && Number.isFinite(obj.longitude) ? obj.longitude : null;
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new DirectoryValidationError('longitude', 'longitude must be between -180 and 180');
  }

  const externalProvider = typeof obj.externalProvider === 'string' && obj.externalProvider.trim()
    ? obj.externalProvider.trim()
    : null;
  const externalRef = typeof obj.externalRef === 'string' && obj.externalRef.trim()
    ? obj.externalRef.trim()
    : null;
  if ((externalProvider === null) !== (externalRef === null)) {
    throw new DirectoryValidationError(
      'external',
      'externalProvider and externalRef must both be provided together or both omitted'
    );
  }

  let status: ListingStatus | undefined = undefined;
  if (typeof obj.status === 'string') {
    const s = obj.status.trim().toUpperCase();
    if (s === 'ACTIVE' || s === 'HIDDEN' || s === 'ARCHIVED') {
      status = s;
    } else {
      throw new DirectoryValidationError('status', 'status must be ACTIVE, HIDDEN, or ARCHIVED');
    }
  }

  return {
    kind,
    name,
    slug,
    addressLine: typeof obj.addressLine === 'string' ? obj.addressLine.trim() : null,
    city: typeof obj.city === 'string' ? obj.city.trim() : null,
    regionCode: typeof obj.regionCode === 'string' ? obj.regionCode.trim() : null,
    country,
    postalCode: typeof obj.postalCode === 'string' ? obj.postalCode.trim() : null,
    latitude,
    longitude,
    phone: typeof obj.phone === 'string' ? obj.phone.trim() : null,
    email: typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : null,
    website: typeof obj.website === 'string' ? obj.website.trim() : null,
    attributes: obj.attributes && typeof obj.attributes === 'object' && !Array.isArray(obj.attributes)
      ? (obj.attributes as Record<string, unknown>)
      : {},
    attributesSchema: typeof obj.attributesSchema === 'string' ? obj.attributesSchema.trim() : null,
    externalProvider,
    externalRef,
    ...(status ? { status } : {}),
  };
}

export type AttributeType = 'string' | 'number' | 'boolean' | 'string[]';

export interface AttributePropertySchema {
  type: AttributeType;
  required?: boolean;
}

export interface KindSchema {
  properties: Record<string, AttributePropertySchema>;
}

export function validateAttributes(
  kind: string,
  attributes: unknown,
  schemaRegistry?: Record<string, KindSchema>
): { valid: boolean; errors: string[] } {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return { valid: false, errors: ['attributes must be an object'] };
  }
  if (!schemaRegistry || !schemaRegistry[kind]) {
    return { valid: true, errors: [] };
  }

  const schema = schemaRegistry[kind]!;
  const attrs = attributes as Record<string, unknown>;
  const errors: string[] = [];

  for (const [prop, def] of Object.entries(schema.properties)) {
    const val = attrs[prop];
    if (val === undefined || val === null) {
      if (def.required) {
        errors.push(`missing required attribute: ${prop}`);
      }
      continue;
    }

    if (def.type === 'string' && typeof val !== 'string') {
      errors.push(`attribute ${prop} must be a string`);
    } else if (def.type === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
      errors.push(`attribute ${prop} must be a number`);
    } else if (def.type === 'boolean' && typeof val !== 'boolean') {
      errors.push(`attribute ${prop} must be a boolean`);
    } else if (def.type === 'string[]' && (!Array.isArray(val) || val.some((item) => typeof item !== 'string'))) {
      errors.push(`attribute ${prop} must be an array of strings`);
    }
  }

  return { valid: errors.length === 0, errors };
}
