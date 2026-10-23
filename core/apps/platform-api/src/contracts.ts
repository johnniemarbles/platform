/**
 * Local contract types mirrored from @platform-hub/contracts until published.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { CredentialClass } from '@platform-core/db-context';

export type RefusalCode =
  | 'TOKEN_SIGNATURE_INVALID'
  | 'TOKEN_MALFORMED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'TOKEN_WRONG_ISSUER'
  | 'TOKEN_WRONG_AUDIENCE'
  | 'TOKEN_SCOPE_MISMATCH'
  | 'CREDENTIAL_NOT_GRANTED'
  | 'CREDENTIAL_CLASS_FORBIDDEN'
  | 'NO_KEY_FALLBACK'
  | 'TENANT_WRONG_REGION'
  | 'IDEMPOTENCY_REPLAY'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_REPLAY'
  | 'REFUSED';

export interface Refusal<Code extends RefusalCode = RefusalCode> {
  readonly ok: false;
  readonly code: Code;
  readonly traceId: string;
  readonly message?: string;
}

export const refusal = <Code extends RefusalCode>(code: Code, traceId: string, message?: string): Refusal<Code> => {
  const base = { ok: false as const, code, traceId };
  return message === undefined ? base : { ...base, message };
};

export const SCOPE_TOKEN_SECRET_MIN_BYTES = 32;

export interface ScopeTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly kind: 'user' | 'system' | 'agent';
  readonly tenantId: string;
  readonly appId: string;
  readonly permissions: readonly string[];
  readonly hierarchyScope: string;
  readonly credentialClass: CredentialClass;
  readonly grantId?: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}

const base64url = (input: Buffer | string): string =>
  (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function signScopeToken(claims: ScopeTokenClaims, secret: string): string {
  if (secret.length < SCOPE_TOKEN_SECRET_MIN_BYTES) {
    throw new Error(`scope-token secret must be at least ${SCOPE_TOKEN_SECRET_MIN_BYTES} bytes`);
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(claims));
  const sig = base64url(createHmac('sha256', secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function signScopeTokenEd25519(_claims: ScopeTokenClaims, _options: { privateKey: string }): string {
  throw new Error('Ed25519 scope tokens require native crypto Ed25519 key');
}
