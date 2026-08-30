/**
 * @platform-core/domain-events — horizontal, versioned business-event envelope.
 *
 * Domain events describe facts that already happened to an aggregate. They are
 * immutable records. Delivery state belongs to the transactional outbox, not
 * to this envelope.
 */

export type DomainEventJsonObject = Readonly<Record<string, unknown>>;

export interface DomainEventEnvelope {
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly actorSubjectId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly packKey: string | null;
  readonly packVersion: number | null;
  readonly payload: DomainEventJsonObject;
  readonly metadata: DomainEventJsonObject;
}

export interface DomainEventInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: Date;
  readonly recordedAt?: Date;
  readonly actorSubjectId: string;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly packKey?: string | null;
  readonly packVersion?: number | null;
  readonly payload?: DomainEventJsonObject;
  readonly metadata?: DomainEventJsonObject;
}

export class DomainEventValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainEventValidationError';
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_FIELD_REQUIRED',
      `${field} must not be blank.`,
    );
  }
  return normalized;
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_DATE_INVALID',
      `${field} must be a valid date.`,
    );
  }
  return value;
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

export function createDomainEvent(input: DomainEventInput): DomainEventEnvelope {
  if (!UUID.test(input.eventId.trim())) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_ID_INVALID',
      'eventId must be a UUID.',
    );
  }
  if (!UUID.test(input.tenantId.trim())) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_TENANT_ID_INVALID',
      'tenantId must be a UUID.',
    );
  }
  if (!Number.isInteger(input.eventVersion) || input.eventVersion <= 0) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_VERSION_INVALID',
      'eventVersion must be a positive integer.',
    );
  }

  const packKey = optionalText(input.packKey);
  const packVersion = input.packVersion ?? null;
  if (packVersion !== null && (!Number.isInteger(packVersion) || packVersion <= 0)) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_PACK_VERSION_INVALID',
      'packVersion must be a positive integer when supplied.',
    );
  }
  if (packVersion !== null && packKey === null) {
    throw new DomainEventValidationError(
      'DOMAIN_EVENT_PACK_KEY_REQUIRED',
      'packKey is required when packVersion is supplied.',
    );
  }

  return {
    eventId: required(input.eventId, 'eventId'),
    tenantId: required(input.tenantId, 'tenantId'),
    aggregateType: required(input.aggregateType, 'aggregateType'),
    aggregateId: required(input.aggregateId, 'aggregateId'),
    eventType: required(input.eventType, 'eventType'),
    eventVersion: input.eventVersion,
    occurredAt: validDate(input.occurredAt, 'occurredAt'),
    recordedAt: validDate(input.recordedAt ?? new Date(), 'recordedAt'),
    actorSubjectId: required(input.actorSubjectId, 'actorSubjectId'),
    correlationId: required(input.correlationId, 'correlationId'),
    causationId: optionalText(input.causationId),
    packKey,
    packVersion,
    payload: input.payload ?? {},
    metadata: input.metadata ?? {},
  };
}
