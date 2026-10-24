import type { Transport } from '@platform-sdk/transport';

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
  readonly status?: ListingStatus;
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
  readonly listingName?: string;
  readonly listingSlug?: string;
  readonly listingKind?: string;
}

export interface DirectoryClient {
  readonly listings: {
    list(params?: {
      kind?: string;
      city?: string;
      q?: string;
      status?: string;
      limit?: number;
    }): Promise<{ items: readonly Listing[] }>;
    get(id: string): Promise<Listing>;
    create(input: ListingInput): Promise<Listing>;
    update(id: string, patch: Partial<ListingInput>): Promise<Listing>;
    archive(id: string): Promise<{ archived: boolean }>;
    claim(id: string): Promise<Listing>;
    decideClaim(id: string, decision: { approve: boolean }): Promise<Listing>;
  };
  readonly featured: {
    list(params?: { placement?: string; on?: string }): Promise<{ items: readonly FeaturedSlot[] }>;
    create(input: {
      listingId: string;
      placement: string;
      startsOn: string;
      endsOn: string;
    }): Promise<FeaturedSlot>;
    update(
      id: string,
      patch: Partial<{ placement: string; startsOn: string; endsOn: string; isActive: boolean }>
    ): Promise<FeaturedSlot>;
  };
}

function queryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      searchParams.set(k, String(v));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

export function directoryClient(t: Transport): DirectoryClient {
  return {
    listings: {
      list: (p) => t.request('GET', `/v1/directory/listings${queryString(p)}`),
      get: (id) => t.request('GET', `/v1/directory/listings/${encodeURIComponent(id)}`),
      create: (input) => t.request('POST', '/v1/directory/listings', input),
      update: (id, patch) => t.request('PATCH', `/v1/directory/listings/${encodeURIComponent(id)}`, patch),
      archive: (id) => t.request('DELETE', `/v1/directory/listings/${encodeURIComponent(id)}`),
      claim: (id) => t.request('POST', `/v1/directory/listings/${encodeURIComponent(id)}/claim`),
      decideClaim: (id, decision) =>
        t.request('POST', `/v1/directory/listings/${encodeURIComponent(id)}/claim/decision`, decision),
    },
    featured: {
      list: (p) => t.request('GET', `/v1/directory/featured${queryString(p)}`),
      create: (input) => t.request('POST', '/v1/directory/featured', input),
      update: (id, patch) => t.request('PATCH', `/v1/directory/featured/${encodeURIComponent(id)}`, patch),
    },
  };
}
