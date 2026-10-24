import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DbClient } from './db.ts';

export interface BundlePermission {
  key: string;
  since: string;
  autoGrant?: boolean;
}

export interface ModuleBundle {
  description: string;
  permissions: BundlePermission[];
}

export interface ModuleDefinition {
  status: string;
  contractVersion: string;
  permissions: string[];
  bundles: Record<string, ModuleBundle>;
}

export interface ModuleRegistry {
  modules: Record<string, ModuleDefinition>;
}

export interface RoleTemplateDef {
  displayName: string;
  bundles: string[];
}

export interface RolesTemplate {
  roles: Record<string, RoleTemplateDef>;
}

export async function syncPermissionCatalog(
  db: DbClient,
  options?: { rootDir?: string }
): Promise<{ syncedBundles: number; syncedKeys: number; syncedRoles: number }> {
  const rootDir = options?.rootDir ?? resolve(import.meta.dirname, '../../../..');
  const modulesPath = resolve(rootDir, 'core/registry/modules.json');

  let syncedBundles = 0;
  let syncedKeys = 0;
  let syncedRoles = 0;

  const knownKeys = new Set<string>();

  // 1. Read registry modules and upsert bundles
  if (existsSync(modulesPath)) {
    const registry: ModuleRegistry = JSON.parse(readFileSync(modulesPath, 'utf8'));
    for (const [modId, mod] of Object.entries(registry.modules)) {
      const contractMajor = parseInt(mod.contractVersion.split('.')[0] || '1', 10);
      const bundles = mod.bundles || {};

      for (const [bundleName, bundle] of Object.entries(bundles)) {
        const bundleKey = `${modId}.${bundleName}`;
        const source = `module:${modId}`;

        await db.query(
          `INSERT INTO platform.permission_bundles (bundle_key, source, contract_major, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (bundle_key) DO UPDATE SET
             contract_major = EXCLUDED.contract_major,
             description = EXCLUDED.description`,
          [bundleKey, source, contractMajor, bundle.description]
        );
        syncedBundles++;

        for (const p of bundle.permissions) {
          knownKeys.add(`${bundleKey}:${p.key}`);
          const autoGrant = p.autoGrant !== false;
          const insKey = await db.query(
            `INSERT INTO platform.permission_bundle_keys (bundle_key, permission_key, auto_grant, added_in_version)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (bundle_key, permission_key) DO NOTHING
             RETURNING bundle_key, permission_key`,
            [bundleKey, p.key, autoGrant, p.since]
          );

          if (insKey.rows.length > 0) {
            syncedKeys++;
            const action = autoGrant ? 'KEY_ADDED' : 'KEY_ADDED_PENDING_OPT_IN';
            await db.query(
              `INSERT INTO platform.permission_catalog_events (bundle_key, permission_key, action, version)
               VALUES ($1, $2, $3, $4)`,
              [bundleKey, p.key, action, p.since]
            );
          }
        }
      }
    }
  }

  // 2. Read app packs and upsert app bundles
  const appPacksDir = resolve(rootDir, 'core/app-packs');
  const packTemplates = new Map<string, RolesTemplate>();

  if (existsSync(appPacksDir)) {
    const packDirs = readdirSync(appPacksDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const packName of packDirs) {
      const packDir = resolve(appPacksDir, packName);
      const appJsonPath = resolve(packDir, 'app.json');
      const rolesJsonPath = resolve(packDir, 'roles.json');

      if (!existsSync(appJsonPath)) continue;

      let appJson: any;
      try {
        appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
      } catch {
        continue;
      }

      const slug = appJson.slug || packName;
      const appId = appJson.appId || `app_${slug}`;

      // Register pack bundles if present
      const bundles = appJson.bundles || {};
      for (const [bundleName, bundle] of Object.entries(bundles) as [string, any][]) {
        const bundleKey = `${slug}.${bundleName}`;
        const source = `app:${slug}`;
        const contractMajor = 1;

        await db.query(
          `INSERT INTO platform.permission_bundles (bundle_key, source, contract_major, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (bundle_key) DO UPDATE SET
             contract_major = EXCLUDED.contract_major,
             description = EXCLUDED.description`,
          [bundleKey, source, contractMajor, bundle.description || bundleName]
        );
        syncedBundles++;

        for (const p of bundle.permissions || []) {
          knownKeys.add(`${bundleKey}:${p.key}`);
          const autoGrant = p.autoGrant !== false;
          const insKey = await db.query(
            `INSERT INTO platform.permission_bundle_keys (bundle_key, permission_key, auto_grant, added_in_version)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (bundle_key, permission_key) DO NOTHING
             RETURNING bundle_key, permission_key`,
            [bundleKey, p.key, autoGrant, p.since || '0.1.0']
          );

          if (insKey.rows.length > 0) {
            syncedKeys++;
            const action = autoGrant ? 'KEY_ADDED' : 'KEY_ADDED_PENDING_OPT_IN';
            await db.query(
              `INSERT INTO platform.permission_catalog_events (bundle_key, permission_key, action, version)
               VALUES ($1, $2, $3, $4)`,
              [bundleKey, p.key, action, p.since || '0.1.0']
            );
          }
        }
      }

      // Read roles.json template if present
      if (existsSync(rolesJsonPath)) {
        try {
          const rawRoles = JSON.parse(readFileSync(rolesJsonPath, 'utf8'));
          if (rawRoles.roles) {
            packTemplates.set(appId, rawRoles);
          } else {
            // Convert legacy roles format
            packTemplates.set(appId, {
              roles: {
                owner: { displayName: 'Owner', bundles: ['platform.member', 'platform.admin'] },
                staff: { displayName: 'Staff', bundles: ['platform.member'] },
                viewer: { displayName: 'Viewer', bundles: ['platform.member'] },
              },
            });
          }
        } catch {
          // ignore error
        }
      }
    }
  }

  // 3. Check for keys in database missing from registry
  const dbKeys = await db.query<{ bundle_key: string; permission_key: string }>(
    'SELECT bundle_key, permission_key FROM platform.permission_bundle_keys'
  );
  for (const row of dbKeys.rows) {
    if (!knownKeys.has(`${row.bundle_key}:${row.permission_key}`)) {
      console.warn(
        `[permission-catalog] Warning: key ${row.bundle_key}.${row.permission_key} exists in DB but missing from registry`
      );
    }
  }

  // 4. System roles sync across all tenants
  const tenants = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM platform.tenants');
  for (const t of tenants.rows) {
    const tenantApps = await db.query<{ app_id: string }>(
      'SELECT app_id FROM platform.tenant_apps WHERE tenant_id = $1 AND deactivated_at IS NULL',
      [t.tenant_id]
    );

    for (const a of tenantApps.rows) {
      const template = packTemplates.get(a.app_id) || {
        roles: {
          owner: { displayName: 'Owner', bundles: ['platform.member', 'platform.admin'] },
          staff: { displayName: 'Staff', bundles: ['platform.member'] },
          viewer: { displayName: 'Viewer', bundles: ['platform.member'] },
        },
      };

      await ensureSystemRolesForTenantApp(db, t.tenant_id, a.app_id, template);
      syncedRoles++;
    }
  }

  return { syncedBundles, syncedKeys, syncedRoles };
}

