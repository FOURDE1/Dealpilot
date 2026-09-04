import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, testAdminUrl, type Pool } from './index.js';
import { reset } from './migrate.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Migration 0074 — the lender submissions ledger (F-81, D-082): the schema-
 * level probes. Each invariant the route mirrors as a 422 is a DB CHECK here,
 * and each is proven by driving the database directly as the OWNER, past the
 * route — the constraint is the arbiter of last resort, so its red must be
 * the SQL error, not a route test that never reaches it (the M1 rule: the
 * route deselects before it selects, so the partial unique is unreachable
 * through the product and only this probe proves it exists).
 *
 * The tenant-isolation proof stays behavioural in apps/api
 * (f81-submissions.test.ts T-S3, driven as the APP role); the composite-FK
 * probes live here as the f79 T-DB1 / 0073 family (defence in depth whose
 * only trigger is a route bug). P7 is the only STATIC red for a forgotten
 * activity_events DROP+re-ADD: nothing else compares the Zod entity enum to
 * the CHECK, and the runtime red is a 23514 in the f81 suite's beforeAll.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_URL = testAdminUrl();

let admin: Pool;
let dbUp = false;
let orgA = '';
let orgB = '';
let storeA = '';
let storeB = '';
let dealA = '';
let lenderA = '';
let lenderB = '';

/** One approved, complete, condition-free row — the shape every probe starts from. */
function approvedRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organization_id: orgA, store_id: storeA, deal_id: dealA, lender_id: lenderA,
    platform: 'manual', status: 'approved', sell_rate_bps: 699, term_months: 72,
    ...extra,
  };
}

