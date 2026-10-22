import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIT_CHAIN_GENESIS,
  createAuditChainEvent,
  verifyAuditChain,
  type AuditChainEvent,
  type AuditChainEventBody,
} from '../src/index.ts';

function event(
  tenantId: string,
  sequence: number,
  previousHash: string,
  details: { readonly state: string },
): AuditChainEvent {
  return createAuditChainEvent({
    tenantId,
    sequence,
    eventId: `${tenantId}-event-${sequence}`,
    eventType: 'WORKFLOW_TRANSITION',
    objectReference: { type: 'case', id: `${tenantId}-case-1` },
    actor: { kind: 'HUMAN', subjectId: 'subject-1' },
    purpose: 'Verify regulated workflow history.',
    reason: 'Approved transition.',
    occurredAt: `2026-08-26T00:00:0${sequence}.000Z`,
    recordedAt: `2026-08-26T00:00:0${sequence}.100Z`,
    correlationId: `${tenantId}-correlation-1`,
    evidenceRefs: ['decision://1'],
    details,
    previousHash,
  });
}

function chain(tenantId = 'tenant-1'): readonly AuditChainEvent[] {
  const first = event(tenantId, 1, AUDIT_CHAIN_GENESIS, { state: 'OPEN' });
  const second = event(tenantId, 2, first.hash, { state: 'APPROVED' });
  const third = event(tenantId, 3, second.hash, { state: 'ACTIVE' });
  return [first, second, third];
}

function bodyOf(eventValue: AuditChainEvent): AuditChainEventBody {
  return Object.fromEntries(
    Object.entries(eventValue).filter(([key]) => key !== 'hash'),
  ) as unknown as AuditChainEventBody;
}

test('verifies an untampered tenant-local chain', () => {
  assert.deepEqual(verifyAuditChain(chain()), { valid: true });
});

test('canonical hashing ignores object insertion order', () => {
  const body = bodyOf(chain()[0]!);
  const first = createAuditChainEvent({
    ...body,
    details: { alpha: 'a', beta: 'b' },
  });
  const second = createAuditChainEvent({
    ...body,
    details: { beta: 'b', alpha: 'a' },
  });

  assert.equal(first.hash, second.hash);
});

test('detects edited event content', () => {
  const events = structuredClone(chain());
  events[1] = {
    ...events[1]!,
    details: { state: 'FRAUDULENTLY_APPROVED' },
  };

  assert.deepEqual(verifyAuditChain(events), {
    valid: false,
    tenantId: 'tenant-1',
    sequence: 2,
    reason: 'CONTENT_HASH_MISMATCH',
  });
});

test('detects removed and reordered events', () => {
  const removed = structuredClone(chain());
  removed.splice(1, 1);
  assert.equal(verifyAuditChain(removed).valid, false);

  const reordered = structuredClone(chain());
  [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
  assert.equal(verifyAuditChain(reordered).valid, false);
});

test('verifies independently interleaved tenant chains', () => {
  const left = chain('tenant-left');
  const right = chain('tenant-right');

  assert.deepEqual(
    verifyAuditChain([
      left[0]!, right[0]!, left[1]!, right[1]!, left[2]!, right[2]!,
    ]),
    { valid: true },
  );
});
