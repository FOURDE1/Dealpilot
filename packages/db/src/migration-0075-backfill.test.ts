import { afterAll, beforeAll, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_ROLE_PERMISSIONS, ROLES } from '@dealpilot/schemas';
import { createPool, migrate, reset, type Pool } from './index.js';
import { DEFAULT_HOST_URL, disposableDatabaseUrl, ensureDatabase } from './test-db.js';

/**
 * Migration 0075 writes DATA into EXISTING organizations — the expense:approve
 * backfill — and nothing else exercises that. Every other database suite
 * resets from migration zero, so the INSERT…SELECT runs against an EMPTY
 * organizations table in every CI run. A claim in a migration header is a
 * claim in the product (the 0070 lesson): this is the only place the
 * backfill is proven against a row that predates the migration.
 *
 * Method (the 0073-backfill harness verbatim): copy every migration BEFORE
 * 0075 byte-identical into a staging directory, reset a DISPOSABLE database
 * (`dealpilot_mig0075_test`) to that state, create two organizations as a
 * pre-0075 database held them, then apply the real directory — which applies
 * 0075 and nothing before it — and read the rows back. The re-run step
 * EXTRACTS the backfill statement from the 0075 file text (0073's regex)
 * rather than carrying a hand-typed copy, and proves idempotency.
 */

const MIGRATION = '20260904000075_vehicle-expenses.sql';
const DB_NAME = 'dealpilot_mig0075_test';
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
  expect(before[before.length - 1]).toMatch(/^20260903000074_/);

  stageDir = mkdtempSync(join(tmpdir(), 'dealpilot-mig0075-'));
  for (const f of before) copyFileSync(join(migrationsDir, f), join(stageDir, f));
  await reset(admin, stageDir, ADMIN_URL);

  // Two organizations exactly as a pre-0075 database held them: no
  // vehicle_expenses table exists yet, and neither org holds an
  // expense:approve row.
  orgA = await insertOrg('Groupe 0075 Alpha', 'groupe-0075-alpha');
  orgB = await insertOrg('Groupe 0075 Beta', 'groupe-0075-beta');
  const none = await admin.query(`SELECT 1 FROM role_permissions WHERE permission = 'expense:approve'`);
  expect(none.rows).toHaveLength(0);
});

afterAll(async () => {
  await admin?.end();
  if (stageDir) rmSync(stageDir, { recursive: true, force: true });
});

it('0075 backfills BOTH pre-existing orgs with expense:approve for gm, owner and used_car_manager — and equals the TS default', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const applied = await migrate(admin, migrationsDir);
  // 0075 was the only migration missing from the ledger; nothing before it
  // may re-run. Exact equality, so a re-run of any earlier migration reds.
  const expectedApplied = readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_[a-z0-9-]+\.sql$/.test(f))
    .sort()
    .filter((f) => f >= MIGRATION);
  expect(expectedApplied[0]).toBe(MIGRATION);
  expect(applied).toEqual(expectedApplied);

  for (const org of [orgA, orgB]) {
    const perms = await admin.query<{ role: string }>(
      `SELECT role FROM role_permissions WHERE organization_id = $1 AND permission = 'expense:approve' AND allowed ORDER BY role`,
      [org],
    );
    expect(perms.rows.map((r) => r.role), org).toEqual(['gm', 'owner', 'used_car_manager']);
  }
  // The backfill and the catalogue default are ONE list: a role added to
  // DEFAULT_ROLE_PERMISSIONS without a VALUES row (or the reverse) reds here.
  const tsDefault = ROLES.filter((r) => DEFAULT_ROLE_PERMISSIONS[r]?.includes('expense:approve')).sort();
  expect(tsDefault).toEqual(['gm', 'owner', 'used_car_manager']);

  const table = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicle_expenses'`,
  );
  expect(table.rows).toHaveLength(1);
});

it('re-running the backfill statement — extracted from the 0075 file itself — changes nothing', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const sql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');
  // 0073's exact extraction regex: a different spelling returns null, and
  // this assertion is what keeps the idempotency case from passing vacuously.
  const permsBackfill = /INSERT INTO role_permissions \(organization_id, role, permission\)\nSELECT o\.id[\s\S]*?ON CONFLICT DO NOTHING;/.exec(sql);
  expect(permsBackfill, 'role_permissions backfill statement not found in 0075').not.toBeNull();
  expect(permsBackfill![0]).toContain("('used_car_manager', 'expense:approve')");

  const before = await admin.query(`SELECT organization_id, role, permission FROM role_permissions ORDER BY organization_id, role, permission`);
  const reRan = await admin.query(permsBackfill![0]);
  expect(reRan.rowCount).toBe(0);
  const after = await admin.query(`SELECT organization_id, role, permission FROM role_permissions ORDER BY organization_id, role, permission`);
  expect(after.rows).toEqual(before.rows);
});
