/**
 * Match-signal scoring and the safe classification rule.
 *
 * The single non-negotiable: only an exact normalized-email match ever auto-links
 * two identities. Every other signal (phone, name) routes to a human review
 * queue — never a silent fuzzy merge. Confidence is a transparent, deterministic
 * weighting so a reviewer can see exactly why a candidate surfaced.
 */

export interface ContactIdentity {
  readonly emailKey?: string | null;
  readonly phoneKey?: string | null;
  readonly nameKey?: string | null;
}

export interface MatchSignals {
  readonly emailExact: boolean;
  readonly phoneExact: boolean;
  readonly nameExact: boolean;
}

export type MatchDecision = 'AUTO_LINK' | 'REVIEW' | 'NONE';

export interface MatchResult {
  readonly signals: MatchSignals;
  readonly confidence: number;
  readonly decision: MatchDecision;
}

// Transparent weights. Email alone is decisive; nothing else is.
const WEIGHT = { email: 1, phone: 0.7, name: 0.4 } as const;

export function matchSignals(a: ContactIdentity, b: ContactIdentity): MatchSignals {
  const eq = (x?: string | null, y?: string | null) => !!x && !!y && x === y;
  return {
    emailExact: eq(a.emailKey, b.emailKey),
    phoneExact: eq(a.phoneKey, b.phoneKey),
    nameExact: eq(a.nameKey, b.nameKey),
  };
}

export function matchConfidence(signals: MatchSignals): number {
  if (signals.emailExact) return WEIGHT.email;
  const score = (signals.phoneExact ? WEIGHT.phone : 0) + (signals.nameExact ? WEIGHT.name : 0);
  return Math.min(1, Number(score.toFixed(4)));
}

/**
 * Exact email → AUTO_LINK. Any other signal → REVIEW (queued, never merged).
 * No signal → NONE. This function is the guardrail against unsafe auto-merge.
 */
export function classifyMatch(a: ContactIdentity, b: ContactIdentity): MatchResult {
  const signals = matchSignals(a, b);
  const confidence = matchConfidence(signals);
  let decision: MatchDecision = 'NONE';
  if (signals.emailExact) decision = 'AUTO_LINK';
  else if (signals.phoneExact || signals.nameExact) decision = 'REVIEW';
  return { signals, confidence, decision };
}
