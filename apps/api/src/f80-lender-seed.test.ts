import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { LENDER_DEFAULTS } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-80 — the seed's lockstep (T-L2) and its idempotency semantics (T-L3).
 *
 * T-L2 freezes the 0073 FILE's copy to LENDER_DEFAULTS: every FULL
 * (name, short_name, category, notes) tuple — null rendered as SQL NULL — the
 * three lender:manage backfill rows, the PA014 lenders arm, and the definer's
 * jsonb lenders INSERT must appear in the migration text. A future slice that
 * grows LENDER_DEFAULTS goes red HERE and must consciously ship its own
 * backfill (the 0055 frozen-copy lesson). This test pins the TEXT only; the
 * backfill's EXECUTION proof against pre-0073 organizations is
 * packages/db/src/migration-0073-backfill.test.ts.
 *
 * T-L3 proves the backfill's ON CONFLICT semantics against an org that
 * already has its rows (an f01-born org): exact-name, org-scoped, zero writes.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const migrationFile = join(migrationsDir, '20260902000073_lender-registry.sql');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';

/** Whitespace-normalized file text, so the pin survives column alignment. */
const normalize = (s: string) => s.replace(/\s+/g, ' ');

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

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f80-seed-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Patronne Semence' },
  });
  const sc = owner.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Semence', slug: `groupe-semence-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('T-L2 — the 0073 frozen copy is pinned to LENDER_DEFAULTS', () => {
  const text = normalize(readFileSync(migrationFile, 'utf8'));

  it('every LENDER_DEFAULTS row appears as its FULL 4-column tuple (notes included, null as NULL)', () => {
    for (const row of LENDER_DEFAULTS) {
      const tuple = `('${row.name}', '${row.short_name}', '${row.category}', ${row.notes === null ? 'NULL' : `'${row.notes}'`})`;
      expect(text, tuple).toContain(tuple);
    }
    expect(LENDER_DEFAULTS).toHaveLength(18);
  });

  it('carries the three lender:manage backfill rows', () => {
    for (const role of ['owner', 'gm', 'fi_manager']) {
      expect(text).toContain(`('${role}', 'lender:manage')`);
    }
  });

  it('the restated definer gained the PA014 lenders arm and the jsonb lenders INSERT', () => {
    // Pin the arm inside the definer's own text, never the file's comments —
    // the review proved a header comment quoting the SQL made a whole-file
    // toContain blind to deleting the real guard line (the name-collision
    // blind-spot class; the 0073 comment now paraphrases as belt).
    const definer = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION admin_provision_tenant'));
    expect(definer).toContain("OR jsonb_array_length(COALESCE(p_seeds->'lenders', '[]'::jsonb)) = 0");
    expect(definer).toContain("FROM jsonb_array_elements(p_seeds->'lenders') l;");
    expect(definer).toContain("SELECT v_org, l->>'name', l->>'short_name', l->>'category', l->>'notes'");
  });
});

describe('T-L3 — backfill idempotency against an org that already has its rows', () => {
  it('an org-scoped exact-name re-run writes nothing and leaves every row byte-identical', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const snapshot = () => admin.query(
      `SELECT id, organization_id, name, short_name, category, contact_name, contact_email,
              contact_phone, notes, active, created_at, updated_at
       FROM lenders WHERE organization_id = $1 ORDER BY id`,
      [orgId],
    );
    const before = await snapshot();
    expect(before.rows).toHaveLength(18);

    // The 0073 backfill's shape, built from the SAME constant, scoped to the
    // fixture org (never the whole-table CROSS JOIN against shared
    // dealpilot_test) and targeting the exact-name UNIQUE.
    const reRan = await admin.query(
      `INSERT INTO lenders (organization_id, name, short_name, category, notes)
       SELECT o.id, d.name, d.short_name, d.category, d.notes
       FROM organizations o
       CROSS JOIN unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS d(name, short_name, category, notes)
       WHERE o.id = $1
       ON CONFLICT (organization_id, name) DO NOTHING`,
      [
        orgId,
        LENDER_DEFAULTS.map((l) => l.name),
        LENDER_DEFAULTS.map((l) => l.short_name),
        LENDER_DEFAULTS.map((l) => l.category),
        LENDER_DEFAULTS.map((l) => l.notes),
      ],
    );
    expect(reRan.rowCount).toBe(0);

    const after = await snapshot();
    expect(after.rows).toEqual(before.rows);
  });
});
