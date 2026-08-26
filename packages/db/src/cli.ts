import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, resolveDatabaseUrl } from './index.js';
import { migrate, reset } from './migrate.js';

/**
 * db CLI (A-04): `node dist/cli.js migrate | reset | platform-grant <email> [role]`
 *
 * `platform-grant` (F-69) is the bootstrap for the first platform super
 * admin — the NULL-actor path of platform_staff_grant(), legal only while no
 * active super admin exists; afterwards staff are granted from the console.
 * Prints the target database BEFORE writing (memory: db:reset once resolved
 * to the owner's dev database and wiped the seeded account).
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const command = process.argv[2];
const databaseUrl = resolveDatabaseUrl();
const pool = createPool({ connectionString: databaseUrl, max: 2 });

try {
  if (command === 'migrate') {
    const applied = await migrate(pool, migrationsDir);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
  } else if (command === 'reset') {
    const applied = await reset(pool, migrationsDir, databaseUrl);
    console.log(`Reset complete. Applied: ${applied.join(', ')}`);
  } else if (command === 'platform-grant') {
    const email = process.argv[3];
    const role = process.argv[4] ?? 'platform_super_admin';
    if (!email) {
      console.error('Usage: cli.js platform-grant <email> [platform_super_admin|platform_support|platform_billing]');
      process.exitCode = 2;
    } else {
      const target = new URL(databaseUrl);
      console.log(`Granting ${role} to ${email} on ${target.hostname}:${target.port || '5432'}${target.pathname}`);
      try {
        const r = await pool.query<{ user_id: string; outcome: string }>(
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
      }
    }
  } else {
    console.error('Usage: cli.js <migrate|reset|platform-grant>');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
