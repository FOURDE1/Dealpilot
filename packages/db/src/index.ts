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

/** Connection string resolution order: explicit arg > env > local-dev default. */
export function resolveDatabaseUrl(explicit?: string): string {
  return (
    explicit ??
    process.env['DATABASE_URL'] ??
    'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot'
  );
}

/**
 * Run `fn` inside a transaction scoped to one tenant. set_config(..., true)
 * is transaction-local — it evaporates on COMMIT/ROLLBACK. `orgId` is bound
 * as a parameter — never interpolated.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
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

export { migrate, reset } from './migrate.js';
