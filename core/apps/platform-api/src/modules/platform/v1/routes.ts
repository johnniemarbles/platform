import type { RouteDefinition } from '@platform-core/route-kit';
import { meRoutes } from '../../../routes/me.ts';
import { adminRoutes } from './admin-routes.ts';

export function platformV1Routes(): readonly RouteDefinition[] {
  return [
    ...meRoutes(),
    ...adminRoutes(),
  ];
}
