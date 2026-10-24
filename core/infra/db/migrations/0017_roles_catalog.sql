BEGIN;
-- Roles catalog. A role assignment points at a role; a role subscribes to permission bundles that
-- modules ship; customer admins adjust with per-role overrides. A module adding a permission to a
-- bundle reaches every subscribed role without editing assignments (plan rule 4: roles are data).

-- Platform-wide catalog, synced from core/registry/modules.json and app packs at platform-api boot.
CREATE TABLE IF NOT EXISTS platform.permission_bundles (
  bundle_key      text PRIMARY KEY CHECK (bundle_key ~ '^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$'),
  source          text NOT NULL CHECK (source ~ '^(module|app):[a-z][a-z0-9_-]*$'),
  contract_major  integer NOT NULL CHECK (contract_major >= 0),
  description     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.permission_bundle_keys (
  bundle_key       text NOT NULL REFERENCES platform.permission_bundles(bundle_key) ON DELETE CASCADE,
  permission_key   text NOT NULL CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  auto_grant       boolean NOT NULL DEFAULT true,
  added_in_version text NOT NULL CHECK (added_in_version ~ '^\d+\.\d+\.\d+$'),
  added_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_key, permission_key)
);
CREATE TABLE IF NOT EXISTS platform.permission_catalog_events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_key     text NOT NULL,
  permission_key text NOT NULL,
  action         text NOT NULL CHECK (action IN ('KEY_ADDED','KEY_ADDED_PENDING_OPT_IN')),
  version        text NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

-- Tenant-owned roles.
CREATE TABLE IF NOT EXISTS platform.roles (
  role_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id        text NOT NULL REFERENCES platform.apps(app_id) ON DELETE CASCADE,
  role_key      text NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, app_id, role_key),
  UNIQUE (role_id, tenant_id)
);
CREATE TABLE IF NOT EXISTS platform.role_bundles (
  role_id     uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  bundle_key  text NOT NULL REFERENCES platform.permission_bundles(bundle_key),
  -- keys a bundle gains later with auto_grant = false need an explicit opt-in per role:
  opted_in_keys text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (role_id, bundle_key),
  FOREIGN KEY (role_id, tenant_id) REFERENCES platform.roles(role_id, tenant_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS platform.role_permission_overrides (
  role_id         uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  permission_key  text NOT NULL,
  effect          text NOT NULL CHECK (effect IN ('GRANT','DENY')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (role_id, tenant_id) REFERENCES platform.roles(role_id, tenant_id) ON DELETE CASCADE
);
ALTER TABLE platform.role_assignments ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES platform.roles(role_id) ON DELETE RESTRICT;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','role_bundles','role_permission_overrides'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON platform.%I', t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON platform.%I USING (tenant_id = platform.current_tenant_id()) WITH CHECK (tenant_id = platform.current_tenant_id())', t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- Effective permissions for one membership in one app. Legacy assignments (role_id IS NULL) keep
-- using their stored permissions array until 0018 backfills them.
CREATE OR REPLACE FUNCTION platform.effective_permissions(p_membership_id uuid, p_app_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $$
  WITH live AS (
    SELECT ra.* FROM platform.role_assignments ra
     WHERE ra.membership_id = p_membership_id AND ra.app_id = p_app_id
       AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at > now())
  ),
  from_bundles AS (
    SELECT k.permission_key, rb.role_id
      FROM live JOIN platform.role_bundles rb ON rb.role_id = live.role_id
      JOIN platform.permission_bundle_keys k ON k.bundle_key = rb.bundle_key
     WHERE k.auto_grant OR k.permission_key = ANY (rb.opted_in_keys)
  ),
  granted AS (
    SELECT permission_key, role_id FROM from_bundles
    UNION SELECT o.permission_key, o.role_id FROM live JOIN platform.role_permission_overrides o
           ON o.role_id = live.role_id AND o.effect = 'GRANT'
  ),
  denied AS (
    SELECT o.permission_key, o.role_id FROM live JOIN platform.role_permission_overrides o
        ON o.role_id = live.role_id AND o.effect = 'DENY'
  ),
  role_based AS (
    SELECT g.permission_key FROM granted g
     WHERE NOT EXISTS (SELECT 1 FROM denied d WHERE d.role_id = g.role_id AND d.permission_key = g.permission_key)
  ),
  legacy AS (
    SELECT unnest(live.permissions) AS permission_key FROM live WHERE live.role_id IS NULL
  )
  SELECT COALESCE(array_agg(DISTINCT permission_key ORDER BY permission_key), ARRAY[]::text[])
    FROM (SELECT permission_key FROM role_based UNION SELECT permission_key FROM legacy) x;
$$;
COMMIT;
