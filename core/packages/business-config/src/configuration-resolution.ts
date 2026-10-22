export type ConfigurationResolutionLevel =
  | 'SYSTEM_INVARIANT'
  | 'PLATFORM'
  | 'ENVIRONMENT'
  | 'PLAN'
  | 'VERTICAL'
  | 'TENANT'
  | 'BRAND'
  | 'WORKSPACE'
  | 'USER_PREFERENCE'
  | 'OPERATIONAL';

export interface ConfigurationResolutionContext {
  readonly environmentKey?: string;
  readonly planKey?: string;
  readonly verticalKey?: string;
  readonly tenantId?: string;
  readonly brandId?: string;
  readonly workspaceId?: string;
  readonly userSubjectId?: string;
  readonly operationalScopeId?: string;
}

export interface ConfigurationValueCandidate<Value = unknown> {
  readonly level: ConfigurationResolutionLevel;
  readonly scopeId?: string;
  readonly recordId: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly value: Value;
  readonly evidenceRefs: readonly string[];
}

export type ConfigurationOverrideMode = 'LOCKED' | 'BOUNDED' | 'OVERRIDABLE';

export interface ConfigurationSettingDefinition<Value = unknown> {
  readonly settingKey: string;
  readonly overrideMode: ConfigurationOverrideMode;
  readonly allowedOverrideLevels: readonly ConfigurationResolutionLevel[];
  readonly validateOverride?: (input: {
    readonly current: ConfigurationValueCandidate<Value>;
    readonly candidate: ConfigurationValueCandidate<Value>;
  }) => ConfigurationOverrideValidation;
}

export interface ConfigurationOverrideValidation {
  readonly allowed: boolean;
  readonly code: string;
  readonly reason: string;
}

export interface ConfigurationResolutionTraceEntry {
  readonly level: ConfigurationResolutionLevel;
  readonly recordId: string;
  readonly version: number;
  readonly outcome: 'APPLIED' | 'REJECTED' | 'NOT_EFFECTIVE';
  readonly code: string;
}

export type ConfigurationResolutionResult<Value = unknown> =
  | {
      readonly status: 'RESOLVED';
      readonly settingKey: string;
      readonly effectiveValue: Value;
      readonly source: ConfigurationValueCandidate<Value>;
      readonly overridden: boolean;
      readonly validation: 'VALID';
      readonly trace: readonly ConfigurationResolutionTraceEntry[];
    }
  | {
      readonly status: 'UNRESOLVED';
      readonly settingKey: string;
      readonly validation: 'NO_EFFECTIVE_VALUE';
      readonly trace: readonly ConfigurationResolutionTraceEntry[];
    };

const LEVEL_ORDER: Readonly<Record<ConfigurationResolutionLevel, number>> = {
  SYSTEM_INVARIANT: 0,
  PLATFORM: 1,
  ENVIRONMENT: 2,
  PLAN: 3,
  VERTICAL: 4,
  TENANT: 5,
  BRAND: 6,
  WORKSPACE: 7,
  USER_PREFERENCE: 8,
  OPERATIONAL: 9,
};

/**
 * Resolves one setting through the canonical inheritance chain. Invalid lower
 * overrides are ignored fail-closed, leaving the last valid parent effective.
 */
export function resolveConfigurationValue<Value>(
  definition: ConfigurationSettingDefinition<Value>,
  candidates: readonly ConfigurationValueCandidate<Value>[],
  effectiveAt: string,
): ConfigurationResolutionResult<Value> {
  return resolveCandidates(definition, candidates, effectiveAt);
}

/** Resolves only candidates belonging to the exact authenticated context. */
export function resolveScopedConfigurationValue<Value>(
  definition: ConfigurationSettingDefinition<Value>,
  candidates: readonly ConfigurationValueCandidate<Value>[],
  context: ConfigurationResolutionContext,
  effectiveAt: string,
): ConfigurationResolutionResult<Value> {
  return resolveCandidates(definition, candidates, effectiveAt, context);
}

