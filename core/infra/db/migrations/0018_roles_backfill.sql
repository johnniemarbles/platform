BEGIN;
-- Backfill: every distinct (tenant, app, role_key) among legacy assignments becomes a role whose
-- permissions are GRANT overrides equal to what the assignments held. Effective permissions do not
-- change. Assignments whose permission arrays differ for the same role_key are quarantined instead.
CREATE TABLE IF NOT EXISTS platform.role_backfill_quarantine (
  assignment_id uuid PRIMARY KEY,
  reason        text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
WITH legacy AS (
  SELECT ra.assignment_id, m.tenant_id, ra.app_id, ra.role_key,
         (SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(ra.permissions) p) AS perms
    FROM platform.role_assignments ra JOIN platform.memberships m USING (membership_id)
   WHERE ra.role_id IS NULL
),
conflicted AS (
  SELECT tenant_id, app_id, role_key FROM legacy GROUP BY 1,2,3 HAVING count(DISTINCT perms) > 1
)
INSERT INTO platform.role_backfill_quarantine (assignment_id, reason)
SELECT l.assignment_id, 'same role_key with different permission sets in one tenant/app'
  FROM legacy l JOIN conflicted c USING (tenant_id, app_id, role_key)
ON CONFLICT DO NOTHING;

INSERT INTO platform.apps (app_id, display_name)
SELECT DISTINCT ra.app_id, ra.app_id FROM platform.role_assignments ra
 WHERE ra.role_id IS NULL AND ra.app_id ~ '^app_[a-z0-9_]{2,40}$'
ON CONFLICT DO NOTHING;

WITH legacy AS (
  SELECT DISTINCT ON (m.tenant_id, ra.app_id, ra.role_key) m.tenant_id, ra.app_id, ra.role_key, ra.permissions, ra.granted_by
    FROM platform.role_assignments ra JOIN platform.memberships m USING (membership_id)
   WHERE ra.role_id IS NULL
     AND ra.assignment_id NOT IN (SELECT assignment_id FROM platform.role_backfill_quarantine)
     AND ra.app_id IN (SELECT app_id FROM platform.apps)
   ORDER BY m.tenant_id, ra.app_id, ra.role_key, ra.granted_at
), new_roles AS (
  INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
  SELECT tenant_id, app_id, role_key, initcap(replace(role_key, '_', ' ')), false FROM legacy
  ON CONFLICT (tenant_id, app_id, role_key) DO UPDATE SET updated_at = now()
  RETURNING role_id, tenant_id, app_id, role_key
)
INSERT INTO platform.role_permission_overrides (role_id, tenant_id, permission_key, effect, created_by)
SELECT nr.role_id, nr.tenant_id, p, 'GRANT', l.granted_by
  FROM new_roles nr JOIN legacy l USING (tenant_id, app_id, role_key), unnest(l.permissions) p
ON CONFLICT DO NOTHING;

UPDATE platform.role_assignments ra SET role_id = r.role_id
  FROM platform.memberships m, platform.roles r
 WHERE ra.membership_id = m.membership_id AND ra.role_id IS NULL
   AND r.tenant_id = m.tenant_id AND r.app_id = ra.app_id AND r.role_key = ra.role_key
   AND ra.assignment_id NOT IN (SELECT assignment_id FROM platform.role_backfill_quarantine);
COMMIT;
