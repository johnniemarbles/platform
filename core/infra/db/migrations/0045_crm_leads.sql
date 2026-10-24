-- extracted from expadio 0045_crm_leads.sql at b2c2811d
BEGIN;

-- P1 Universal Business Engine — Leads (sales pipeline over Party).
--
-- A lead is a potential piece of business moving through governed stages,
-- optionally attached to an account and/or contact. Tenant-scoped and
-- RLS-forced like the rest of the platform.

CREATE TABLE platform.crm_leads (
  lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  account_id uuid REFERENCES platform.crm_accounts(account_id) ON DELETE SET NULL,
  contact_id uuid REFERENCES platform.crm_contacts(contact_id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  stage text NOT NULL DEFAULT 'NEW'
    CHECK (stage IN ('NEW','QUALIFIED','PROPOSAL','WON','LOST')),
  amount_minor_units bigint CHECK (amount_minor_units IS NULL OR amount_minor_units >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  source text,
  owner_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_leads_tenant_idx ON platform.crm_leads(tenant_id, stage, created_at DESC);
CREATE INDEX crm_leads_account_idx ON platform.crm_leads(account_id) WHERE account_id IS NOT NULL;

ALTER TABLE platform.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_leads FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_leads_tenant_isolation ON platform.crm_leads
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
