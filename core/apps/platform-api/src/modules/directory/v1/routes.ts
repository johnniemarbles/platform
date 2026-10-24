import type { IncomingMessage } from 'node:http';
import type { HandlerContext, RouteDefinition } from '@platform-core/route-kit';
import { readJson } from '@platform-core/route-kit';
import { refusal } from '@platform-hub/contracts';
import {
  type Listing,
  type FeaturedSlot,
  validateListingInput,
  DirectoryValidationError,
} from '@platform-core/directory';

function parseLimit(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : 50;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
}

function mapListing(r: {
  listing_id: string;
  tenant_id: string;
  app_id: string;
  kind: string;
  name: string;
  slug: string;
  address_line: string | null;
  city: string | null;
  region_code: string | null;
  country: string | null;
  postal_code: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  attributes: Record<string, unknown> | null;
  attributes_schema: string | null;
  external_provider: string | null;
  external_ref: string | null;
  claim_status: string;
  owner_person_id: string | null;
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}): Listing {
  return {
    listingId: r.listing_id,
    tenantId: r.tenant_id,
    appId: r.app_id,
    kind: r.kind,
    name: r.name,
    slug: r.slug,
    addressLine: r.address_line,
    city: r.city,
    regionCode: r.region_code,
    country: r.country,
    postalCode: r.postal_code,
    latitude: r.latitude !== null && r.latitude !== undefined ? Number(r.latitude) : null,
    longitude: r.longitude !== null && r.longitude !== undefined ? Number(r.longitude) : null,
    phone: r.phone,
    email: r.email,
    website: r.website,
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    attributesSchema: r.attributes_schema,
    externalProvider: r.external_provider,
    externalRef: r.external_ref,
    claimStatus: r.claim_status as Listing['claimStatus'],
    ownerPersonId: r.owner_person_id,
    status: r.status as Listing['status'],
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapFeaturedSlot(r: {
  slot_id: string;
  tenant_id: string;
  app_id: string;
  listing_id: string;
  placement: string;
  starts_on: Date | string;
  ends_on: Date | string;
  is_active: boolean;
  created_at: Date;
}): FeaturedSlot {
  return {
    slotId: r.slot_id,
    tenantId: r.tenant_id,
    appId: r.app_id,
    listingId: r.listing_id,
    placement: r.placement,
    startsOn: String(r.starts_on),
    endsOn: String(r.ends_on),
    isActive: r.is_active,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function directoryV1Routes(): readonly RouteDefinition[] {
  return [
    // ---------------- Listings ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/directory/listings',
      requires: ['directory.listing.read'],
      handler: async (ctx: HandlerContext) => {
        const limit = parseLimit(ctx.url.searchParams.get('limit') ?? undefined);
        const kind = ctx.url.searchParams.get('kind')?.trim() ?? '';
        const city = ctx.url.searchParams.get('city')?.trim() ?? '';
        const search = ctx.url.searchParams.get('q')?.trim() ?? '';
        const status = ctx.url.searchParams.get('status')?.trim().toUpperCase() ?? 'ACTIVE';

        const res = await ctx.tx.query<{
          listing_id: string;
          tenant_id: string;
          app_id: string;
          kind: string;
          name: string;
          slug: string;
          address_line: string | null;
          city: string | null;
          region_code: string | null;
          country: string | null;
          postal_code: string | null;
          latitude: string | number | null;
          longitude: string | number | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          attributes: Record<string, unknown> | null;
          attributes_schema: string | null;
          external_provider: string | null;
          external_ref: string | null;
          claim_status: string;
          owner_person_id: string | null;
          status: string;
          created_by: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                  country, postal_code, latitude, longitude, phone, email, website, attributes,
                  attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                  status, created_by, created_at, updated_at
             FROM platform.directory_listings
            WHERE ($1 = '' OR kind = $1)
              AND ($2 = '' OR city ILIKE ('%' || $2 || '%'))
              AND ($3 = '' OR name ILIKE ('%' || $3 || '%'))
              AND ($4 = 'ALL' OR status = $4)
            ORDER BY created_at DESC
            LIMIT $5`,
          [kind, city, search, status, limit]
        );

        return {
          items: res.rows.map(mapListing),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/directory/listings',
      requires: ['directory.listing.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        let input;
        try {
          input = validateListingInput(await readJson(req));
        } catch (err) {
          if (err instanceof DirectoryValidationError) {
            return refusal('REFUSED', ctx.traceId, err.message);
          }
          throw err;
        }

        let res;
        if (input.externalProvider && input.externalRef) {
          // Upsert on (tenant_id, external_provider, external_ref)
          res = await ctx.tx.query<{
            listing_id: string;
            tenant_id: string;
            app_id: string;
            kind: string;
            name: string;
            slug: string;
            address_line: string | null;
            city: string | null;
            region_code: string | null;
            country: string | null;
            postal_code: string | null;
            latitude: string | number | null;
            longitude: string | number | null;
            phone: string | null;
            email: string | null;
            website: string | null;
            attributes: Record<string, unknown> | null;
            attributes_schema: string | null;
            external_provider: string | null;
            external_ref: string | null;
            claim_status: string;
            owner_person_id: string | null;
            status: string;
            created_by: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO platform.directory_listings (
               tenant_id, app_id, kind, name, slug, address_line, city, region_code,
               country, postal_code, latitude, longitude, phone, email, website,
               attributes, attributes_schema, external_provider, external_ref, status, created_by
             ) VALUES (
               $1::uuid, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14, $15,
               $16::jsonb, $17, $18, $19, COALESCE($20, 'ACTIVE'), $21::uuid
             )
             ON CONFLICT (tenant_id, external_provider, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name = EXCLUDED.name,
               address_line = EXCLUDED.address_line,
               city = EXCLUDED.city,
               region_code = EXCLUDED.region_code,
               country = EXCLUDED.country,
               postal_code = EXCLUDED.postal_code,
               latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               phone = EXCLUDED.phone,
               email = EXCLUDED.email,
               website = EXCLUDED.website,
               attributes = EXCLUDED.attributes,
               updated_at = now()
             RETURNING listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                       country, postal_code, latitude, longitude, phone, email, website, attributes,
                       attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                       status, created_by, created_at, updated_at`,
            [
              ctx.membership.tenantId,
              ctx.membership.appId,
              input.kind,
              input.name,
              input.slug,
              input.addressLine,
              input.city,
              input.regionCode,
              input.country,
              input.postalCode,
              input.latitude,
              input.longitude,
              input.phone,
              input.email,
              input.website,
              JSON.stringify(input.attributes ?? {}),
              input.attributesSchema,
              input.externalProvider,
              input.externalRef,
              input.status ?? null,
              ctx.membership.personId,
            ]
          );
        } else {
          res = await ctx.tx.query<{
            listing_id: string;
            tenant_id: string;
            app_id: string;
            kind: string;
            name: string;
            slug: string;
            address_line: string | null;
            city: string | null;
            region_code: string | null;
            country: string | null;
            postal_code: string | null;
            latitude: string | number | null;
            longitude: string | number | null;
            phone: string | null;
            email: string | null;
            website: string | null;
            attributes: Record<string, unknown> | null;
            attributes_schema: string | null;
            external_provider: string | null;
            external_ref: string | null;
            claim_status: string;
            owner_person_id: string | null;
            status: string;
            created_by: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO platform.directory_listings (
               tenant_id, app_id, kind, name, slug, address_line, city, region_code,
               country, postal_code, latitude, longitude, phone, email, website,
               attributes, attributes_schema, external_provider, external_ref, status, created_by
             ) VALUES (
               $1::uuid, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14, $15,
               $16::jsonb, $17, $18, $19, COALESCE($20, 'ACTIVE'), $21::uuid
             )
             RETURNING listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                       country, postal_code, latitude, longitude, phone, email, website, attributes,
                       attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                       status, created_by, created_at, updated_at`,
            [
              ctx.membership.tenantId,
              ctx.membership.appId,
              input.kind,
              input.name,
              input.slug,
              input.addressLine,
              input.city,
              input.regionCode,
              input.country,
              input.postalCode,
              input.latitude,
              input.longitude,
              input.phone,
              input.email,
              input.website,
              JSON.stringify(input.attributes ?? {}),
              input.attributesSchema,
              input.externalProvider,
              input.externalRef,
              input.status ?? null,
              ctx.membership.personId,
            ]
          );
        }

        return mapListing(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'GET',
      path: '/v1/directory/listings/:id',
      pattern: /^\/v1\/directory\/listings\/([0-9a-fA-F-]+)$/,
      requires: ['directory.listing.read'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query<{
          listing_id: string;
          tenant_id: string;
          app_id: string;
          kind: string;
          name: string;
          slug: string;
          address_line: string | null;
          city: string | null;
          region_code: string | null;
          country: string | null;
          postal_code: string | null;
          latitude: string | number | null;
          longitude: string | number | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          attributes: Record<string, unknown> | null;
          attributes_schema: string | null;
          external_provider: string | null;
          external_ref: string | null;
          claim_status: string;
          owner_person_id: string | null;
          status: string;
          created_by: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                  country, postal_code, latitude, longitude, phone, email, website, attributes,
                  attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                  status, created_by, created_at, updated_at
             FROM platform.directory_listings
            WHERE listing_id = $1::uuid`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapListing(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/directory/listings/:id',
      pattern: /^\/v1\/directory\/listings\/([0-9a-fA-F-]+)$/,
      requires: ['directory.listing.write'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);

        const name = typeof body.name === 'string' ? body.name.trim() : undefined;
        const addressLine = typeof body.addressLine === 'string' ? body.addressLine.trim() : undefined;
        const city = typeof body.city === 'string' ? body.city.trim() : undefined;
        const regionCode = typeof body.regionCode === 'string' ? body.regionCode.trim() : undefined;
        const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : undefined;
        const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : undefined;
        const latitude = typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : undefined;
        const longitude = typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : undefined;
        const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined;
        const website = typeof body.website === 'string' ? body.website.trim() : undefined;
        const attributes = body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)
          ? JSON.stringify(body.attributes)
          : undefined;
        const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : undefined;

        const res = await ctx.tx.query<{
          listing_id: string;
          tenant_id: string;
          app_id: string;
          kind: string;
          name: string;
          slug: string;
          address_line: string | null;
          city: string | null;
          region_code: string | null;
          country: string | null;
          postal_code: string | null;
          latitude: string | number | null;
          longitude: string | number | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          attributes: Record<string, unknown> | null;
          attributes_schema: string | null;
          external_provider: string | null;
          external_ref: string | null;
          claim_status: string;
          owner_person_id: string | null;
          status: string;
          created_by: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.directory_listings
              SET name = COALESCE($2, name),
                  address_line = COALESCE($3, address_line),
                  city = COALESCE($4, city),
                  region_code = COALESCE($5, region_code),
                  country = COALESCE($6, country),
                  postal_code = COALESCE($7, postal_code),
                  latitude = COALESCE($8, latitude),
                  longitude = COALESCE($9, longitude),
                  phone = COALESCE($10, phone),
                  email = COALESCE($11, email),
                  website = COALESCE($12, website),
                  attributes = COALESCE($13::jsonb, attributes),
                  status = COALESCE($14, status),
                  updated_at = now()
            WHERE listing_id = $1::uuid
            RETURNING listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                      country, postal_code, latitude, longitude, phone, email, website, attributes,
                      attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                      status, created_by, created_at, updated_at`,
          [
            id,
            name ?? null,
            addressLine ?? null,
            city ?? null,
            regionCode ?? null,
            country ?? null,
            postalCode ?? null,
            latitude ?? null,
            longitude ?? null,
            phone ?? null,
            email ?? null,
            website ?? null,
            attributes ?? null,
            status ?? null,
          ]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapListing(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'DELETE',
      path: '/v1/directory/listings/:id',
      pattern: /^\/v1\/directory\/listings\/([0-9a-fA-F-]+)$/,
      requires: ['directory.listing.write'],
      handler: async (ctx: HandlerContext) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const res = await ctx.tx.query(
          `UPDATE platform.directory_listings
              SET status = 'ARCHIVED',
                  updated_at = now()
            WHERE listing_id = $1::uuid
            RETURNING listing_id`,
          [id]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return { archived: true };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/directory/listings/:id/claim',
      pattern: /^\/v1\/directory\/listings\/([0-9a-fA-F-]+)\/claim$/,
      requires: ['directory.listing.claim'],
      handler: async (ctx: HandlerContext) => {
        const match = ctx.url.pathname.match(/^\/v1\/directory\/listings\/([0-9a-fA-F-]+)\/claim$/);
        const id = match![1];

        const res = await ctx.tx.query<{
          listing_id: string;
          tenant_id: string;
          app_id: string;
          kind: string;
          name: string;
          slug: string;
          address_line: string | null;
          city: string | null;
          region_code: string | null;
          country: string | null;
          postal_code: string | null;
          latitude: string | number | null;
          longitude: string | number | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          attributes: Record<string, unknown> | null;
          attributes_schema: string | null;
          external_provider: string | null;
          external_ref: string | null;
          claim_status: string;
          owner_person_id: string | null;
          status: string;
          created_by: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.directory_listings
              SET claim_status = 'PENDING',
                  owner_person_id = $2::uuid,
                  updated_at = now()
            WHERE listing_id = $1::uuid
            RETURNING listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                      country, postal_code, latitude, longitude, phone, email, website, attributes,
                      attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                      status, created_by, created_at, updated_at`,
          [id, ctx.membership.personId]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapListing(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/directory/listings/:id/claim/decision',
      pattern: /^\/v1\/directory\/listings\/([0-9a-fA-F-]+)\/claim\/decision$/,
      requires: ['directory.listing.manage'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const match = ctx.url.pathname.match(/^\/v1\/directory\/listings\/([0-9a-fA-F-]+)\/claim\/decision$/);
        const id = match![1];
        const body = await readJson(req);
        const approve = body.approve === true;

        const nextClaimStatus = approve ? 'CLAIMED' : 'UNCLAIMED';
        const nextOwner = approve ? undefined : null;

        const res = await ctx.tx.query<{
          listing_id: string;
          tenant_id: string;
          app_id: string;
          kind: string;
          name: string;
          slug: string;
          address_line: string | null;
          city: string | null;
          region_code: string | null;
          country: string | null;
          postal_code: string | null;
          latitude: string | number | null;
          longitude: string | number | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          attributes: Record<string, unknown> | null;
          attributes_schema: string | null;
          external_provider: string | null;
          external_ref: string | null;
          claim_status: string;
          owner_person_id: string | null;
          status: string;
          created_by: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `UPDATE platform.directory_listings
              SET claim_status = $2,
                  owner_person_id = CASE WHEN $3 = true THEN owner_person_id ELSE NULL END,
                  updated_at = now()
            WHERE listing_id = $1::uuid
            RETURNING listing_id, tenant_id, app_id, kind, name, slug, address_line, city, region_code,
                      country, postal_code, latitude, longitude, phone, email, website, attributes,
                      attributes_schema, external_provider, external_ref, claim_status, owner_person_id,
                      status, created_by, created_at, updated_at`,
          [id, nextClaimStatus, approve]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapListing(res.rows[0]!);
      },
    },

    // ---------------- Featured Slots ----------------
    {
      appId: '*',
      method: 'GET',
      path: '/v1/directory/featured',
      requires: ['directory.listing.read'],
      handler: async (ctx: HandlerContext) => {
        const placement = ctx.url.searchParams.get('placement')?.trim() ?? '';
        const onDate = ctx.url.searchParams.get('on')?.trim() || new Date().toISOString().slice(0, 10);

        const res = await ctx.tx.query<{
          slot_id: string;
          tenant_id: string;
          app_id: string;
          listing_id: string;
          placement: string;
          starts_on: Date | string;
          ends_on: Date | string;
          is_active: boolean;
          created_at: Date;
          listing_name: string;
          listing_slug: string;
          listing_kind: string;
        }>(
          `SELECT fs.slot_id, fs.tenant_id, fs.app_id, fs.listing_id, fs.placement,
                  fs.starts_on, fs.ends_on, fs.is_active, fs.created_at,
                  l.name AS listing_name, l.slug AS listing_slug, l.kind AS listing_kind
             FROM platform.directory_featured_slots fs
             JOIN platform.directory_listings l ON l.listing_id = fs.listing_id
            WHERE ($1 = '' OR fs.placement = $1)
              AND fs.is_active = true
              AND fs.starts_on <= $2::date
              AND fs.ends_on >= $2::date
            ORDER BY fs.created_at DESC`,
          [placement, onDate]
        );

        return {
          items: res.rows.map((r) => ({
            ...mapFeaturedSlot(r),
            listingName: r.listing_name,
            listingSlug: r.listing_slug,
            listingKind: r.listing_kind,
          })),
        };
      },
    },
    {
      appId: '*',
      method: 'POST',
      path: '/v1/directory/featured',
      requires: ['directory.featured.manage'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const body = await readJson(req);
        const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : null;
        if (!listingId) {
          return refusal('REFUSED', ctx.traceId, 'listingId is required');
        }
        const placement = typeof body.placement === 'string' ? body.placement.trim() : '';
        if (!placement || placement.length > 120) {
          return refusal('REFUSED', ctx.traceId, 'placement must be between 1 and 120 characters');
        }
        const startsOn = typeof body.startsOn === 'string' ? body.startsOn.trim() : null;
        const endsOn = typeof body.endsOn === 'string' ? body.endsOn.trim() : null;
        if (!startsOn || !endsOn) {
          return refusal('REFUSED', ctx.traceId, 'startsOn and endsOn dates are required');
        }

        const res = await ctx.tx.query<{
          slot_id: string;
          tenant_id: string;
          app_id: string;
          listing_id: string;
          placement: string;
          starts_on: Date | string;
          ends_on: Date | string;
          is_active: boolean;
          created_at: Date;
        }>(
          `INSERT INTO platform.directory_featured_slots (
             tenant_id, app_id, listing_id, placement, starts_on, ends_on
           ) VALUES (
             $1::uuid, $2, $3::uuid, $4, $5::date, $6::date
           ) RETURNING slot_id, tenant_id, app_id, listing_id, placement,
                     starts_on, ends_on, is_active, created_at`,
          [ctx.membership.tenantId, ctx.membership.appId, listingId, placement, startsOn, endsOn]
        );

        return mapFeaturedSlot(res.rows[0]!);
      },
    },
    {
      appId: '*',
      method: 'PATCH',
      path: '/v1/directory/featured/:id',
      pattern: /^\/v1\/directory\/featured\/([0-9a-fA-F-]+)$/,
      requires: ['directory.featured.manage'],
      handler: async (ctx: HandlerContext, req: IncomingMessage) => {
        const id = ctx.url.pathname.split('/').pop()!;
        const body = await readJson(req);
        const placement = typeof body.placement === 'string' ? body.placement.trim() : undefined;
        const startsOn = typeof body.startsOn === 'string' ? body.startsOn.trim() : undefined;
        const endsOn = typeof body.endsOn === 'string' ? body.endsOn.trim() : undefined;
        const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined;

        const res = await ctx.tx.query<{
          slot_id: string;
          tenant_id: string;
          app_id: string;
          listing_id: string;
          placement: string;
          starts_on: Date | string;
          ends_on: Date | string;
          is_active: boolean;
          created_at: Date;
        }>(
          `UPDATE platform.directory_featured_slots
              SET placement = COALESCE($2, placement),
                  starts_on = COALESCE($3::date, starts_on),
                  ends_on = COALESCE($4::date, ends_on),
                  is_active = COALESCE($5, is_active)
            WHERE slot_id = $1::uuid
            RETURNING slot_id, tenant_id, app_id, listing_id, placement,
                      starts_on, ends_on, is_active, created_at`,
          [id, placement ?? null, startsOn ?? null, endsOn ?? null, isActive ?? null]
        );
        if (res.rows.length === 0) {
          return refusal('REFUSED', ctx.traceId, 'not found');
        }
        return mapFeaturedSlot(res.rows[0]!);
      },
    },
  ];
}
