-- extracted from expadio 0046_crm_cases.sql at b2c2811d
BEGIN;

-- P1 Universal Business Engine — Cases (service/work units over Party).
--
-- A case is a governed unit of work attached to an account/contact. Tenant-
-- scoped and RLS-forced. The Decision Fabric seam: blueprint_key records the
-- workflow blueprint meant to govern the case, and workflow_instance_id is
-- reserved for binding to a real platform.workflow_instances row once the
-- workflow transition runtime is exposed through app routes. Until then the
-- case runs its own honest status lifecycle.

CREATE TABLE platform.crm_cases (
  case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  account_id uuid REFERENCES platform.crm_accounts(account_id) ON DELETE SET NULL,
  contact_id uuid REFERENCES platform.crm_contacts(contact_id) ON DELETE SET NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  description text,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PENDING','RESOLVED','CLOSED')),
  blueprint_key text,
  workflow_instance_id uuid,
  stage_key text,
  owner_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_cases_tenant_idx ON platform.crm_cases(tenant_id, status, priority, created_at DESC);
CREATE INDEX crm_cases_account_idx ON platform.crm_cases(account_id) WHERE account_id IS NOT NULL;

ALTER TABLE platform.crm_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_cases_tenant_isolation ON platform.crm_cases
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
