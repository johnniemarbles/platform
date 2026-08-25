import {
  resolveEffectiveContext,
  type EffectiveContext,
  type IdentityContext,
  type MembershipContext,
} from '@platform-core/tenancy';

export interface MembershipRepository {
  listActiveMemberships(identity: IdentityContext): Promise<readonly MembershipContext[]>;
}

export interface ResolvePersistedContextInput {
  readonly identity: IdentityContext;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId?: string;
  readonly operatingUnitId?: string;
  readonly correlationId?: string;
}

export async function resolveEffectiveContextFromRepository(
  repository: MembershipRepository,
  input: ResolvePersistedContextInput,
): Promise<EffectiveContext> {
  const memberships = await repository.listActiveMemberships(input.identity);
  return resolveEffectiveContext({
    identity: input.identity,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    memberships,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.operatingUnitId !== undefined ? { operatingUnitId: input.operatingUnitId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  });
}

export type DatabaseSessionSettingKey =
  | 'app.tenant_id'
  | 'app.subject_id'
  | 'app.organization_id'
  | 'app.workspace_id'
  | 'app.operating_unit_id'
  | 'app.correlation_id';

export interface DatabaseSessionSetting {
  readonly key: DatabaseSessionSettingKey;
  readonly value: string;
}

/**
 * Converts an already verified EffectiveContext into transaction-local
 * database settings. This function does not verify membership; callers must
 * resolve the context first and then bind these settings inside one DB
 * transaction using SET LOCAL / set_config(..., true).
 */
export function databaseSessionSettings(context: EffectiveContext): readonly DatabaseSessionSetting[] {
  return [
    { key: 'app.tenant_id', value: context.tenantId },
    { key: 'app.subject_id', value: context.subjectId },
    { key: 'app.organization_id', value: context.organizationId },
    ...(context.workspaceId !== undefined
      ? [{ key: 'app.workspace_id' as const, value: context.workspaceId }]
      : []),
    ...(context.operatingUnitId !== undefined
      ? [{ key: 'app.operating_unit_id' as const, value: context.operatingUnitId }]
      : []),
    ...(context.correlationId !== undefined
      ? [{ key: 'app.correlation_id' as const, value: context.correlationId }]
      : []),
  ];
}

export interface TransactionContextBinder {
  setLocal(key: DatabaseSessionSettingKey, value: string): Promise<void>;
}

export async function bindEffectiveContext(
  binder: TransactionContextBinder,
  context: EffectiveContext,
): Promise<void> {
  for (const setting of databaseSessionSettings(context)) {
    await binder.setLocal(setting.key, setting.value);
  }
}
