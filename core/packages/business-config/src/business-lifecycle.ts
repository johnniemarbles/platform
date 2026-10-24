export interface BusinessLifecycle {
  readonly states: readonly BusinessLifecycleState[];
  readonly transitions: readonly BusinessLifecycleTransition[];
}

export interface BusinessLifecycleState {
  readonly stateKey: string;
  readonly label: string;
  readonly initial: boolean;
  readonly terminal: boolean;
}

export interface BusinessLifecycleTransition {
  readonly transitionKey: string;
  readonly label: string;
  readonly fromStateKey: string;
  readonly toStateKey: string;
}

export type BusinessLifecycleValidationCode =
  | 'BUSINESS_LIFECYCLE_STATE_REQUIRED'
  | 'BUSINESS_LIFECYCLE_STATE_KEY_INVALID'
  | 'BUSINESS_LIFECYCLE_STATE_KEY_DUPLICATE'
  | 'BUSINESS_LIFECYCLE_STATE_LABEL_REQUIRED'
  | 'BUSINESS_LIFECYCLE_INITIAL_STATE_INVALID'
  | 'BUSINESS_LIFECYCLE_TRANSITION_KEY_INVALID'
  | 'BUSINESS_LIFECYCLE_TRANSITION_KEY_DUPLICATE'
  | 'BUSINESS_LIFECYCLE_TRANSITION_LABEL_REQUIRED'
  | 'BUSINESS_LIFECYCLE_TRANSITION_ENDPOINT_UNKNOWN'
  | 'BUSINESS_LIFECYCLE_TRANSITION_DUPLICATE'
  | 'BUSINESS_LIFECYCLE_TERMINAL_TRANSITION'
  | 'BUSINESS_LIFECYCLE_STATE_UNREACHABLE';

export interface BusinessLifecycleValidationIssue {
  readonly code: BusinessLifecycleValidationCode;
  readonly path: string;
}

export type BusinessLifecycleValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly BusinessLifecycleValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateBusinessLifecycle(
  lifecycle: BusinessLifecycle,
): BusinessLifecycleValidationResult {
  const issues: BusinessLifecycleValidationIssue[] = [];
  if (lifecycle.states.length === 0) {
    issues.push({
      code: 'BUSINESS_LIFECYCLE_STATE_REQUIRED',
      path: 'states',
    });
  }

  const stateKeys = new Set<string>();
  const terminalStates = new Set<string>();
  const initialStates: string[] = [];
  lifecycle.states.forEach((state, index) => {
    const path = `states[${index}]`;
    if (!CANONICAL_KEY.test(state.stateKey)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_STATE_KEY_INVALID',
        path: `${path}.stateKey`,
      });
    } else if (stateKeys.has(state.stateKey)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_STATE_KEY_DUPLICATE',
        path: `${path}.stateKey`,
      });
    }
    stateKeys.add(state.stateKey);
    if (state.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_STATE_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (state.initial) initialStates.push(state.stateKey);
    if (state.terminal) terminalStates.add(state.stateKey);
  });

  if (initialStates.length !== 1) {
    issues.push({
      code: 'BUSINESS_LIFECYCLE_INITIAL_STATE_INVALID',
      path: 'states',
    });
  }

  const transitionKeys = new Set<string>();
  const edges = new Set<string>();
  const graph = new Map<string, string[]>();
  lifecycle.transitions.forEach((transition, index) => {
    const path = `transitions[${index}]`;
    if (!CANONICAL_KEY.test(transition.transitionKey)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TRANSITION_KEY_INVALID',
        path: `${path}.transitionKey`,
      });
    } else if (transitionKeys.has(transition.transitionKey)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TRANSITION_KEY_DUPLICATE',
        path: `${path}.transitionKey`,
      });
    }
    transitionKeys.add(transition.transitionKey);

    if (transition.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TRANSITION_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }

    const endpointsKnown =
      stateKeys.has(transition.fromStateKey)
      && stateKeys.has(transition.toStateKey);
    if (!endpointsKnown) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TRANSITION_ENDPOINT_UNKNOWN',
        path,
      });
    }

    const edge = `${transition.fromStateKey}:${transition.toStateKey}`;
    if (edges.has(edge)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TRANSITION_DUPLICATE',
        path,
      });
    }
    edges.add(edge);

    if (terminalStates.has(transition.fromStateKey)) {
      issues.push({
        code: 'BUSINESS_LIFECYCLE_TERMINAL_TRANSITION',
        path,
      });
    }
    if (endpointsKnown) {
      const adjacent = graph.get(transition.fromStateKey) ?? [];
      adjacent.push(transition.toStateKey);
      graph.set(transition.fromStateKey, adjacent);
    }
  });

  if (initialStates.length === 1) {
    const reachable = reachableStates(initialStates[0]!, graph);
    lifecycle.states.forEach((state, index) => {
      if (!reachable.has(state.stateKey)) {
        issues.push({
          code: 'BUSINESS_LIFECYCLE_STATE_UNREACHABLE',
          path: `states[${index}]`,
        });
      }
    });
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

function reachableStates(
  initialState: string,
  graph: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = [initialState];
  while (pending.length > 0) {
    const state = pending.pop()!;
    if (reachable.has(state)) continue;
    reachable.add(state);
    pending.push(...(graph.get(state) ?? []));
  }
  return reachable;
}
