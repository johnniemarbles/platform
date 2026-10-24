BEGIN;
-- extracted from expadio infra/db/migrations/0002_tenancy_memberships.sql (platform.organizations);
-- required by 0044_crm_party.sql's FK (organization_id, tenant_id).
CREATE TABLE IF NOT EXISTS platform.organizations (
  organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  parent_organization_id uuid,
  organization_kind text NOT NULL DEFAULT 'BUSINESS',
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, tenant_id)
);
ALTER TABLE platform.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_tenant_isolation ON platform.organizations;
CREATE POLICY organizations_tenant_isolation ON platform.organizations
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
COMMIT;
