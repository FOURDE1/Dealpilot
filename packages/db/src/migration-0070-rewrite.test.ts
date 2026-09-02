import { afterAll, beforeAll, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, migrate, reset, type Pool } from './index.js';
import { DEFAULT_HOST_URL, disposableDatabaseUrl, ensureDatabase } from './test-db.js';

/**
 * Migration 0070 rewrites DATA, not just DDL — and nothing else exercises it.
 *
 * Every other database suite resets from migration zero, and `migrate()` has
 * no partial-apply mode, so the two column UPDATEs, the `published_snapshot`
 * rewrite and the DO-block assertion in 0070 run against an EMPTY table on
 * every CI run. A claim in a migration header is a claim in the product: the
 * header says the rewrite touches 72 of 72 published rows on the dev database,
 * and this is the only place that proves the rewrite does what it says to a
 * row that actually carries the retired values.
 *
 * Method: copy every migration BEFORE 0070 (byte-identical, so the ledger
 * checksums match afterwards) into a staging directory, reset a DISPOSABLE
 * database to that state, seed the stale row as 0027 allowed it, then apply
 * the real directory — which applies 0070 and every migration after it, and
 * nothing before it — and read the row back.
 *
 * Own database (`dealpilot_mig0070_test`, created on demand through the
 * *_test rule in test-db.ts) rather than the shared `dealpilot_test`: the
 * schema here is deliberately one migration behind for part of the run, and a
 * suite that shares the database must never be able to observe that. The
 * database is left in place afterwards, like `dealpilot_cliswap_test`; every
 * run resets it from zero.
 */

const MIGRATION = '20260831000070_branding-retire-custom.sql';
const DB_NAME = 'dealpilot_mig0070_test';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const baseUrl = process.env['DB_ADMIN_URL'] ?? DEFAULT_HOST_URL;
const ADMIN_URL = disposableDatabaseUrl(baseUrl, DB_NAME);

let admin: Pool;
let dbUp = false;
let stageDir = '';

/** What a snapshot written before 0070 could carry (0027's vocabulary). */
const STALE_SNAPSHOT = {
  display_name: 'Marque 0070',
  logo_light_key: null,
  logo_dark_key: null,
  favicon_key: null,
  font_family: 'custom',
  font_woff2_key: 'k/font.woff2',
  font_woff2_bold_key: 'k/font-bold.woff2',
  radius: 'md',
  density: 'comfortable',
  dark_mode: 'custom',
  palette: { fills: { primary: 'oklch(0.55 0.2 262)' }, text: { primary: 'oklch(0.5 0.2 262)' } },
};

/** A snapshot that carries nothing retired — the WHERE scope must leave it alone. */
const CLEAN_SNAPSHOT = {
  display_name: 'Marque propre',
  logo_light_key: null,
  logo_dark_key: null,
  favicon_key: null,
  font_family: 'system',
  radius: 'sm',
  density: 'compact',
  dark_mode: 'disabled',
  palette: { fills: { primary: 'oklch(0.55 0.2 262)' } },
};

let staleId = '';
let cleanId = '';
let draftId = '';

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
  expect(before[before.length - 1]).toMatch(/^20260830000069_/);

  stageDir = mkdtempSync(join(tmpdir(), 'dealpilot-mig0070-'));
  for (const f of before) copyFileSync(join(migrationsDir, f), join(stageDir, f));
  await reset(admin, stageDir, ADMIN_URL);

  // Seeded as the OWNER (superuser locally) exactly as 0027 permitted it:
  // `custom` in both columns, both WOFF columns set, and a published snapshot
  // frozen with the same vocabulary.
  const staleOrg = await insertOrg('Groupe 0070 périmé', 'groupe-0070-perime');
  const stale = await admin.query<{ id: string }>(
    `INSERT INTO tenant_branding
       (organization_id, dark_mode, font_family, font_woff2_key, font_woff2_bold_key,
        status, version, published_at, published_snapshot)
     VALUES ($1, 'custom', 'custom', 'k/font.woff2', 'k/font-bold.woff2',
             'published', 3, now() - interval '1 day', $2::jsonb)
     RETURNING id`,
    [staleOrg, JSON.stringify(STALE_SNAPSHOT)],
  );
  staleId = stale.rows[0]!.id;

  const cleanOrg = await insertOrg('Groupe 0070 propre', 'groupe-0070-propre');
  const clean = await admin.query<{ id: string }>(
    `INSERT INTO tenant_branding
       (organization_id, dark_mode, font_family, status, version, published_at, published_snapshot)
     VALUES ($1, 'disabled', 'system', 'published', 2, now() - interval '1 day', $2::jsonb)
     RETURNING id`,
    [cleanOrg, JSON.stringify(CLEAN_SNAPSHOT)],
  );
  cleanId = clean.rows[0]!.id;

  // A draft that holds the retired values with nothing published yet.
  const draftOrg = await insertOrg('Groupe 0070 brouillon', 'groupe-0070-brouillon');
  const draft = await admin.query<{ id: string }>(
    `INSERT INTO tenant_branding (organization_id, dark_mode, font_family, font_woff2_key)
     VALUES ($1, 'custom', 'custom', 'k/draft.woff2') RETURNING id`,
    [draftOrg],
  );
  draftId = draft.rows[0]!.id;
});

