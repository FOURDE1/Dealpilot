import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { DEFAULT_HOST_URL, disposableDatabaseUrl, ensureDatabase } from './test-db.js';

/**
 * F-74 — the *_test rule, and the CLI's positional-dbname pool swap.
 *
 * The rule group is a mutation set: every name the e2e path could plausibly
 * be pointed at by mistake must be REFUSED, because disposableDatabaseUrl is
 * what stands between "edit one literal" and "DROP SCHEMA on the owner's dev
 * database" (HO-07 — four lockouts before the reset guard existed).
 *
 * The pool-swap group exists because cli.ts builds its default pool at module
 * load: the natural implementation of `reset <dbname>` — swap the URL string,
 * reuse that pool — passes reset()'s name guard on the *_test string while
 * the DROP SCHEMA runs on the resolved default. These tests run the BUILT CLI
 * as a child process against a sentinel, so that wiring ever reappearing goes
 * red here instead of in someone's dev database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const cliPath = join(pkgDir, 'dist', 'cli.js');
const adminBase = process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL;

/** A database only this file uses; *_test so every guard on the path accepts it. */
const SWAP_DB = 'dealpilot_cliswap_test';

function swapped(name: string): string {
  const u = new URL(adminBase);
  u.pathname = `/${name}`;
  return u.toString();
}

describe('disposableDatabaseUrl — the *_test rule', () => {
  it('accepts disposable names and swaps only the database', () => {
    expect(new URL(disposableDatabaseUrl(adminBase, 'dealpilot_e2e_test')).pathname).toBe('/dealpilot_e2e_test');
    expect(new URL(disposableDatabaseUrl(adminBase, 'dealpilot_test')).pathname).toBe('/dealpilot_test');
    // Host/credentials come from the base, untouched.
    expect(disposableDatabaseUrl(adminBase, 'dealpilot_test')).toContain(new URL(adminBase).host);
  });

  it.each([
    'dealpilot', // the dev database — the one this rule exists for
    'dealpilot_e2e', // the pre-F-74 orphan: no suffix, no entry
    'postgres',
    'x_test; DROP', // not an identifier — the regex doubles as the SQL whitelist
    '',
    'DEALPILOT_TEST', // uppercase is not the identifier the rule names
  ])('refuses %j', (name) => {
    expect(() => disposableDatabaseUrl(adminBase, name)).toThrow(/_test/);
  });
});

describe('ensureDatabase — refusals come before any connection', () => {
  it('refuses a non-local host before interpolating CREATE DATABASE', async () => {
    // A reachable-looking remote URL: the host check must throw without pg
    // ever being asked to connect (no timeout wait — the rejection is fast).
    await expect(
      ensureDatabase('postgresql://dealpilot:dealpilot@db.example.com:5432/dealpilot', 'x_test'),
    ).rejects.toThrow(/non-local host/);
  });

  it('refuses a non-*_test name before connecting', async () => {
    // Port 9 answers nothing; a connection attempt would surface ECONNREFUSED
    // or a timeout. The _test message proves the guard ran first.
    await expect(
      ensureDatabase('postgresql://dealpilot:dealpilot@localhost:9/dealpilot', 'dealpilot'),
    ).rejects.toThrow(/_test/);
  });
});

