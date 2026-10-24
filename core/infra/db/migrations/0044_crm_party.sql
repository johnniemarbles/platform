BEGIN;

-- P1 Universal Business Engine — Party / CRM foundation.
--
-- Industry-neutral customer-relationship domain: an account (a customer
-- organization) and a contact (a person). Tenant-scoped and RLS-forced exactly
-- like the rest of the platform, so isolation is enforced at the data layer via
-- platform.current_tenant_id() (set from app.tenant_id by withTenantClient),
-- not in application code.

CREATE TABLE platform.crm_accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  domain text,
  industry text,
  lifecycle_stage text NOT NULL DEFAULT 'PROSPECT'
    CHECK (lifecycle_stage IN ('PROSPECT','LEAD','OPPORTUNITY','CUSTOMER','CHURNED')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id) ON DELETE SET NULL
);

CREATE INDEX crm_accounts_tenant_idx ON platform.crm_accounts(tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX crm_accounts_tenant_domain_uq
  ON platform.crm_accounts(tenant_id, lower(domain)) WHERE domain IS NOT NULL;

ALTER TABLE platform.crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_accounts_tenant_isolation ON platform.crm_accounts
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE platform.crm_contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  account_id uuid,
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 200),
  email text,
  phone text,
  title text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNSUBSCRIBED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id) REFERENCES platform.crm_accounts(account_id) ON DELETE SET NULL
);

CREATE INDEX crm_contacts_tenant_idx ON platform.crm_contacts(tenant_id, status, created_at DESC);
CREATE INDEX crm_contacts_account_idx ON platform.crm_contacts(account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX crm_contacts_tenant_email_uq
  ON platform.crm_contacts(tenant_id, lower(email)) WHERE email IS NOT NULL;

ALTER TABLE platform.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_contacts_tenant_isolation ON platform.crm_contacts
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
