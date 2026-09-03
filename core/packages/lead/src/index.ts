/**
 * @platform-core/lead — the sales pipeline on top of @expadio/party.
 *
 * A Lead is a potential piece of business moving through governed stages,
 * optionally attached to an Account and/or Contact. Pure domain: types +
 * validation + the stage-transition rule that decides when a lead is closed.
 * Industry Packs relabel the stages; the engine stays neutral.
 *
 * AutoGTM warm replies ingest here as source=outbound_gtm with raw_payload first.
 * Inbound demand-capture converts here as source=web_form. Neither is a second CRM.
 * The 19-stage capture catalogue lives in the extract; this package stays 5-stage.
 */

export const LEAD_STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Terminal stages: the lead is closed and its amount is realized or lost. */
export const CLOSED_STAGES: readonly LeadStage[] = ['WON', 'LOST'];

export function isClosedStage(stage: LeadStage): boolean {
  return CLOSED_STAGES.includes(stage);
}

/** Accepted lead sources. outbound_gtm is AutoGTM. web_form is inbound demand-capture. */
export const LEAD_INGEST_SOURCES = ['manual', 'web_form', 'outbound_gtm'] as const;
export type LeadIngestSource = (typeof LEAD_INGEST_SOURCES)[number];
export const OUTBOUND_GTM_LEAD_SOURCE = 'outbound_gtm' as const;
export const DEMAND_CAPTURE_LEAD_SOURCE = 'web_form' as const;

export function isAcceptedLeadSource(source: string | null | undefined): source is LeadIngestSource {
  return source != null && (LEAD_INGEST_SOURCES as readonly string[]).includes(source);
}

export interface CrmLead {
  readonly leadId: string;
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly contactId: string | null;
  readonly title: string;
  readonly stage: LeadStage;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly rawPayload: Readonly<Record<string, unknown>>;
  readonly ownerSubjectId: string | null;
  readonly captureLeadId: string | null;
  readonly captureLayerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidatedLeadInput {
  readonly title: string;
  readonly stage: LeadStage;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly rawPayload: Readonly<Record<string, unknown>>;
  readonly accountId: string | null;
  readonly contactId: string | null;
  readonly captureLeadId: string | null;
  readonly captureLayerId: string | null;
}

export class LeadValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'LeadValidationError';
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s === '' ? null : s;
}
function optionalUuid(value: unknown, field: string): string | null {
  const s = optionalStr(value);
  if (s !== null && !UUID.test(s)) throw new LeadValidationError(field, `${field} must be a valid identifier.`);
  return s;
}

function rawPayload(value: unknown): Record<string, unknown> {
  if (value == null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LeadValidationError('rawPayload', 'raw_payload must be an object.');
  }
  return value as Record<string, unknown>;
}

export function validateLeadInput(body: unknown): ValidatedLeadInput {
  const record = (body ?? {}) as Record<string, unknown>;

  const title = str(record.title);
  if (title === '' || title.length > 200) {
    throw new LeadValidationError('title', 'A lead title of 1–200 characters is required.');
  }

  const stageRaw = str(record.stage).toUpperCase() || 'NEW';
  if (!LEAD_STAGES.includes(stageRaw as LeadStage)) {
    throw new LeadValidationError('stage', `Unknown stage. Expected one of: ${LEAD_STAGES.join(', ')}.`);
  }

  let amountMinorUnits: number | null = null;
  if (record.amountMinorUnits !== undefined && record.amountMinorUnits !== null && record.amountMinorUnits !== '') {
    const n = typeof record.amountMinorUnits === 'number' ? record.amountMinorUnits : Number(record.amountMinorUnits);
    if (!Number.isInteger(n) || n < 0) {
      throw new LeadValidationError('amountMinorUnits', 'Amount must be a whole number of minor units (e.g. cents), or blank.');
    }
    amountMinorUnits = n;
  }

  const currency = (str(record.currency).toUpperCase() || 'USD');
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new LeadValidationError('currency', 'Currency must be a 3-letter ISO code such as USD.');
  }

  const source = optionalStr(record.source);
  if (source !== null && !isAcceptedLeadSource(source)) {
    throw new LeadValidationError('source', `Unknown source. Expected one of: ${LEAD_INGEST_SOURCES.join(', ')}.`);
  }

  return {
    title,
    stage: stageRaw as LeadStage,
    amountMinorUnits,
    currency,
    source,
    rawPayload: rawPayload(record.rawPayload),
    accountId: optionalUuid(record.accountId, 'accountId'),
    contactId: optionalUuid(record.contactId, 'contactId'),
    captureLeadId: optionalUuid(record.captureLeadId, 'captureLeadId'),
    captureLayerId: optionalStr(record.captureLayerId),
  };
}

export function validateStage(value: unknown): LeadStage {
  const stageRaw = str(value).toUpperCase();
  if (!LEAD_STAGES.includes(stageRaw as LeadStage)) {
    throw new LeadValidationError('stage', `Unknown stage. Expected one of: ${LEAD_STAGES.join(', ')}.`);
  }
  return stageRaw as LeadStage;
}

/**
 * The 5-stage CRM transition graph. STANDARD moves are the expected forward
 * path; OVERRIDE moves (skips, backward steps, reopening a LOST lead) are allowed
 * only with a recorded reason; anything else — including leaving the terminal WON
 * stage — is ILLEGAL. This replaces "last writer wins" with governed transitions.
 */
const STANDARD_LEAD_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  NEW: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['PROPOSAL', 'LOST'],
  PROPOSAL: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};
