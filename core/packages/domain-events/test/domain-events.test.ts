import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DomainEventValidationError,
  createDomainEvent,
} from '../src/index.ts';

test('canonical event envelope preserves correlation, causation, and Pack provenance', () => {
  const occurredAt = new Date('2026-08-30T08:00:00.000Z');
  const recordedAt = new Date('2026-08-30T08:00:01.000Z');
  const event = createDomainEvent({
    eventId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    aggregateType: 'crm.case',
    aggregateId: 'treatment-1',
    eventType: 'Treatment.StageChanged',
    eventVersion: 1,
    occurredAt,
    recordedAt,
    actorSubjectId: 'dentist-1',
    correlationId: 'correlation-1',
    causationId: 'command-1',
    packKey: 'dentex',
    packVersion: 2,
    payload: { fromStage: 'INTAKE', toStage: 'IN_PROGRESS' },
    metadata: { source: 'workflow' },
  });

  assert.equal(event.correlationId, 'correlation-1');
  assert.equal(event.causationId, 'command-1');
  assert.equal(event.packKey, 'dentex');
  assert.equal(event.packVersion, 2);
  assert.deepEqual(event.payload, {
    fromStage: 'INTAKE',
    toStage: 'IN_PROGRESS',
  });
});

test('event version and Pack provenance fail closed', () => {
  assert.throws(
    () => createDomainEvent({
      eventId: '22222222-2222-4222-8222-222222222222',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      aggregateType: 'crm.case',
      aggregateId: 'treatment-1',
      eventType: 'Treatment.StageChanged',
      eventVersion: 0,
      occurredAt: new Date(),
      actorSubjectId: 'actor-1',
      correlationId: 'correlation-1',
    }),
    (error) =>
      error instanceof DomainEventValidationError
      && error.code === 'DOMAIN_EVENT_VERSION_INVALID',
  );

  assert.throws(
    () => createDomainEvent({
      eventId: '33333333-3333-4333-8333-333333333333',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      aggregateType: 'crm.case',
      aggregateId: 'treatment-1',
      eventType: 'Treatment.StageChanged',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: 'actor-1',
      correlationId: 'correlation-1',
      packVersion: 1,
    }),
    /packKey is required/,
  );
});
