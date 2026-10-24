-- extracted from expadio 0123_crm_lead_organization_scope.sql at b2c2811d
-- CRM lead organization scope
--
-- Leads were originally tenant-scoped only. Brand operations require an immutable
-- organization binding and selected-workspace subtree isolation. Reuse the
-- enterprise organization graph instead of introducing a Lead-specific hierarchy.

ALTER TABLE platform.crm_leads
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Backfill only where an existing Account provides authoritative organization
-- provenance. Unscoped legacy rows deliberately remain NULL and fail closed under
-- the policy below until explicitly reconciled by a governed migration/operator.
UPDATE platform.crm_leads AS l
   SET organization_id = a.organization_id
  FROM platform.crm_accounts AS a
 WHERE l.organization_id IS NULL
   AND l.account_id = a.account_id
   AND l.tenant_id = a.tenant_id
   AND a.organization_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'crm_accounts_id_tenant_organization_key'
       AND conrelid = 'platform.crm_accounts'::regclass
  ) THEN
    ALTER TABLE platform.crm_accounts
      ADD CONSTRAINT crm_accounts_id_tenant_organization_key
      UNIQUE (account_id, tenant_id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'crm_leads_organization_tenant_fk'
       AND conrelid = 'platform.crm_leads'::regclass
  ) THEN
    ALTER TABLE platform.crm_leads
      ADD CONSTRAINT crm_leads_organization_tenant_fk
      FOREIGN KEY (organization_id, tenant_id)
      REFERENCES platform.organizations(organization_id, tenant_id);
  END IF;

  -- A scoped Lead cannot reference an Account from a sibling organization or an
  -- unscoped Account. This closes the cross-organization association seam at DB level.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'crm_leads_account_organization_fk'
       AND conrelid = 'platform.crm_leads'::regclass
  ) THEN
    ALTER TABLE platform.crm_leads
      ADD CONSTRAINT crm_leads_account_organization_fk
      FOREIGN KEY (account_id, tenant_id, organization_id)
      REFERENCES platform.crm_accounts(account_id, tenant_id, organization_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS crm_leads_tenant_organization_created_idx
  ON platform.crm_leads (tenant_id, organization_id, created_at DESC);

-- Selected workspace is a second boundary on top of the subject's enterprise
-- grants. A user who is allowed at HQ may see descendants while HQ is selected;
-- selecting a country/unit narrows the visible subtree and cannot expose siblings.
CREATE OR REPLACE FUNCTION platform.current_context_can_access_organization(
  p_tenant_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT
    p_organization_id IS NOT NULL
    AND p_tenant_id = platform.current_tenant_id()
    AND platform.current_organization_id() IS NOT NULL
    AND platform.current_subject_can_access_organization(p_tenant_id, p_organization_id)
    AND (
      p_organization_id = platform.current_organization_id()
      OR EXISTS (
        SELECT 1
          FROM platform.organization_closure AS oc
         WHERE oc.tenant_id = p_tenant_id
           AND oc.ancestor_organization_id = platform.current_organization_id()
           AND oc.descendant_organization_id = p_organization_id
      )
    );
$$;

DROP POLICY IF EXISTS crm_leads_tenant_isolation ON platform.crm_leads;
DROP POLICY IF EXISTS crm_leads_organization_isolation ON platform.crm_leads;

CREATE POLICY crm_leads_organization_isolation
  ON platform.crm_leads
  FOR ALL
  USING (
    tenant_id = platform.current_tenant_id()
    AND organization_id IS NOT NULL
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  )
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND organization_id IS NOT NULL
    AND platform.current_context_can_access_organization(tenant_id, organization_id)
  );

COMMENT ON COLUMN platform.crm_leads.organization_id IS
  'Authoritative EXPADIO organization scope for Lead authorization. Never derived from capture_layer_id.';
COMMENT ON FUNCTION platform.current_context_can_access_organization(uuid, uuid) IS
  'True only when the subject grant and currently selected organization context both authorize the target organization/subtree.';