describe('cli positional dbname — pool swap', () => {
  let dbUp = false;

  beforeAll(async () => {
    // The CLI is exercised as the built artifact — that is what the e2e
    // runner and the bootstrap helper invoke.
    const build = spawnSync('pnpm build', { cwd: pkgDir, shell: true, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`pnpm build failed:\n${build.stdout}\n${build.stderr}`);

    const probe = new pg.Pool({ connectionString: adminBase, max: 1, connectionTimeoutMillis: 5_000 });
    try {
      await probe.query('SELECT 1');
      dbUp = true;
    } catch {
      // In CI the database MUST be present — a silently-skipped suite must fail.
      if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED is set but no database is reachable');
    } finally {
      await probe.end();
    }
  }, 120_000);

  it('a non-*_test positional refuses before any connection is opened', () => {
    // Needs no database: the base URL points at a dead port, so a run that
    // got as far as connecting would fail with a network error instead of
    // the rule's own message.
    const deadBase = 'postgresql://dealpilot:dealpilot@localhost:9/dealpilot';
    for (const args of [
      ['reset', 'dealpilot_e2e'],
      ['platform-grant', 'x@1dealer.test', 'platform_super_admin', 'dealpilot'],
    ]) {
      const run = spawnSync(process.execPath, [cliPath, ...args], {
        env: { ...process.env, DB_ADMIN_URL: deadBase },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(run.status, run.stderr).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toMatch(/_test/);
      expect(`${run.stdout}${run.stderr}`).not.toMatch(/ECONNREFUSED/);
    }
  }, 60_000);

  it('reset <dbname> rebuilds the NAMED database, never the resolved default', async () => {
    if (!dbUp) return; // no local DB — self-skip (CI throws above via RLS_REQUIRED)

    // Sentinel: the CLI's resolved default is pointed at dealpilot_test. If
    // the positional path ever queries the module pool, the reset lands there
    // and the sentinel dies — a red test instead of a wiped database.
    await ensureDatabase(adminBase, 'dealpilot_test');
    const sentinelPool = new pg.Pool({ connectionString: swapped('dealpilot_test'), max: 1 });
    try {
      await sentinelPool.query('CREATE TABLE IF NOT EXISTS f74_pool_swap_sentinel (x int)');

      const run = spawnSync(process.execPath, [cliPath, 'reset', SWAP_DB], {
        env: { ...process.env, DB_ADMIN_URL: swapped('dealpilot_test') },
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toContain(`Reset complete (${SWAP_DB})`);

      const swapPool = new pg.Pool({ connectionString: swapped(SWAP_DB), max: 1 });
      try {
        const migrations = await swapPool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
        expect(Number(migrations.rows[0]!.n)).toBeGreaterThan(50);
      } finally {
        await swapPool.end();
      }

      const sentinel = await sentinelPool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'f74_pool_swap_sentinel'",
      );
      expect(sentinel.rowCount, 'the module-pool database was reset — the positional path leaked onto the default pool').toBe(1);
    } finally {
      await sentinelPool.end();
    }
  }, 120_000);

  it('platform-grant <email> <role> <dbname> writes to the NAMED database', async () => {
    if (!dbUp) return;

    // The grant needs a Better Auth account in the TARGET database (PA008
    // otherwise) — seeded directly because no API runs here; the product
    // path for this write is covered by the e2e journey's console grant.
    // The id must be uuid-shaped: "user".id is text, but the grant casts it
    // (`u.id::uuid`) for the platform_staff FK.
    const swapPool = new pg.Pool({ connectionString: swapped(SWAP_DB), max: 1 });
    try {
      await swapPool.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", "updatedAt") VALUES ('00000000-0000-4000-8000-00000000f074', 'Swap Test', 'f74-swap@1dealer.test', false, now()) ON CONFLICT (id) DO NOTHING`,
      );

      const run = spawnSync(
        process.execPath,
        [cliPath, 'platform-grant', 'f74-swap@1dealer.test', 'platform_super_admin', SWAP_DB],
        {
          env: { ...process.env, DB_ADMIN_URL: swapped('dealpilot_test') },
          encoding: 'utf8',
          timeout: 60_000,
        },
      );
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
      // The pre-write target line names the swapped database, not the default.
      expect(run.stdout).toContain(`/${SWAP_DB}`);
      expect(run.stdout).toContain('granted:');

      const staff = await swapPool.query<{ n: string }>('SELECT count(*) AS n FROM platform_staff');
      expect(Number(staff.rows[0]!.n)).toBe(1);
    } finally {
      await swapPool.end();
    }
  }, 60_000);
});