const OVERRIDE_LEAD_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  NEW: ['PROPOSAL', 'WON'],
  QUALIFIED: ['NEW', 'WON'],
  PROPOSAL: ['QUALIFIED', 'NEW'],
  WON: [], // terminal: WON never transitions again
  LOST: ['NEW', 'QUALIFIED', 'PROPOSAL'], // reopen, with a reason
};

export type LeadTransitionKind = 'NOOP' | 'STANDARD' | 'OVERRIDE' | 'ILLEGAL';

export function classifyLeadTransition(from: LeadStage, to: LeadStage): LeadTransitionKind {
  if (from === to) return 'NOOP';
  if (STANDARD_LEAD_TRANSITIONS[from].includes(to)) return 'STANDARD';
  if (OVERRIDE_LEAD_TRANSITIONS[from].includes(to)) return 'OVERRIDE';
  return 'ILLEGAL';
}

/** OVERRIDE transitions demand an explicit reason for the audit trail. */
export function leadTransitionRequiresReason(kind: LeadTransitionKind): boolean {
  return kind === 'OVERRIDE';
}

/** 19-stage capture catalogue. Lives in the extract. Never stored on platform.crm_leads. */
export const CAPTURE_JOURNEY_STAGES = [
  'NEW_ENQUIRY',
  'CONTACT_ATTEMPTED',
  'CONTACTED',
  'QUALIFICATION',
  'QUALIFIED',
  'DISCOVERY_SCHEDULED',
  'DISCOVERY_COMPLETED',
  'OPPORTUNITY_EVALUATION',
  'APPLICATION_INVITED',
  'APPLICATION_STARTED',
  'APPLICATION_SUBMITTED',
  'DUE_DILIGENCE',
  'APPROVAL',
  'AGREEMENT',
  'ACTIVATION',
  'WON',
  'LOST',
  'DISQUALIFIED',
  'NURTURE',
] as const;
export type CaptureJourneyStage = (typeof CAPTURE_JOURNEY_STAGES)[number];

const PROPOSAL_CAPTURE_STAGES: ReadonlySet<string> = new Set([
  'APPLICATION_INVITED',
  'APPLICATION_STARTED',
  'APPLICATION_SUBMITTED',
  'DUE_DILIGENCE',
  'APPROVAL',
  'AGREEMENT',
  'ACTIVATION',
]);

const QUALIFIED_CAPTURE_STAGES: ReadonlySet<string> = new Set([
  'QUALIFIED',
  'DISCOVERY_SCHEDULED',
  'DISCOVERY_COMPLETED',
  'OPPORTUNITY_EVALUATION',
]);

export function isCaptureJourneyStage(value: string): value is CaptureJourneyStage {
  return (CAPTURE_JOURNEY_STAGES as readonly string[]).includes(value);
}

/** Map extract journey stage → thin CRM stage. Does not mutate the capture row (I8). */
export function mapCaptureStageToCrm(stage: string): LeadStage {
  if (stage === 'WON') return 'WON';
  if (stage === 'LOST' || stage === 'DISQUALIFIED') return 'LOST';
  if (PROPOSAL_CAPTURE_STAGES.has(stage)) return 'PROPOSAL';
  if (QUALIFIED_CAPTURE_STAGES.has(stage)) return 'QUALIFIED';
  return 'NEW';
}

export interface CaptureConvertSnapshot {
  readonly captureLeadId: string;
  readonly tenantId: string;
  readonly title?: string;
  readonly email?: string;
  readonly captureStage: string;
  readonly captureLayerId?: string;
  readonly contactId?: string;
  readonly accountId?: string;
  readonly ownerSubjectId?: string;
  readonly rawPayload?: Record<string, unknown>;
}

export interface CaptureConvertResult {
  readonly input: ValidatedLeadInput;
  readonly capturePreserved: true;
  readonly deleteCapture: false;
}

/**
 * Build a CRM insert from a capture snapshot.
 * I8: does not delete or rewrite the capture lead. Re-convert is the caller's
 * job via capture_lead_id uniqueness on platform.crm_leads.
 */
export function buildCrmLeadFromCapture(snapshot: CaptureConvertSnapshot): CaptureConvertResult {
  if (!UUID.test(snapshot.captureLeadId)) {
    throw new LeadValidationError('captureLeadId', 'captureLeadId must be a valid identifier.');
  }
  if (!isCaptureJourneyStage(snapshot.captureStage) && !LEAD_STAGES.includes(snapshot.captureStage as LeadStage)) {
    throw new LeadValidationError('captureStage', `Unknown capture stage: ${snapshot.captureStage}`);
  }
  const email = str(snapshot.email);
  const title =
    str(snapshot.title) ||
    (email ? `Inbound — ${email}`.slice(0, 200) : 'Inbound enquiry');
  const input = validateLeadInput({
    title,
    stage: mapCaptureStageToCrm(snapshot.captureStage),
    source: DEMAND_CAPTURE_LEAD_SOURCE,
    rawPayload: {
      ...(snapshot.rawPayload ?? {}),
      captureLeadId: snapshot.captureLeadId,
      captureStage: snapshot.captureStage,
      captureLayerId: snapshot.captureLayerId ?? null,
    },
    accountId: snapshot.accountId ?? null,
    contactId: snapshot.contactId ?? null,
    captureLeadId: snapshot.captureLeadId,
    captureLayerId: snapshot.captureLayerId ?? null,
  });
  return { input, capturePreserved: true, deleteCapture: false };
}

export * from './scoring.ts';
