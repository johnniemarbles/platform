BEGIN;

-- One row per (person, tenant). Cognito's sub + pool is the identity key.
CREATE TABLE IF NOT EXISTS platform.memberships (
  membership_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  person_id            uuid NOT NULL,                 -- -> @platform-core/party.people
  identity_provider    text NOT NULL CHECK (identity_provider IN ('cognito','dev')),
  identity_pool_id     text NOT NULL,                 -- Cognito user pool id, or 'dev'
  identity_subject_id  text NOT NULL,                 -- Cognito sub, or dev sub
  state                text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','SUSPENDED','REVOKED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz,
  UNIQUE (identity_pool_id, identity_subject_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS memberships_person_idx ON platform.memberships (person_id);

-- Role assignments: a scoped grant of a set of permission keys to a
-- membership for a specific app at a specific hierarchy node.
CREATE TABLE IF NOT EXISTS platform.role_assignments (
  assignment_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id    uuid NOT NULL REFERENCES platform.memberships(membership_id) ON DELETE CASCADE,
  app_id           text NOT NULL CHECK (btrim(app_id) <> ''),
  role_key         text NOT NULL,
  permissions      text[] NOT NULL DEFAULT ARRAY[]::text[],
  hierarchy_scope  text NOT NULL,
  granted_by       uuid NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  CHECK (expires_at IS NULL OR expires_at > granted_at)
);

CREATE INDEX IF NOT EXISTS role_assignments_live_idx
  ON platform.role_assignments (membership_id, app_id)
  WHERE revoked_at IS NULL;

COMMIT;
