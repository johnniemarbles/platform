import { describe, expect, it } from 'vitest';
import { normalizeSequenceTouches, listSlotsInTemplate } from './sequence-touches.ts';

describe('normalizeSequenceTouches', () => {
  it('requires at least one touch', () => {
    const r = normalizeSequenceTouches([]);
    expect(r.ok).toBe(false);
  });

  it('assigns touch_N keys and default delay', () => {
    const r = normalizeSequenceTouches([
      { subject: 'Hi {{firstName}}', body: 'About {{company}}' },
      { subject: 'Follow up', body: 'Still interested?', delayDays: 5 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.touches).toHaveLength(2);
    expect(r.touches[0]!.stepKey).toBe('touch_1');
    expect(r.touches[0]!.delayDays).toBe(0);
    expect(r.touches[1]!.stepKey).toBe('touch_2');
    expect(r.touches[1]!.delayDays).toBe(5);
  });

  it('rejects unknown slots', () => {
    const r = normalizeSequenceTouches([
      { subject: 'Hi {{ssn}}', body: 'x' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unknown slot/);
  });
});

describe('listSlotsInTemplate', () => {
  it('finds slots', () => {
    expect(listSlotsInTemplate('Hi {{firstName}} at {{company}}')).toEqual(
      expect.arrayContaining(['firstName', 'company']),
    );
  });
});
