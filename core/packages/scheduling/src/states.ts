/**
 * ADR-018 lifecycle state machine — pure domain, no I/O.
 */

export const APPOINTMENT_STATES = [
  'REQUESTED',
  'TENTATIVE',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'DECLINED',
  'EXPIRED',
] as const;

export type AppointmentState = (typeof APPOINTMENT_STATES)[number];

/** States that occupy resource capacity (holds + these). */
export const OCCUPYING_STATES: readonly AppointmentState[] = [
  'TENTATIVE',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_PROGRESS',
] as const;

export function isOccupyingState(state: AppointmentState): boolean {
  return (OCCUPYING_STATES as readonly string[]).includes(state);
}

export function isTerminalState(state: AppointmentState): boolean {
  return (
    state === 'COMPLETED' ||
    state === 'CANCELLED' ||
    state === 'NO_SHOW' ||
    state === 'DECLINED' ||
    state === 'EXPIRED'
  );
}

/** v1 allowed transitions (from → to). Reschedule keeps CONFIRMED → CONFIRMED via event. */
const TRANSITIONS: Readonly<Record<AppointmentState, readonly AppointmentState[]>> = {
  REQUESTED: ['CONFIRMED', 'CANCELLED', 'DECLINED', 'EXPIRED', 'TENTATIVE'],
  TENTATIVE: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'DECLINED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'CONFIRMED'],
  CHECKED_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  DECLINED: [],
  EXPIRED: [],
};

export function canTransition(from: AppointmentState, to: AppointmentState): boolean {
  return TRANSITIONS[from]?.includes(to) === true;
}

export function allowedTransitions(from: AppointmentState): readonly AppointmentState[] {
  return TRANSITIONS[from] ?? [];
}

export class AppointmentTransitionError extends Error {
  readonly from: AppointmentState;
  readonly to: AppointmentState;
  constructor(from: AppointmentState, to: AppointmentState) {
    super(`Invalid appointment transition: ${from} → ${to}`);
    this.name = 'AppointmentTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: AppointmentState, to: AppointmentState): void {
  if (!canTransition(from, to)) {
    throw new AppointmentTransitionError(from, to);
  }
}
