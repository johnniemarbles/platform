import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IdentityVerifier, VerifiedIdentity } from '@platform-core/iam';
import { refusal, type Refusal, type RefusalCode } from './contracts.ts';
import { resolveMembership, type ResolvedMembership } from './membership.ts';
import { withRequestContext, type Db, type Transaction } from './db.ts';

export interface HandlerContext {
  readonly tx: Transaction;
  readonly identity: VerifiedIdentity;
  readonly membership: ResolvedMembership;
  readonly traceId: string;
}

export type Route = (ctx: HandlerContext, req: IncomingMessage) => Promise<unknown>;

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  readonly path?: string;
  readonly pattern?: RegExp;
  readonly appId: string;                   // which app this route serves
  readonly requires: readonly string[];     // permission keys the role must carry
  readonly handler: Route;
}

export interface PlatformApiConfig {
  readonly db: Db;
  readonly identity: IdentityVerifier;
  readonly resolveTenantFromHost: (host: string | undefined) => Promise<string | null>;
  readonly now?: () => Date;
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};
const sendRefusal = (res: ServerResponse, r: Refusal, status = 403): void => sendJson(res, status, r);

export function makeDispatcher(routes: readonly RouteDefinition[], config: PlatformApiConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    if (req.url === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, traceId });

    const route = routes.find((r) => {
      if (r.method !== req.method) return false;
      if (r.pattern) return r.pattern.test(req.url ?? '');
      return r.path !== undefined && r.path === req.url;
    });
    if (!route) return sendJson(res, 404, refusal('REFUSED', traceId, 'route not found'));

    const authz = req.headers['authorization'];
    if (typeof authz !== 'string' || !authz.toLowerCase().startsWith('bearer ')) {
      return sendRefusal(res, refusal('TOKEN_MALFORMED', traceId, 'missing bearer'), 401);
    }
    const token = authz.slice('bearer '.length).trim();

    let identity: VerifiedIdentity;
    try { identity = await config.identity.verify({ credential: token }); }
    catch (e: unknown) {
      const reason = (e as { reason?: string } | null)?.reason;
      return sendRefusal(res,
        refusal(reason === 'IDENTITY_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_SIGNATURE_INVALID', traceId),
        401);
    }

    const host = typeof req.headers['x-platform-host'] === 'string'
      ? req.headers['x-platform-host'] : req.headers['host'];
    const tenantId = await config.resolveTenantFromHost(host);
    if (!tenantId) return sendRefusal(res, refusal('TENANT_WRONG_REGION', traceId, 'no tenant for host'));

    // Resolve membership (opens a short tx for the read).
    const membership = await (async () => {
      const tx = await config.db.begin();
      try {
        const m = await resolveMembership(tx, identity, { tenantId, appId: route.appId });
        await tx.commit();
        return m;
      } catch (e) { await tx.rollback(); throw e; }
    })();
    if (!membership) return sendRefusal(res, refusal('TOKEN_SCOPE_MISMATCH', traceId, 'no membership'));

    // Permission gate.
    for (const need of route.requires) {
      if (!membership.permissions.includes(need)) {
        return sendRefusal(res, refusal('TOKEN_SCOPE_MISMATCH', traceId, `missing permission: ${need}`));
      }
    }

    try {
      const result = await withRequestContext(config.db, {
        tenantId: membership.tenantId,
        appId: membership.appId,
        hierarchyScope: membership.hierarchyScope,
        credentialClass: 'platform-operational',
      }, async (tx) => route.handler({ tx, identity, membership, traceId }, req));
      sendJson(res, 200, { ok: true, traceId, result });
    } catch (e) {
      sendJson(res, 500, { ok: false, code: 'REFUSED', traceId });
      console.error('[platform-api]', traceId, e);
    }
  };
}
