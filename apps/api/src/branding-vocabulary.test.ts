import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { DarkMode, Density, FontFamily, Radius } from '@dealpilot/schemas';

/**
 * Branding vocabulary: the CHECK and the Zod enum are the SAME set.
 *
 * packages/db/src/enum-vocabulary.test.ts proves one direction for every enum
 * in the product — nothing the contract accepts may be refused by its column.
 * It deliberately does not prove the other: a CHECK may keep permitting a value
 * nothing produces, and that is exactly how `dark_mode='custom'` and
 * `font_family='custom'` lived from F-14 to F-75 — in the CHECK, in the enum,
 * in the editor's select, reachable by no code path that could honour them.
 *
 * F-75 wrote the first consumers of these four columns, and a consumer that has
 * to alias a value nobody can produce is the dead-vocabulary bug in new code.
 * So for the four branding enums the guard is EQUALITY, both directions: a
 * value added to the Zod enum without a migration, or left in a CHECK after the
 * enum dropped it, is a failure here. The two dropped WOFF columns are held
 * absent for the same reason — a column no route writes and no schema names
 * is the dead-column pattern with a different spelling.
 */

const ADMIN_URL = testAdminUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');

let admin: Pool;
let dbUp = false;

/** Column → the enum the contract binds to it. Postgres names the CHECK `<table>_<column>_check`. */
const VOCABULARIES = [
  ['font_family', FontFamily],
  ['dark_mode', DarkMode],
  ['radius', Radius],
  ['density', Density],
] as const;

/** Retired by 0070; nothing may bring them back without a producer and a consumer. */
const DROPPED_COLUMNS = ['font_woff2_key', 'font_woff2_bold_key'];

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

it('each branding CHECK is exactly its Zod enum — set equality, both directions', async (ctx) => {
  if (!dbUp) return ctx.skip();
  for (const [column, schema] of VOCABULARIES) {
    const r = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'tenant_branding'::regclass AND contype = 'c' AND conname = $1`,
      [`tenant_branding_${column}_check`],
    );
    expect(r.rows, `tenant_branding_${column}_check must exist`).toHaveLength(1);
    const def = r.rows[0]!.def;
    // The constraint must be ABOUT this column, so a renamed CHECK on another
    // column cannot satisfy the name lookup by accident.
    expect(def, `${column}: ${def}`).toMatch(new RegExp(`\\(\\(?${column}\\)?(?:::text)?\\s*=\\s*ANY`));
    // Postgres renders `col IN ('a','b')` as `col = ANY (ARRAY['a'::text, 'b'::text])`.
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
    const inCode = [...schema.options].sort();
    expect(inDb, `${column}: CHECK ${JSON.stringify(inDb)} vs enum ${JSON.stringify(inCode)}`).toEqual(inCode);
  }
});

it('the two WOFF columns 0070 dropped are absent, and the table is still there to be asked', async (ctx) => {
  if (!dbUp) return ctx.skip();
  const r = await admin.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_branding'
       AND column_name = ANY($1::text[])`,
    [[...DROPPED_COLUMNS, 'font_family']],
  );
  // `font_family` is the control: an empty result would also be what a missing
  // table returns, and a guard that passes on a missing table proves nothing.
  expect(r.rows.map((row) => row.column_name)).toEqual(['font_family']);
});
