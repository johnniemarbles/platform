import type {
  AuthorizationQuery,
  AuthorizationRestriction,
  RoleAssignment,
} from '@platform-core/authorization';
import type { EffectiveContext } from '@platform-core/tenancy';

export interface AuthorizationPolicy {
  readonly assignments: readonly RoleAssignment[];
  readonly restrictions: readonly AuthorizationRestriction[];
}

export interface AuthorizationPolicyRepository {
  loadPolicy(context: EffectiveContext): Promise<AuthorizationPolicy>;
}

export interface PersistedAuthorizationInput {
  readonly context: EffectiveContext;
  readonly query: AuthorizationQuery;
  readonly entitlements?: ReadonlySet<string>;
}

export async function buildAuthorizationInput(
  repository: AuthorizationPolicyRepository,
  input: PersistedAuthorizationInput,
) {
  const policy = await repository.loadPolicy(input.context);
  return {
    context: input.context,
    query: input.query,
    assignments: policy.assignments,
    restrictions: policy.restrictions,
    ...(input.entitlements !== undefined ? { entitlements: input.entitlements } : {}),
  };
}
