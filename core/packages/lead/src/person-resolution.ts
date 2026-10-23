/**
 * One person spine for demand inlets.
 * Capture, GTM replies, email, voice, and social events call this before
 * inserting platform.crm_leads. This module does not write SQL.
 */

export const DEMAND_INLETS = [
  'manual',
  'web_form',
  'meta_leadgen',
  'outbound_gtm',
  'email',
  'voice',
  'social_dm',
] as const;
export type DemandInlet = (typeof DEMAND_INLETS)[number];

export interface PersonMatchKeys {
  readonly email: string | null;
  readonly phone: string | null;
  readonly socialUserId: string | null;
}

export interface OpenLeadCandidate {
  readonly leadId: string;
  readonly stage: string;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly socialUserId: string | null;
}

export type PersonResolution =
  | { readonly action: 'reuse'; readonly leadId: string; readonly matchedOn: 'email' | 'phone' | 'social' }
  | { readonly action: 'open-new'; readonly reason: 'NO_OPEN_MATCH' }
  | { readonly action: 'ambiguous'; readonly leadIds: readonly string[]; readonly reason: 'CONFLICTING_OPEN_LEADS' };

const E164 = /^\+[1-9]\d{7,14}$/u;

export function normalizePersonMatchKeys(input: {
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly socialUserId?: string | null;
}): PersonMatchKeys {
  const emailRaw = (input.email ?? '').trim().toLowerCase();
  const email = emailRaw.includes('@') && !emailRaw.includes(' ') ? emailRaw : null;
  const phoneRaw = (input.phone ?? '').trim().replace(/[\s()-]/g, '');
  const phone = E164.test(phoneRaw) ? phoneRaw : null;
  const social = (input.socialUserId ?? '').trim();
  return {
    email,
    phone,
    socialUserId: social === '' ? null : social,
  };
}

const OPEN_STAGES = new Set(['NEW', 'QUALIFIED', 'PROPOSAL']);

export function resolveOpenLead(
  keys: PersonMatchKeys,
  candidates: readonly OpenLeadCandidate[],
): PersonResolution {
  const open = candidates.filter((row) => OPEN_STAGES.has(row.stage));
  const emailHits = keys.email === null
    ? []
    : open.filter((row) => (row.contactEmail ?? '').trim().toLowerCase() === keys.email);
  const phoneHits = keys.phone === null
    ? []
    : open.filter((row) => (row.contactPhone ?? '').trim() === keys.phone);
  const socialHits = keys.socialUserId === null
    ? []
    : open.filter((row) => (row.socialUserId ?? '').trim() === keys.socialUserId);

  const ranked: Array<{ leadId: string; matchedOn: 'email' | 'phone' | 'social' }> = [
    ...emailHits.map((row) => ({ leadId: row.leadId, matchedOn: 'email' as const })),
    ...phoneHits.map((row) => ({ leadId: row.leadId, matchedOn: 'phone' as const })),
    ...socialHits.map((row) => ({ leadId: row.leadId, matchedOn: 'social' as const })),
  ];

  const uniqueIds = [...new Set(ranked.map((row) => row.leadId))];
  if (uniqueIds.length === 0) {
    return { action: 'open-new', reason: 'NO_OPEN_MATCH' };
  }
  if (uniqueIds.length > 1) {
    return { action: 'ambiguous', leadIds: uniqueIds, reason: 'CONFLICTING_OPEN_LEADS' };
  }
  return {
    action: 'reuse',
    leadId: uniqueIds[0] as string,
    matchedOn: ranked[0]?.matchedOn ?? 'email',
  };
}

export type CapturePromoteDecision = 'auto-convert' | 'review';

/**
 * Safe auto-convert only when identity + consent + not suppressed.
 * Meta / social / unverified email always review. Never silent CRM write.
 */
export function decideCapturePromote(input: {
  readonly inlet: DemandInlet;
  readonly emailVerified: boolean;
  readonly keys: PersonMatchKeys;
  readonly suppressed: boolean;
  readonly channelConsentOk: boolean;
}): CapturePromoteDecision {
  if (input.suppressed) return 'review';
  if (!input.channelConsentOk) return 'review';
  if (input.keys.email === null) return 'review';
  if (!input.emailVerified) return 'review';
  if (input.inlet === 'social_dm' || input.inlet === 'meta_leadgen') return 'review';
  return 'auto-convert';
}
