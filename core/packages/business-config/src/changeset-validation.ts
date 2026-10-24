import {
  businessConfigurationIdentityKey,
  type BusinessConfigurationChangeset,
  type BusinessConfigurationIdentity,
  type BusinessConfigurationObject,
  type BusinessConfigurationScope,
} from './index.ts';

export type BusinessConfigurationChangesetIssueCode =
  | 'CONFIG_CHANGESET_ID_REQUIRED'
  | 'CONFIG_CHANGESET_CHANGES_REQUIRED'
  | 'CONFIG_CHANGESET_BASE_REVISION_INVALID'
  | 'CONFIG_CHANGESET_ACTOR_REQUIRED'
  | 'CONFIG_CHANGESET_AUTHORED_AT_INVALID'
  | 'CONFIG_CHANGESET_REASON_REQUIRED'
  | 'CONFIG_CHANGESET_EVIDENCE_REQUIRED'
  | 'CONFIG_OBJECT_IDENTITY_INVALID'
  | 'CONFIG_OBJECT_DUPLICATE'
  | 'CONFIG_OBJECT_SCOPE_MISMATCH'
  | 'CONFIG_OBJECT_NOT_DRAFT'
  | 'CONFIG_OBJECT_LABEL_REQUIRED'
  | 'CONFIG_DEPENDENCY_DUPLICATE'
  | 'CONFIG_DEPENDENCY_SELF_REFERENCE'
  | 'CONFIG_DEPENDENCY_MISSING';

export interface BusinessConfigurationChangesetIssue {
  readonly code: BusinessConfigurationChangesetIssueCode;
  readonly path: string;
  readonly message: string;
}

export type BusinessConfigurationChangesetValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly BusinessConfigurationChangesetIssue[];
    };

/**
 * Validates a draft as one dependency unit. availableDependencies must be the
 * already-published, scope-resolved catalogue visible to this changeset.
 */
