/**
 * WO-GTM-A — normalize and validate sequence touch payloads.
 * Pure. No DB. No send.
 */

import { ALLOWED_SLOTS, SequenceRenderError } from './index.ts';

export interface SequenceTouchInput {
  readonly stepKey?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly delayDays?: number;
}

export interface NormalizedSequenceTouch {
  readonly stepKey: string;
  readonly subject: string;
  readonly body: string;
  readonly delayDays: number;
}

const SLOT_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Collect {{slot}} names used in a template string. */
export function listSlotsInTemplate(template: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(SLOT_RE.source, 'g');
  while ((m = re.exec(template)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

/** Reject unknown {{slots}}; known slots may be empty at draft time. */
export function assertKnownSlotsOnly(template: string, label: string): void {
  for (const name of listSlotsInTemplate(template)) {
    if (!(ALLOWED_SLOTS as readonly string[]).includes(name)) {
      throw new SequenceRenderError(`${label}: unknown slot {{${name}}}`);
    }
  }
}

export interface NormalizeTouchesResult {
  readonly ok: true;
  readonly touches: readonly NormalizedSequenceTouch[];
}

export interface NormalizeTouchesError {
  readonly ok: false;
  readonly error: string;
}

const MAX_TOUCHES = 12;

/**
 * Coerce API body touches into ordered touch_1…touch_N with validated slots.
 */
export function normalizeSequenceTouches(
  raw: unknown,
): NormalizeTouchesResult | NormalizeTouchesError {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'At least one touch (subject + body) is required.' };
  }
  if (raw.length > MAX_TOUCHES) {
    return { ok: false, error: `At most ${MAX_TOUCHES} touches allowed.` };
  }

  const touches: NormalizedSequenceTouch[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as SequenceTouchInput | null;
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Touch ${i + 1} is invalid.` };
    }
    const subject = typeof item.subject === 'string' ? item.subject.trim() : '';
    const body = typeof item.body === 'string' ? item.body.trim() : '';
    if (!subject || !body) {
      return { ok: false, error: `Touch ${i + 1} requires non-empty subject and body.` };
    }
    if (subject.length > 500) {
      return { ok: false, error: `Touch ${i + 1} subject exceeds 500 characters.` };
    }
    if (body.length > 20_000) {
      return { ok: false, error: `Touch ${i + 1} body exceeds 20 000 characters.` };
    }
    try {
      assertKnownSlotsOnly(subject, `Touch ${i + 1} subject`);
      assertKnownSlotsOnly(body, `Touch ${i + 1} body`);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : `Touch ${i + 1} has invalid slots.`,
      };
    }
    const delayRaw = item.delayDays;
    const delayDays =
      typeof delayRaw === 'number' && Number.isFinite(delayRaw) && delayRaw >= 0
        ? Math.min(Math.floor(delayRaw), 365)
        : i === 0
          ? 0
          : 3;
    touches.push({
      stepKey: `touch_${i + 1}`,
      subject,
      body,
      delayDays,
    });
  }

  return { ok: true, touches };
}
