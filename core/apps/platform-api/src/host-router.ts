import type { DbClient } from './db.ts';

export function makeHostResolver(db: DbClient): (host: string | undefined) => Promise<string | null> {
  const cache = new Map<string, string>();
  return async (host) => {
    if (!host) return null;
    const workspace = host.split('.')[0];
    if (!workspace) return null;
    const cached = cache.get(workspace);
    if (cached) return cached;
    const r = await db.query<{ tenant_id: string }>(
      `SELECT tenant_id::text FROM platform.tenants WHERE workspace_name = $1`,
      [workspace],
    );
    const row = r.rows[0];
    if (!row) return null;
    cache.set(workspace, row.tenant_id);
    return row.tenant_id;
  };
}
