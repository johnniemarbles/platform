import { randomUUID } from 'node:crypto';
import type { CredentialClass } from '@platform-core/db-context';
import {
  signScopeToken, signScopeTokenEd25519,
  SCOPE_TOKEN_SECRET_MIN_BYTES, type ScopeTokenClaims,
} from './contracts.ts';
import type { ResolvedMembership } from './membership.ts';

export interface ScopeTokenSignerConfig {
  readonly algorithm: 'HS256' | 'EdDSA';
  readonly hs256Secret?: string;
  readonly ed25519PrivateKey?: string;
  readonly issuer?: string;        // 'platform' default
  readonly audience?: string;      // 'hub' default
  readonly ttlSeconds?: number;    // 300 default
  readonly now?: () => Date;
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
  readonly grantId?: string;
  readonly permissions?: readonly string[];   // narrow permissions to this subset
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
    iat: now, exp: now + ttl,
    ...(options.grantId !== undefined ? { grantId: options.grantId } : {}),
  };
  if (cfg.algorithm === 'HS256') return signScopeToken(base, cfg.hs256Secret!);
  return signScopeTokenEd25519(base, { privateKey: cfg.ed25519PrivateKey! });
}
