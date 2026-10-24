-- extracted from expadio infra/db/migrations/0002_tenancy_memberships.sql, 0110_enterprise_control_plane.sql, 0123_crm_lead_organization_scope.sql at b2c2811d
BEGIN;

CREATE OR REPLACE FUNCTION platform.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

-- Operational hierarchy traversal read model.
CREATE TABLE IF NOT EXISTS platform.organization_closure (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  ancestor_organization_id uuid NOT NULL,
  descendant_organization_id uuid NOT NULL,
  depth integer NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (tenant_id, ancestor_organization_id, descendant_organization_id),
  FOREIGN KEY (ancestor_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (descendant_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (
    (depth = 0 AND ancestor_organization_id = descendant_organization_id)
    OR
    (depth > 0 AND ancestor_organization_id <> descendant_organization_id)
  )
);

CREATE INDEX IF NOT EXISTS organization_closure_descendant_idx
  ON platform.organization_closure (tenant_id, descendant_organization_id, depth);

CREATE OR REPLACE FUNCTION platform.organization_parent_would_cycle(
  p_tenant_id uuid,
  p_organization_id uuid,
  p_parent_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT
      o.organization_id,
      o.parent_organization_id,
      ARRAY[o.organization_id]::uuid[] AS path
    FROM platform.organizations o
    WHERE o.tenant_id = p_tenant_id
      AND o.organization_id = p_parent_organization_id

    UNION ALL

    SELECT
      parent.organization_id,
      parent.parent_organization_id,
      ancestors.path || parent.organization_id
    FROM ancestors
    JOIN platform.organizations parent
      ON parent.tenant_id = p_tenant_id
     AND parent.organization_id = ancestors.parent_organization_id
    WHERE NOT parent.organization_id = ANY(ancestors.path)
  )
  SELECT
    p_parent_organization_id = p_organization_id
    OR EXISTS (
      SELECT 1
      FROM ancestors
      WHERE organization_id = p_organization_id
    );
$$;

CREATE OR REPLACE FUNCTION platform.reject_organization_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_organization_id IS NOT NULL
     AND platform.organization_parent_would_cycle(
       NEW.tenant_id,
       NEW.organization_id,
       NEW.parent_organization_id
     ) THEN
    RAISE EXCEPTION 'organization hierarchy cycle rejected'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_reject_cycles ON platform.organizations;
CREATE TRIGGER organizations_reject_cycles
BEFORE INSERT OR UPDATE OF parent_organization_id, tenant_id
ON platform.organizations
FOR EACH ROW EXECUTE FUNCTION platform.reject_organization_cycle();

CREATE OR REPLACE FUNCTION platform.refresh_organization_closure(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM platform.organization_closure
   WHERE tenant_id = p_tenant_id;

  INSERT INTO platform.organization_closure (
    tenant_id, ancestor_organization_id, descendant_organization_id, depth
  )
  SELECT
    o.tenant_id, o.organization_id, o.organization_id, 0
  FROM platform.organizations o
  WHERE o.tenant_id = p_tenant_id;

  WITH RECURSIVE paths AS (
    SELECT
      child.tenant_id,
      child.parent_organization_id AS ancestor_organization_id,
      child.organization_id AS descendant_organization_id,
      1 AS depth,
      ARRAY[child.parent_organization_id, child.organization_id]::uuid[] AS path
    FROM platform.organizations child
    WHERE child.tenant_id = p_tenant_id
      AND child.parent_organization_id IS NOT NULL

    UNION ALL

    SELECT
      paths.tenant_id,
      paths.ancestor_organization_id,
      child.organization_id,
      paths.depth + 1,
      paths.path || child.organization_id
    FROM paths
    JOIN platform.organizations child
      ON child.tenant_id = paths.tenant_id
     AND child.parent_organization_id = paths.descendant_organization_id
    WHERE NOT child.organization_id = ANY(paths.path)
  )
  INSERT INTO platform.organization_closure (
    tenant_id, ancestor_organization_id, descendant_organization_id, depth
  )
  SELECT tenant_id, ancestor_organization_id, descendant_organization_id, min(depth)
  FROM paths
  GROUP BY tenant_id, ancestor_organization_id, descendant_organization_id
  ON CONFLICT (tenant_id, ancestor_organization_id, descendant_organization_id)
  DO UPDATE SET depth = EXCLUDED.depth;
END;
$$;

CREATE OR REPLACE FUNCTION platform.refresh_organization_closure_after_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM platform.refresh_organization_closure(OLD.tenant_id);
    RETURN OLD;
  END IF;

  PERFORM platform.refresh_organization_closure(NEW.tenant_id);
  IF TG_OP = 'UPDATE' AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    PERFORM platform.refresh_organization_closure(OLD.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_refresh_closure ON platform.organizations;
CREATE TRIGGER organizations_refresh_closure
AFTER INSERT OR UPDATE OF parent_organization_id, tenant_id OR DELETE
ON platform.organizations
FOR EACH ROW EXECUTE FUNCTION platform.refresh_organization_closure_after_change();

ALTER TABLE platform.organization_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_closure FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_closure_tenant_all ON platform.organization_closure;
CREATE POLICY organization_closure_tenant_all ON platform.organization_closure
  FOR ALL USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.current_subject_can_access_organization(
  p_tenant_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT
    p_organization_id IS NOT NULL
    AND p_tenant_id = platform.current_tenant_id()
    AND (
      platform.current_organization_id() IS NULL
      OR p_organization_id = platform.current_organization_id()
      OR EXISTS (
        SELECT 1
        FROM platform.organization_closure closure
        WHERE closure.tenant_id = p_tenant_id
          AND closure.ancestor_organization_id = platform.current_organization_id()
          AND closure.descendant_organization_id = p_organization_id
      )
    );
$$;

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
    AND (
      platform.current_organization_id() IS NULL
      OR (
        platform.current_subject_can_access_organization(p_tenant_id, p_organization_id)
        AND (
          p_organization_id = platform.current_organization_id()
          OR EXISTS (
            SELECT 1
              FROM platform.organization_closure AS oc
             WHERE oc.tenant_id = p_tenant_id
               AND oc.ancestor_organization_id = platform.current_organization_id()
               AND oc.descendant_organization_id = p_organization_id
          )
        )
      )
    );
$$;

DO $$
DECLARE
  tenant_record record;
BEGIN
  FOR tenant_record IN SELECT tenant_id FROM platform.tenants
  LOOP
    PERFORM platform.refresh_organization_closure(tenant_record.tenant_id);
  END LOOP;
END;
$$;

COMMIT;