export function validateBusinessConfigurationChangeset(
  changeset: BusinessConfigurationChangeset,
  availableDependencies: readonly BusinessConfigurationIdentity[],
): BusinessConfigurationChangesetValidationResult {
  const issues: BusinessConfigurationChangesetIssue[] = [];

  required(changeset.changesetId, 'changesetId', 'CONFIG_CHANGESET_ID_REQUIRED', issues);
  required(
    changeset.authoredBySubjectId,
    'authoredBySubjectId',
    'CONFIG_CHANGESET_ACTOR_REQUIRED',
    issues,
  );
  required(changeset.reason, 'reason', 'CONFIG_CHANGESET_REASON_REQUIRED', issues);

  if (!Number.isInteger(changeset.expectedBaseRevision) || changeset.expectedBaseRevision < 0) {
    issues.push(issue(
      'CONFIG_CHANGESET_BASE_REVISION_INVALID',
      'expectedBaseRevision',
      'Expected base revision must be a non-negative integer.',
    ));
  }
  if (!Number.isFinite(Date.parse(changeset.authoredAt))) {
    issues.push(issue(
      'CONFIG_CHANGESET_AUTHORED_AT_INVALID',
      'authoredAt',
      'Changeset authoredAt must be a valid instant.',
    ));
  }
  if (
    changeset.evidenceRefs.length === 0
    || changeset.evidenceRefs.some((entry) => entry.trim() === '')
  ) {
    issues.push(issue(
      'CONFIG_CHANGESET_EVIDENCE_REQUIRED',
      'evidenceRefs',
      'Changeset requires non-empty evidence references.',
    ));
  }
  if (changeset.changes.length === 0) {
    issues.push(issue(
      'CONFIG_CHANGESET_CHANGES_REQUIRED',
      'changes',
      'Changeset must contain at least one configuration object.',
    ));
  }

  const changedKeys = new Set<string>();
  for (let index = 0; index < changeset.changes.length; index += 1) {
    const object = changeset.changes[index]!;
    const path = `changes[${index}]`;
    validateObject(object, changeset.scope, path, changedKeys, issues);
  }

  const availableKeys = new Set(
    availableDependencies.map(businessConfigurationIdentityKey),
  );
  for (const key of changedKeys) availableKeys.add(key);

  for (let index = 0; index < changeset.changes.length; index += 1) {
    const object = changeset.changes[index]!;
    const objectKey = businessConfigurationIdentityKey(object);
    const dependencyKeys = new Set<string>();

    for (
      let dependencyIndex = 0;
      dependencyIndex < object.dependencies.length;
      dependencyIndex += 1
    ) {
      const dependency = object.dependencies[dependencyIndex]!;
      const dependencyKey = businessConfigurationIdentityKey(dependency);
      const path = `changes[${index}].dependencies[${dependencyIndex}]`;

      if (dependencyKeys.has(dependencyKey)) {
        issues.push(issue(
          'CONFIG_DEPENDENCY_DUPLICATE',
          path,
          `Dependency ${dependencyKey} is duplicated.`,
        ));
      }
      dependencyKeys.add(dependencyKey);

      if (dependencyKey === objectKey) {
        issues.push(issue(
          'CONFIG_DEPENDENCY_SELF_REFERENCE',
          path,
          'Configuration object cannot depend on itself.',
        ));
      } else if (!availableKeys.has(dependencyKey)) {
        issues.push(issue(
          'CONFIG_DEPENDENCY_MISSING',
          path,
          `Dependency ${dependencyKey} is neither published nor present in this changeset.`,
        ));
      }
    }
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

function validateObject(
  object: BusinessConfigurationObject,
  scope: BusinessConfigurationScope,
  path: string,
  changedKeys: Set<string>,
  issues: BusinessConfigurationChangesetIssue[],
): void {
  if (
    object.key.trim() === ''
    || !Number.isInteger(object.version)
    || object.version < 1
  ) {
    issues.push(issue(
      'CONFIG_OBJECT_IDENTITY_INVALID',
      path,
      'Configuration key is required and version must be a positive integer.',
    ));
  }

  const key = businessConfigurationIdentityKey(object);
  if (changedKeys.has(key)) {
    issues.push(issue(
      'CONFIG_OBJECT_DUPLICATE',
      path,
      `Configuration identity ${key} is duplicated in the changeset.`,
    ));
  }
  changedKeys.add(key);

  if (scopeKey(object.scope) !== scopeKey(scope)) {
    issues.push(issue(
      'CONFIG_OBJECT_SCOPE_MISMATCH',
      `${path}.scope`,
      'Configuration object scope must match its changeset scope.',
    ));
  }
  if (object.state !== 'DRAFT') {
    issues.push(issue(
      'CONFIG_OBJECT_NOT_DRAFT',
      `${path}.state`,
      'Only draft configuration objects can be submitted in a draft changeset.',
    ));
  }
  if (object.label.trim() === '') {
    issues.push(issue(
      'CONFIG_OBJECT_LABEL_REQUIRED',
      `${path}.label`,
      'Configuration object label is required.',
    ));
  }
}

function scopeKey(scope: BusinessConfigurationScope): string {
  switch (scope.kind) {
    case 'PLATFORM':
      return 'PLATFORM';
    case 'VERTICAL':
      return `VERTICAL:${scope.verticalKey}`;
    case 'TENANT':
      return `TENANT:${scope.tenantId}`;
  }
}

function required(
  value: string,
  path: string,
  code: BusinessConfigurationChangesetIssueCode,
  issues: BusinessConfigurationChangesetIssue[],
): void {
  if (value.trim() === '') {
    issues.push(issue(code, path, `${path} is required.`));
  }
}

function issue(
  code: BusinessConfigurationChangesetIssueCode,
  path: string,
  message: string,
): BusinessConfigurationChangesetIssue {
  return { code, path, message };
}
