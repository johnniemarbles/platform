import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeFreeSlots,
  mergeIntervals,
  subtractIntervals,
} from '../src/index.ts';

const t = (iso: string) => new Date(iso);

test('mergeIntervals collapses overlaps', () => {
  const merged = mergeIntervals([
    { startsAt: t('2026-09-15T10:00:00Z'), endsAt: t('2026-09-15T11:00:00Z') },
    { startsAt: t('2026-09-15T10:30:00Z'), endsAt: t('2026-09-15T12:00:00Z') },
    { startsAt: t('2026-09-15T13:00:00Z'), endsAt: t('2026-09-15T14:00:00Z') },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.startsAt.toISOString(), '2026-09-15T10:00:00.000Z');
  assert.equal(merged[0]!.endsAt.toISOString(), '2026-09-15T12:00:00.000Z');
});

test('subtractIntervals removes occupancy from open windows', () => {
  const free = subtractIntervals(
    [{ startsAt: t('2026-09-15T09:00:00Z'), endsAt: t('2026-09-15T17:00:00Z') }],
    [{ startsAt: t('2026-09-15T12:00:00Z'), endsAt: t('2026-09-15T13:00:00Z') }],
  );
  assert.equal(free.length, 2);
  assert.equal(free[0]!.endsAt.toISOString(), '2026-09-15T12:00:00.000Z');
  assert.equal(free[1]!.startsAt.toISOString(), '2026-09-15T13:00:00.000Z');
});

test('computeFreeSlots emits stepped candidates inside open time', () => {
  // Monday 2026-09-14 is weekday 1 in UTC if offset 0
  const slots = computeFreeSlots({
    windowStart: t('2026-09-14T08:00:00Z'),
    windowEnd: t('2026-09-14T12:00:00Z'),
    timezone: 'UTC',
    offsetMinutes: 0,
    rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
    blackouts: [],
    specialOpens: [],
    occupancy: [{ startsAt: t('2026-09-14T09:30:00Z'), endsAt: t('2026-09-14T10:00:00Z') }],
    slotDurationMs: 30 * 60_000,
    stepMs: 30 * 60_000,
  });
  // Open 09:00–11:00 minus 09:30–10:00 → 09:00–09:30 and 10:00–11:00
  // 30m slots: 09:00 only in first window; 10:00, 10:30 in second
  const starts = slots.map((s) => s.startsAt.toISOString());
  assert.deepEqual(starts, [
    '2026-09-14T09:00:00.000Z',
    '2026-09-14T10:00:00.000Z',
    '2026-09-14T10:30:00.000Z',
  ]);
});

test('blackouts eliminate candidates', () => {
  const slots = computeFreeSlots({
    windowStart: t('2026-09-14T08:00:00Z'),
    windowEnd: t('2026-09-14T12:00:00Z'),
    timezone: 'UTC',
    offsetMinutes: 0,
    rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
    blackouts: [{ startsAt: t('2026-09-14T09:00:00Z'), endsAt: t('2026-09-14T11:00:00Z') }],
    specialOpens: [],
    occupancy: [],
    slotDurationMs: 30 * 60_000,
  });
  assert.equal(slots.length, 0);
});
