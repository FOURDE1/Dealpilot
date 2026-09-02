import { afterAll, beforeAll, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LENDER_DEFAULTS } from '@dealpilot/schemas';
import { createPool, migrate, reset, type Pool } from './index.js';
import { DEFAULT_HOST_URL, disposableDatabaseUrl, ensureDatabase } from './test-db.js';

/**
 * Migration 0073 writes DATA into EXISTING organizations — and nothing else
 * exercises that. Every other database suite resets from migration zero, so
 * 0073's two INSERT…SELECT backfills (18 lenders per org, 3 lender:manage
 * rows per org) run against an EMPTY organizations table in every CI run. A
 * claim in a migration header is a claim in the product (the 0070 lesson):
 * this is the only place the backfill is proven against a row that predates
 * the migration.
 *
 * Method (the 0070-rewrite harness verbatim): copy every migration BEFORE
 * 0073 byte-identical into a staging directory, reset a DISPOSABLE database
 * (`dealpilot_mig0073_test`) to that state, create two organizations as a
 * pre-0073 database held them, then apply the real directory — which applies
 * 0073 and nothing before it — and read the rows back.
 *
 * The re-run step EXTRACTS the two backfill statements from the 0073 file
 * text rather than carrying a hand-typed third SQL copy (which would itself
 * be an unguarded frozen copy), re-runs both, and proves idempotency.
 *
 * The grant-shape pin (T-L7) and the composite-FK probe live here too: the
 * FK is defence in depth whose only trigger is a route bug, so a schema-level
 * 23503 assertion is the honest proof (the f79 T-DB1 / grant-catalog family);
 * the tenant-isolation proof stays behavioural in apps/api (T-L6).
 */

const MIGRATION = '20260902000073_lender-registry.sql';
const DB_NAME = 'dealpilot_mig0073_test';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const baseUrl = process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL;
const ADMIN_URL = disposableDatabaseUrl(baseUrl, DB_NAME);

let admin: Pool;
let dbUp = false;
let stageDir = '';
let orgA = '';
let orgB = '';

async function insertOrg(name: string, slug: string): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [name, slug],
  );
  return r.rows[0]!.id;
}

/** The 4 columns the seed owns, sorted the same way on both sides (JS
 * code-unit order, collation-independent — the DB's own ORDER BY collation
 * varies between local alpine and CI images). */
const expectedRows = [...LENDER_DEFAULTS]
  .map(({ name, short_name, category, notes }) => ({ name, short_name, category, notes }))
  .sort((a, b) => (a.name < b.name ? -1 : 1));

beforeAll(async () => {
  try {
    await ensureDatabase(baseUrl, DB_NAME);
    admin = createPool({ connectionString: ADMIN_URL, max: 2 });
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }

  const all = readdirSync(migrationsDir).filter((f) => /^\d{14}_[a-z0-9-]+\.sql$/.test(f)).sort();
  expect(all, 'the migration under test must exist in the real directory').toContain(MIGRATION);
  const before = all.filter((f) => f < MIGRATION);
  expect(before[before.length - 1]).toMatch(/^20260902000072_/);

  stageDir = mkdtempSync(join(tmpdir(), 'dealpilot-mig0073-'));
  for (const f of before) copyFileSync(join(migrationsDir, f), join(stageDir, f));
  await reset(admin, stageDir, ADMIN_URL);

  // Two organizations exactly as a pre-0073 database held them: no lenders
  // table exists yet, and neither org holds any lender:manage row.
  orgA = await insertOrg('Groupe 0073 Alpha', 'groupe-0073-alpha');
  orgB = await insertOrg('Groupe 0073 Beta', 'groupe-0073-beta');
});

afterAll(async () => {
  await admin?.end();
  if (stageDir) rmSync(stageDir, { recursive: true, force: true });
});

