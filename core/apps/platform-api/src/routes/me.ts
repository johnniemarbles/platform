import type { HandlerContext, RouteDefinition } from '@platform-core/route-kit';

async function me({ membership, identity }: HandlerContext): Promise<unknown> {
  return {
    person: { id: membership.personId },
    identity: { provider: identity.providerKey, subject: identity.subjectId },
    tenant: { id: membership.tenantId, country: membership.country, region: membership.region },
    app: membership.appId,
    permissions: membership.permissions,
    hierarchyScope: membership.hierarchyScope,
  };
}

export const meRoutes = (): readonly RouteDefinition[] => [
  { method: 'GET', path: '/v1/me', appId: '*', requires: ['me.read'], handler: me },
];
