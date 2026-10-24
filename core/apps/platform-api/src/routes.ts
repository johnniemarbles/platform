import type { RouteDefinition } from '@platform-core/route-kit';
import { meRoutes } from './routes/me.ts';
import { appPacks } from './app-packs.ts';

export function routes(): readonly RouteDefinition[] {
  return [
    ...meRoutes(),
    ...appPacks.flatMap((p) => p.routes()),
  ];
}
