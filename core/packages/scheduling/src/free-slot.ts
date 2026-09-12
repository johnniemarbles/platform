/**
 * ADR-018 free-slot engine — pure functions over availability + occupancy.
 * No I/O. Repositories supply intervals; this module subtracts occupancy from
 * open windows and emits candidate starts for a fixed service duration.
 */

export interface TimeInterval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface AvailabilityRuleInput {
  /** 0 = Sunday … 6 = Saturday (local weekday in `timezone`). */
  readonly weekday: number;
  /** Minutes from local midnight [0, 1440). */
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface FreeSlotRequest {
  readonly windowStart: Date;
  readonly windowEnd: Date;
  /** IANA zone used to interpret availability rules (resource → location → tenant). */
  readonly timezone: string;
  readonly rules: readonly AvailabilityRuleInput[];
  /** BLACKOUT removes time; OPEN adds windows (already as absolute intervals). */
  readonly blackouts: readonly TimeInterval[];
  readonly specialOpens: readonly TimeInterval[];
  readonly occupancy: readonly TimeInterval[];
  /** Service duration including buffers already folded in by the caller. */
  readonly slotDurationMs: number;
  /** Step between candidate starts (default 15 minutes). */
  readonly stepMs?: number;
}

export interface FreeSlot {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

function assertValidInterval(i: TimeInterval, label: string): void {
  if (!(i.startsAt instanceof Date) || Number.isNaN(i.startsAt.getTime())) {
    throw new Error(`${label}.startsAt must be a valid Date`);
  }
  if (!(i.endsAt instanceof Date) || Number.isNaN(i.endsAt.getTime())) {
    throw new Error(`${label}.endsAt must be a valid Date`);
  }
  if (i.endsAt.getTime() <= i.startsAt.getTime()) {
    throw new Error(`${label} must have endsAt > startsAt`);
  }
}

/** Merge overlapping/adjacent intervals and sort ascending. */
export function mergeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const sorted = [...intervals]
    .map((i) => {
      assertValidInterval(i, 'interval');
      return { startsAt: i.startsAt, endsAt: i.endsAt };
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (sorted.length === 0) return [];
  const out: TimeInterval[] = [];
  let cur = { startsAt: sorted[0]!.startsAt, endsAt: sorted[0]!.endsAt };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.startsAt.getTime() <= cur.endsAt.getTime()) {
      if (next.endsAt.getTime() > cur.endsAt.getTime()) {
        cur = { startsAt: cur.startsAt, endsAt: next.endsAt };
      }
    } else {
      out.push(cur);
      cur = { startsAt: next.startsAt, endsAt: next.endsAt };
    }
  }
  out.push(cur);
  return out;
}

/** Subtract blockers from source windows. */
export function subtractIntervals(
  sources: readonly TimeInterval[],
  blockers: readonly TimeInterval[],
): TimeInterval[] {
  const mergedSources = mergeIntervals(sources);
  const mergedBlockers = mergeIntervals(blockers);
  const result: TimeInterval[] = [];
  for (const src of mergedSources) {
    let cursor = src.startsAt.getTime();
    const end = src.endsAt.getTime();
    for (const b of mergedBlockers) {
      const bs = b.startsAt.getTime();
      const be = b.endsAt.getTime();
      if (be <= cursor || bs >= end) continue;
      if (bs > cursor) {
        result.push({ startsAt: new Date(cursor), endsAt: new Date(Math.min(bs, end)) });
      }
      cursor = Math.max(cursor, be);
      if (cursor >= end) break;
    }
    if (cursor < end) {
      result.push({ startsAt: new Date(cursor), endsAt: new Date(end) });
    }
  }
  return result.filter((i) => i.endsAt.getTime() > i.startsAt.getTime());
}

/**
 * Local weekday + minute helpers using UTC getters adjusted by a fixed offset.
 * For v1 tests we accept a numeric offsetMinutes; production adapters resolve
 * IANA → offset for the concrete day (DST-aware) before calling this module.
 */
export function localParts(instant: Date, offsetMinutes: number): { weekday: number; minuteOfDay: number } {
  const local = new Date(instant.getTime() + offsetMinutes * 60_000);
  return {
    weekday: local.getUTCDay(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function expandRulesToIntervals(
  windowStart: Date,
  windowEnd: Date,
  rules: readonly AvailabilityRuleInput[],
  offsetMinutes: number,
): TimeInterval[] {
  assertValidInterval({ startsAt: windowStart, endsAt: windowEnd }, 'window');
  const out: TimeInterval[] = [];
  // Iterate calendar days covering the window in the offset zone
  const startDay = new Date(windowStart.getTime() + offsetMinutes * 60_000);
  startDay.setUTCHours(0, 0, 0, 0);
  const endLimit = windowEnd.getTime();
  for (let day = startDay.getTime(); day < endLimit + 86_400_000; day += 86_400_000) {
    const dayUtcMidnight = day - offsetMinutes * 60_000;
    const probe = new Date(dayUtcMidnight + 12 * 3600_000); // noon local-ish
    const { weekday } = localParts(probe, offsetMinutes);
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      if (rule.endMinute <= rule.startMinute) continue;
      const startsAt = new Date(dayUtcMidnight + rule.startMinute * 60_000);
      const endsAt = new Date(dayUtcMidnight + rule.endMinute * 60_000);
      const clippedStart = new Date(Math.max(startsAt.getTime(), windowStart.getTime()));
      const clippedEnd = new Date(Math.min(endsAt.getTime(), windowEnd.getTime()));
      if (clippedEnd.getTime() > clippedStart.getTime()) {
        out.push({ startsAt: clippedStart, endsAt: clippedEnd });
      }
    }
  }
  return mergeIntervals(out);
}

/**
 * Compute free slots. `offsetMinutes` is the zone offset for rule expansion;
 * callers that need full IANA/DST behavior must resolve offset per day and/or
 * pre-expand rules into absolute intervals and pass them via specialOpens.
 */
export function computeFreeSlots(
  request: FreeSlotRequest & { offsetMinutes?: number },
): FreeSlot[] {
  const stepMs = request.stepMs ?? 15 * 60_000;
  if (request.slotDurationMs <= 0) throw new Error('slotDurationMs must be > 0');
  if (stepMs <= 0) throw new Error('stepMs must be > 0');

  const offset = request.offsetMinutes ?? 0;
  const fromRules = expandRulesToIntervals(
    request.windowStart,
    request.windowEnd,
    request.rules,
    offset,
  );
  const open = mergeIntervals([...fromRules, ...request.specialOpens]);
  const freeWindows = subtractIntervals(
    subtractIntervals(open, request.blackouts),
    request.occupancy,
  );

  const slots: FreeSlot[] = [];
  for (const win of freeWindows) {
    const lastStart = win.endsAt.getTime() - request.slotDurationMs;
    for (let t = win.startsAt.getTime(); t <= lastStart; t += stepMs) {
      slots.push({
        startsAt: new Date(t),
        endsAt: new Date(t + request.slotDurationMs),
      });
    }
  }
  return slots;
}
