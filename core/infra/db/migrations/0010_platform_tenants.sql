BEGIN;

CREATE SCHEMA IF NOT EXISTS platform;

CREATE OR REPLACE FUNCTION platform.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION platform.current_app_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.app_id', true), '')
$$;

CREATE OR REPLACE FUNCTION platform.current_hierarchy_scope()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.hierarchy_scope', true), '')
$$;

CREATE OR REPLACE FUNCTION platform.current_credential_class()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.credential_class', true), '')
$$;

CREATE OR REPLACE FUNCTION platform.current_grant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.grant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION platform.set_request_context(
  p_tenant_id uuid,
  p_app_id text,
  p_hierarchy_scope text,
  p_credential_class text,
  p_grant_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_credential_class NOT IN ('platform-operational', 'tenant-byok', 'platform-provisioned') THEN
    RAISE EXCEPTION 'invalid credential class: %', p_credential_class;
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.app_id', p_app_id, true);
  PERFORM set_config('app.hierarchy_scope', p_hierarchy_scope, true);
  PERFORM set_config('app.credential_class', p_credential_class, true);
  PERFORM set_config('app.grant_id', COALESCE(p_grant_id::text, ''), true);
END $$;

-- A tenant is one country's cell of a single customer. The directory row in
-- the global account-list is separate; this table is the regional cell's view.
CREATE TABLE IF NOT EXISTS platform.tenants (
  tenant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL,
  country          text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  region           text NOT NULL CHECK (region ~ '^[a-z]+-[a-z]+-[1-9]$'),
  workspace_name   text NOT NULL CHECK (workspace_name ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, country)
);

CREATE INDEX IF NOT EXISTS tenants_workspace_idx ON platform.tenants (workspace_name);

COMMIT;
