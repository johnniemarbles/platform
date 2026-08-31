/**
 * AutoGTM domain engines on EXPADIO.
 * Pure functions. No lab adapter. No send. No auto-approve.
 */

export const OUTBOUND_GTM_SOURCE = 'outbound_gtm' as const;
export const PROTECTED_FIT_ATTRIBUTES = [
  'race', 'ethnicity', 'religion', 'gender', 'sex', 'age', 'disability',
  'nationalOrigin', 'sexualOrientation', 'maritalStatus', 'pregnancy',
] as const;

export type ReplyClass =
  | 'interested'
  | 'meeting_requested'
  | 'not_now'
  | 'not_a_fit'
  | 'unsubscribe'
  | 'out_of_office'
  | 'bounce'
  | 'unknown';

export interface FitComponent {
  readonly key: string;
  readonly points: number;
  readonly reason: string;
}

export interface FitScoreInput {
  readonly industry?: string;
  readonly geography?: string;
  readonly companySize?: string;
  readonly title?: string;
  readonly seniority?: string;
  readonly hasValidatedEmail?: boolean;
  readonly hasCommercialDomain?: boolean;
  readonly disqualifierHit?: string;
  readonly extra?: Record<string, unknown>;
}

export interface IcpFitTarget {
  readonly industries: readonly string[];
  readonly geographies: readonly string[];
  readonly companySizeHints: readonly string[];
  readonly titleHints: readonly string[];
  readonly seniorityHints: readonly string[];
  readonly disqualifiers: readonly string[];
}

export interface FitScoreResult {
  readonly total: number;
  readonly band: 'POOR' | 'FAIR' | 'GOOD' | 'STRONG' | 'DISQUALIFIED';
  readonly version: 'gtm-fit-v1';
  readonly components: FitComponent[];
}

const PROTECTED_TOKENS = new Set(
  PROTECTED_FIT_ATTRIBUTES.map((a) => a.toLowerCase()).concat([
    'nationality', 'nationalorigin', 'sexualorientation', 'maritalstatus',
  ]),
);

function tokens(key: string): string[] {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function assertNoProtectedInputs(keys: string[]): void {
  for (const key of keys) {
    for (const token of tokens(key)) {
      if (PROTECTED_TOKENS.has(token)) {
        throw new Error(`protected attribute not allowed in scoring: ${key}`);
      }
    }
  }
}

function includesLoose(haystack: readonly string[], needle?: string): boolean {
  if (!needle) return false;
  const n = needle.toLowerCase();
  return haystack.some((h) => n.includes(h.toLowerCase()) || h.toLowerCase().includes(n));
}

export function bandFor(total: number): FitScoreResult['band'] {
  if (total < 0) return 'DISQUALIFIED';
  if (total >= 80) return 'STRONG';
  if (total >= 60) return 'GOOD';
  if (total >= 40) return 'FAIR';
  return 'POOR';
}

export function scoreFit(input: FitScoreInput, icp: IcpFitTarget): FitScoreResult {
  assertNoProtectedInputs([...Object.keys(input), ...Object.keys(input.extra ?? {})]);
  if (input.disqualifierHit) {
    return {
      total: 0,
      band: 'DISQUALIFIED',
      version: 'gtm-fit-v1',
      components: [{ key: 'disqualifier', points: 0, reason: `hit disqualifier: ${input.disqualifierHit}` }],
    };
  }
  const hay = `${input.title ?? ''} ${input.seniority ?? ''}`.toLowerCase();
  const dq = icp.disqualifiers.find((d) => hay.includes(d.toLowerCase()));
  if (dq) {
    return {
      total: 0,
      band: 'DISQUALIFIED',
      version: 'gtm-fit-v1',
      components: [{ key: 'disqualifier', points: 0, reason: `persona matched disqualifier: ${dq}` }],
    };
  }
  const components: FitComponent[] = [];
  const add = (key: string, points: number, reason: string, cond: boolean) => {
    if (cond) components.push({ key, points, reason });
  };
  add('industry', 25, `industry ${input.industry} matches ICP`, includesLoose(icp.industries, input.industry));
  add('geography', 20, `geography ${input.geography} matches ICP`, includesLoose(icp.geographies, input.geography));
  add('companySize', 15, `size ${input.companySize} matches ICP`, includesLoose(icp.companySizeHints, input.companySize));
  add('title', 20, `title ${input.title} matches persona`, includesLoose(icp.titleHints, input.title));
  add('seniority', 10, `seniority ${input.seniority} matches persona`, includesLoose(icp.seniorityHints, input.seniority));
  add('validatedEmail', 5, 'validated email present', Boolean(input.hasValidatedEmail));
  add('commercialDomain', 5, 'commercial domain present', Boolean(input.hasCommercialDomain));
  const total = components.reduce((s, c) => s + c.points, 0);
  return { total, band: bandFor(total), version: 'gtm-fit-v1', components };
}

export function scoringMayAutoApprove(): false {
  return false;
}

const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i;
const META_RE = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i;
const H1_RE = /<h1[^>]*>([^<]+)<\/h1>/i;

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function guessIndustries(text: string): string[] {
  const hay = text.toLowerCase();
  const hits: string[] = [];
  if (/(saas|software|platform|workflow)/.test(hay)) hits.push('software');
  if (/(manufactur|industrial|factory)/.test(hay)) hits.push('manufacturing');
  if (/(health|clinic|hospital|patient)/.test(hay)) hits.push('healthcare');
  if (/(financ|bank|payment|lending)/.test(hay)) hits.push('financial-services');
  if (/(logistics|freight|supply chain)/.test(hay)) hits.push('logistics');
  return hits.length ? hits : ['software'];
}

export interface BrandDossier {
  readonly sourceUrl: string;
  readonly name: string;
  readonly offeringSummary: string;
  readonly industries: readonly string[];
  readonly geographies: readonly string[];
}

export function extractBrandFromSite(input: { readonly sourceUrl: string; readonly html?: string }): BrandDossier {
  const html = input.html ?? `<title>${new URL(input.sourceUrl).hostname}</title>`;
  const title = TITLE_RE.exec(html)?.[1]?.trim() ?? new URL(input.sourceUrl).hostname;
  const meta = META_RE.exec(html)?.[1]?.trim();
  const h1 = H1_RE.exec(html)?.[1]?.trim();
  const text = stripTags(html);
  const offering = meta ?? h1 ?? text.slice(0, 280) ?? title;
  return {
    sourceUrl: input.sourceUrl,
    name: title.slice(0, 120),
    offeringSummary: offering.slice(0, 600),
    industries: guessIndustries(`${title} ${offering} ${text}`),
    geographies: ['global'],
  };
}

export const ALLOWED_SLOTS = [
  'firstName', 'fullName', 'title', 'company', 'domain', 'offerLine', 'senderName', 'senderTitle',
] as const;
export type SlotName = (typeof ALLOWED_SLOTS)[number];
export type SlotValues = Partial<Record<SlotName, string>>;

const SLOT_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export class SequenceRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SequenceRenderError';
  }
}

