import pg from 'pg';

/**
 * Isolated test database (HO-07). Every integration suite calls `reset()`,
 * which drops and rebuilds the schema — pointed at the shared dev database it
 * deleted the owner's seeded account on every merge-gate run (three lockouts).
 * Suites now target `dealpilot_test`, created on demand, so dev data survives.
 *
 * Roles are cluster-wide in Postgres, so `dealpilot_app` needs no re-creation;
 * the migrations re-grant it inside the new database.
 */
export const DEFAULT_HOST_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const TEST_DB_NAME = 'dealpilot_test';

/**
 * Only *_test databases are disposable — the same rule reset() enforces
 * before it drops a schema (migrate.ts), applied one step earlier so nothing
 * on the test or e2e path can even NAME the dev database. The pattern is also
 * the identifier whitelist for the CREATE DATABASE interpolation below: every
 * accepted name is a bare lowercase identifier, so it cannot smuggle SQL.
 */
const DISPOSABLE = /^[a-z][a-z0-9_]*_test$/;

function swapDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Admin (owner) connection string for the TEST database. */
export function testAdminUrl(): string {
  return swapDatabase(process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL, TEST_DB_NAME);
}

/** RLS-bound app-role connection string for the TEST database. */
export function testAppUrl(): string {
  return testAdminUrl().replace(/\/\/[^@]+@/, '//dealpilot_app:dealpilot_app_dev@');
}

/**
 * Connection string for a DISPOSABLE database (F-74). The name must match the
 * *_test rule or this throws before any connection exists; the base URL
 * contributes host, port and credentials only. The database name is forced by
 * the caller's code, never read from an environment variable — so a shell
 * with DB_ADMIN_URL pointing at the dev database still cannot aim a reset or
 * a grant at it through this function.
 */
export function disposableDatabaseUrl(baseUrl: string, name: string): string {
  if (!DISPOSABLE.test(name)) {
    throw new Error(
      `Refusing "${name}" — only *_test databases are disposable (lowercase identifier ending _test). ` +
        'This is the same rule reset() enforces before a DROP SCHEMA; the dev database cannot be named on this path.',
    );
  }
  return swapDatabase(baseUrl, name);
}

/**
 * Create a disposable database if it is missing. Safe to call from every
 * suite: a concurrent creation surfaces as 42P04 (duplicate_database) and is
 * ignored. The maintenance connection targets the BASE url's own database, so
 * a foreign cluster squatting on the same port (no `dealpilot` database)
 * fails loudly here instead of being silently adopted.
 *
 * The host check mirrors reset()'s (migrate.ts): this function interpolates
 * an identifier into CREATE DATABASE, and a hostile DB_ADMIN_URL must be
 * refused before anything executes remotely — the name rule alone would still
 * let a remote host receive the CREATE.
 */
export async function ensureDatabase(maintenanceUrl: string, name: string): Promise<void> {
  if (!DISPOSABLE.test(name)) {
    throw new Error(
      `Refusing to create "${name}" — only *_test databases are disposable (lowercase identifier ending _test).`,
    );
  }
  const host = new URL(maintenanceUrl).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'db') {
    throw new Error(`Refusing to CREATE DATABASE on non-local host "${host}"`);
  }
  const maintenance = new pg.Pool({
    connectionString: maintenanceUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await maintenance.query(`CREATE DATABASE ${name}`);
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await maintenance.end();
  }
}

/** The integration suites' database, created on demand (behaviour unchanged). */
export async function ensureTestDatabase(): Promise<void> {
  await ensureDatabase(process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL, TEST_DB_NAME);
}
