import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXPENSE_CATEGORIES } from '@dealpilot/schemas';
import { createPool, testAdminUrl, testAppUrl, withTenant, type Pool } from './index.js';
import { reset } from './migrate.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Migration 0075 — the vehicle expenses ledger (F-82, D-084): the schema-
 * level probes. Each vocabulary and shape the route relies on is a DB CHECK
 * here, and each is proven by driving the database directly as the OWNER,
 * past the route — the constraint is the arbiter of last resort, so its red
 * must be the SQL error, not a route test that never reaches it.
 *
 * The tenant-isolation proof stays behavioural in apps/api
 * (f82-expenses.test.ts T-X6, driven as the APP role); the composite-FK
 * probes live here as the f79 T-DB1 / 0073 / 0074 family (defence in depth
 * whose only trigger is a route bug). P7 is the only STATIC red for a
 * forgotten activity_events DROP+re-ADD: nothing else compares the Zod
 * entity enum to the CHECK, and the runtime red is a 23514 in the f82
 * suite's first recordEvent.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_URL = testAdminUrl();

let admin: Pool;
let dbUp = false;
let orgA = '';
let orgB = '';
let storeA = '';
let storeB = '';
let vehicleA = '';

/** One pending, complete, receipt-free row — the shape every probe starts from. */
function baseRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organization_id: orgA, store_id: storeA, vehicle_id: vehicleA,
    category: 'detail', vendor_name: 'Lave-Auto Express', amount_cents: 34_000, tax_cents: 5_092,
    expense_date: '2026-08-15',
    ...extra,
  };
}

