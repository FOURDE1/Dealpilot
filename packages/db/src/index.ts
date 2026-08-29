import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

/**
 * @dealpilot/db — connection pooling and tenant-scoped query execution (A-04).
 *
 * Tenant isolation contract (multi-tenancy.md §4, ADR-007): every business
 * query runs inside `withTenant(orgId, ...)`, which opens a transaction and
 * sets the transaction-local GUC `app.org_id` via SET LOCAL semantics. All RLS
 * policies key on that GUC; a connection without it sees ZERO rows (FORCE RLS
 * + NULL comparison). The GUC dies with the transaction, so pooled connections
 * can never leak tenant context.
 */

const { Pool } = pg;

export interface DbConfig {
  connectionString: string;
  max?: number;
}

export function createPool(config: DbConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    // Fail fast instead of hanging on a dead database (CLAUDE.md: explicit timeouts).
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });
}

/**
 * Connection string resolution: explicit arg > DB_ADMIN_URL > DATABASE_URL >
 * local-dev owner default. DB_ADMIN_URL exists so migrations/db:reset keep
 * owner privileges while DATABASE_URL points the API at the RLS-bound
 * dealpilot_app role (HO-04 — a superuser API bypasses all RLS).
 */
export function resolveDatabaseUrl(explicit?: string): string {
  return (
    explicit ??
    process.env['DB_ADMIN_URL'] ??
    process.env['DATABASE_URL'] ??
    'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot'
  );
}

/**
 * F-71 (admin-console.md §7): the organization a live support session is
 * scoped to. The API's first request hook opens a store per request; the
 * impersonation gate fills it; `withContext` turns it into the transaction-
 * local GUC `app.impersonation_org`, which the 0067 policies and
 * `has_permission` read. Workers never open a store — unscoped, as today.
 */
export interface ConnectionScope {
  impersonationOrgId: string | null;
}
export const connectionScope = new AsyncLocalStorage<ConnectionScope>();

/** Transaction-local RLS context. At least one of the two must be set. */
export interface TxnContext {
  /** Tenant key for the 0001 isolation policies (`app.org_id`). */
  orgId?: string;
  /** Caller key for the 0003 user-scoped read policies (`app.user_id`). */
  userId?: string;
}

/**
 * Run `fn` inside a transaction with the RLS context GUCs set.
 * set_config(..., true) evaporates on COMMIT/ROLLBACK, so pooled connections
 * can never leak context. Values are bound as parameters — never interpolated.
 */
export async function withContext<T>(
  pool: pg.Pool,
  ctx: TxnContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!ctx.orgId && !ctx.userId) {
    throw new Error('withContext requires orgId and/or userId — a contextless transaction sees nothing');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ctx.orgId) await client.query("SELECT set_config('app.org_id', $1, true)", [ctx.orgId]);
    if (ctx.userId) await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    const scope = connectionScope.getStore();
    if (scope?.impersonationOrgId) {
      await client.query("SELECT set_config('app.impersonation_org', $1, true)", [scope.impersonationOrgId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection is dead mid-transaction: destroy it instead of returning a
      // poisoned client to the pool, and surface the ORIGINAL error.
      client.release(err as Error);
      throw err;
    }
    client.release();
    throw err;
  }
}

/** Tenant-scoped transaction: all RLS tenant policies key on `app.org_id`. */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withContext(pool, { orgId }, fn);
}

/**
 * User-scoped READ transaction (F-01): the 0003 policies let a signed-in user
 * see the organizations/stores/memberships they belong to (and their own
 * users row) before any tenant is picked. Reads only — writes still require
 * tenant context.
 */
export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withContext(pool, { userId }, fn);
}

export { migrate, reset } from './migrate.js';
export { ensureTestDatabase, testAdminUrl, testAppUrl } from './test-db.js';
export type { Pool, PoolClient } from 'pg';