function resolveCandidates<Value>(
  definition: ConfigurationSettingDefinition<Value>,
  candidates: readonly ConfigurationValueCandidate<Value>[],
  effectiveAt: string,
  context?: ConfigurationResolutionContext,
): ConfigurationResolutionResult<Value> {
  const at = Date.parse(effectiveAt);
  if (!Number.isFinite(at)) {
    throw new Error('CONFIGURATION_EFFECTIVE_AT_INVALID');
  }

  const trace: ConfigurationResolutionTraceEntry[] = [];
  const ordered = [...candidates].sort(compareCandidates);
  let current: ConfigurationValueCandidate<Value> | null = null;
  let appliedCount = 0;
  const appliedLevels = new Set<ConfigurationResolutionLevel>();

  for (const candidate of ordered) {
    if (context !== undefined && !matchesContext(candidate, context)) {
      trace.push(entry(candidate, 'REJECTED', 'CONFIGURATION_SCOPE_MISMATCH'));
      continue;
    }
    if (!Number.isFinite(Date.parse(candidate.effectiveFrom))) {
      trace.push(entry(candidate, 'REJECTED', 'CONFIGURATION_EFFECTIVE_FROM_INVALID'));
      continue;
    }
    if (Date.parse(candidate.effectiveFrom) > at) {
      trace.push(entry(candidate, 'NOT_EFFECTIVE', 'CONFIGURATION_NOT_YET_EFFECTIVE'));
      continue;
    }

    if (appliedLevels.has(candidate.level)) {
      trace.push(entry(candidate, 'REJECTED', 'CONFIGURATION_VERSION_SUPERSEDED'));
      continue;
    }

    if (current === null) {
      current = cloneCandidate(candidate);
      appliedLevels.add(candidate.level);
      appliedCount += 1;
      trace.push(entry(candidate, 'APPLIED', 'CONFIGURATION_BASELINE_APPLIED'));
      continue;
    }

    if (definition.overrideMode === 'LOCKED') {
      trace.push(entry(candidate, 'REJECTED', 'CONFIGURATION_LOCKED'));
      continue;
    }
    if (!definition.allowedOverrideLevels.includes(candidate.level)) {
      trace.push(entry(candidate, 'REJECTED', 'CONFIGURATION_LEVEL_NOT_ALLOWED'));
      continue;
    }
    if (definition.overrideMode === 'BOUNDED') {
      const validation = definition.validateOverride?.({
        current,
        candidate,
      });
      if (validation === undefined || !validation.allowed) {
        trace.push(entry(
          candidate,
          'REJECTED',
          validation?.code ?? 'CONFIGURATION_BOUND_VALIDATOR_REQUIRED',
        ));
        continue;
      }
    }

    current = cloneCandidate(candidate);
    appliedLevels.add(candidate.level);
    appliedCount += 1;
    trace.push(entry(candidate, 'APPLIED', 'CONFIGURATION_OVERRIDE_APPLIED'));
  }

  if (current === null) {
    return {
      status: 'UNRESOLVED',
      settingKey: definition.settingKey,
      validation: 'NO_EFFECTIVE_VALUE',
      trace,
    };
  }
  return {
    status: 'RESOLVED',
    settingKey: definition.settingKey,
    effectiveValue: current.value,
    source: current,
    overridden: appliedCount > 1,
    validation: 'VALID',
    trace,
  };
}

function compareCandidates<Value>(
  left: ConfigurationValueCandidate<Value>,
  right: ConfigurationValueCandidate<Value>,
): number {
  return (
    LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level]
    || Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom)
    || right.version - left.version
    || left.recordId.localeCompare(right.recordId)
  );
}

function cloneCandidate<Value>(
  candidate: ConfigurationValueCandidate<Value>,
): ConfigurationValueCandidate<Value> {
  return {
    ...candidate,
    evidenceRefs: [...candidate.evidenceRefs],
  };
}

function entry<Value>(
  candidate: ConfigurationValueCandidate<Value>,
  outcome: ConfigurationResolutionTraceEntry['outcome'],
  code: string,
): ConfigurationResolutionTraceEntry {
  return {
    level: candidate.level,
    recordId: candidate.recordId,
    version: candidate.version,
    outcome,
    code,
  };
}

function matchesContext<Value>(
  candidate: ConfigurationValueCandidate<Value>,
  context: ConfigurationResolutionContext,
): boolean {
  switch (candidate.level) {
    case 'SYSTEM_INVARIANT':
    case 'PLATFORM':
      return candidate.scopeId === undefined;
    case 'ENVIRONMENT':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.environmentKey;
    case 'PLAN':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.planKey;
    case 'VERTICAL':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.verticalKey;
    case 'TENANT':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.tenantId;
    case 'BRAND':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.brandId;
    case 'WORKSPACE':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.workspaceId;
    case 'USER_PREFERENCE':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.userSubjectId;
    case 'OPERATIONAL':
      return candidate.scopeId !== undefined
        && candidate.scopeId === context.operationalScopeId;
  }
}
