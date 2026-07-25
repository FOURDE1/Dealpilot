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
const DEFAULT_HOST_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const TEST_DB_NAME = 'dealpilot_test';

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
 * Create the test database if it is missing. Safe to call from every suite:
 * a concurrent creation surfaces as 42P04 (duplicate_database) and is ignored.
 */
export async function ensureTestDatabase(): Promise<void> {
  const maintenance = new pg.Pool({
    connectionString: process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await maintenance.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await maintenance.end();
  }
}
