/**
 * GTM enrollment state machine — pure domain.
 * Persistence and workers apply these transitions; this module never writes DB or sends mail.
 */

export const ENROLLMENT_STATUSES = [
  'active',
  'paused_by_system',
  'paused_by_user',
  'completed',
  'aborted',
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export type EnrollmentEvent =
  | { readonly type: 'SCHEDULING_CONFIRMED' | 'SCHEDULING_COMPLETED' }
  | { readonly type: 'SCHEDULING_CANCELLED' | 'SCHEDULING_NO_SHOW' }
  | { readonly type: 'USER_PAUSE' }
  | { readonly type: 'USER_RESUME' }
  | { readonly type: 'SEQUENCE_EXHAUSTED' | 'SEQUENCE_SUCCESS' }
  | { readonly type: 'UNSUBSCRIBE' | 'HARD_BOUNCE' | 'ABORT'; readonly reason?: string }
  | { readonly type: 'ADVANCE_STEP'; readonly nextNodeKey: string };

export interface EnrollmentSnapshot {
  readonly enrollmentStatus: EnrollmentStatus;
  readonly currentNodeKey: string | null;
  readonly pausedAt: string | null;
  readonly activeSalesCycleLocked?: boolean;
}

export interface EnrollmentTransitionResult {
  readonly ok: boolean;
  readonly next: EnrollmentSnapshot;
  readonly reason: string;
}

export interface EnrollmentDispatchCandidate extends EnrollmentSnapshot {
  readonly enrollmentId: string;
}

function snap(
  status: EnrollmentStatus,
  node: string | null,
  pausedAt: string | null,
  locked?: boolean,
): EnrollmentSnapshot {
  const s: any = {
    enrollmentStatus: status,
    currentNodeKey: node,
    pausedAt,
  };
  if (locked !== undefined) {
    s.activeSalesCycleLocked = locked;
  }
  return s as EnrollmentSnapshot;
}

/**
 * Default sequential cursor: touch_1 → touch_2 → …
 * Custom graphs should pass an explicit nextNodeKey from sequence payload.
 */
export function nextTouchNodeKey(currentNodeKey: string | null | undefined): string {
  const key = (currentNodeKey ?? 'touch_1').trim() || 'touch_1';
  const match = /^touch_(\d+)$/i.exec(key);
  if (!match || !match[1]) return 'touch_2';
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1) return 'touch_2';
  return `touch_${n + 1}`;
}

/**
 * Apply a single enrollment event. Idempotent where possible (e.g. pause when already system-paused).
 */
export function applyEnrollmentEvent(
  current: EnrollmentSnapshot,
  event: EnrollmentEvent,
  nowIso: string = new Date().toISOString(),
): EnrollmentTransitionResult {
  const { enrollmentStatus: s, currentNodeKey: node } = current;

  if (s === 'completed' || s === 'aborted') {
    return {
      ok: false,
      next: current,
      reason: `terminal status ${s}; no further transitions`,
    };
  }

  switch (event.type) {
    case 'SCHEDULING_CONFIRMED':
    case 'SCHEDULING_COMPLETED': {
      if (s === 'active') {
        return {
          ok: true,
          next: snap('paused_by_system', node, nowIso, true),
          reason: 'paused_by_system for sales-cycle / meeting',
        };
      }
      return { ok: true, next: current, reason: 'no-op; not active' };
    }
    case 'SCHEDULING_CANCELLED':
    case 'SCHEDULING_NO_SHOW': {
      if (s === 'paused_by_system') {
        return {
          ok: true,
          next: snap('active', node, null, false),
          reason: 'resumed system pause after cancel/no_show',
        };
      }
      return {
        ok: true,
        next: current,
        reason: 'user pause or other status untouched',
      };
    }
    case 'USER_PAUSE': {
      if (s === 'active' || s === 'paused_by_system') {
        return {
          ok: true,
          next: snap('paused_by_user', node, nowIso, current.activeSalesCycleLocked),
          reason: 'user pause',
        };
      }
      return { ok: false, next: current, reason: `cannot user-pause from ${s}` };
    }
    case 'USER_RESUME': {
      if (s === 'paused_by_user') {
        return {
          ok: true,
          next: snap('active', node, null, current.activeSalesCycleLocked),
          reason: 'user resume',
        };
      }
      return { ok: false, next: current, reason: `cannot user-resume from ${s}` };
    }
    case 'SEQUENCE_EXHAUSTED':
    case 'SEQUENCE_SUCCESS': {
      return {
        ok: true,
        next: snap('completed', node, current.pausedAt),
        reason: event.type === 'SEQUENCE_SUCCESS' ? 'success terminal' : 'sequence exhausted',
      };
    }
    case 'UNSUBSCRIBE':
    case 'HARD_BOUNCE':
    case 'ABORT': {
      return {
        ok: true,
        next: snap('aborted', node, current.pausedAt),
        reason: event.reason ?? event.type.toLowerCase(),
      };
    }
    case 'ADVANCE_STEP': {
      if (s !== 'active') {
        return {
          ok: false,
          next: current,
          reason: `cannot advance while status=${s}`,
        };
      }
      if (current.activeSalesCycleLocked) {
        return {
          ok: false,
          next: current,
          reason: 'cannot advance while active_sales_cycle locked',
        };
      }
      return {
        ok: true,
        next: snap('active', event.nextNodeKey, null, false),
        reason: `advanced to ${event.nextNodeKey}`,
      };
    }
    default: {
      const _exhaustive: never = event;
      return { ok: false, next: current, reason: `unknown event ${JSON.stringify(_exhaustive)}` };
    }
  }
}

/** Whether a worker may dispatch the next touch for this enrollment. */
export function mayDispatchEnrollmentStep(current: EnrollmentSnapshot): boolean {
  return (
    current.enrollmentStatus === 'active' &&
    !current.activeSalesCycleLocked
  );
}

/**
 * Filter enrollments a future governed dispatch worker may consider.
 * Still requires Communication path + daily caps + policy — pure eligibility only.
 */
export function listDispatchableEnrollments(
  rows: readonly EnrollmentDispatchCandidate[],
): EnrollmentDispatchCandidate[] {
  return rows.filter((row) => mayDispatchEnrollmentStep(row));
}

import type { ReplyClass } from './index.ts';

/** Map reply classification to an enrollment event proposal (still requires policy/human for legal acts). */
export function enrollmentEventFromReplyClass(
  cls: ReplyClass,
): EnrollmentEvent | null {
  if (cls === 'unsubscribe') return { type: 'UNSUBSCRIBE', reason: 'reply_unsubscribe' };
  if (cls === 'bounce') return { type: 'HARD_BOUNCE', reason: 'reply_bounce' };
  if (cls === 'meeting_requested' || cls === 'interested') {
    return null;
  }
  return null;
}
