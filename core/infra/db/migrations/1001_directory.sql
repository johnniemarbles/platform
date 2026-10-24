BEGIN;

-- @platform-core/directory — industry-neutral listings (clinics, salons, properties, branches).
CREATE TABLE IF NOT EXISTS platform.directory_listings (
  listing_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id            text NOT NULL REFERENCES platform.apps(app_id),
  kind              text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug              text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  address_line      text,
  city              text,
  region_code       text,
  country           text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  postal_code       text,
  latitude          numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude         numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  phone             text,
  email             text,
  website           text,
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes_schema text,
  external_provider text,
  external_ref      text,
  claim_status      text NOT NULL DEFAULT 'UNCLAIMED' CHECK (claim_status IN ('UNCLAIMED','PENDING','CLAIMED')),
  owner_person_id   uuid,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','ARCHIVED')),
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, app_id, slug),
  CHECK ((external_provider IS NULL) = (external_ref IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS directory_listings_external_uq
  ON platform.directory_listings(tenant_id, external_provider, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS directory_listings_search_idx
  ON platform.directory_listings(tenant_id, app_id, kind, city, status);
ALTER TABLE platform.directory_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.directory_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS directory_listings_isolation ON platform.directory_listings;
CREATE POLICY directory_listings_isolation ON platform.directory_listings
  USING (tenant_id = platform.current_tenant_id() AND app_id = platform.current_app_id())
  WITH CHECK (tenant_id = platform.current_tenant_id() AND app_id = platform.current_app_id());

CREATE TABLE IF NOT EXISTS platform.directory_featured_slots (
  slot_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id      text NOT NULL REFERENCES platform.apps(app_id),
  listing_id  uuid NOT NULL REFERENCES platform.directory_listings(listing_id) ON DELETE CASCADE,
  placement   text NOT NULL CHECK (char_length(placement) BETWEEN 1 AND 120),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS directory_featured_lookup_idx
  ON platform.directory_featured_slots(tenant_id, app_id, placement, starts_on, ends_on) WHERE is_active;
ALTER TABLE platform.directory_featured_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.directory_featured_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS directory_featured_isolation ON platform.directory_featured_slots;
CREATE POLICY directory_featured_isolation ON platform.directory_featured_slots
  USING (tenant_id = platform.current_tenant_id() AND app_id = platform.current_app_id())
  WITH CHECK (tenant_id = platform.current_tenant_id() AND app_id = platform.current_app_id());

COMMIT;