async function insertRow(row: Record<string, unknown>) {
  const cols = Object.keys(row);
  return admin.query<{ id: string }>(
    `INSERT INTO deal_submissions (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => row[c]),
  );
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

  const org = async (name: string, slug: string) =>
    (await admin.query<{ id: string }>(`INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`, [name, slug])).rows[0]!.id;
  const store = async (o: string, code: string) =>
    (await admin.query<{ id: string }>(
      `INSERT INTO stores (organization_id, name, code, province) VALUES ($1, 'Kia', $2, 'QC') RETURNING id`, [o, code],
    )).rows[0]!.id;
  const lender = async (o: string) =>
    (await admin.query<{ id: string }>(
      `INSERT INTO lenders (organization_id, name, category) VALUES ($1, 'TD Auto Finance', 'PRIME') RETURNING id`, [o],
    )).rows[0]!.id;
  orgA = await org('Groupe 0074 Alpha', 'groupe-0074-alpha');
  orgB = await org('Groupe 0074 Beta', 'groupe-0074-beta');
  storeA = await store(orgA, 'AL-74');
  storeB = await store(orgB, 'BE-74');
  lenderA = await lender(orgA);
  lenderB = await lender(orgB);
  dealA = (await admin.query<{ id: string }>(
    `INSERT INTO deals (organization_id, store_id, province, sale_price_cents) VALUES ($1, $2, 'QC', 3000000) RETURNING id`,
    [orgA, storeA],
  )).rows[0]!.id;
});

afterAll(async () => {
  await admin?.end();
});

describe('0074 — deal_submissions invariants, as the database enforces them', () => {
  it('P1: a second selected row on one deal is a 23505 on deal_submissions_one_selected (both rows approved)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Both probe rows are approved and complete, so the ONLY constraint that
    // can refuse the second flag is the partial unique — a non-approved probe
    // would trip deal_submissions_selected_approved first and prove the
    // wrong constraint.
    const first = await insertRow(approvedRow({ selected: true }));
    const second = await insertRow(approvedRow());
    await expect(
      admin.query(`UPDATE deal_submissions SET selected = true WHERE id = $1`, [second.rows[0]!.id]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'deal_submissions_one_selected' });
    // Positive control: flipping the FIRST off then the second on is legal.
    await admin.query(`UPDATE deal_submissions SET selected = false WHERE id = $1`, [first.rows[0]!.id]);
    await admin.query(`UPDATE deal_submissions SET selected = true WHERE id = $1`, [second.rows[0]!.id]);
    await admin.query(`DELETE FROM deal_submissions WHERE deal_id = $1`, [dealA]);
  });

  it('P2: (organization_id, deal_id) of different tenants is a 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow({ organization_id: orgB, store_id: storeB, deal_id: dealA, lender_id: lenderB, platform: 'manual' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('P3: (organization_id, lender_id) of different tenants is a 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow({ organization_id: orgA, store_id: storeA, deal_id: dealA, lender_id: lenderB, platform: 'manual' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('P3b: (organization_id, store_id) of different tenants is a 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow({ organization_id: orgA, store_id: storeB, deal_id: dealA, lender_id: lenderA, platform: 'manual' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('P4: selected on a conditional row is a 23514 on deal_submissions_selected_approved', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow(approvedRow({ status: 'conditional', selected: true })),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_submissions_selected_approved' });
  });

  it('P4b: approved with conditions on file and not met is a 23514 on deal_submissions_approved_conditions_met', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow(approvedRow({ conditions: 'Preuve de revenu', conditions_met: false })),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_submissions_approved_conditions_met' });
    // Positive controls: met, or whitespace-only conditions, are approvable.
    const met = await insertRow(approvedRow({ conditions: 'Preuve de revenu', conditions_met: true }));
    const blank = await insertRow(approvedRow({ conditions: '   ', conditions_met: false }));
    await admin.query(`DELETE FROM deal_submissions WHERE id = ANY($1)`, [[met.rows[0]!.id, blank.rows[0]!.id]]);
  });

  it('P4c: a decline reason on an approved row is a 23514 on deal_submissions_reason_declined', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      insertRow(approvedRow({ decline_reason: 'Ratio dette/revenu' })),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_submissions_reason_declined' });
    const declined = await insertRow(approvedRow({ status: 'declined', decline_reason: 'Ratio dette/revenu', sell_rate_bps: null, term_months: null }));
    await admin.query(`DELETE FROM deal_submissions WHERE id = $1`, [declined.rows[0]!.id]);
  });

  it('P6: exactly one policy, FORCED, org-keyed on both sides, never `true`', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const pol = await admin.query<{ polname: string; qual: string; check_expr: string }>(
      `SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
              pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
       FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
       WHERE c.relname = 'deal_submissions'`,
    );
    expect(pol.rows).toHaveLength(1);
    expect(pol.rows[0]!.polname).toBe('deal_submissions_isolation');
    for (const e of [pol.rows[0]!.qual, pol.rows[0]!.check_expr]) {
      expect(e).toMatch(/app\.org_id/);
      expect(e).not.toMatch(/^\s*true\s*$/i);
      expect(e).not.toMatch(/app\.user_id/);
    }
    const rls = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'deal_submissions'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('P6b: dealpilot_app holds exactly SELECT/INSERT/UPDATE — no DELETE — on deal_submissions', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name = 'deal_submissions'
       ORDER BY privilege_type`,
    );
    expect(r.rows.map((x) => x.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('P7: both activity_events CHECKs carry deal_submission (the DROP+re-ADD happened)', async (ctx) => {
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
      expect(row.def, row.conname).toContain("'deal_submission'");
      // The lists are 0072's verbatim + the new entity — the previous entity
      // must still be there, or the re-ADD dropped history's vocabulary.
      expect(row.def, row.conname).toContain("'commission_clawback'");
    }
  });

  it('P9: the catalogue comment on `selected` names BOTH application writers — the select route and the status PATCH', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A claim in a comment is a claim in the product: the comment ships to
    // every psql reader, and the deselect-on-leaving-approved door lives in
    // PATCH /submissions/:id (invariant deal_submissions_selected_approved),
    // not in the select route. `selected` has exactly these two doors.
    const r = await admin.query<{ comment: string | null }>(
      `SELECT col_description('deal_submissions'::regclass, attnum) AS comment
       FROM pg_attribute WHERE attrelid = 'deal_submissions'::regclass AND attname = 'selected'`,
    );
    const comment = r.rows[0]?.comment ?? '';
    expect(comment).toMatch(/select route/);
    expect(comment).toMatch(/status PATCH/);
    expect(comment).not.toMatch(/Written only by the select route/);
  });

  it('P8: cents and bps are integer, term_months is integer, expiry_date is date', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'deal_submissions'
         AND column_name IN ('approval_amount_cents', 'monthly_payment_cents', 'buy_rate_bps',
                             'sell_rate_bps', 'term_months', 'expiry_date', 'responded_at')
       ORDER BY column_name`,
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.column_name, x.data_type]))).toEqual({
      approval_amount_cents: 'integer',
      buy_rate_bps: 'integer',
      expiry_date: 'date',
      monthly_payment_cents: 'integer',
      responded_at: 'timestamp with time zone',
      sell_rate_bps: 'integer',
      term_months: 'integer',
    });
    // The bounds themselves, so a widened rate or term is a red here too.
    await expect(insertRow(approvedRow({ sell_rate_bps: 10001 }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(approvedRow({ term_months: 121 }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(approvedRow({ term_months: 0 }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(approvedRow({ platform: 'fax' }))).rejects.toMatchObject({ code: '23514' });
    await expect(insertRow(approvedRow({ status: 'funded' }))).rejects.toMatchObject({ code: '23514' });
  });
});
