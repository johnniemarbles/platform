import type { HandlerContext, RouteDefinition } from '../handler.ts';

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

export const meRoutes = (appId: string): readonly RouteDefinition[] => [
  { method: 'GET', path: '/v1/me', appId, requires: ['me.read'], handler: me },
];
