import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSequenceTouches, listSlotsInTemplate } from './sequence-touches.ts';

describe('normalizeSequenceTouches', () => {
  it('requires at least one touch', () => {
    const r = normalizeSequenceTouches([]);
    assert.equal(r.ok, false);
  });

  it('assigns touch_N keys and default delay', () => {
    const r = normalizeSequenceTouches([
      { subject: 'Hi {{firstName}}', body: 'About {{company}}' },
      { subject: 'Follow up', body: 'Still interested?', delayDays: 5 },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.touches.length, 2);
    assert.equal(r.touches[0]!.stepKey, 'touch_1');
    assert.equal(r.touches[0]!.delayDays, 0);
    assert.equal(r.touches[1]!.stepKey, 'touch_2');
    assert.equal(r.touches[1]!.delayDays, 5);
  });

  it('rejects unknown slots', () => {
    const r = normalizeSequenceTouches([
      { subject: 'Hi {{ssn}}', body: 'x' },
    ]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /unknown slot/);
  });
});

describe('listSlotsInTemplate', () => {
  it('finds slots', () => {
    const slots = listSlotsInTemplate('Hi {{firstName}} at {{company}}');
    assert.ok(slots.includes('firstName'));
    assert.ok(slots.includes('company'));
  });
});
