import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db, DbClient } from './db.ts';

export interface AppJsonIdentityClient {
  provider: 'cognito' | 'dev';
  poolId: string;
  clientId: string;
}

export interface AppJson {
  appId: string;
  slug: string;
  displayName: string;
  identityClients: Record<string, AppJsonIdentityClient[]>;
}

export async function syncAppRegistry(db: Db, env = process.env['PLATFORM_ENV'] ?? 'dev'): Promise<void> {
  const packsDir = resolve(import.meta.dirname, '../../app-packs');
  if (!existsSync(packsDir)) return;

  const entries = readdirSync(packsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const appJsonPath = resolve(packsDir, entry.name, 'app.json');
    if (!existsSync(appJsonPath)) continue;

    try {
      const appJson: AppJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
      await db.query(
        `INSERT INTO platform.apps (app_id, display_name, status)
         VALUES ($1, $2, 'ACTIVE')
         ON CONFLICT (app_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [appJson.appId, appJson.displayName]
      );

      const clients = appJson.identityClients[env] ?? [];
      for (const client of clients) {
        await db.query(
          `INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (client_id) DO UPDATE SET
             app_id = EXCLUDED.app_id,
             identity_provider = EXCLUDED.identity_provider,
             identity_pool_id = EXCLUDED.identity_pool_id`,
          [client.clientId, appJson.appId, client.provider, client.poolId]
        );
        console.log(`[app-registry] registered client ${client.clientId} -> ${appJson.appId}`);
      }
    } catch (e) {
      console.error(`[app-registry] failed to register app from ${appJsonPath}:`, e);
    }
  }
}

export async function lookupAppsForClients(db: DbClient, clientIds: readonly string[]): Promise<string[]> {
  if (clientIds.length === 0) return [];
  const r = await db.query<{ app_id: string }>(
    'SELECT DISTINCT app_id FROM platform.app_clients WHERE client_id = ANY($1)',
    [clientIds]
  );
  return r.rows.map((row) => row.app_id);
}
