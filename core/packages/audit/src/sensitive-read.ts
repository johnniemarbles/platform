export interface SensitiveReadRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requestedBySubjectId: string;
  readonly resourceReference: {
    readonly type: string;
    readonly id: string;
  };
  readonly purpose: string;
  readonly legalBasis: string;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface SensitiveReadDecision {
  readonly decisionId: string;
  readonly allowed: boolean;
  readonly reasonKey: string;
}

export interface SensitiveReadAuthorizer {
  authorize(request: SensitiveReadRequest & {
    readonly action: 'resource.sensitive.read';
  }): Promise<SensitiveReadDecision>;
}

export interface SensitiveReadObservation {
  readonly requestId: string;
  readonly tenantId: string;
  readonly resourceReference: SensitiveReadRequest['resourceReference'];
  readonly resultReference: string;
  readonly classifications: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly completedAt: string;
}

export interface SensitiveResourceLoader {
  load(input: {
    readonly request: SensitiveReadRequest;
    readonly authorizationDecisionId: string;
  }): Promise<SensitiveReadObservation>;
}

export type SensitiveReadOutcome = 'ALLOWED' | 'DENIED' | 'FAILED';

export interface SensitiveReadAuditEvent {
  readonly eventId: string;
  readonly request: SensitiveReadRequest;
  readonly authorizationDecisionId: string;
  readonly authorizationReasonKey: string;
  readonly outcome: SensitiveReadOutcome;
  readonly resultReference: string | null;
  readonly classifications: readonly string[];
  readonly sourceReferences: readonly string[];
  readonly failureReasonKey: string | null;
  readonly recordedAt: string;
}

export interface SensitiveReadAuditRepository {
  record(event: SensitiveReadAuditEvent): Promise<{
    readonly recorded: boolean;
    readonly event: SensitiveReadAuditEvent;
  }>;
}

export class GovernedSensitiveReadService {
  readonly #authorizer: SensitiveReadAuthorizer;
  readonly #loader: SensitiveResourceLoader;
  readonly #audit: SensitiveReadAuditRepository;
  readonly #eventId: () => string;
  readonly #clock: () => string;

  constructor(
    authorizer: SensitiveReadAuthorizer,
    loader: SensitiveResourceLoader,
    audit: SensitiveReadAuditRepository,
    eventId: () => string,
    clock: () => string,
  ) {
    this.#authorizer = authorizer;
    this.#loader = loader;
    this.#audit = audit;
    this.#eventId = eventId;
    this.#clock = clock;
  }

  async read(request: SensitiveReadRequest): Promise<SensitiveReadObservation> {
    validateRequest(request);
    const decision = await this.#authorizer.authorize({
      ...request,
      action: 'resource.sensitive.read',
    });
    stable(decision.decisionId);
    stable(decision.reasonKey);

    if (!decision.allowed) {
      await this.#record({
        eventId: this.#eventId(),
        request,
        authorizationDecisionId: decision.decisionId,
        authorizationReasonKey: decision.reasonKey,
        outcome: 'DENIED',
        resultReference: null,
        classifications: [],
        sourceReferences: [],
        failureReasonKey: decision.reasonKey,
        recordedAt: this.#clock(),
      });
      throw new Error('SENSITIVE_READ_DENIED:' + decision.reasonKey);
    }

    let observation: SensitiveReadObservation;
    try {
      observation = await this.#loader.load({
        request,
        authorizationDecisionId: decision.decisionId,
      });
      validateObservation(observation, request);
    } catch (error) {
      await this.#record({
        eventId: this.#eventId(),
        request,
        authorizationDecisionId: decision.decisionId,
        authorizationReasonKey: decision.reasonKey,
        outcome: 'FAILED',
        resultReference: null,
        classifications: [],
        sourceReferences: [],
        failureReasonKey: 'RESOURCE_LOAD_FAILED',
        recordedAt: this.#clock(),
      });
      throw error;
    }

    await this.#record({
      eventId: this.#eventId(),
      request,
      authorizationDecisionId: decision.decisionId,
      authorizationReasonKey: decision.reasonKey,
      outcome: 'ALLOWED',
      resultReference: observation.resultReference,
      classifications: [...observation.classifications],
      sourceReferences: [...observation.sourceReferences],
      failureReasonKey: null,
      recordedAt: this.#clock(),
    });
    return observation;
  }

  async #record(event: SensitiveReadAuditEvent): Promise<void> {
    const result = await this.#audit.record(event);
    if (
      result.event.eventId !== event.eventId
      || result.event.request.tenantId !== event.request.tenantId
      || result.event.request.requestId !== event.request.requestId
      || result.event.outcome !== event.outcome
    ) {
      throw new SensitiveReadAuditError('SENSITIVE_READ_AUDIT_MISMATCH');
    }
  }
}

class SensitiveReadAuditError extends Error {}

function validateRequest(request: SensitiveReadRequest): void {
  const values = [
    request.requestId,
    request.tenantId,
    request.requestedBySubjectId,
    request.resourceReference.type,
    request.resourceReference.id,
    request.purpose,
    request.legalBasis,
    request.correlationId,
    ...request.evidenceRefs,
  ];
  if (
    values.some((value) => !valid(value))
    || request.evidenceRefs.length === 0
    || !Number.isFinite(Date.parse(request.requestedAt))
  ) {
    throw new Error('SENSITIVE_READ_REQUEST_INVALID');
  }
}

function validateObservation(
  observation: SensitiveReadObservation,
  request: SensitiveReadRequest,
): void {
  const exact = observation.requestId === request.requestId
    && observation.tenantId === request.tenantId
    && observation.resourceReference.type === request.resourceReference.type
    && observation.resourceReference.id === request.resourceReference.id;
  const values = [
    observation.resultReference,
    ...observation.classifications,
    ...observation.sourceReferences,
  ];
  if (
    !exact
    || values.some((value) => !valid(value))
    || observation.classifications.length === 0
    || observation.sourceReferences.length === 0
    || !Number.isFinite(Date.parse(observation.completedAt))
  ) {
    throw new Error('SENSITIVE_READ_OBSERVATION_INVALID');
  }
}

function stable(value: string): void {
  if (!valid(value)) throw new Error('SENSITIVE_READ_DECISION_INVALID');
}

function valid(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

export function validateSensitiveReadAuditEvent(
  event: SensitiveReadAuditEvent,
): void {
  validateRequest(event.request);
  const values = [
    event.eventId,
    event.authorizationDecisionId,
    event.authorizationReasonKey,
  ];
  if (
    values.some((value) => !valid(value))
    || !Number.isFinite(Date.parse(event.recordedAt))
    || Date.parse(event.recordedAt) < Date.parse(event.request.requestedAt)
  ) {
    throw new Error('SENSITIVE_READ_AUDIT_EVENT_INVALID');
  }

  if (event.outcome === 'ALLOWED') {
    if (
      event.resultReference === null
      || !valid(event.resultReference)
      || event.classifications.length === 0
      || event.sourceReferences.length === 0
      || event.classifications.some((value) => !valid(value))
      || event.sourceReferences.some((value) => !valid(value))
      || event.failureReasonKey !== null
    ) {
      throw new Error('SENSITIVE_READ_AUDIT_EVENT_INVALID');
    }
  } else if (
    event.resultReference !== null
    || event.classifications.length !== 0
    || event.sourceReferences.length !== 0
    || event.failureReasonKey === null
    || !valid(event.failureReasonKey)
  ) {
    throw new Error('SENSITIVE_READ_AUDIT_EVENT_INVALID');
  }
}
