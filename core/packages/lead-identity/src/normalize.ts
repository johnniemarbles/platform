/**
 * Deterministic identity normalization. Pure and unit-tested. These produce the
 * *match keys* the dedup engine compares on — never a rewrite of the stored raw
 * value. Rules are intentionally conservative: lowercase/trim/strip only, no
 * provider-specific tricks (gmail dots, plus-tags), so a "match" is defensible
 * and never silently collapses distinct people.
 */

export class IdentityNormalizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IdentityNormalizationError';
    this.code = code;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Lowercased, trimmed email. The exact-match key for AUTO_LINK. */
export function normalizeEmailKey(email: unknown): string {
  if (typeof email !== 'string') throw new IdentityNormalizationError('EMAIL_REQUIRED', 'An email is required.');
  const value = email.trim().toLowerCase();
  if (value === '' || value.length > 320 || !EMAIL.test(value)) {
    throw new IdentityNormalizationError('EMAIL_INVALID', 'The email is not a valid address.');
  }
  return value;
}

/**
 * Digits-only phone key, preserving a leading `+`. Returns null when there is no
 * usable phone. This is a match key, not full E.164 validation — canonical
 * country resolution is deliberately out of scope to avoid guessing.
 */
export function normalizePhoneKey(phone: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (trimmed === '') return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${hasPlus ? '+' : ''}${digits}`;
}

/**
 * A name key: lowercased tokens, sorted and de-duplicated, so "Ada Lovelace"
 * and "Lovelace, Ada" key alike. Returns null when there is no usable name.
 */
export function normalizeNameKey(first: unknown, last: unknown): string | null {
  const parts: string[] = [];
  for (const raw of [first, last]) {
    if (typeof raw !== 'string') continue;
    for (const token of raw.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/u)) {
      if (token !== '') parts.push(token);
    }
  }
  if (parts.length === 0) return null;
  return [...new Set(parts)].sort().join(' ');
}