afterAll(async () => {
  await admin?.end();
  if (stageDir) rmSync(stageDir, { recursive: true, force: true });
});

it('0070 rewrites the stale row and its snapshot, leaves version alone, and drops the two columns', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const cleanBefore = await admin.query<{ updated_at: string }>(
    `SELECT updated_at::text FROM tenant_branding WHERE id = $1`, [cleanId],
  );

  const applied = await migrate(admin, migrationsDir);
  // Everything from 0070 on was missing from the ledger — 0070 applies first,
  // every later migration follows, and nothing BEFORE 0070 may re-run. Exact
  // equality, so a re-run of any earlier migration still reds this line.
  const expectedApplied = readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_[a-z0-9-]+\.sql$/.test(f))
    .sort()
    .filter((f) => f >= MIGRATION);
  expect(expectedApplied[0]).toBe(MIGRATION);
  expect(applied).toEqual(expectedApplied);

  const stale = await admin.query<{
    dark_mode: string; font_family: string; version: number; published_snapshot: Record<string, unknown>;
  }>(
    `SELECT dark_mode, font_family, version, published_snapshot FROM tenant_branding WHERE id = $1`,
    [staleId],
  );
  const row = stale.rows[0]!;
  expect(row.dark_mode).toBe('derived');
  expect(row.font_family).toBe('inter');
  // No publish happened, so no version was minted.
  expect(row.version).toBe(3);
  // Values rewritten, keys removed, everything else byte-for-byte as frozen.
  const rest: Record<string, unknown> = { ...STALE_SNAPSHOT };
  delete rest['font_woff2_key'];
  delete rest['font_woff2_bold_key'];
  expect(row.published_snapshot).toEqual({ ...rest, dark_mode: 'derived', font_family: 'inter' });
  expect(row.published_snapshot).not.toHaveProperty('font_woff2_key');
  expect(row.published_snapshot).not.toHaveProperty('font_woff2_bold_key');

  // The draft's columns are rewritten and its NULL snapshot stays NULL.
  const draft = await admin.query<{ dark_mode: string; font_family: string; published_snapshot: unknown }>(
    `SELECT dark_mode, font_family, published_snapshot FROM tenant_branding WHERE id = $1`, [draftId],
  );
  expect(draft.rows[0]).toEqual({ dark_mode: 'derived', font_family: 'inter', published_snapshot: null });

  // The clean row was not touched at all — the WHERE scope is real, and the
  // updated_at trigger did not fire on it.
  const clean = await admin.query<{ published_snapshot: unknown; updated_at: string }>(
    `SELECT published_snapshot, updated_at::text FROM tenant_branding WHERE id = $1`, [cleanId],
  );
  expect(clean.rows[0]!.published_snapshot).toEqual(CLEAN_SNAPSHOT);
  expect(clean.rows[0]!.updated_at).toBe(cleanBefore.rows[0]!.updated_at);

  // The columns are gone, and the CHECKs now refuse the retired values.
  const cols = await admin.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_branding'
       AND column_name IN ('font_woff2_key', 'font_woff2_bold_key', 'font_family')`,
  );
  expect(cols.rows.map((r) => r.column_name)).toEqual(['font_family']);
  await expect(
    admin.query(`UPDATE tenant_branding SET dark_mode = 'custom' WHERE id = $1`, [staleId]),
  ).rejects.toMatchObject({ constraint: 'tenant_branding_dark_mode_check' });
  await expect(
    admin.query(`UPDATE tenant_branding SET font_family = 'custom' WHERE id = $1`, [staleId]),
  ).rejects.toMatchObject({ constraint: 'tenant_branding_font_family_check' });
});
