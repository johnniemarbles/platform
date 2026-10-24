import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { dbFromPglite } from '../../src/db-pglite.ts';
import { DevIdentityVerifier, signDevToken } from '@platform-core/iam-dev';
import { makeDispatcher, type PlatformApiConfig } from '../../src/handler.ts';
import { meRoutes } from '../../src/routes/me.ts';
import { makeHostResolver } from '../../src/host-router.ts';
import { collectMigrations } from '../../../../../tools/db/migrate.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteDefinition } from '@platform-core/route-kit';

const DEV_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface HarnessCaller {
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

export interface TestHarness {
  db: ReturnType<typeof dbFromPglite>;
  pg: PGlite;
  asRole(role: string): Promise<HarnessCaller>;
  asTenant(workspace: string, role: string): Promise<HarnessCaller>;
  asOtherApp(otherSlug: string): Promise<HarnessCaller>;
  close(): Promise<void>;
}

export async function setupHarness(slug: string, customPackDir?: string): Promise<TestHarness> {
  const rootDir = resolve(import.meta.dirname, '../../../../..');
  const packDir = customPackDir ?? resolve(rootDir, 'core/app-packs', slug);

  const appJsonPath = resolve(packDir, 'app.json');
  const rolesJsonPath = resolve(packDir, 'roles.json');

  const appJson = existsSync(appJsonPath) ? JSON.parse(readFileSync(appJsonPath, 'utf8')) : { appId: `app_${slug}`, slug };
  const rolesJson: Record<string, string[]> = existsSync(rolesJsonPath) ? JSON.parse(readFileSync(rolesJsonPath, 'utf8')) : {
    owner: ['me.read'],
    staff: ['me.read'],
    viewer: ['me.read'],
  };

  const pg = await PGlite.create({ extensions: { pgcrypto, btree_gist } });

  // Apply migrations
  const migrations = collectMigrations(rootDir);
  for (const m of migrations) {
    if (m.key.startsWith(`${slug}/`)) continue;
    const sql = readFileSync(m.path, 'utf8');
    await pg.exec(sql);
  }

  // Also apply migrations from this app pack if present
  const packMigrationsDir = resolve(packDir, 'migrations');
  if (existsSync(packMigrationsDir)) {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(packMigrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = readFileSync(resolve(packMigrationsDir, f), 'utf8');
      await pg.exec(sql);
    }
  }

  const db = dbFromPglite(pg);

  // Register app & client
  const appId = appJson.appId ?? `app_${slug}`;
  const clientId = `dev-${slug}`;
  await pg.query(
    'INSERT INTO platform.apps (app_id, display_name) VALUES ($1, $2) ON CONFLICT (app_id) DO NOTHING',
    [appId, appJson.displayName ?? slug]
  );
  await pg.query(
    "INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id) VALUES ($1, $2, 'dev', 'platform-dev') ON CONFLICT (client_id) DO NOTHING",
    [clientId, appId]
  );

  // Switch to non-superuser role so PostgreSQL enforces RLS (superusers bypass RLS)
  await pg.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER;
      END IF;
    END
    $$;
    GRANT ALL ON SCHEMA platform TO app_user;
    GRANT ALL ON ALL TABLES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA platform TO app_user;
    GRANT ALL ON ALL ROUTINES IN SCHEMA platform TO app_user;
    SET ROLE app_user;
  `);

  // Dynamically load routes from pack if index.ts exists
  let packRoutes: RouteDefinition[] = [];
  const packIndexPath = resolve(packDir, 'src/index.ts');
  if (existsSync(packIndexPath)) {
    try {
      // Ensure local symlink to route-kit exists if pack has no node_modules
      const packModules = resolve(packDir, 'node_modules/@platform-core');
      const routeKitDest = resolve(packModules, 'route-kit');
      if (!existsSync(routeKitDest)) {
        const { mkdirSync, symlinkSync } = await import('node:fs');
        mkdirSync(packModules, { recursive: true });
        symlinkSync(resolve(rootDir, 'core/packages/route-kit'), routeKitDest, 'junction');
      }
      const mod = await import(packIndexPath);
      if (typeof mod.routes === 'function') {
        packRoutes = mod.routes();
      }
    } catch (e) {
      console.warn('[harness] warning loading pack routes:', e);
    }
  }

  const verifier = new DevIdentityVerifier({ secret: DEV_SECRET, productionGuard: 'allow' });
  const config: PlatformApiConfig = {
    db,
    identity: verifier,
    resolveTenantFromHost: makeHostResolver(db),
  };

  const allRoutes = [...meRoutes(), ...packRoutes];
  const dispatcher = makeDispatcher(allRoutes, config);

  const defaultTenantWorkspace = `${slug}-test`;

  async function ensureTenant(workspace: string): Promise<string> {
    const r = await pg.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM platform.tenants WHERE workspace_name = $1',
      [workspace]
    );
    if (r.rows[0]) return r.rows[0].tenant_id;

    const ins = await pg.query<{ tenant_id: string }>(
      `INSERT INTO platform.tenants (account_id, country, region, workspace_name)
       VALUES (gen_random_uuid(), 'US', 'us-east-1', $1)
       RETURNING tenant_id`,
      [workspace]
    );
    const tenantId = ins.rows[0]!.tenant_id;
    await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
    await pg.query(
      'INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [tenantId, appId]
    );
    return tenantId;
  }

  async function ensureMembership(tenantId: string, role: string): Promise<{ personId: string; subject: string }> {
    const subject = `usr_${role}_${tenantId.slice(0, 8)}`;
    const m = await pg.query<{ person_id: string }>(
      'SELECT person_id FROM platform.memberships WHERE tenant_id = $1 AND identity_subject_id = $2',
      [tenantId, subject]
    );
    let personId: string;
    if (m.rows[0]) {
      personId = m.rows[0].person_id;
    } else {
      const ins = await pg.query<{ membership_id: string; person_id: string }>(
        `INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
         VALUES ($1, gen_random_uuid(), 'dev', 'platform-dev', $2)
         RETURNING membership_id, person_id`,
        [tenantId, subject]
      );
      const membershipId = ins.rows[0]!.membership_id;
      personId = ins.rows[0]!.person_id;

      const perms = rolesJson[role] ?? ['me.read'];
      await pg.query(
        `INSERT INTO platform.role_assignments (membership_id, app_id, role_key, permissions, hierarchy_scope, granted_by)
         VALUES ($1, $2, $3, $4, 'root', $5)`,
        [membershipId, appId, role, perms, personId]
      );
    }
    return { personId, subject };
  }

  function createCaller(workspace: string, subject: string, aud = clientId): HarnessCaller {
    return {
      async request(method: string, path: string, body?: unknown) {
        const token = signDevToken({ sub: subject, iss: 'platform-dev', aud }, DEV_SECRET);
        const [pathname, search] = path.split('?');
        const reqObj: Partial<IncomingMessage> = {
          method,
          url: search ? `${pathname}?${search}` : pathname,
          headers: {
            authorization: `Bearer ${token}`,
            host: `${workspace}.platform.test`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
        };
        if (body !== undefined) {
          const raw = Buffer.from(JSON.stringify(body));
          (reqObj as any)[Symbol.asyncIterator] = async function* () {
            yield raw;
          };
        }

        return new Promise<{ status: number; body: any }>((resolve) => {
          const mockRes = {
            statusCode: 200,
            setHeader() {},
            end(chunk: string) {
              try {
                resolve({ status: mockRes.statusCode, body: JSON.parse(chunk) });
              } catch {
                resolve({ status: mockRes.statusCode, body: chunk });
              }
            },
          } as unknown as ServerResponse;
          dispatcher(reqObj as IncomingMessage, mockRes);
        });
      },
    };
  }

  return {
    db,
    pg,
    async asRole(role: string) {
      const tenantId = await ensureTenant(defaultTenantWorkspace);
      const { subject } = await ensureMembership(tenantId, role);
      return createCaller(defaultTenantWorkspace, subject);
    },
    async asTenant(workspace: string, role: string) {
      const tenantId = await ensureTenant(workspace);
      const { subject } = await ensureMembership(tenantId, role);
      return createCaller(workspace, subject);
    },
    async asOtherApp(otherSlug: string) {
      const tenantId = await ensureTenant(defaultTenantWorkspace);
      const safeSlug = otherSlug.replace(/-/g, '_');
      const otherAppId = `app_${safeSlug}`;
      const otherClientId = `dev-${otherSlug}`;
      await pg.query(
        'INSERT INTO platform.apps (app_id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [otherAppId, otherSlug]
      );
      await pg.query(
        "INSERT INTO platform.app_clients (client_id, app_id, identity_provider, identity_pool_id) VALUES ($1, $2, 'dev', 'platform-dev') ON CONFLICT DO NOTHING",
        [otherClientId, otherAppId]
      );
      await pg.query("SELECT set_config('app.tenant_id', $1::text, false)", [tenantId]);
      await pg.query(
        'INSERT INTO platform.tenant_apps (tenant_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [tenantId, otherAppId]
      );

      const otherSubject = `usr_other_${otherSlug}`;
      await pg.query(`
        INSERT INTO platform.memberships (tenant_id, person_id, identity_provider, identity_pool_id, identity_subject_id)
        VALUES ($1, gen_random_uuid(), 'dev', 'platform-dev', $2)
        ON CONFLICT DO NOTHING;
      `, [tenantId, otherSubject]);

      return createCaller(defaultTenantWorkspace, otherSubject, otherClientId);
    },
    async close() {
      await db.close();
    },
  };
}
