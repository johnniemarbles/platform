/**
 * Server-set database context (plan V3.1 rule 3).
 *
 * "Database rules use context set by the server, from the verified token:
 *  tenant, app, hierarchy scope. A client can never supply it."
 *
 * This module produces the exact SQL the server runs per request. The context
 * MUST come from a verified scope token (handed in here as a `Context`), never
 * from caller-supplied JSON. Callers that bypass this and build their own
 * `set_config` strings are the regression this package exists to prevent — the
 * architecture checker's permission-check patterns flag that shape in review.
 *
 * The migration-defined `platform.set_request_context(...)` is a stored
 * procedure, and set_config here is called with `is_local=true`, so the GUCs
 * roll back at commit and cannot leak into the next pooled transaction.
 */
export type CredentialClass = 'platform-operational' | 'tenant-byok' | 'platform-provisioned';

export interface RequestContext {
  readonly tenantId: string;
  readonly appId: string;
  readonly hierarchyScope: string;
  readonly credentialClass: CredentialClass;
  readonly grantId?: string;
}

export interface SetContextSql {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape-checks a context against the token shape before it ever hits the server. */
export function assertServerContext(ctx: RequestContext): void {
  if (!UUID_RE.test(ctx.tenantId)) throw new TypeError('tenantId must be a UUID');
  if (ctx.appId.trim().length === 0) throw new TypeError('appId must not be empty');
  if (ctx.hierarchyScope.trim().length === 0) throw new TypeError('hierarchyScope must not be empty');
  if (!['platform-operational', 'tenant-byok', 'platform-provisioned'].includes(ctx.credentialClass)) {
    throw new TypeError('credentialClass must be one of the three defined classes');
  }
  if (ctx.credentialClass !== 'platform-operational' && !(ctx.grantId && UUID_RE.test(ctx.grantId))) {
    throw new TypeError('grantId must be a UUID when credentialClass is tenant-byok or platform-provisioned');
  }
}

/** The parameterised call the hub makes per request. */
export function setRequestContextSql(ctx: RequestContext): SetContextSql {
  assertServerContext(ctx);
  return {
    sql: 'SELECT platform.set_request_context($1, $2, $3, $4, $5)',
    params: [
      ctx.tenantId,
      ctx.appId,
      ctx.hierarchyScope,
      ctx.credentialClass,
      ctx.grantId ?? null,
    ],
  };
}

/** A tenant-only variant for platform-api endpoints that don't need the credential context. */
export function setTenantContextSql(tenantId: string, appId: string, hierarchyScope: string): SetContextSql {
  return setRequestContextSql({ tenantId, appId, hierarchyScope, credentialClass: 'platform-operational' });
}
