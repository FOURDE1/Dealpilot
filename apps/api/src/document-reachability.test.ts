import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requiredDocuments, type DealShape } from '@dealpilot/core';

/**
 * Dead-vocabulary guard for the document catalogue (F-13b).
 *
 * `warranty_agreement`, `gap_agreement` and `aftermarket_agreement` were in the
 * database CHECK, in the type enum, in the catalogue, and in golden tests — and
 * no real deal could produce any of them, because the only F&I the system
 * stored was one unnamed aggregate and the generator passed no products at all.
 * Three of thirteen document types were decoration. Nothing failed; the tests
 * that covered them passed by handing `requiredDocuments()` products that no
 * code path ever built.
 *
 * So the vocabulary is read from the DATABASE — the constraint itself, not a
 * list in TypeScript that could drift from it — and every value in it has to be
 * producible by some deal. A fourteenth type added to a migration with no rule
 * behind it fails here, on the day it is added.
 */

const ADMIN_URL = testAdminUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
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

/**
 * Deal shapes a dealership actually writes. Not every combination — the point
 * is that each type has at least one honest deal behind it.
 */
const SHAPES: DealShape[] = [
  { dealType: 'cash', province: 'QC', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'CAMS' },
  { dealType: 'finance', province: 'QC', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'CAMS' },
  { dealType: 'lease', province: 'QC', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'Merlin' },
  { dealType: 'cash', province: 'ON', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'CAMS' },
  { dealType: 'cash', province: 'QC', tradeLienCents: 750_000, soldAsIs: false, billOfSaleSystem: 'CAMS' },
  { dealType: 'cash', province: 'QC', tradeLienCents: 0, soldAsIs: true, billOfSaleSystem: 'CAMS' },
  { dealType: 'cash', province: 'QC', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'CAMS', vehicleType: 'used' },
];

/**
 * The F&I shape is built from the kinds `deal_fi_products` can STORE, not from
 * a list written here — which is the whole correction.
 *
 * Handing `requiredDocuments()` a product literal is how the three dead types
 * looked covered for as long as they did: the golden tests passed products that
 * no code path could produce, so the tests proved the rule and said nothing
 * about whether a dealership could ever reach it. Reading the kinds from the
 * table means this fails if the table is gone, if a kind is added with no
 * agreement behind it, or if F&I goes back to being one unnamed aggregate.
 */
async function storableFiShape(pool: Pool): Promise<DealShape> {
  const def = await pool.query<{ src: string }>(
    `SELECT pg_get_constraintdef(oid) AS src FROM pg_constraint
     WHERE conrelid = 'deal_fi_products'::regclass AND conname LIKE '%kind%'`,
  );
  if (def.rows.length !== 1) throw new Error('no kind CHECK on deal_fi_products — F&I is not itemised');
  const kinds = [...def.rows[0]!.src.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  return {
    dealType: 'finance', province: 'QC', tradeLienCents: 0, soldAsIs: false, billOfSaleSystem: 'CAMS',
    fiProducts: kinds.map((k) => ({ kind: k as 'warranty' | 'gap' | 'aftermarket', name: `${k} product` })),
  };
}

it('every document type the database allows is producible by some deal', async (ctx) => {
  if (!dbUp) return ctx.skip();

  // The vocabulary as the database states it — pg_get_constraintdef, so this
  // cannot drift from the migration the way a hand-kept list would.
  const def = await admin.query<{ src: string }>(
    `SELECT pg_get_constraintdef(oid) AS src FROM pg_constraint
     WHERE conrelid = 'deal_documents'::regclass AND conname LIKE '%document_type%'`,
  );
  expect(def.rows.length, 'no document_type CHECK constraint found').toBe(1);
  const allowed = [...def.rows[0]!.src.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  expect(allowed.length).toBeGreaterThan(10);

  const shapes = [...SHAPES, await storableFiShape(admin)];
  const producible = new Set(shapes.flatMap((s) => requiredDocuments(s)).map((d) => d.type));
  const dead = allowed.filter((t) => !producible.has(t as never));

  expect(
    dead,
    `these document types cannot be produced by any deal — either give them a rule in requiredDocuments() or take them out of the CHECK: ${dead.join(', ')}`,
  ).toEqual([]);
});

it('nothing is generated that the database would reject', async (ctx) => {
  if (!dbUp) return ctx.skip();
  const def = await admin.query<{ src: string }>(
    `SELECT pg_get_constraintdef(oid) AS src FROM pg_constraint
     WHERE conrelid = 'deal_documents'::regclass AND conname LIKE '%document_type%'`,
  );
  const allowed = new Set([...def.rows[0]!.src.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));

  // The other direction: a rule producing a type the CHECK forbids would fail
  // at INSERT time, in front of whoever opened the deal.
  const shapes = [...SHAPES, await storableFiShape(admin)];
  const produced = [...new Set(shapes.flatMap((s) => requiredDocuments(s)).map((d) => d.type))];
  const rejected = produced.filter((t) => !allowed.has(t));
  expect(rejected, `requiredDocuments() produces types the database forbids: ${rejected.join(', ')}`).toEqual([]);
});
