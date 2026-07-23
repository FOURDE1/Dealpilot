import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, resolveDatabaseUrl } from './index.js';
import { migrate, reset } from './migrate.js';

/** db CLI (A-04): `node dist/cli.js migrate | reset` */
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
  } else {
    console.error('Usage: cli.js <migrate|reset>');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
