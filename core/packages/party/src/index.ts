/**
 * @platform-core/party — the seed of the universal BEMP business engine.
 *
 * Industry-neutral customer-relationship primitives: an Account (a customer
 * organization) and a Contact (a person, optionally attached to an account).
 * These sit on top of tenancy + authorization + business-config; the domain is
 * pure (types + validation + normalization) with no persistence or transport,
 * so a platform-web route or any future experience can adopt it unchanged.
 *
 * Vocabulary (Account/Contact/stage labels) is presentation configuration
 * supplied by business-config Industry Packs; the engine stays neutral.
 */

export const ACCOUNT_LIFECYCLE_STAGES = [
  'PROSPECT',
  'LEAD',
  'OPPORTUNITY',
  'CUSTOMER',
  'CHURNED',
] as const;
export type AccountLifecycleStage = (typeof ACCOUNT_LIFECYCLE_STAGES)[number];

export const PARTY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const CONTACT_STATUSES = ['ACTIVE', 'UNSUBSCRIBED', 'ARCHIVED'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface CrmAccount {
  readonly accountId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
  readonly name: string;
  readonly domain: string | null;
  readonly industry: string | null;
  readonly lifecycleStage: AccountLifecycleStage;
  readonly status: PartyStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrmContact {
  readonly contactId: string;
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly status: ContactStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidatedAccountInput {
  readonly name: string;
  readonly domain: string | null;
  readonly industry: string | null;
  readonly lifecycleStage: AccountLifecycleStage;
}

export interface ValidatedContactInput {
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly accountId: string | null;
}

export class PartyValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'PartyValidationError';
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately permissive but structurally real; the send path re-validates.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A registrable domain, lower-cased. Rejects a full email or a URL.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s === '' ? null : s;
}

export function validateAccountInput(body: unknown): ValidatedAccountInput {
  const record = (body ?? {}) as Record<string, unknown>;
  const name = str(record.name);
  if (name === '' || name.length > 200) {
    throw new PartyValidationError('name', 'An account name of 1–200 characters is required.');
  }
  const domain = optionalStr(record.domain)?.toLowerCase() ?? null;
  if (domain !== null && !DOMAIN.test(domain)) {
    throw new PartyValidationError('domain', 'Enter a bare domain such as acme.com, or leave it blank.');
  }
  const industry = optionalStr(record.industry);
  const stageRaw = str(record.lifecycleStage).toUpperCase() || 'PROSPECT';
  if (!ACCOUNT_LIFECYCLE_STAGES.includes(stageRaw as AccountLifecycleStage)) {
    throw new PartyValidationError('lifecycleStage', `Unknown lifecycle stage. Expected one of: ${ACCOUNT_LIFECYCLE_STAGES.join(', ')}.`);
  }
  return { name, domain, industry, lifecycleStage: stageRaw as AccountLifecycleStage };
}

export function validateContactInput(body: unknown): ValidatedContactInput {
  const record = (body ?? {}) as Record<string, unknown>;
  const fullName = str(record.fullName);
  if (fullName === '' || fullName.length > 200) {
    throw new PartyValidationError('fullName', 'A contact name of 1–200 characters is required.');
  }
  const email = optionalStr(record.email)?.toLowerCase() ?? null;
  if (email !== null && !EMAIL.test(email)) {
    throw new PartyValidationError('email', 'Enter a valid email address, or leave it blank.');
  }
  const phone = optionalStr(record.phone);
  const title = optionalStr(record.title);
  const accountId = optionalStr(record.accountId);
  if (accountId !== null && !UUID.test(accountId)) {
    throw new PartyValidationError('accountId', 'accountId must be a valid identifier.');
  }
  // A contact carries at least one way to reach or identify it beyond a name.
  if (email === null && phone === null && accountId === null) {
    throw new PartyValidationError('contact', 'A contact needs an email, a phone number, or an account to attach to.');
  }
  return { fullName, email, phone, title, accountId };
}
