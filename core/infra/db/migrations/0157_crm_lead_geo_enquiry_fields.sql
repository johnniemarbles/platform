-- extracted from expadio 0157_crm_lead_geo_enquiry_fields.sql at b2c2811d
BEGIN;

-- Extend crm_leads with geography and structured enquiry payload fields.
--
-- first_name / last_name: split from contact_name (0156); contact_name
--   remains for legacy rows and is populated as first_name || ' ' || last_name
--   by the application layer on new inserts.
-- country_code / region_or_state / city / postal_code: geography for
--   territory matching and routing. country_code is ISO 3166-1 alpha-2.
-- enquiry_payload: jsonb bag of interest-type-specific self-declared data
--   collected at manual lead entry (mirrors hosted-form capture payload
--   structure from interest-payload.ts). Indexed for JSONB containment queries.

ALTER TABLE platform.crm_leads
  ADD COLUMN IF NOT EXISTS first_name text
    CHECK (first_name IS NULL OR char_length(btrim(first_name)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS last_name text
    CHECK (last_name IS NULL OR char_length(btrim(last_name)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS country_code char(2)
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS region_or_state text
    CHECK (region_or_state IS NULL OR char_length(btrim(region_or_state)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS city text
    CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS postal_code text
    CHECK (postal_code IS NULL OR char_length(btrim(postal_code)) BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS enquiry_payload jsonb;

CREATE INDEX IF NOT EXISTS crm_leads_country_code_idx
  ON platform.crm_leads (tenant_id, organization_id, country_code)
  WHERE country_code IS NOT NULL;

COMMENT ON COLUMN platform.crm_leads.first_name IS
  'Prospect given name. Preferred over parsing contact_name.';
COMMENT ON COLUMN platform.crm_leads.last_name IS
  'Prospect family name.';
COMMENT ON COLUMN platform.crm_leads.country_code IS
  'ISO 3166-1 alpha-2 country code for territory matching and routing.';
COMMENT ON COLUMN platform.crm_leads.region_or_state IS
  'State, province, or region within country_code.';
COMMENT ON COLUMN platform.crm_leads.city IS
  'City within region_or_state.';
COMMENT ON COLUMN platform.crm_leads.postal_code IS
  'Postal / ZIP code.';
COMMENT ON COLUMN platform.crm_leads.enquiry_payload IS
  'Interest-type-specific self-declared qualification data (mirrors interest-payload.ts schema). Stored as jsonb for flexible schema evolution.';

COMMIT;
