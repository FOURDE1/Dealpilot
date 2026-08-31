import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, resolveDatabaseUrl } from './index.js';
import { migrate, reset } from './migrate.js';
import { DEFAULT_HOST_URL, disposableDatabaseUrl, ensureDatabase } from './test-db.js';

/**
 * db CLI (A-04): `node dist/cli.js migrate | reset [dbname] | platform-grant <email> [role] [dbname]`
 *
 * `platform-grant` (F-69) is the bootstrap for the first platform super
 * admin — the NULL-actor path of platform_staff_grant(), legal only while no
 * active super admin exists; afterwards staff are granted from the console.
 * Prints the target database BEFORE writing (memory: db:reset once resolved
 * to the owner's dev database and wiped the seeded account).
 *
 * The optional [dbname] positional (F-74) exists for the e2e runner. It goes
 * through disposableDatabaseUrl(), whose *_test rule refuses any other name
 * BEFORE a connection exists, and the verb then runs on a SECOND pool built
 * from the swapped URL — the module-level pool below is never queried on a
 * positional path (pg.Pool connects lazily, so its end() stays a no-op). The
 * tempting shortcut — swap the URL string, reuse the pool — would have
 * reset() check its guards against the *_test name while the DROP SCHEMA ran
 * on whatever the resolved default names, which is the HO-07 lockout with the
 * safety mechanism reporting success.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const command = process.argv[2];
const databaseUrl = resolveDatabaseUrl();
const pool = createPool({ connectionString: databaseUrl, max: 2 });

/**
 * Base for positional-dbname paths: host-shaped, owner credentials. Never
 * DATABASE_URL — that carries the RLS-bound dealpilot_app role, and a
 * CREATE DATABASE as dealpilot_app fails in a way that reads as a
 * permissions bug rather than as a misconfiguration.
 */
const adminBase = process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL;

try {
  if (command === 'migrate') {
    const applied = await migrate(pool, migrationsDir);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
  } else if (command === 'reset') {
    const dbname = process.argv[3];
    if (dbname) {
      // Refuses any non-*_test name here, before a single connection exists.
      const url = disposableDatabaseUrl(adminBase, dbname);
      // The reset path also CREATES the database: the e2e database exists in
      // no container image, so "reset from zero" must include existence.
      await ensureDatabase(adminBase, dbname);
      const target = createPool({ connectionString: url, max: 2 });
      try {
        const applied = await reset(target, migrationsDir, url);
        console.log(`Reset complete (${dbname}). Applied: ${applied.join(', ')}`);
      } finally {
        await target.end();
      }
    } else {
      const applied = await reset(pool, migrationsDir, databaseUrl);
      console.log(`Reset complete. Applied: ${applied.join(', ')}`);
    }
  } else if (command === 'platform-grant') {
    const email = process.argv[3];
    const role = process.argv[4] ?? 'platform_super_admin';
    const dbname = process.argv[5];
    if (!email) {
      console.error('Usage: cli.js platform-grant <email> [platform_super_admin|platform_support|platform_billing] [dbname]');
      process.exitCode = 2;
    } else {
      const grantUrl = dbname ? disposableDatabaseUrl(adminBase, dbname) : databaseUrl;
      const grantPool = dbname ? createPool({ connectionString: grantUrl, max: 2 }) : pool;
      const target = new URL(grantUrl);
      console.log(`Granting ${role} to ${email} on ${target.hostname}:${target.port || '5432'}${target.pathname}`);
      try {
        const r = await grantPool.query<{ user_id: string; outcome: string }>(
          'SELECT * FROM platform_staff_grant(NULL, $1, $2, $3)',
          [email, role, 'cli bootstrap'],
        );
        console.log(`${r.rows[0]?.outcome ?? 'unchanged'}: ${email} (${r.rows[0]?.user_id ?? '?'})`);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'PA008') console.error(`No account for ${email} — the person must sign up first.`);
        else if (code === 'PA010') console.error('Bootstrap closed — an active platform_super_admin exists; grant from the console (POST /api/v1/admin/staff).');
        else console.error((err as Error).message);
        process.exitCode = 1;
      } finally {
        if (dbname) await grantPool.end();
      }
    }
  } else {
    console.error('Usage: cli.js <migrate|reset [dbname]|platform-grant <email> [role] [dbname]>');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
