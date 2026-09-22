import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessLifecycle,
  type BusinessLifecycle,
} from '../src/index.ts';

const lifecycle: BusinessLifecycle = {
  states: [
    { stateKey: 'new', label: 'New', initial: true, terminal: false },
    { stateKey: 'active', label: 'Active', initial: false, terminal: false },
    { stateKey: 'completed', label: 'Completed', initial: false, terminal: true },
  ],
  transitions: [
    {
      transitionKey: 'activate',
      label: 'Activate',
      fromStateKey: 'new',
      toStateKey: 'active',
    },
    {
      transitionKey: 'complete',
      label: 'Complete',
      fromStateKey: 'active',
      toStateKey: 'completed',
    },
  ],
};

test('validates a reachable lifecycle with one initial state', () => {
  assert.deepEqual(
    validateBusinessLifecycle(lifecycle),
    { valid: true, issues: [] },
  );
});

test('rejects multiple initial states and unreachable states', () => {
  const result = validateBusinessLifecycle({
    states: [
      { stateKey: 'a', label: 'A', initial: true, terminal: false },
      { stateKey: 'b', label: 'B', initial: true, terminal: false },
      { stateKey: 'c', label: 'C', initial: false, terminal: true },
    ],
    transitions: [],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_LIFECYCLE_INITIAL_STATE_INVALID',
    ]),
  );
});

test('rejects unknown endpoints, duplicate edges, and terminal departures', () => {
  const result = validateBusinessLifecycle({
    states: lifecycle.states,
    transitions: [
      ...lifecycle.transitions,
      {
        transitionKey: 'complete_again',
        label: 'Complete again',
        fromStateKey: 'active',
        toStateKey: 'completed',
      },
      {
        transitionKey: 'reopen',
        label: 'Reopen',
        fromStateKey: 'completed',
        toStateKey: 'active',
      },
      {
        transitionKey: 'missing',
        label: 'Missing',
        fromStateKey: 'unknown',
        toStateKey: 'new',
      },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'BUSINESS_LIFECYCLE_TRANSITION_DUPLICATE',
      'BUSINESS_LIFECYCLE_TERMINAL_TRANSITION',
      'BUSINESS_LIFECYCLE_TRANSITION_ENDPOINT_UNKNOWN',
    ]),
  );
});

test('reports a state unreachable from the sole initial state', () => {
  const result = validateBusinessLifecycle({
    states: [
      ...lifecycle.states,
      { stateKey: 'orphaned', label: 'Orphaned', initial: false, terminal: true },
    ],
    transitions: lifecycle.transitions,
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.some((issue) =>
      issue.code === 'BUSINESS_LIFECYCLE_STATE_UNREACHABLE'
      && issue.path === 'states[3]'
    ),
    true,
  );
});
