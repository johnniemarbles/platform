-- extracted from expadio 0145_crm_lead_stage_governance.sql at b2c2811d
BEGIN;

-- Gate 4 — CRM lead lifecycle governance.
--
-- Replaces arbitrary "SET stage" (last-writer-wins) with governed transitions:
-- an optimistic-concurrency revision, a legal-transition graph enforced in the
-- application (@expadio/lead), and a hash-chained, append-only audit of every
-- move with actor + reason. The capture 19-stage journey already has its own
-- governed history (0127); this is the thin CRM projection's equivalent.

ALTER TABLE platform.crm_leads
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);

CREATE TABLE platform.crm_lead_stage_transitions (
  transition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  from_stage text NOT NULL CHECK (from_stage IN ('NEW','QUALIFIED','PROPOSAL','WON','LOST')),
  to_stage text NOT NULL CHECK (to_stage IN ('NEW','QUALIFIED','PROPOSAL','WON','LOST')),
  transition_kind text NOT NULL CHECK (transition_kind IN ('STANDARD','OVERRIDE')),
  reason text,
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  from_revision integer NOT NULL CHECK (from_revision >= 1),
  to_revision integer NOT NULL CHECK (to_revision = from_revision + 1),
  prev_hash text,
  entry_hash text NOT NULL CHECK (btrim(entry_hash) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  FOREIGN KEY (lead_id) REFERENCES platform.crm_leads(lead_id) ON DELETE CASCADE,
  -- One transition per revision step per lead: the chain has no forks or gaps.
  UNIQUE (lead_id, to_revision),
  UNIQUE (lead_id, entry_hash),
  -- An OVERRIDE must carry a reason; STANDARD moves may omit it.
  CONSTRAINT crm_lead_transition_reason CHECK (transition_kind <> 'OVERRIDE' OR btrim(coalesce(reason, '')) <> '')
);
CREATE INDEX crm_lead_stage_transitions_lead_idx
  ON platform.crm_lead_stage_transitions (tenant_id, organization_id, lead_id, to_revision);

CREATE OR REPLACE FUNCTION platform.deny_crm_lead_transition_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_lead_stage_transitions is append-only';
END;
$$;
CREATE TRIGGER crm_lead_stage_transitions_append_only
  BEFORE UPDATE OR DELETE ON platform.crm_lead_stage_transitions
  FOR EACH ROW EXECUTE FUNCTION platform.deny_crm_lead_transition_mutation();

ALTER TABLE platform.crm_lead_stage_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.crm_lead_stage_transitions FORCE ROW LEVEL SECURITY;

-- Same organization-subtree authorization as the leads they describe.
CREATE POLICY crm_lead_stage_transitions_organization_isolation ON platform.crm_lead_stage_transitions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id))
  WITH CHECK (tenant_id = platform.current_tenant_id() AND platform.current_context_can_access_organization(tenant_id, organization_id));

COMMENT ON COLUMN platform.crm_leads.revision IS
  'Optimistic-concurrency revision. A stage transition must supply the expected revision and bumps it by one.';
COMMENT ON TABLE platform.crm_lead_stage_transitions IS
  'Append-only, hash-chained audit of CRM lead stage moves: actor, reason, revision step, and entry hash chained to the prior entry.';

COMMIT;