async function insertRow(row: Record<string, unknown>) {
  const cols = Object.keys(row);
  return admin.query<{ id: string }>(
    `INSERT INTO vehicle_expenses (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => row[c]),
  );
}

const SHA = 'a'.repeat(64);
const receipt = {
  receipt_storage_key: 'org/x/vehicles/y/expenses/z/aaaa.png',
  receipt_content_sha256: SHA,
  receipt_content_type: 'image/png',
  receipt_size_bytes: 12,
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

  const org = async (name: string, slug: string) =>
    (await admin.query<{ id: string }>(`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`, [name, slug])).rows[0]!.id;
  const store = async (o: string, code: string) =>
    (await admin.query<{ id: string }>(
      `INSERT INTO stores (organization_id, name, code, province) VALUES ($1, 'Kia', $2, 'QC') RETURNING id`, [o, code],
    )).rows[0]!.id;
  orgA = await org('Groupe 0075 Alpha', 'groupe-0075-alpha');
  orgB = await org('Groupe 0075 Beta', 'groupe-0075-beta');
  storeA = await store(orgA, 'AL-75');
  storeB = await store(orgB, 'BE-75');
  vehicleA = (await admin.query<{ id: string }>(
    `INSERT INTO vehicles (organization_id, store_id, stock_number, year, make, model, acquisition_type)
     VALUES ($1, $2, 'K-75', 2024, 'Kia', 'Sportage', 'trade_in') RETURNING id`,
    [orgA, storeA],
  )).rows[0]!.id;
});

afterAll(async () => {
  await admin?.end();
});

describe('0075 — vehicle_expenses invariants, as the database enforces them', () => {
  it('P1: each of the 12 category codes is accepted; pack / purchase / transport / commission_sales / commission_fi are 23514', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect(EXPENSE_CATEGORIES).toHaveLength(12);
    const ids: string[] = [];
    for (const category of EXPENSE_CATEGORIES) {
      const r = await insertRow(baseRow({ category }));
      ids.push(r.rows[0]!.id);
    }
    expect(ids).toHaveLength(12);
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = ANY($1)`, [ids]);
    for (const category of ['pack', 'purchase', 'transport', 'commission_sales', 'commission_fi']) {
      await expect(insertRow(baseRow({ category })), category).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('P2: a status outside the five is a 23514; the five are accepted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const status of ['submitted', 'cancelled', 'closed']) {
      await expect(insertRow(baseRow({ status })), status).rejects.toMatchObject({ code: '23514' });
    }
    const ids: string[] = [];
    for (const status of ['pending', 'approved', 'paid', 'rejected', 'void']) {
      ids.push((await insertRow(baseRow({ status }))).rows[0]!.id);
    }
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = ANY($1)`, [ids]);
  });

  it('P3: (organization_id, vehicle_id) of different tenants is a 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow(baseRow({ organization_id: orgB, store_id: storeB })),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('P3b: (organization_id, store_id) of different tenants is a 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(insertRow(baseRow({ store_id: storeB }))).rejects.toMatchObject({ code: '23503' });
  });

  it('P4: a half-filled receipt is a 23514 on vehicle_expenses_receipt_complete; all four together are accepted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow(baseRow({ receipt_content_sha256: SHA, receipt_content_type: 'image/png' })),
    ).rejects.toMatchObject({ code: '23514', constraint: 'vehicle_expenses_receipt_complete' });
    await expect(
      insertRow(baseRow({ receipt_storage_key: receipt.receipt_storage_key })),
    ).rejects.toMatchObject({ code: '23514', constraint: 'vehicle_expenses_receipt_complete' });
    const full = await insertRow(baseRow(receipt));
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = $1`, [full.rows[0]!.id]);
  });

  it('P4b: a non-hex sha, a content type outside pdf/jpeg/png, and a zero size are each 23514', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(insertRow(baseRow({ ...receipt, receipt_content_sha256: 'G'.repeat(64) }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ ...receipt, receipt_content_sha256: 'ab'.repeat(31) }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ ...receipt, receipt_content_type: 'image/gif' }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ ...receipt, receipt_size_bytes: 0 }))).rejects.toMatchObject({ code: '23514' });
  });

  it('P5: total_cents is GENERATED amount + tax — read back as the sum, refused on a direct write', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await insertRow(baseRow({ amount_cents: 34_000, tax_cents: 5_092 }));
    const id = r.rows[0]!.id;
    const read = await admin.query<{ total_cents: number }>(`SELECT total_cents FROM vehicle_expenses WHERE id = $1`, [id]);
    expect(read.rows[0]!.total_cents).toBe(39_092);
    // 428C9 generated_always: a direct INSERT or UPDATE of the column errors.
    await expect(insertRow(baseRow({ total_cents: 1 }))).rejects.toMatchObject({ code: '428C9' });
    await expect(
      admin.query(`UPDATE vehicle_expenses SET total_cents = 1 WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: '428C9' });
    // Omitted tax defaults to 0 and the sum follows.
    const { tax_cents: _omitted, ...withoutTax } = baseRow({ amount_cents: 12_000 });
    void _omitted;
    const noTax = await insertRow(withoutTax);
    const readNoTax = await admin.query<{ tax_cents: number; total_cents: number }>(
      `SELECT tax_cents, total_cents FROM vehicle_expenses WHERE id = $1`, [noTax.rows[0]!.id],
    );
    expect(readNoTax.rows[0]).toEqual({ tax_cents: 0, total_cents: 12_000 });
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = ANY($1)`, [[id, noTax.rows[0]!.id]]);
  });

  it('P6: exactly one policy, FORCED, org-keyed on both sides, never `true`, no app.user_id', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const pol = await admin.query<{ polname: string; qual: string; check_expr: string }>(
      `SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
              pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
       FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
       WHERE c.relname = 'vehicle_expenses'`,
    );
    expect(pol.rows).toHaveLength(1);
    expect(pol.rows[0]!.polname).toBe('vehicle_expenses_isolation');
    for (const e of [pol.rows[0]!.qual, pol.rows[0]!.check_expr]) {
      expect(e).toMatch(/app\.org_id/);
      expect(e).not.toMatch(/^\s*true\s*$/i);
      expect(e).not.toMatch(/app\.user_id/);
    }
    const rls = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'vehicle_expenses'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('P6b: dealpilot_app holds SELECT + INSERT on the table and UPDATE on exactly the ten writable columns — no DELETE, no table-wide UPDATE', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The rls-coverage no-DELETE list stays its closed 3-table immutable set
    // (rls-coverage.test.ts:344-350); this ledger holds UPDATE by design (void
    // and the ladder are UPDATEs) but COLUMN-scoped, so the amounts and the
    // keys are immutable at the database (P11) — the grant shape is pinned
    // here (the f79 T-DB1 / 0074 P6b precedent, narrowed).
    const t = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name = 'vehicle_expenses'
       ORDER BY privilege_type`,
    );
    expect(t.rows.map((x) => x.privilege_type)).toEqual(['INSERT', 'SELECT']);
    const c = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.role_column_grants
       WHERE grantee = 'dealpilot_app' AND table_name = 'vehicle_expenses' AND privilege_type = 'UPDATE'
       ORDER BY column_name`,
    );
    expect(c.rows.map((x) => x.column_name)).toEqual([
      'category', 'description', 'expense_date', 'invoice_number',
      'receipt_content_sha256', 'receipt_content_type', 'receipt_size_bytes', 'receipt_storage_key',
      'status', 'vendor_name',
    ]);
  });

  it('P7: both activity_events CHECKs carry vehicle_expense AND deal_submission AND commission_clawback (the DROP+re-ADD kept history)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname IN ('activity_events_entity_type_check', 'activity_events_parent_entity_type_check')
       ORDER BY conname`,
    );
    expect(r.rows.map((x) => x.conname)).toEqual([
      'activity_events_entity_type_check', 'activity_events_parent_entity_type_check',
    ]);
    for (const row of r.rows) {
      expect(row.def, row.conname).toContain("'vehicle_expense'");
      // The lists are 0074's verbatim + the new entity — the previous two
      // entities must still be there, or the re-ADD dropped history's vocabulary.
      expect(row.def, row.conname).toContain("'deal_submission'");
      expect(row.def, row.conname).toContain("'commission_clawback'");
      // …and no value twice (an eyeballed copy can double one).
      const values = [...row.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
      expect(new Set(values).size, `${row.conname} repeats a value`).toBe(values.length);
    }
  });

  it('P8: cents columns are integer, expense_date is date, timestamps are timestamptz', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicle_expenses'
         AND column_name IN ('amount_cents', 'tax_cents', 'total_cents', 'receipt_size_bytes',
                             'expense_date', 'created_at', 'updated_at')
       ORDER BY column_name`,
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type]))).toEqual({
      amount_cents: 'integer',
      created_at: 'timestamp with time zone',
      expense_date: 'date',
      receipt_size_bytes: 'integer',
      tax_cents: 'integer',
      total_cents: 'integer',
      updated_at: 'timestamp with time zone',
    });
    // No default on expense_date: the form always sends the day (F-78's clock law).
    const def = await admin.query<{ column_default: string | null; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicle_expenses' AND column_name = 'expense_date'`,
    );
    expect(def.rows[0]).toEqual({ column_default: null, is_nullable: 'NO' });
    await expect(insertRow(baseRow({ amount_cents: -1 }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ tax_cents: -1 }))).rejects.toMatchObject({ code: '23514' });
  });

  it('P8b: updated_at moves on UPDATE (the set_updated_at trigger is wired)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await insertRow(baseRow());
    const id = r.rows[0]!.id;
    const before = await admin.query<{ updated_at: Date }>(`SELECT updated_at FROM vehicle_expenses WHERE id = $1`, [id]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await admin.query(`UPDATE vehicle_expenses SET status = 'approved' WHERE id = $1`, [id]);
    const after = await admin.query<{ updated_at: Date }>(`SELECT updated_at FROM vehicle_expenses WHERE id = $1`, [id]);
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.rows[0]!.updated_at.getTime());
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = $1`, [id]);
  });

  it('P9: the catalogue comment on amount_cents names immutability — a claim in a comment is a claim in the product', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ comment: string | null }>(
      `SELECT col_description('vehicle_expenses'::regclass, attnum) AS comment
       FROM pg_attribute WHERE attrelid = 'vehicle_expenses'::regclass AND attname = 'amount_cents'`,
    );
    expect(r.rows[0]?.comment ?? '').toMatch(/Immutable after insert/);
    expect(r.rows[0]?.comment ?? '').toMatch(/voided and logged again/);
  });

  it('P10: a blank vendor_name, an empty invoice_number and a description over 500 characters are each 23514', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(insertRow(baseRow({ vendor_name: '   ' }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ vendor_name: 'x'.repeat(121) }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ invoice_number: '' }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ invoice_number: 'x'.repeat(61) }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(baseRow({ description: 'x'.repeat(501) }))).rejects.toMatchObject({ code: '23514' });
    // Positive control: the bounds themselves are legal.
    const ok = await insertRow(baseRow({ vendor_name: 'x'.repeat(120), invoice_number: 'x'.repeat(60), description: 'x'.repeat(500) }));
    await admin.query(`DELETE FROM vehicle_expenses WHERE id = $1`, [ok.rows[0]!.id]);
  });

  it('P11 (review fix): as dealpilot_app the money and the keys are NOT UPDATE-able — 42501 on amount_cents / tax_cents / vehicle_id / store_id / organization_id; the six patchable columns and the four receipt columns are (the mechanism behind « Immutable after insert »)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await insertRow(baseRow());
    const id = r.rows[0]!.id;
    const appPool = createPool({ connectionString: testAppUrl(), max: 1 });
    const attempt = (sql: string, params: unknown[]) =>
      withTenant(appPool, orgA, async (c) => { await c.query(sql, params); });
    try {
      // Red at tip: 0075 granted UPDATE on the whole table, so every one of
      // these succeeded and the column comment was a claim without a mechanism.
      await expect(attempt(`UPDATE vehicle_expenses SET amount_cents = 1 WHERE id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
      await expect(attempt(`UPDATE vehicle_expenses SET tax_cents = 1 WHERE id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
      await expect(attempt(`UPDATE vehicle_expenses SET vehicle_id = $2 WHERE id = $1`, [id, vehicleA])).rejects.toMatchObject({ code: '42501' });
      await expect(attempt(`UPDATE vehicle_expenses SET store_id = $2 WHERE id = $1`, [id, storeA])).rejects.toMatchObject({ code: '42501' });
      await expect(attempt(`UPDATE vehicle_expenses SET organization_id = $2 WHERE id = $1`, [id, orgA])).rejects.toMatchObject({ code: '42501' });
      // Positive controls: the ladder / the patchable fields / the receipt
      // quartet stay writable by the app role (the trigger fills updated_at).
      await attempt(
        `UPDATE vehicle_expenses SET status = 'approved', category = 'parts', vendor_name = 'Pièces Plus',
                invoice_number = 'INV-11', expense_date = '2026-08-16', description = 'ok' WHERE id = $1`,
        [id],
      );
      await attempt(
        `UPDATE vehicle_expenses SET receipt_storage_key = $2, receipt_content_sha256 = $3,
                receipt_content_type = 'image/png', receipt_size_bytes = 12 WHERE id = $1`,
        [id, receipt.receipt_storage_key, SHA],
      );
      const after = await admin.query<{ status: string; amount_cents: number; receipt_size_bytes: number }>(
        `SELECT status, amount_cents, receipt_size_bytes FROM vehicle_expenses WHERE id = $1`, [id],
      );
      expect(after.rows[0]).toMatchObject({ status: 'approved', amount_cents: 34_000, receipt_size_bytes: 12 });
    } finally {
      await appPool.end();
      await admin.query(`DELETE FROM vehicle_expenses WHERE id = $1`, [id]);
    }
  });
});