it('0073 backfills BOTH pre-existing orgs with the 18 LENDER_DEFAULTS rows, the 3 permission rows, and deals.lender_id', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const applied = await migrate(admin, migrationsDir);
  // 0073 was the only migration missing from the ledger; nothing before it
  // may re-run. Exact equality, so a re-run of any earlier migration reds.
  const expectedApplied = readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_[a-z0-9-]+\.sql$/.test(f))
    .sort()
    .filter((f) => f >= MIGRATION);
  expect(expectedApplied[0]).toBe(MIGRATION);
  expect(applied).toEqual(expectedApplied);

  for (const org of [orgA, orgB]) {
    // ROWS-EQUAL against the constant on every seed-owned column — a
    // counts-plus-spot-tuple pin would let the notes column drift invisibly.
    const rows = await admin.query<{ name: string; short_name: string; category: string; notes: string | null }>(
      `SELECT name, short_name, category, notes FROM lenders WHERE organization_id = $1`,
      [org],
    );
    expect([...rows.rows].sort((a, b) => (a.name < b.name ? -1 : 1)), org).toEqual(expectedRows);

    const byCategory = await admin.query<{ category: string; n: string }>(
      `SELECT category, count(*) AS n FROM lenders WHERE organization_id = $1 GROUP BY category`,
      [org],
    );
    const counts = Object.fromEntries(byCategory.rows.map((r) => [r.category, Number(r.n)]));
    expect(counts, org).toEqual({ PRIME: 7, NEAR_PRIME: 5, SUBPRIME: 5, CAPTIVE: 1 });

    const perms = await admin.query<{ role: string }>(
      `SELECT role FROM role_permissions WHERE organization_id = $1 AND permission = 'lender:manage' ORDER BY role`,
      [org],
    );
    expect(perms.rows.map((r) => r.role), org).toEqual(['fi_manager', 'gm', 'owner']);
  }

  const col = await admin.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'lender_id'`,
  );
  expect(col.rows).toHaveLength(1);
});

it('re-running both backfill statements — extracted from the 0073 file itself — changes nothing', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const sql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');
  // The definer body carries its OWN lenders/role_permissions INSERTs (over
  // jsonb, `SELECT v_org, …`); the backfills are the `SELECT o.id` forms.
  const lendersBackfill = /INSERT INTO lenders \(organization_id, name, short_name, category, notes\)\nSELECT o\.id[\s\S]*?ON CONFLICT \(organization_id, name\) DO NOTHING;/.exec(sql);
  const permsBackfill = /INSERT INTO role_permissions \(organization_id, role, permission\)\nSELECT o\.id[\s\S]*?ON CONFLICT DO NOTHING;/.exec(sql);
  expect(lendersBackfill, 'lenders backfill statement not found in 0073').not.toBeNull();
  expect(permsBackfill, 'role_permissions backfill statement not found in 0073').not.toBeNull();

  const before = {
    lenders: await admin.query(`SELECT id, name, short_name, category, notes, active FROM lenders ORDER BY id`),
    perms: await admin.query(`SELECT organization_id, role, permission FROM role_permissions ORDER BY organization_id, role, permission`),
  };
  const reRanLenders = await admin.query(lendersBackfill![0]);
  const reRanPerms = await admin.query(permsBackfill![0]);
  expect(reRanLenders.rowCount).toBe(0);
  expect(reRanPerms.rowCount).toBe(0);
  const after = {
    lenders: await admin.query(`SELECT id, name, short_name, category, notes, active FROM lenders ORDER BY id`),
    perms: await admin.query(`SELECT organization_id, role, permission FROM role_permissions ORDER BY organization_id, role, permission`),
  };
  expect(after.lenders.rows).toEqual(before.lenders.rows);
  expect(after.perms.rows).toEqual(before.perms.rows);
});

it('T-L7: dealpilot_app holds exactly SELECT/INSERT/UPDATE — no DELETE — on lenders', async (ctx) => {
  if (!dbUp) return ctx.skip();
  // The rls-coverage no-DELETE list stays its closed immutable set; this
  // registry table holds UPDATE by design (deactivation is an UPDATE), so its
  // grant shape is pinned here instead (the f79 T-DB1 precedent).
  const r = await admin.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.role_table_grants
     WHERE grantee = 'dealpilot_app' AND table_name = 'lenders'
     ORDER BY privilege_type`,
  );
  expect(r.rows.map((x) => x.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
});

it('the composite FK refuses a mismatched (organization_id, lender_id) pair with 23503 on deals_lender_fk', async (ctx) => {
  if (!dbUp) return ctx.skip();
  const store = await admin.query<{ id: string }>(
    `INSERT INTO stores (organization_id, name, code, province) VALUES ($1, 'Alpha Kia', 'AL-1', 'QC') RETURNING id`,
    [orgA],
  );
  const deal = await admin.query<{ id: string }>(
    `INSERT INTO deals (organization_id, store_id, province, sale_price_cents)
     VALUES ($1, $2, 'QC', 2500000) RETURNING id`,
    [orgA, store.rows[0]!.id],
  );
  const dealId = deal.rows[0]!.id;
  const lenderOf = async (org: string) =>
    (await admin.query<{ id: string }>(
      `SELECT id FROM lenders WHERE organization_id = $1 AND name = 'TD Auto Finance'`, [org],
    )).rows[0]!.id;

  // Positive control first: the SAME org's lender id is accepted — so the red
  // below is the cross-org mismatch, not a broken column.
  await admin.query(`UPDATE deals SET lender_id = $2 WHERE id = $1`, [dealId, await lenderOf(orgA)]);

  await expect(
    admin.query(`UPDATE deals SET lender_id = $2 WHERE id = $1`, [dealId, await lenderOf(orgB)]),
  ).rejects.toMatchObject({ code: '23503', constraint: 'deals_lender_fk' });
});
