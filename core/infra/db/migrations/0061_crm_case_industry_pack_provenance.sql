-- extracted from expadio 0061_crm_case_industry_pack_provenance.sql at b2c2811d
BEGIN;

ALTER TABLE platform.crm_cases
  ADD COLUMN IF NOT EXISTS industry_pack_vertical_key text,
  ADD COLUMN IF NOT EXISTS industry_pack_version integer,
  ADD COLUMN IF NOT EXISTS industry_pack_runtime_source text;

ALTER TABLE platform.crm_cases
  ADD CONSTRAINT crm_cases_industry_pack_version_check
    CHECK (industry_pack_version IS NULL OR industry_pack_version > 0),
  ADD CONSTRAINT crm_cases_industry_pack_runtime_source_check
    CHECK (
      industry_pack_runtime_source IS NULL
      OR industry_pack_runtime_source IN (
        'TENANT_PUBLISHED',
        'PLATFORM_PUBLISHED',
        'CODE_BASELINE',
        'NEUTRAL'
      )
    ),
  ADD CONSTRAINT crm_cases_industry_pack_provenance_shape_check
    CHECK (
      industry_pack_runtime_source IS NULL
      OR (
        industry_pack_runtime_source = 'NEUTRAL'
        AND industry_pack_vertical_key IS NULL
        AND industry_pack_version IS NULL
      )
      OR (
        industry_pack_runtime_source IN ('TENANT_PUBLISHED','PLATFORM_PUBLISHED')
        AND industry_pack_vertical_key IS NOT NULL
        AND btrim(industry_pack_vertical_key) <> ''
        AND industry_pack_version IS NOT NULL
      )
      OR (
        industry_pack_runtime_source = 'CODE_BASELINE'
        AND industry_pack_vertical_key IS NOT NULL
        AND btrim(industry_pack_vertical_key) <> ''
      )
    );

CREATE OR REPLACE FUNCTION platform.enforce_crm_case_pack_provenance_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.industry_pack_vertical_key IS DISTINCT FROM NEW.industry_pack_vertical_key
     OR OLD.industry_pack_version IS DISTINCT FROM NEW.industry_pack_version
     OR OLD.industry_pack_runtime_source IS DISTINCT FROM NEW.industry_pack_runtime_source THEN
    RAISE EXCEPTION 'crm case Industry Pack provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_cases_pack_provenance_immutable
BEFORE UPDATE OF industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
ON platform.crm_cases
FOR EACH ROW
EXECUTE FUNCTION platform.enforce_crm_case_pack_provenance_immutability();

COMMIT;
