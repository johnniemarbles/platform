/**
 * @platform-core/lead — the sales pipeline on top of @expadio/party.
 *
 * A Lead is a potential piece of business moving through governed stages,
 * optionally attached to an Account and/or Contact. Pure domain: types +
 * validation + the stage-transition rule that decides when a lead is closed.
 * Industry Packs relabel the stages; the engine stays neutral.
 */

export const LEAD_STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Terminal stages: the lead is closed and its amount is realized or lost. */
export const CLOSED_STAGES: readonly LeadStage[] = ['WON', 'LOST'];

export function isClosedStage(stage: LeadStage): boolean {
  return CLOSED_STAGES.includes(stage);
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
  readonly ownerSubjectId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidatedLeadInput {
  readonly title: string;
  readonly stage: LeadStage;
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly source: string | null;
  readonly accountId: string | null;
  readonly contactId: string | null;
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

  return {
    title,
    stage: stageRaw as LeadStage,
    amountMinorUnits,
    currency,
    source: optionalStr(record.source),
    accountId: optionalUuid(record.accountId, 'accountId'),
    contactId: optionalUuid(record.contactId, 'contactId'),
  };
}

export function validateStage(value: unknown): LeadStage {
  const stageRaw = str(value).toUpperCase();
  if (!LEAD_STAGES.includes(stageRaw as LeadStage)) {
    throw new LeadValidationError('stage', `Unknown stage. Expected one of: ${LEAD_STAGES.join(', ')}.`);
  }
  return stageRaw as LeadStage;
}
