import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { VerifiedIdentity } from '@platform-core/iam';
import {
  refusal,
  type Refusal,
  type CredentialClass,
  type ScopeTokenClaims,
  signScopeToken,
  signScopeTokenEd25519,
  SCOPE_TOKEN_SECRET_MIN_BYTES,
} from '@platform-hub/contracts';

export interface Transaction {
  query<R extends Record<string, any> = Record<string, any>>(
    sql: string,
    params?: readonly any[]
  ): Promise<{ readonly rows: readonly R[]; rowCount?: number | null }>;
}

export interface ResolvedMembership {
  membershipId?: string;
  tenantId: string;
  country?: string;
  region?: string;
  appId: string;
  personId: string;
  hierarchyScope: string;
  roles?: readonly string[];
  permissions: readonly string[];
}

export interface HandlerContext {
  readonly tx: Transaction;
  readonly identity: VerifiedIdentity;
  readonly membership: ResolvedMembership;
  readonly traceId: string;
  readonly url: URL;
}

export type Route = (ctx: HandlerContext, req: IncomingMessage) => Promise<unknown>;

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  readonly path?: string;
  readonly pattern?: RegExp;
  readonly appId: string | '*';
  readonly requires: readonly string[];
  readonly handler: Route;
}

export class RouteKitHttpError extends Error {
  readonly status: number;
  readonly refusal: Refusal;

  constructor(status: number, code: 'REFUSED' = 'REFUSED', message: string, traceId = 'system') {
    super(message);
    this.name = 'RouteKitHttpError';
    this.status = status;
    this.refusal = refusal(code, traceId, message);
  }
}

export async function readJson(
  req: IncomingMessage,
  options: { maxBytes?: number; traceId?: string } = {}
): Promise<Record<string, unknown>> {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const traceId = options.traceId ?? (req.headers?.['x-trace-id'] as string | undefined) ?? 'system';

  let bytes = 0;
  const chunks: Buffer[] = [];

  if (typeof (req as any)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of req as any) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > maxBytes) {
        if (typeof req.destroy === 'function') req.destroy();
        throw new RouteKitHttpError(413, 'REFUSED', `payload exceeds maximum allowed size of ${maxBytes} bytes`, traceId);
      }
      chunks.push(buf);
    }
  } else if (typeof req.on === 'function') {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          if (typeof req.destroy === 'function') req.destroy();
          reject(new RouteKitHttpError(413, 'REFUSED', `payload exceeds maximum allowed size of ${maxBytes} bytes`, traceId));
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      req.on('end', () => resolve());
      req.on('error', (err) => reject(err));
    });
  }

  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RouteKitHttpError(400, 'REFUSED', 'body must be a JSON object', traceId);
    }
    return parsed as Record<string, unknown>;
  } catch (err: any) {
    if (err instanceof RouteKitHttpError) throw err;
    throw new RouteKitHttpError(400, 'REFUSED', 'invalid JSON payload', traceId);
  }
}

export function parsePagination(
  url: URL,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): { limit: number; cursor: string | null } {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const limitParam = url.searchParams.get('limit');
  let limit = defaultLimit;
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  const cursor = url.searchParams.get('cursor') || null;

  return { limit, cursor };
}

export function notFound(traceId: string): Refusal {
  return refusal('REFUSED', traceId, 'not found');
}

export function badRequest(traceId: string, message: string): Refusal {
  return refusal('REFUSED', traceId, message);
}

export function forbidden(traceId: string, message = 'forbidden'): Refusal {
  return refusal('REFUSED', traceId, message);
}

export interface ScopeTokenSignerConfig {
  readonly algorithm: 'HS256' | 'EdDSA';
  readonly hs256Secret?: string | undefined;
  readonly ed25519PrivateKey?: string | undefined;
  readonly issuer?: string | undefined;
  readonly audience?: string | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

export function signerFromEnv(): ScopeTokenSignerConfig {
  const algorithm = (process.env['SCOPE_TOKEN_ALGORITHM'] ?? 'HS256') as 'HS256' | 'EdDSA';
  if (algorithm === 'HS256') {
    const hs256Secret = process.env['SCOPE_TOKEN_HS256_SECRET'];
    if (!hs256Secret || hs256Secret.length < SCOPE_TOKEN_SECRET_MIN_BYTES) {
      throw new Error('SCOPE_TOKEN_HS256_SECRET missing or too short');
    }
    return { algorithm, hs256Secret };
  }
  const ed25519PrivateKey = process.env['SCOPE_TOKEN_ED25519_PRIVATE_KEY'];
  if (!ed25519PrivateKey) throw new Error('SCOPE_TOKEN_ED25519_PRIVATE_KEY required');
  return { algorithm, ed25519PrivateKey };
}

export interface MintScopeOptions {
  readonly membership: ResolvedMembership;
  readonly credentialClass: CredentialClass;
  readonly grantId?: string | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export function mintScopeToken(cfg: ScopeTokenSignerConfig, options: MintScopeOptions): string {
  const now = Math.floor((cfg.now?.() ?? new Date()).getTime() / 1000);
  const ttl = cfg.ttlSeconds ?? 300;
  const perms = options.permissions
    ? options.membership.permissions.filter((p) => options.permissions!.includes(p))
    : options.membership.permissions;
  const base: ScopeTokenClaims = {
    iss: cfg.issuer ?? 'platform',
    aud: cfg.audience ?? 'hub',
    sub: options.membership.personId,
    kind: 'user',
    tenantId: options.membership.tenantId,
    appId: options.membership.appId,
    permissions: perms,
    hierarchyScope: options.membership.hierarchyScope,
    credentialClass: options.credentialClass,
    jti: randomUUID(),
    iat: now,
    exp: now + ttl,
    ...(options.grantId !== undefined ? { grantId: options.grantId } : {}),
  };
  if (cfg.algorithm === 'HS256') return signScopeToken(base, cfg.hs256Secret!);
  return signScopeTokenEd25519(base, { privateKey: cfg.ed25519PrivateKey! });
}
