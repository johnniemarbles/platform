import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  applyEnrollmentEvent,
  mayDispatchEnrollmentStep,
  listDispatchableEnrollments,
  enrollmentEventFromReplyClass,
  nextTouchNodeKey,
  scoreFit,
  assertNoProtectedInputs,
  renderTemplate,
  SequenceRenderError,
  classifyReplyText,
  proposeOptimization,
  scoringMayAutoApprove,
  shouldConvertReplyToLead,
} from './index.ts';
import type { EnrollmentSnapshot } from './enrollment.ts';

const active: EnrollmentSnapshot = {
  enrollmentStatus: 'active',
  currentNodeKey: 'touch_1',
  pausedAt: null,
  activeSalesCycleLocked: false,
};

describe('enrollment state machine', () => {
  it('pauses active on scheduling confirm', () => {
    const r = applyEnrollmentEvent(active, { type: 'SCHEDULING_CONFIRMED' }, '2026-09-19T00:00:00.000Z');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.next.enrollmentStatus, 'paused_by_system');
    assert.strictEqual(r.next.pausedAt, '2026-09-19T00:00:00.000Z');
  });

  it('resumes only system pause on cancel', () => {
    const paused = applyEnrollmentEvent(active, { type: 'SCHEDULING_COMPLETED' }).next;
    const r = applyEnrollmentEvent(paused, { type: 'SCHEDULING_CANCELLED' });
    assert.strictEqual(r.next.enrollmentStatus, 'active');
    assert.strictEqual(r.next.pausedAt, null);
  });

  it('does not resume user pause on cancel', () => {
    const userPaused = applyEnrollmentEvent(active, { type: 'USER_PAUSE' }).next;
    const r = applyEnrollmentEvent(userPaused, { type: 'SCHEDULING_NO_SHOW' });
    assert.strictEqual(r.next.enrollmentStatus, 'paused_by_user');
  });

  it('blocks advance when sales-cycle locked', () => {
    const locked: EnrollmentSnapshot = { ...active, activeSalesCycleLocked: true };
    const r = applyEnrollmentEvent(locked, { type: 'ADVANCE_STEP', nextNodeKey: 'touch_2' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(mayDispatchEnrollmentStep(locked), false);
  });

  it('advances cursor when active and unlocked', () => {
    const r = applyEnrollmentEvent(active, { type: 'ADVANCE_STEP', nextNodeKey: 'touch_2' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.next.currentNodeKey, 'touch_2');
    assert.strictEqual(mayDispatchEnrollmentStep(r.next), true);
  });

  it('aborts on unsubscribe reply mapping', () => {
    const ev = enrollmentEventFromReplyClass('unsubscribe');
    assert.strictEqual(ev?.type, 'UNSUBSCRIBE');
    const r = applyEnrollmentEvent(active, ev!);
    assert.strictEqual(r.next.enrollmentStatus, 'aborted');
  });

  it('rejects transitions from completed', () => {
    const done = applyEnrollmentEvent(active, { type: 'SEQUENCE_EXHAUSTED' }).next;
    const r = applyEnrollmentEvent(done, { type: 'USER_PAUSE' });
    assert.strictEqual(r.ok, false);
  });

  it('nextTouchNodeKey increments sequential touches', () => {
    assert.strictEqual(nextTouchNodeKey('touch_1'), 'touch_2');
    assert.strictEqual(nextTouchNodeKey('touch_9'), 'touch_10');
    assert.strictEqual(nextTouchNodeKey(null), 'touch_2');
    assert.strictEqual(nextTouchNodeKey('custom_node'), 'touch_2');
  });

  it('listDispatchableEnrollments filters locked and paused', () => {
    const rows = [
      { enrollmentId: 'a', ...active },
      {
        enrollmentId: 'b',
        enrollmentStatus: 'active' as const,
        currentNodeKey: 'touch_1',
        pausedAt: null,
        activeSalesCycleLocked: true,
      },
      {
        enrollmentId: 'c',
        enrollmentStatus: 'paused_by_user' as const,
        currentNodeKey: 'touch_1',
        pausedAt: '2026-09-19T00:00:00.000Z',
        activeSalesCycleLocked: false,
      },
    ];
    const due = listDispatchableEnrollments(rows);
    assert.deepStrictEqual(due.map((r) => r.enrollmentId), ['a']);
  });
});

describe('fit scoring', () => {
  const icp = {
    industries: ['software'],
    geographies: ['us'],
    companySizeHints: ['51-200'],
    titleHints: ['vp', 'director'],
    seniorityHints: ['director'],
    disqualifiers: ['intern'],
  };

  it('scores matching persona', () => {
    const r = scoreFit(
      {
        industry: 'software',
        geography: 'US-West',
        companySize: '51-200',
        title: 'VP Sales',
        seniority: 'director',
        hasValidatedEmail: true,
        hasCommercialDomain: true,
      },
      icp,
    );
    assert.ok(r.total >= 80);
    assert.strictEqual(r.band, 'STRONG');
    assert.strictEqual(scoringMayAutoApprove(), false);
  });

  it('rejects protected attributes', () => {
    assert.throws(() => assertNoProtectedInputs(['ethnicity']), /protected/);
  });
});

describe('templates and replies', () => {
  it('renders allowed slots', () => {
    assert.strictEqual(renderTemplate('Hi {{firstName}}', { firstName: 'Ada' }), 'Hi Ada');
  });

  it('rejects unknown slots', () => {
    assert.throws(() => renderTemplate('{{ssn}}', {}), SequenceRenderError);
  });

  it('classifies unsubscribe', () => {
    const r = classifyReplyText('Please unsubscribe me');
    assert.strictEqual(r.proposedClass, 'unsubscribe');
    assert.strictEqual(shouldConvertReplyToLead(r.proposedClass), false);
  });

  it('proposes pause on high unsub rate', () => {
    const p = proposeOptimization({ sent: 100, replied: 5, meetings: 1, unsubscribed: 3 });
    assert.strictEqual(p?.action, 'pause_segment');
  });
});
