import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { signDevToken } from '@platform-core/iam-dev';
import { loadManifest } from '../manifest.ts';

export interface SeedDevOptions {
  manifestPath: string;
  platformRoot: string;
  databaseUrl?: string;
  secret?: string;
}

export function isAllowedDatabaseHost(dbUrl: string): boolean {
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.railway.internal') ||
      host.includes('staging')
    );
  } catch {
    return false;
  }
}

export async function seedDev(options: SeedDevOptions): Promise<{ token: string; tenantId: string; personId: string }> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('seed-dev refuses to run in production (NODE_ENV=production)');
  }

  const manifest = loadManifest(options.manifestPath, options.platformRoot);
  const dbUrl = options.databaseUrl ?? process.env['DATABASE_URL'];
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required for seed-dev');
  }

  if (!isAllowedDatabaseHost(dbUrl)) {
    throw new Error(`seed-dev refuses to connect to host: ${dbUrl}`);
  }

  const secret = options.secret ?? process.env['DEV_IDENTITY_SECRET'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const packDir = resolve(options.platformRoot, 'core/app-packs', manifest.slug);
  const rolesJsonPath = resolve(packDir, 'roles.json');
  let ownerPermissions = ['me.read'];
  if (existsSync(rolesJsonPath)) {
    try {
      const roles = JSON.parse(readFileSync(rolesJsonPath, 'utf8'));
      if (Array.isArray(roles.owner)) ownerPermissions = roles.owner;
    } catch {
      // ignore
    }
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    // 1. App
    await pool.query(
      `INSERT INTO platform.apps (app_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (app_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [manifest.appId, manifest.displayName]
    );

    // 2. Clients
    const devClients = manifest.identityClients['dev'] ?? [];
    for (const c of devClients) {
      await pool.query(
        `INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id) DO NOTHING`,
        [c.clientId, manifest.appId, c.provider, c.poolId]
      );
    }

    // 3. Tenant
    const workspaceName = `${manifest.slug}-dev`;
    const tRes = await pool.query<{ tenant_id: string }>(
      `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
       VALUES (gen_random_uuid(), 'IN', 'ap-south-1', $1)
       ON CONFLICT (account_id, country) DO UPDATE SET workspace_name = EXCLUDED.workspace_name
       RETURNING tenant_id`,
      [workspaceName]
    ).catch(async () => {
      return pool.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM platform.tenants WHERE workspace_name = $1',
        [workspaceName]
      );
    });

    const tenantId = tRes.rows[0]?.tenant_id;
    if (!tenantId) throw new Error('Failed to resolve or create dev tenant');

    // 4. Activate app for tenant
    await pool.query(
      `INSERT INTO platform.tenant_apps (tenant_id, app_id)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id, app_id) DO NOTHING`,
      [tenantId, manifest.appId]
    );

    // 5. Person & Membership
    const devSubject = 'usr_dev_owner';
    const mRes = await pool.query<{ membership_id: string; person_id: string }>(
      `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
       VALUES ($1, gen_random_uuid(), 'dev', 'dev', $2)
       ON CONFLICT (identity_pool_id, identity_subject_id, tenant_id) DO UPDATE SET state = 'ACTIVE'
       RETURNING membership_id, person_id`,
      [tenantId, devSubject]
    );

    const membershipId = mRes.rows[0]!.membership_id;
    const personId = mRes.rows[0]!.person_id;

    // 6. Role assignment
    await pool.query(
      `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
       VALUES ($1, $2, 'owner', $3, $4, $5)`,
      [membershipId, manifest.appId, ownerPermissions, `tenant/${tenantId}`, personId]
    );

    // 7. Mint token
    const token = signDevToken(
      {
        sub: devSubject,
        iss: 'dev',
        aud: `dev-${manifest.slug}`,
        exp: Math.floor(Date.now() / 1000) + 8 * 3600,
      },
      secret
    );

    console.log(`[seed-dev] Seeded dev environment for app ${manifest.appId}:`);
    console.log(`  Tenant:     ${tenantId} (${workspaceName})`);
    console.log(`  Person:     ${personId} (${devSubject})`);
    console.log(`  Audience:   dev-${manifest.slug}`);
    console.log(`  Token:      ${token}`);

    return { token, tenantId, personId };
  } finally {
    await pool.end();
  }
}
