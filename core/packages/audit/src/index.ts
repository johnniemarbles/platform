import { createHash } from 'node:crypto';

export const AUDIT_CHAIN_GENESIS = '0'.repeat(64);

export type AuditJson =
  | null
  | boolean
  | number
  | string
  | readonly AuditJson[]
  | { readonly [key: string]: AuditJson };

export interface AuditChainEventBody {
  readonly tenantId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly objectReference: {
    readonly type: string;
    readonly id: string;
  };
  readonly actor: {
    readonly kind: 'HUMAN' | 'AGENT' | 'SYSTEM';
    readonly subjectId: string;
  };
  readonly purpose: string;
  readonly reason: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
  readonly details: AuditJson;
  readonly previousHash: string;
}

export interface AuditChainEvent extends AuditChainEventBody {
  readonly hash: string;
}

export type AuditChainFailureReason =
  | 'EVENT_INVALID'
  | 'SEQUENCE_GAP'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'CONTENT_HASH_MISMATCH';

export type AuditChainVerification =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly tenantId: string;
      readonly sequence: number;
      readonly reason: AuditChainFailureReason;
    };

/**
 * Canonical SHA-256 audit export integrity, promoted from the verified GFSM
 * hash-chain invariant. This supplies tamper evidence, not storage immutability
 * or provider retention lock/WORM guarantees.
 */
export function hashAuditChainEvent(body: AuditChainEventBody): string {
  validateBody(body);
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function createAuditChainEvent(
  body: AuditChainEventBody,
): AuditChainEvent {
  return { ...body, hash: hashAuditChainEvent(body) };
}

export function verifyAuditChain(
  events: readonly AuditChainEvent[],
): AuditChainVerification {
  const heads = new Map<string, { sequence: number; hash: string }>();

  for (const event of events) {
    try {
      validateEvent(event);
    } catch {
      return failure(event, 'EVENT_INVALID');
    }
    const head = heads.get(event.tenantId) ?? {
      sequence: 0,
      hash: AUDIT_CHAIN_GENESIS,
    };
    if (event.sequence !== head.sequence + 1) {
      return failure(event, 'SEQUENCE_GAP');
    }
    if (event.previousHash !== head.hash) {
      return failure(event, 'PREVIOUS_HASH_MISMATCH');
    }
    const { hash, ...body } = event;
    if (!safeEqualHash(hashAuditChainEvent(body), hash)) {
      return failure(event, 'CONTENT_HASH_MISMATCH');
    }
    heads.set(event.tenantId, { sequence: event.sequence, hash });
  }
  return { valid: true };
}

function validateEvent(event: AuditChainEvent): void {
  validateBody(event);
  if (!validHash(event.hash)) throw new Error('invalid event hash');
}

function validateBody(body: AuditChainEventBody): void {
  const strings = [
    body.tenantId,
    body.eventId,
    body.eventType,
    body.objectReference.type,
    body.objectReference.id,
    body.actor.subjectId,
    body.purpose,
    body.reason,
    body.correlationId,
    ...body.evidenceRefs,
  ];
  if (
    strings.some((value) => !stable(value))
    || body.evidenceRefs.length === 0
    || !Number.isInteger(body.sequence)
    || body.sequence < 1
    || !validInstant(body.occurredAt)
    || !validInstant(body.recordedAt)
    || Date.parse(body.recordedAt) < Date.parse(body.occurredAt)
    || !validHash(body.previousHash)
  ) {
    throw new Error('invalid audit chain event');
  }
  canonical(body.details);
}

function canonical(value: AuditJson | AuditChainEventBody): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite audit number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((entry) => canonical(entry)).join(',') + ']';
  }
  if (typeof value !== 'object') throw new Error('non-JSON audit value');

  const record = value as Readonly<Record<string, AuditJson>>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map((key) => {
    const child = record[key];
    if (child === undefined) throw new Error('undefined audit value');
    return JSON.stringify(key) + ':' + canonical(child);
  }).join(',') + '}';
}

function failure(
  event: AuditChainEvent,
  reason: AuditChainFailureReason,
): AuditChainVerification {
  return {
    valid: false,
    tenantId: event.tenantId,
    sequence: event.sequence,
    reason,
  };
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function validInstant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function safeEqualHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export * from './sensitive-read.ts';
export * from './authorization-sink.ts';
