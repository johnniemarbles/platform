import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPOINTMENT_STATES,
  assertTransition,
  canTransition,
  isOccupyingState,
  isTerminalState,
  AppointmentTransitionError,
} from '../src/index.ts';

test('all ADR-018 states are declared', () => {
  assert.deepEqual([...APPOINTMENT_STATES], [
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
  ]);
});

test('happy path booking lifecycle', () => {
  assert.equal(canTransition('REQUESTED', 'CONFIRMED'), true);
  assert.equal(canTransition('CONFIRMED', 'CHECKED_IN'), true);
  assert.equal(canTransition('CHECKED_IN', 'COMPLETED'), true);
  assert.equal(canTransition('CHECKED_IN', 'IN_PROGRESS'), true);
  assert.equal(canTransition('IN_PROGRESS', 'COMPLETED'), true);
});

test('cancel and no-show paths', () => {
  assert.equal(canTransition('REQUESTED', 'CANCELLED'), true);
  assert.equal(canTransition('CONFIRMED', 'CANCELLED'), true);
  assert.equal(canTransition('CONFIRMED', 'NO_SHOW'), true);
  assert.equal(canTransition('REQUESTED', 'DECLINED'), true);
  assert.equal(canTransition('REQUESTED', 'EXPIRED'), true);
});

test('reschedule keeps CONFIRMED identity', () => {
  assert.equal(canTransition('CONFIRMED', 'CONFIRMED'), true);
});

test('terminal states reject further transitions', () => {
  for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'DECLINED', 'EXPIRED'] as const) {
    assert.equal(isTerminalState(s), true);
    assert.equal(canTransition(s, 'CONFIRMED'), false);
  }
});

test('occupying states match ADR capacity rules', () => {
  assert.equal(isOccupyingState('CONFIRMED'), true);
  assert.equal(isOccupyingState('TENTATIVE'), true);
  assert.equal(isOccupyingState('REQUESTED'), false);
  assert.equal(isOccupyingState('CANCELLED'), false);
});

test('assertTransition throws on illegal moves', () => {
  assert.throws(() => assertTransition('COMPLETED', 'CONFIRMED'), AppointmentTransitionError);
  assert.doesNotThrow(() => assertTransition('REQUESTED', 'CONFIRMED'));
});
