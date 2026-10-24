BEGIN;
CREATE SCHEMA IF NOT EXISTS platform;
DO $$
BEGIN
  IF to_regclass('platform.tenants') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'platform' AND table_name = 'tenants'
                       AND column_name = 'workspace_name') THEN
    IF EXISTS (SELECT 1 FROM platform.tenants) THEN
      RAISE EXCEPTION 'platform.tenants has the hub stub shape and contains rows; backfill account_id, country, region, workspace_name by hand before applying 0009';
    END IF;
    ALTER TABLE platform.tenants
      ADD COLUMN account_id uuid NOT NULL,
      ADD COLUMN country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
      ADD COLUMN region text NOT NULL CHECK (region ~ '^[a-z]+-[a-z]+-[1-9]$'),
      ADD COLUMN workspace_name text NOT NULL CHECK (workspace_name ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
      ADD CONSTRAINT tenants_account_id_country_key UNIQUE (account_id, country);
  END IF;
END $$;
COMMIT;
