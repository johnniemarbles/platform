import type { CredentialClass } from '@platform-core/db-context';

export interface QueryResult<Row> { readonly rows: readonly Row[]; }
export interface DbClient {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<void>;
}
export interface Transaction extends DbClient { commit(): Promise<void>; rollback(): Promise<void>; }
export interface Db extends DbClient { begin(): Promise<Transaction>; close(): Promise<void>; }

export interface RequestContext {
  readonly tenantId: string;
  readonly appId: string;
  readonly hierarchyScope: string;
  readonly credentialClass: CredentialClass;
  readonly grantId?: string;
}

export async function withRequestContext<T>(db: Db, ctx: RequestContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.begin();
  try {
    await tx.query(
      'SELECT platform.set_request_context($1, $2, $3, $4, $5)',
      [ctx.tenantId, ctx.appId, ctx.hierarchyScope, ctx.credentialClass, ctx.grantId ?? null],
    );
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (e) { try { await tx.rollback(); } catch { /* ignore */ } throw e; }
}
