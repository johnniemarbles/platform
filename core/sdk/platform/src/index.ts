import type { Transport } from '@platform-sdk/transport';

export interface MeResult {
  readonly person: { readonly id: string };
  readonly identity: { readonly provider: string; readonly subject: string };
  readonly tenant: { readonly id: string; readonly country: string; readonly region: string };
  readonly app: string;
  readonly permissions: readonly string[];
  readonly hierarchyScope: string;
}

export interface CatalogBundleKey {
  readonly key: string;
  readonly autoGrant: boolean;
  readonly since: string;
  readonly optedInRoleIds: readonly string[];
}

export interface CatalogBundle {
  readonly bundleKey: string;
  readonly description: string;
  readonly source: string;
  readonly keys: readonly CatalogBundleKey[];
}

export interface AdminRole {
  readonly roleId: string;
  readonly roleKey: string;
  readonly displayName: string;
  readonly isSystem: boolean;
  readonly bundles: readonly string[];
  readonly overrides: readonly { permissionKey: string; effect: 'GRANT' | 'DENY' }[];
  readonly optedInKeys: readonly string[];
  readonly effectivePermissions: readonly string[];
}

export interface AdminMember {
  readonly membershipId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly roles: readonly string[];
}

export interface AdminAssignment {
  readonly assignmentId: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly hierarchyScope: string;
}

export function platformClient(t: Transport) {
  return {
    me: () => t.request<MeResult>('GET', '/v1/me'),
    admin: {
      catalog: () => t.request<readonly CatalogBundle[]>('GET', '/v1/admin/permission-catalog'),
      roles: {
        list: () => t.request<readonly AdminRole[]>('GET', '/v1/admin/roles'),
        create: (input: { roleKey: string; displayName: string; bundles: string[] }) =>
          t.request<AdminRole>('POST', '/v1/admin/roles', input),
        update: (
          id: string,
          patch: {
            displayName?: string;
            bundles?: string[];
            overrides?: { permissionKey: string; effect: 'GRANT' | 'DENY' }[];
            optedInKeys?: string[];
          }
        ) => t.request<AdminRole>('PATCH', `/v1/admin/roles/${id}`, patch),
      },
      members: {
        search: (query: { email?: string; phone?: string }) =>
          t.request<readonly AdminMember[]>('POST', '/v1/admin/members/search', query),
      },
      assignments: {
        grant: (input: { membershipId: string; roleId: string; hierarchyScope?: string }) =>
          t.request<AdminAssignment>('POST', '/v1/admin/role-assignments', input),
        revoke: (id: string) => t.request<{ revoked: true }>('DELETE', `/v1/admin/role-assignments/${id}`),
      },
    },
  };
}
