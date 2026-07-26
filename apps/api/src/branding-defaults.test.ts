import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { BRANDING_DEFAULTS } from '@dealpilot/schemas';

/**
 * The platform's default brand exists in two places, and they have to agree.
 *
 * A tenant who has never opened the theme editor has no draft row, so the
 * editor is handed `null` and has to render something. `BRANDING_DEFAULTS` is
 * what it renders. The database has its own DEFAULT on each of those columns,
 * used the moment the first save creates the row.
 *
 * If those two ever disagree, the editor opens on one colour and saves a
 * different one — a bug that looks like the form ignoring you, and that no
 * amount of staring at the form would explain. So the values are read out of
 * the catalogue and compared, rather than trusted to stay in step.
 */

const ADMIN_URL = testAdminUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);

let admin: Pool;
let dbUp = false;

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
});

afterAll(async () => {
  await admin?.end();
});

/** `'inter'::text` / `'oklch(0.55 0.2 262)'::text` → the value itself. */
function literal(columnDefault: string | null): string | null {
  if (columnDefault === null) return null;
  const m = /^'(.*)'::/s.exec(columnDefault);
  return m ? m[1]!.replace(/''/g, "'") : columnDefault;
}

it('the defaults the editor shows are the defaults the database applies', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const r = await admin.query<{ column_name: string; column_default: string | null }>(
    `SELECT column_name, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_branding'`,
  );
  const fromDatabase = new Map(r.rows.map((row) => [row.column_name, literal(row.column_default)]));
  expect(fromDatabase.size).toBeGreaterThan(10);

  const mismatches: string[] = [];
  for (const [column, expected] of Object.entries(BRANDING_DEFAULTS)) {
    if (!fromDatabase.has(column)) {
      mismatches.push(`${column}: not a column on tenant_branding at all`);
      continue;
    }
    const actual = fromDatabase.get(column) ?? null;
    if (actual !== expected) {
      mismatches.push(`${column}: the editor shows ${JSON.stringify(expected)}, the database applies ${JSON.stringify(actual)}`);
    }
  }

  expect(
    mismatches,
    `the theme editor and the database disagree about what an unbranded tenant starts as — the editor would open on one value and save another:\n${mismatches.join('\n')}`,
  ).toEqual([]);
});
