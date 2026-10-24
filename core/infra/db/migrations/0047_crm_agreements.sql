-- extracted from expadio 0047_crm_agreements.sql at b2c2811d
BEGIN;

-- P1 Universal Business Engine — Agreements (the money layer over Party/Leads).
--
-- An agreement is a commitment with a customer account: a contract,
-- subscription, or order. It closes the funnel the pipeline opens — a won lead
-- becomes a customer, and a customer signs an agreement. Tenant-scoped and
-- RLS-forced like the rest of the platform. source_lead_id records provenance
-- back to the lead the agreement came from (kept even if that lead is deleted).

CREATE TABLE platform.crm_agreements (
  agreement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES platform.crm_accounts(account_id) ON DELETE CASCADE,
  source_lead_id uuid REFERENCES platform.crm_leads(lead_id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','CANCELLED')),
  value_minor_units bigint CHECK (value_minor_units IS NULL OR value_minor_units >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  starts_on date,
  ends_on date,
  owner_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX crm_agreements_tenant_idx ON platform.crm_agreements(tenant_id, status, created_at DESC);
CREATE INDEX crm_agreements_account_idx ON platform.crm_agreements(account_id);

ALTER TABLE platform.crm_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_agreements_tenant_isolation ON platform.crm_agreements
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
