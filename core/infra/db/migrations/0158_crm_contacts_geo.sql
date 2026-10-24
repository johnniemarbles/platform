-- extracted from expadio 0158_crm_contacts_geo.sql at b2c2811d
BEGIN;

-- Add geo fields to crm_contacts and crm_accounts so the search-first
-- create forms can capture location alongside identity.

ALTER TABLE platform.crm_contacts
  ADD COLUMN IF NOT EXISTS country_code char(2)
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS region_or_state text
    CHECK (region_or_state IS NULL OR char_length(region_or_state) <= 100),
  ADD COLUMN IF NOT EXISTS city text
    CHECK (city IS NULL OR char_length(city) <= 100);

ALTER TABLE platform.crm_accounts
  ADD COLUMN IF NOT EXISTS country_code char(2)
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS city text
    CHECK (city IS NULL OR char_length(city) <= 100);

CREATE INDEX IF NOT EXISTS crm_contacts_country_code_idx
  ON platform.crm_contacts (tenant_id, country_code)
  WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_accounts_country_code_idx
  ON platform.crm_accounts (tenant_id, country_code)
  WHERE country_code IS NOT NULL;

COMMIT;
