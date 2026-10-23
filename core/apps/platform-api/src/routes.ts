import { meRoutes } from './routes/me.ts';
import type { RouteDefinition } from './handler.ts';

export function routesFor(appId: string): readonly RouteDefinition[] {
  return [...meRoutes(appId)];
}
