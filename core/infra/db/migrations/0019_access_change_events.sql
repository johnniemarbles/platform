BEGIN;
-- Append-only, hash-chained record of every role, override, opt-in and assignment change
-- (plan: tenant administration is an audited workflow). Rows are chained per tenant with
-- @platform-core/audit createAuditChainEvent(); verifyAuditChain() proves nothing was altered.
CREATE TABLE IF NOT EXISTS platform.access_change_events (
  event_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  app_id        text NOT NULL,
  actor_person_id uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('ROLE_CREATED','ROLE_UPDATED','BUNDLE_ADDED','BUNDLE_REMOVED',
                  'OVERRIDE_SET','OVERRIDE_REMOVED','OPT_IN','OPT_OUT','ASSIGNMENT_GRANTED','ASSIGNMENT_REVOKED','APP_ACTIVATED')),
  subject       jsonb NOT NULL,
  sequence      bigint NOT NULL,
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash    text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sequence)
);
ALTER TABLE platform.access_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.access_change_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS access_change_events_read ON platform.access_change_events;
DROP POLICY IF EXISTS access_change_events_insert ON platform.access_change_events;
CREATE POLICY access_change_events_read ON platform.access_change_events FOR SELECT
  USING (tenant_id = platform.current_tenant_id());
CREATE POLICY access_change_events_insert ON platform.access_change_events FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());
-- No UPDATE or DELETE policy: with FORCE RLS, updates and deletes match no rows.
COMMIT;
