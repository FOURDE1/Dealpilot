import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import type { DeskingInputsT } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import { computeOutputs, INPUT_COLUMNS, OUTPUT_COLUMNS } from './deal-outputs.js';

/**
 * The stored quote must never drift from the inputs beside it (CR-13).
 *
 * A deal stores both its inputs and the engine's answer, because the pipeline
 * card, the deal row and every report read the stored quote rather than
 * recomputing. F-05's PATCH had always recomputed inline. F-13b then changed a
 * deal's inputs from OUTSIDE that route: the trigger re-summed `fi_price_cents`
 * and nothing touched the payment, the taxes or the gross beside it — so adding
 * a $2,500 warranty moved the input and left the pre-warranty quote on every
 * screen until somebody happened to re-save the worksheet.
 *
 * Hussein found it by probing the running system, not from a failing test,
 * because no test asserted the invariant that F-05's own comment states. This
 * one does, after every path that can move a deal's inputs — so the next
 * feature that writes to `deals` from somewhere new fails here instead of
 * quoting a customer last week's payment.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';

/**
 * Read the deal straight from the database and re-run the engine over its
 * stored inputs. Through the admin pool on purpose: this asserts what is ON
 * DISK, not what a route chose to return.
 */
async function assertNoDrift(dealId: string, because: string) {
  const r = await admin.query<Record<string, unknown>>(
    `SELECT ${[...INPUT_COLUMNS, ...OUTPUT_COLUMNS].join(', ')} FROM deals WHERE id = $1`,
    [dealId],
  );
  const row = r.rows[0]!;
  const fresh = computeOutputs(row as unknown as DeskingInputsT) as unknown as Record<string, number>;
  const stored = Object.fromEntries(OUTPUT_COLUMNS.map((k) => [k, Number(row[k])]));
  const expected = Object.fromEntries(OUTPUT_COLUMNS.map((k) => [k, fresh[k]]));
  expect(stored, `stored quote drifted from the stored inputs after ${because}`).toEqual(expected);
}

async function makeDeal(extra: Record<string, unknown> = {}) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC', deal_type: 'finance',
      sale_price_cents: 2_000_000, vehicle_cost_cents: 1_700_000,
      interest_rate_bps: 599, term_months: 60, ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function addProduct(dealId: string, payload: Record<string, unknown>) {
  const res = await app!.inject({
    method: 'POST', url: `/api/v1/deals/${dealId}/fi-products`, headers: { cookie }, payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string };
}

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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `drift-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Drift', slug: `groupe-drift-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Drift Kia', code: 'DRIFT-1', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the stored quote follows the stored inputs', () => {
  it('on create, and on a normal worksheet edit', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    await assertNoDrift(dealId, 'create');

    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { sale_price_cents: 2_400_000, cash_down_cents: 300_000 },
    });
    expect(res.statusCode, res.body).toBe(200);
    await assertNoDrift(dealId, 'a worksheet edit');
  });

  it('when an F&I product is ADDED — the case that shipped broken', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const before = await admin.query<{ monthly_payment_cents: number; tax_total_cents: number }>(
      `SELECT monthly_payment_cents, tax_total_cents FROM deals WHERE id = $1`, [dealId],
    );

    await addProduct(dealId, { kind: 'warranty', name: 'Safe-Guard 5yr', price_cents: 250_000, cost_cents: 100_000 });
    await assertNoDrift(dealId, 'adding an F&I product');

    // Not just self-consistent — actually MOVED. A recompute that produced the
    // same numbers would pass the drift check and still be wrong.
    const after = await admin.query<{ monthly_payment_cents: number; tax_total_cents: number }>(
      `SELECT monthly_payment_cents, tax_total_cents FROM deals WHERE id = $1`, [dealId],
    );
    expect(after.rows[0]!.monthly_payment_cents).toBeGreaterThan(before.rows[0]!.monthly_payment_cents);
    expect(after.rows[0]!.tax_total_cents).toBeGreaterThan(before.rows[0]!.tax_total_cents);
  });

  it('when a product is REPRICED and when it is REMOVED', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const p = await addProduct(dealId, { kind: 'gap', name: 'GAP', price_cents: 90_000, cost_cents: 40_000 });

    const patched = await app!.inject({
      method: 'PATCH', url: `/api/v1/fi-products/${p.id}`, headers: { cookie },
      payload: { price_cents: 150_000 },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    await assertNoDrift(dealId, 'repricing a product');

    const deleted = await app!.inject({
      method: 'DELETE', url: `/api/v1/fi-products/${p.id}`, headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);
    await assertNoDrift(dealId, 'removing a product');

    // Back to a deal with no F&I at all.
    const row = await admin.query<{ fi_price_cents: number }>(
      `SELECT fi_price_cents FROM deals WHERE id = $1`, [dealId],
    );
    expect(row.rows[0]!.fi_price_cents).toBe(0);
  });

  it('across a whole desk-and-sell sequence', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The realistic order: desk it, add products, change the price, add more,
    // drop one. Every step has to leave the quote true.
    const dealId = await makeDeal({ deal_type: 'lease', residual_percent: 55, term_months: 48 });
    await addProduct(dealId, { kind: 'warranty', name: 'W', price_cents: 200_000, cost_cents: 120_000 });
    await assertNoDrift(dealId, 'step 1');
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { sale_price_cents: 3_100_000, rebate_cents: 100_000 },
    });
    await assertNoDrift(dealId, 'step 2');
    const rust = await addProduct(dealId, { kind: 'aftermarket', name: 'Antirouille', price_cents: 60_000 });
    await assertNoDrift(dealId, 'step 3');
    await app!.inject({ method: 'DELETE', url: `/api/v1/fi-products/${rust.id}`, headers: { cookie } });
    await assertNoDrift(dealId, 'step 4');
  });
});

describe('one source of truth for F&I', () => {
  it("refuses to hand-edit the F&I total once the deal has products", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    await addProduct(dealId, { kind: 'warranty', name: 'W', price_cents: 200_000 });

    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { fi_price_cents: 999_900 },
    });
    // Refused, not accepted-and-overwritten: the next product write would have
    // silently replaced whatever was typed here, which is CR-12 in reverse.
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'fi_is_itemised' } });

    const row = await admin.query<{ fi_price_cents: number }>(
      `SELECT fi_price_cents FROM deals WHERE id = $1`, [dealId],
    );
    expect(row.rows[0]!.fi_price_cents).toBe(200_000);
  });

  it('still allows the hand-typed total on a deal with no products', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Most deals never itemise; the plain F&I box has to keep working.
    const dealId = await makeDeal();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { fi_price_cents: 180_000, fi_cost_cents: 90_000 },
    });
    expect(res.statusCode, res.body).toBe(200);
    await assertNoDrift(dealId, 'a hand-typed F&I total');
  });
});
