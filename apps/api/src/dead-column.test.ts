import { afterAll, beforeAll, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';

/**
 * Dead-column guard.
 *
 * Three times in one week the same bug arrived wearing different clothes:
 *
 *  - `deals.sold_as_is` — in the input schema, in the migration, read by the
 *    document generator, and in NO insert. The API accepted the value, answered
 *    201, and dropped it (CR-12, found by Hussein).
 *  - `warranty_agreement` / `gap_agreement` / `aftermarket_agreement` — in the
 *    CHECK, the catalogue and eighteen golden tests, producible by no deal
 *    (F-13b, found by the reachability guard).
 *  - `dispatch_assignments.customer_notified_at` — a column since F-11's first
 *    migration with nothing ever writing to it, so the board could report that
 *    a customer had been told when nobody had told them (F-11c).
 *
 * Each was invisible: nothing failed, nothing warned, and the tests covering
 * the feature passed. What they share is a column the application can never
 * write. That is what this checks — against the database catalogue, so a column
 * added tomorrow is included without anybody remembering to add it here.
 *
 * The check is deliberately coarse: it looks for the column name in the places
 * this codebase writes columns from. A false positive costs one line in
 * DELIBERATELY_UNWRITTEN with a reason, which is a fair price — a reason
 * written down is worth more than a column nobody has thought about.
 *
 * KNOWN BLIND SPOT: evidence is matched by column NAME, not table.column,
 * because a SQL fragment rarely carries its table. So a dead column is masked
 * by a live column of the same name on another table — `stores.esign_platform`
 * hid behind `deal_documents.esign_platform` on this guard's first run and had
 * to be found by reading the output rather than by the assertion. Qualifying it
 * properly needs a SQL parser; until then, treat a name shared across tables as
 * unchecked rather than checked.
 */

const ADMIN_URL = testAdminUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');

let admin: Pool;
let dbUp = false;

/** Infrastructure every table carries; never written by name from a route. */
const STRUCTURAL = new Set([
  'id', 'organization_id', 'store_id', 'created_at', 'updated_at', 'deleted_at', 'seq',
]);

/**
 * Columns nothing writes ON PURPOSE. Each needs a reason, because "we meant to"
 * is exactly what the three bugs above would have claimed.
 */
const DELIBERATELY_UNWRITTEN: Record<string, string> = {
  // Written by the trigger deal_fi_products_sync, not by any route — on
  // purpose: they are money desking reads, and a route that forgot to re-sum
  // would pay someone the wrong commission (F-13b).
  'deals.fi_price_cents': 'maintained by trigger deal_fi_products_sync',
  'deals.fi_cost_cents': 'maintained by trigger deal_fi_products_sync',

  // Written by the invitation_accept() SQL function, not by a route: accepting
  // an invitation has to reactivate a membership and stamp acceptance in one
  // indivisible step, or a re-invited colleague ends up with two memberships
  // (F-12).
  'invitations.accepted_at': 'written by invitation_accept()',
  'invitations.accepted_user_id': 'written by invitation_accept()',

  // AI lead scoring is not built. The column ships with the table rather than
  // arriving in a migration later; named here so it is a known gap and not a
  // forgotten one.
  'leads.score': 'F-14 AI scoring not built yet',
};

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

/** Every non-test source file in a directory. */
function sourceIn(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * The places this codebase writes a column from:
 *  - an INSERT's column list
 *  - a `SET col = ...` clause
 *  - a `*_COLUMNS` whitelist (Set or plain array), which is how the generic
 *    update routes decide what may be written
 *  - `sets.push('col = ...')` / `setEntries.push(['col', …])` builders
 *  - a `Create*Input` / `Update*Input` SCHEMA, because the generic routes write
 *    whatever those accept, via Object.entries(input)
 *
 * READ models are deliberately excluded. `DispatchAssignment` has listed
 * `customer_notified_at` since the day it was written — counting a field
 * because something can DISPLAY it is precisely how a column nothing writes
 * goes on looking alive.
 */
function writeEvidence(apiSrc: string, schemaSrc: string): string {
  const parts: string[] = [];
  for (const m of apiSrc.matchAll(/INSERT\s+INTO\s+\w+\s*\(([^)]*)\)/gis)) parts.push(m[1]!);
  for (const m of apiSrc.matchAll(/SET\s+([\s\S]{0,400}?)(?:WHERE|RETURNING|`)/gis)) parts.push(m[1]!);
  for (const m of apiSrc.matchAll(/_COLUMNS\s*=\s*(?:new Set\()?\[([\s\S]*?)\]/gis)) parts.push(m[1]!);
  for (const m of apiSrc.matchAll(/(?:sets|setEntries|stamps)\.push\(([\s\S]{0,200}?)\);/gis)) parts.push(m[1]!);
  for (const m of schemaSrc.matchAll(
    /export const (?:Create|Update)\w*Input\s*=([\s\S]*?)\n(?=export |\/\*\*)/gis,
  )) {
    parts.push(m[1]!);
  }
  return parts.join('\n');
}

it('every column the app is expected to write, it can write', async (ctx) => {
  if (!dbUp) return ctx.skip();

  // Tenant-scoped business tables only: auth tables belong to Better Auth and
  // the migration bookkeeping table belongs to the migrator.
  const cols = await admin.query<{ table_name: string; column_name: string; has_default: boolean }>(
    `SELECT c.table_name, c.column_name, (c.column_default IS NOT NULL) AS has_default
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns o
         WHERE o.table_schema = 'public' AND o.table_name = c.table_name
           AND o.column_name = 'organization_id'
       )
     ORDER BY c.table_name, c.ordinal_position`,
  );
  expect(cols.rows.length).toBeGreaterThan(50);

  const evidence = writeEvidence(
    sourceIn(here),
    sourceIn(join(here, '..', '..', '..', 'packages', 'schemas', 'src')),
  );
  const dead: string[] = [];
  for (const row of cols.rows) {
    const qualified = `${row.table_name}.${row.column_name}`;
    if (STRUCTURAL.has(row.column_name)) continue;
    if (qualified in DELIBERATELY_UNWRITTEN) continue;
    // A column with a DEFAULT has a value without anyone writing it; it is only
    // dead if it is also never set, which the same check covers.
    if (new RegExp(`\\b${row.column_name}\\b`).test(evidence)) continue;
    dead.push(qualified);
  }

  expect(
    dead,
    `these columns exist in the database and NOTHING in the API can write them — either wire them up, or register them in DELIBERATELY_UNWRITTEN with the reason: ${dead.join(', ')}`,
  ).toEqual([]);
});
