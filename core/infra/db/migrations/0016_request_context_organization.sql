BEGIN;

-- 6-parameter set_request_context setting app.organization_id
CREATE OR REPLACE FUNCTION platform.set_request_context(
  p_tenant_id uuid,
  p_app_id text,
  p_hierarchy_scope text,
  p_credential_class text,
  p_grant_id uuid,
  p_organization_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_credential_class NOT IN ('platform-operational', 'tenant-byok', 'platform-provisioned') THEN
    RAISE EXCEPTION 'invalid credential class: %', p_credential_class;
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.app_id', p_app_id, true);
  PERFORM set_config('app.hierarchy_scope', p_hierarchy_scope, true);
  PERFORM set_config('app.credential_class', p_credential_class, true);
  PERFORM set_config('app.grant_id', COALESCE(p_grant_id::text, ''), true);
  PERFORM set_config('app.organization_id', COALESCE(p_organization_id::text, ''), true);
END;
$$;

-- 5-parameter signature delegates to 6-parameter with NULL organization_id
CREATE OR REPLACE FUNCTION platform.set_request_context(
  p_tenant_id uuid,
  p_app_id text,
  p_hierarchy_scope text,
  p_credential_class text,
  p_grant_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM platform.set_request_context(
    p_tenant_id,
    p_app_id,
    p_hierarchy_scope,
    p_credential_class,
    p_grant_id,
    NULL
  );
END;
$$;

COMMIT;
