BEGIN;
-- Apps, the identity-provider clients that represent them, and per-tenant activation.
-- platform-api resolves the request's app from the VERIFIED token audience (aud),
-- never from a caller-supplied header (plan rule 3).
CREATE TABLE IF NOT EXISTS platform.apps (
  app_id        text PRIMARY KEY CHECK (app_id ~ '^app_[a-z0-9_]{2,40}$'),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.app_clients (
  client_id          text PRIMARY KEY CHECK (btrim(client_id) <> ''),
  app_id             text NOT NULL REFERENCES platform.apps(app_id) ON DELETE CASCADE,
  identity_provider  text NOT NULL CHECK (identity_provider IN ('cognito','dev')),
  identity_pool_id   text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_clients_app_idx ON platform.app_clients(app_id);
CREATE TABLE IF NOT EXISTS platform.tenant_apps (
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id        text NOT NULL REFERENCES platform.apps(app_id) ON DELETE CASCADE,
  activated_at  timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  PRIMARY KEY (tenant_id, app_id)
);
ALTER TABLE platform.tenant_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_apps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_apps_tenant_isolation ON platform.tenant_apps;
CREATE POLICY tenant_apps_tenant_isolation ON platform.tenant_apps
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
COMMIT;
