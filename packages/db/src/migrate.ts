import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

/**
 * Minimal, deterministic SQL migration runner (A-04).
 * - Files: packages/db/migrations/YYYYMMDDHHMMSS_<slug>.sql, applied in
 *   filename order, each inside its own transaction.
 * - Ledger: schema_migrations records filename + sha256; a checksum mismatch
 *   on an already-applied file aborts — merged migrations are immutable
 *   (TEAM-WORKFLOW §5); fixes are always a NEW migration.
 */

const MIGRATION_FILE = /^\d{14}_[a-z0-9-]+\.sql$/;

export interface AppliedMigration {
  filename: string;
  checksum: string;
}

async function ensureLedger(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Serialize concurrent migrate runs (two runners fail loudly, never corrupt).
    await client.query('SELECT pg_advisory_lock(72347001)');
    await ensureLedger(client);
    const { rows } = await client.query<AppliedMigration>(
      'SELECT filename, checksum FROM schema_migrations',
    );
    const ledger = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const filename of files) {
      const sql = await readFile(join(migrationsDir, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const known = ledger.get(filename);
      if (known !== undefined) {
        if (known !== checksum) {
          throw new Error(
            `Migration ${filename} was modified after being applied (checksum mismatch). ` +
              'Applied migrations are immutable — write a new migration instead.',
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          filename,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${(err as Error).message}`);
      }
      applied.push(filename);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(72347001)').catch(() => undefined);
    client.release();
  }
}

/**
 * Dev/CI only: drop everything in `public` and rebuild from migration zero.
 * Refuses to run against anything that does not look like a local database.
 */
export async function reset(pool: pg.Pool, migrationsDir: string, databaseUrl: string): Promise<string[]> {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'db') {
    throw new Error(`Refusing to reset non-local database host "${host}"`);
  }
  // HO-07, and again on 2026-07-26: `pnpm db:reset` resolves DATABASE_URL, which
  // in a dev shell is the DEVELOPER'S database, not the test one. Running it to
  // refresh the test schema silently destroys the owner's login and any data he
  // was in the middle of looking at — it locked him out four times before this
  // guard existed. The test database is safe by name; anything else has to be
  // asked for out loud.
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test') && process.env['DB_RESET_CONFIRM'] !== dbName) {
    throw new Error(
      `Refusing to DROP SCHEMA on "${dbName}" — this is not a *_test database and it probably has someone's work in it. ` +
        `If you really mean it: DB_RESET_CONFIRM=${dbName} pnpm --filter @dealpilot/db run db:reset`,
    );
  }
  const client = await pool.connect();
  try {
    // A suite that ended a moment ago may still have a backend draining, and
    // DROP SCHEMA waits on its locks. Waiting forever turns a flake into a hung
    // CI job; failing after ten seconds turns it into a report.
    await client.query("SET lock_timeout = '10s'");
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO dealpilot');
    await client.query('GRANT USAGE ON SCHEMA public TO public');
  } catch (cause) {
    // One full-suite run failed here and passed alone and on re-run, which is
    // the least useful bug report there is. Whoever sees it next gets the
    // Postgres code AND who was holding the database, rather than a bare
    // "beforeAll failed" and an afternoon of guessing.
    const code = (cause as { code?: string }).code ?? 'unknown';
    let holders = 'could not be read';
    try {
      const busy = await client.query<{ pid: number; state: string; query: string }>(
        `SELECT pid, state, left(query, 120) AS query
         FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
      holders = busy.rows.length === 0
        ? 'nobody else was connected'
        : busy.rows.map((r) => `pid ${r.pid} [${r.state}] ${r.query}`).join(' | ');
    } catch {
      // The diagnostic must never replace the real error.
    }
    throw new Error(
      `reset("${dbName}") could not rebuild the schema (pg code ${code}). Other connections: ${holders}`,
      { cause },
    );
  } finally {
    client.release();
  }
  const applied = await migrate(pool, migrationsDir);
  // Dev-only bootstrap (host verified local above): grant the app role LOGIN
  // with the well-known dev password so the RLS suite and local API can
  // connect. Staging/prod roles get credentials from Secrets Manager (D-022).
  await pool.query("ALTER ROLE dealpilot_app LOGIN PASSWORD 'dealpilot_app_dev'");
  return applied;
}
