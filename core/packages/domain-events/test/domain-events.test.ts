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
    aggregateId: 'service-request-1',
    eventType: 'ServiceRequest.StageChanged',
    eventVersion: 1,
    occurredAt,
    recordedAt,
    actorSubjectId: 'agent-1',
    correlationId: 'correlation-1',
    causationId: 'command-1',
    packKey: 'acme-corp',
    packVersion: 2,
    payload: { fromStage: 'INTAKE', toStage: 'IN_PROGRESS' },
    metadata: { source: 'workflow' },
  });

  assert.equal(event.correlationId, 'correlation-1');
  assert.equal(event.causationId, 'command-1');
  assert.equal(event.packKey, 'acme-corp');
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


test('tenant ids use PostgreSQL UUID semantics, including the seeded EXPADIO tenant', () => {
  const event = createDomainEvent({
    eventId: '44444444-4444-4444-8444-444444444444',
    tenantId: '00000000-0000-0000-0000-000000000001',
    aggregateType: 'tenant.access',
    aggregateId: 'inv_test',
    eventType: 'tenant.membership.invited',
    eventVersion: 1,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
    actorSubjectId: 'platform-admin',
    correlationId: 'correlation-postgres-uuid',
  });
  assert.equal(event.tenantId, '00000000-0000-0000-0000-000000000001');

  assert.throws(
    () => createDomainEvent({
      eventId: '55555555-5555-4555-8555-555555555555',
      tenantId: '00000000-0000-0000-0000-00000000000z',
      aggregateType: 'tenant.access',
      aggregateId: 'inv_test',
      eventType: 'tenant.membership.invited',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: 'platform-admin',
      correlationId: 'correlation-invalid-tenant',
    }),
    (error) =>
      error instanceof DomainEventValidationError
      && error.code === 'DOMAIN_EVENT_TENANT_ID_INVALID',
  );
});

test('event ids remain strict generated UUIDs even though tenant ids follow PostgreSQL semantics', () => {
  assert.throws(
    () => createDomainEvent({
      eventId: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000001',
      aggregateType: 'tenant.access',
      aggregateId: 'inv_test',
      eventType: 'tenant.membership.invited',
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: 'platform-admin',
      correlationId: 'correlation-strict-event-id',
    }),
    (error) =>
      error instanceof DomainEventValidationError
      && error.code === 'DOMAIN_EVENT_ID_INVALID',
  );
});
