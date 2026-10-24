import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IdentityVerifier, VerifiedIdentity } from '@platform-core/iam';
import { refusal, isRefusal, type Refusal } from '@platform-hub/contracts';
import {
  type HandlerContext,
  type RouteDefinition,
  RouteKitHttpError,
} from '@platform-core/route-kit';
import { resolveMembership, type ResolvedMembership } from './membership.ts';
import { withRequestContext, type Db } from './db.ts';
import { lookupAppsForClients } from './app-registry.ts';

export type { HandlerContext, RouteDefinition };

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
    const url = new URL(req.url ?? '/', 'http://local');
    const pathname = url.pathname;

    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, traceId });
    }

    const route = routes.find((r) => {
      if (r.method !== req.method) return false;
      if (r.pattern) return r.pattern.test(pathname);
      return r.path !== undefined && r.path === pathname;
    });
    if (!route) return sendJson(res, 404, refusal('REFUSED', traceId, 'route not found'));

    const authz = req.headers['authorization'];
    if (typeof authz !== 'string' || !authz.toLowerCase().startsWith('bearer ')) {
      return sendRefusal(res, refusal('TOKEN_MALFORMED', traceId, 'missing bearer'), 401);
    }
    const token = authz.slice('bearer '.length).trim();

    let identity: VerifiedIdentity;
    try {
      identity = await config.identity.verify({ credential: token });
    } catch (e: unknown) {
      const reason = (e as { reason?: string } | null)?.reason;
      return sendRefusal(
        res,
        refusal(reason === 'IDENTITY_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_SIGNATURE_INVALID', traceId),
        401
      );
    }

    // App resolution from verified token audience (Rule 3)
    const aud = identity.audiences ?? [];
    const apps = await lookupAppsForClients(config.db, aud);
    if (apps.length !== 1) {
      return sendRefusal(
        res,
        refusal('APP_UNKNOWN', traceId, 'token audience does not map to exactly one app'),
        403
      );
    }
    const appId = apps[0]!;

    // Route ownership check: route.appId must be '*' or match appId (return 404 to avoid revealing app routes)
    if (route.appId !== '*' && route.appId !== appId) {
      return sendJson(res, 404, refusal('REFUSED', traceId, 'route not found'));
    }

    const host = typeof req.headers['x-platform-host'] === 'string'
      ? req.headers['x-platform-host']
      : req.headers['host'];
    const tenantId = await config.resolveTenantFromHost(host);
    if (!tenantId) return sendRefusal(res, refusal('TENANT_WRONG_REGION', traceId, 'no tenant for host'));

    // Resolve membership and check app activation inside one transaction with tenant GUC set
    const authResult = await (async () => {
      const tx = await config.db.begin();
      try {
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const r = await tx.query(
          'SELECT 1 FROM platform.tenant_apps WHERE tenant_id = $1 AND app_id = $2 AND deactivated_at IS NULL',
          [tenantId, appId]
        );
        if (r.rows.length === 0) {
          await tx.rollback();
          return { status: 'not_activated' as const };
        }
        const m = await resolveMembership(tx, identity, { tenantId, appId });
        await tx.commit();
        return { status: 'ok' as const, membership: m };
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    })();

    if (authResult.status === 'not_activated') {
      return sendRefusal(
        res,
        refusal('APP_NOT_ACTIVATED', traceId, `app ${appId} is not activated for tenant ${tenantId}`),
        403
      );
    }

    const membership = authResult.membership;
    if (!membership) return sendRefusal(res, refusal('TOKEN_SCOPE_MISMATCH', traceId, 'no membership'));

    // Permission gate
    for (const need of route.requires) {
      if (!membership.permissions.includes(need)) {
        return sendRefusal(res, refusal('TOKEN_SCOPE_MISMATCH', traceId, `missing permission: ${need}`));
      }
    }

    try {
      const result = await withRequestContext(
        config.db,
        {
          tenantId: membership.tenantId,
          appId,
          hierarchyScope: membership.hierarchyScope,
          credentialClass: 'platform-operational',
        },
        async (tx) => route.handler({ tx, identity, membership, traceId, url }, req)
      );
      if (isRefusal(result)) {
        const status = result.message === 'not found' ? 404 : 400;
        return sendRefusal(res, result, status);
      }
      sendJson(res, 200, { ok: true, traceId, result });
    } catch (e) {
      if (e instanceof RouteKitHttpError) {
        return sendRefusal(res, e.refusal, e.status);
      }
      sendJson(res, 500, { ok: false, code: 'REFUSED', traceId });
      console.error('[platform-api]', traceId, e);
    }
  };
}
