import { meRoutes } from './routes/me.ts';
import { bookingsRoutes, type BookingsRouteOptions } from './routes/bookings.ts';
import type { RouteDefinition } from './handler.ts';

export function routesFor(appId: string, options?: BookingsRouteOptions): readonly RouteDefinition[] {
  return [
    ...meRoutes(appId),
    ...bookingsRoutes(appId, options),
  ];
}

