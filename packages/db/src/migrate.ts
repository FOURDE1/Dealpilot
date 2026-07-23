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
  const host = new URL(databaseUrl).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'db') {
    throw new Error(`Refusing to reset non-local database host "${host}"`);
  }
  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO dealpilot');
    await client.query('GRANT USAGE ON SCHEMA public TO public');
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
