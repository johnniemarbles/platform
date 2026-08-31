export const LEARNING_AUTOMATION_EXECUTOR_CLASSES = [
  'CREATE_TASK',
  'COMMUNICATE',
  'SCHEDULE',
] as const;

export type LearningAutomationExecutorClass =
  (typeof LEARNING_AUTOMATION_EXECUTOR_CLASSES)[number];

export interface LearningAutomationRuleDraft {
  readonly eventType: string;
  readonly executorClass: LearningAutomationExecutorClass;
  readonly actionKey: string;
  readonly enabled: boolean;
  readonly policyKeys: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;
}

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EVENT = /^learning\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class LearningAutomationValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningAutomationValidationError';
    this.field = field;
    this.code = code;
  }
}

function requiredText(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearningAutomationValidationError(
      field,
      'REQUIRED',
      `${field} is required.`,
    );
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new LearningAutomationValidationError(
      field,
      'TOO_LONG',
      `${field} is too long.`,
    );
  }
  return normalized;
}

export function validateLearningAutomationRuleKey(value: unknown): string {
  const normalized = requiredText(value, 'ruleKey', 160).toLowerCase();
  if (!KEY.test(normalized)) {
    throw new LearningAutomationValidationError(
      'ruleKey',
      'INVALID_KEY',
      'ruleKey must be a stable lowercase key.',
    );
  }
  return normalized;
}

export function validateLearningAutomationRuleDraft(
  value: unknown,
): LearningAutomationRuleDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningAutomationValidationError(
      'rule',
      'INVALID_OBJECT',
      'Automation rule must be an object.',
    );
  }
  const input = value as Record<string, unknown>;

  const eventType = requiredText(input.eventType, 'eventType', 200);
  if (!EVENT.test(eventType)) {
    throw new LearningAutomationValidationError(
      'eventType',
      'INVALID_EVENT_TYPE',
      'Learning automation events must use the learning.* namespace.',
    );
  }

  const executor = input.executorClass;
  if (
    typeof executor !== 'string'
    || !(LEARNING_AUTOMATION_EXECUTOR_CLASSES as readonly string[]).includes(
      executor,
    )
  ) {
    throw new LearningAutomationValidationError(
      'executorClass',
      'INVALID_EXECUTOR',
      'Learning automation supports CREATE_TASK, COMMUNICATE, or SCHEDULE.',
    );
  }

  const actionKey = requiredText(input.actionKey, 'actionKey', 200);
  if (!KEY.test(actionKey)) {
    throw new LearningAutomationValidationError(
      'actionKey',
      'INVALID_KEY',
      'actionKey must be a stable lowercase key.',
    );
  }

  const rawPolicyKeys = input.policyKeys ?? [];
  if (!Array.isArray(rawPolicyKeys)) {
    throw new LearningAutomationValidationError(
      'policyKeys',
      'INVALID_LIST',
      'policyKeys must be an array.',
    );
  }
  const policyKeys = rawPolicyKeys.map((candidate, index) =>
    requiredText(candidate, `policyKeys[${index}]`, 160),
  );
  if (new Set(policyKeys).size !== policyKeys.length) {
    throw new LearningAutomationValidationError(
      'policyKeys',
      'DUPLICATE_POLICY_KEY',
      'policyKeys must be unique.',
    );
  }

  const configuration = input.configuration ?? {};
  if (
    configuration === null
    || typeof configuration !== 'object'
    || Array.isArray(configuration)
  ) {
    throw new LearningAutomationValidationError(
      'configuration',
      'INVALID_OBJECT',
      'configuration must be an object.',
    );
  }

  return {
    eventType,
    executorClass: executor as LearningAutomationExecutorClass,
    actionKey,
    enabled: input.enabled !== false,
    policyKeys,
    configuration: configuration as Readonly<Record<string, unknown>>,
  };
}
