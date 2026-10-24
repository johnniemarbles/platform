import type { RouteDefinition } from '@platform-core/route-kit';
import { platformV1Routes } from './modules/platform/v1/routes.ts';
import { schedulingV1Routes } from './modules/scheduling/v1/routes.ts';
import { crmV1Routes } from './modules/crm/v1/routes.ts';
import { appPacks } from './app-packs.ts';

export function routes(): readonly RouteDefinition[] {
  return [
    ...platformV1Routes(),
    ...schedulingV1Routes(),
    ...crmV1Routes(),
    ...appPacks.flatMap((p) => p.routes()),
  ];
}