export async function ensureSystemRolesForTenantApp(
  db: DbClient,
  tenantId: string,
  appId: string,
  rolesTemplate?: RolesTemplate
): Promise<void> {
  const template: RolesTemplate = rolesTemplate?.roles
    ? rolesTemplate
    : {
        roles: {
          owner: { displayName: 'Owner', bundles: ['platform.member', 'platform.admin'] },
          staff: { displayName: 'Staff', bundles: ['platform.member'] },
          viewer: { displayName: 'Viewer', bundles: ['platform.member'] },
        },
      };

  // Set request context for RLS
  await db.query("SELECT platform.set_request_context($1::uuid, $2, '', 'platform-operational', NULL)", [
    tenantId,
    appId,
  ]);

  for (const [roleKey, roleDef] of Object.entries(template.roles)) {
    await db.query(
      `INSERT INTO platform.roles (tenant_id, app_id, role_key, display_name, is_system)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, app_id, role_key) DO NOTHING`,
      [tenantId, appId, roleKey, roleDef.displayName]
    );

    const roleRes = await db.query<{ role_id: string }>(
      'SELECT role_id FROM platform.roles WHERE tenant_id = $1 AND app_id = $2 AND role_key = $3',
      [tenantId, appId, roleKey]
    );
    const roleId = roleRes.rows[0]?.role_id;

    if (roleId && roleDef.bundles) {
      for (const bundleKey of roleDef.bundles) {
        // Ensure bundle exists in permission_bundles before inserting
        const bExists = await db.query(
          'SELECT 1 FROM platform.permission_bundles WHERE bundle_key = $1',
          [bundleKey]
        );
        if (bExists.rows.length > 0) {
          await db.query(
            `INSERT INTO platform.role_bundles (role_id, tenant_id, bundle_key, opted_in_keys)
             VALUES ($1, $2, $3, '{}')
             ON CONFLICT (role_id, bundle_key) DO NOTHING`,
            [roleId, tenantId, bundleKey]
          );
        }
      }
    }
  }
}