export function renderTemplate(template: string, slots: SlotValues): string {
  return template.replace(SLOT_RE, (_, name: string) => {
    if (!(ALLOWED_SLOTS as readonly string[]).includes(name)) {
      throw new SequenceRenderError(`unknown slot {{${name}}}`);
    }
    const value = slots[name as SlotName];
    if (!value || !value.trim()) throw new SequenceRenderError(`missing slot {{${name}}}`);
    return value.trim();
  });
}

const REPLY_RULES: ReadonlyArray<{ cls: ReplyClass; confidence: number; pattern: RegExp }> = [
  { cls: 'unsubscribe', confidence: 0.95, pattern: /\b(unsubscribe|remove me|stop emailing|opt[ -]?out)\b/i },
  { cls: 'bounce', confidence: 0.9, pattern: /\b(undeliverable|mailbox unavailable|user unknown)\b/i },
  { cls: 'out_of_office', confidence: 0.9, pattern: /\b(out of (the )?office|automatic reply)\b/i },
  { cls: 'meeting_requested', confidence: 0.8, pattern: /\b(book|calendar|let'?s meet|does Thursday work|hold 20 min)\b/i },
  { cls: 'interested', confidence: 0.75, pattern: /\b(interested|tell me more|send (the )?deck)\b/i },
  { cls: 'not_a_fit', confidence: 0.8, pattern: /\b(not a fit|wrong person|no budget)\b/i },
  { cls: 'not_now', confidence: 0.7, pattern: /\b(not now|next quarter|too early)\b/i },
];

export function classifyReplyText(rawBody: string): { proposedClass: ReplyClass; confidence: number } {
  const text = rawBody.trim();
  if (!text) return { proposedClass: 'unknown', confidence: 0 };
  for (const rule of REPLY_RULES) {
    if (rule.pattern.test(text)) return { proposedClass: rule.cls, confidence: rule.confidence };
  }
  return { proposedClass: 'unknown', confidence: 0.2 };
}

export function shouldConvertReplyToLead(cls: ReplyClass): boolean {
  return cls === 'interested' || cls === 'meeting_requested';
}

export function proposeOptimization(input: {
  readonly sent: number;
  readonly replied: number;
  readonly meetings: number;
  readonly unsubscribed: number;
  readonly minSends?: number;
}): { action: 'pause_segment' | 'scale_segment' | 'retire_sequence'; reason: string } | null {
  const minSends = input.minSends ?? 30;
  if (input.sent < minSends) return null;
  const unsubRate = input.unsubscribed / input.sent;
  const replyRate = input.replied / input.sent;
  const meetingRate = input.meetings / input.sent;
  if (unsubRate >= 0.02) {
    return {
      action: unsubRate >= 0.05 ? 'retire_sequence' : 'pause_segment',
      reason: `unsubscribe rate ${(unsubRate * 100).toFixed(2)}% exceeds 2%`,
    };
  }
  if (meetingRate >= 0.03 && replyRate >= 0.04) {
    return { action: 'scale_segment', reason: `meeting rate ${(meetingRate * 100).toFixed(2)}%` };
  }
  return null;
}
