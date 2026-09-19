import { describe, expect, it } from 'vitest';
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
} from './index';
import type { EnrollmentSnapshot } from './enrollment';

const active: EnrollmentSnapshot = {
  enrollmentStatus: 'active',
  currentNodeKey: 'touch_1',
  pausedAt: null,
  activeSalesCycleLocked: false,
};

describe('enrollment state machine', () => {
  it('pauses active on scheduling confirm', () => {
    const r = applyEnrollmentEvent(active, { type: 'SCHEDULING_CONFIRMED' }, '2026-09-19T00:00:00.000Z');
    expect(r.ok).toBe(true);
    expect(r.next.enrollmentStatus).toBe('paused_by_system');
    expect(r.next.pausedAt).toBe('2026-09-19T00:00:00.000Z');
  });

  it('resumes only system pause on cancel', () => {
    const paused = applyEnrollmentEvent(active, { type: 'SCHEDULING_COMPLETED' }).next;
    const r = applyEnrollmentEvent(paused, { type: 'SCHEDULING_CANCELLED' });
    expect(r.next.enrollmentStatus).toBe('active');
    expect(r.next.pausedAt).toBeNull();
  });

  it('does not resume user pause on cancel', () => {
    const userPaused = applyEnrollmentEvent(active, { type: 'USER_PAUSE' }).next;
    const r = applyEnrollmentEvent(userPaused, { type: 'SCHEDULING_NO_SHOW' });
    expect(r.next.enrollmentStatus).toBe('paused_by_user');
  });

  it('blocks advance when sales-cycle locked', () => {
    const locked: EnrollmentSnapshot = { ...active, activeSalesCycleLocked: true };
    const r = applyEnrollmentEvent(locked, { type: 'ADVANCE_STEP', nextNodeKey: 'touch_2' });
    expect(r.ok).toBe(false);
    expect(mayDispatchEnrollmentStep(locked)).toBe(false);
  });

  it('advances cursor when active and unlocked', () => {
    const r = applyEnrollmentEvent(active, { type: 'ADVANCE_STEP', nextNodeKey: 'touch_2' });
    expect(r.ok).toBe(true);
    expect(r.next.currentNodeKey).toBe('touch_2');
    expect(mayDispatchEnrollmentStep(r.next)).toBe(true);
  });

  it('aborts on unsubscribe reply mapping', () => {
    const ev = enrollmentEventFromReplyClass('unsubscribe');
    expect(ev?.type).toBe('UNSUBSCRIBE');
    const r = applyEnrollmentEvent(active, ev!);
    expect(r.next.enrollmentStatus).toBe('aborted');
  });

  it('rejects transitions from completed', () => {
    const done = applyEnrollmentEvent(active, { type: 'SEQUENCE_EXHAUSTED' }).next;
    const r = applyEnrollmentEvent(done, { type: 'USER_PAUSE' });
    expect(r.ok).toBe(false);
  });

  it('nextTouchNodeKey increments sequential touches', () => {
    expect(nextTouchNodeKey('touch_1')).toBe('touch_2');
    expect(nextTouchNodeKey('touch_9')).toBe('touch_10');
    expect(nextTouchNodeKey(null)).toBe('touch_2');
    expect(nextTouchNodeKey('custom_node')).toBe('touch_2');
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
    expect(due.map((r) => r.enrollmentId)).toEqual(['a']);
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
    expect(r.total).toBeGreaterThanOrEqual(80);
    expect(r.band).toBe('STRONG');
    expect(scoringMayAutoApprove()).toBe(false);
  });

  it('rejects protected attributes', () => {
    expect(() => assertNoProtectedInputs(['ethnicity'])).toThrow(/protected/);
  });
});

describe('templates and replies', () => {
  it('renders allowed slots', () => {
    expect(renderTemplate('Hi {{firstName}}', { firstName: 'Ada' })).toBe('Hi Ada');
  });

  it('rejects unknown slots', () => {
    expect(() => renderTemplate('{{ssn}}', {})).toThrow(SequenceRenderError);
  });

  it('classifies unsubscribe', () => {
    const r = classifyReplyText('Please unsubscribe me');
    expect(r.proposedClass).toBe('unsubscribe');
    expect(shouldConvertReplyToLead(r.proposedClass)).toBe(false);
  });

  it('proposes pause on high unsub rate', () => {
    const p = proposeOptimization({ sent: 100, replied: 5, meetings: 1, unsubscribed: 3 });
    expect(p?.action).toBe('pause_segment');
  });
});
