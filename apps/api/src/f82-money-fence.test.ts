import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-82 money fence — the STATIC claims pin (D-084). The behavioural proof is
 * f82-expenses.test.ts T-F1/T-F2/T-F3 (every deal column, the commissions
 * rows, the vehicle triplet, the vehicle read, the leaderboard and the GM
 * dashboard byte-identical across the whole ledger walk on a FUNDED and an
 * UNFUNDED deal; a new desk copies the triplet). This file pins the claim that
 * the ledger's surface never even NAMES a desk input, an engine output, a
 * commission or the vehicle's cost columns, that f07 keeps the ONE formula
 * site, that the page adds the ledger's sum in exactly one pure call, and
 * that the shipped caption says what the product does.
 *
 * All six F-82 files are REQUIRED (R10 — no 'when present'; the F-81
 * follow-up closed): the web three land in wave 2, so this file is red until
 * then on the existence pin alone. The doc sections (S6) are scanned when
 * present and hard-required by the ship gate (F-81's shape). Comments are
 * stripped before scanning (enum-vocabulary.test.ts:133-138's two regexes,
 * copied — it exports nothing — plus the SQL `--` line comment) so a header
 * is free to NAME the columns it fences.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const has = (rel: string) => existsSync(join(root, rel));

/** enum-vocabulary.test.ts:133-138 verbatim, plus SQL `--` for the migration. */
function stripComments(src: string, sql = false): string {
  const ts = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not `://`, so a URL in a schema default survives.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return sql ? ts.replace(/--[^\n]*/g, '') : ts;
}

const ROUTES = 'apps/api/src/f82-expense-routes.ts';
const SCHEMA = 'packages/schemas/src/expense.ts';
const MIGRATION = 'packages/db/migrations/20260904000075_vehicle-expenses.sql';
const WEB = [
  'apps/web/src/features/inventory/expenses-api.ts',
  'apps/web/src/features/inventory/expenses-model.ts',
  'apps/web/src/features/inventory/expenses-panel.tsx',
];
const F82_FILES = [ROUTES, SCHEMA, MIGRATION, ...WEB];
const F07 = 'apps/api/src/f07-vehicles-routes.ts';
const PAGE = 'apps/web/src/features/inventory/vehicle-detail-page.tsx';
const DESK = 'apps/web/src/features/deals/desking-page.tsx';
const FR = 'packages/i18n/src/locales/fr-CA.ts';
const EN = 'packages/i18n/src/locales/en-CA.ts';

/** S1 — every desk input, engine output, cost column and commission token, for TS/TSX files. */
const S1_TS = /vehicle_cost|fees_cents|fi_cost|acquisition_cost_cents|transport_cost_cents|recon_cost_cents|front_gross|total_gross|fi_reserve|commission|OUTPUT_COLUMNS|recomputeDealOutputs|deal_id|useUpdateVehicle|vehicleKeys/;
/** A1 — the migration restates the activity CHECK lists, which carry the
 * literal 'commission_clawback'; its scan replaces the bare `commission`
 * token with the write and column shapes a commission could actually ride. */
const S1_SQL = /vehicle_cost|fees_cents|fi_cost|acquisition_cost_cents|transport_cost_cents|recon_cost_cents|front_gross|total_gross|fi_reserve|OUTPUT_COLUMNS|recomputeDealOutputs|deal_id|useUpdateVehicle|vehicleKeys|INSERT\s+INTO\s+commissions|UPDATE\s+commissions|\bcommissions\b|commission_rate|commission_sales|commission_fi/;
const WRITE_SHAPES = /UPDATE\s+(vehicles|deals)|INSERT\s+INTO\s+(deals|commissions)|CREATE\s+(FUNCTION|TRIGGER)/;
const TRIGGER_LINE = /^CREATE TRIGGER vehicle_expenses_updated_at BEFORE UPDATE ON vehicle_expenses$/m;

/** The formula in any spelling, FR or EN — banned from the docs' F-82 sections. */
const FORMULA = /total_cost_cents\s*\+|\+\s*total_cost_cents|coût total\s*\+\s*dépenses|approved_cents\s*\+/i;

/** Every `exp*` key/value pair in the inventory namespace of a locale file. */
function expEntries(src: string): [string, string][] {
  const start = src.indexOf('inventory: {');
  expect(start, 'inventory namespace not found').toBeGreaterThan(-1);
  const end = src.indexOf('\n  },', start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\s*(exp\w*):\s*(['"`])((?:\\.|(?!\2).)*)\2/gm)].map((m) => [m[1]!, m[3]!]);
}
const valueOf = (entries: [string, string][], key: string) => entries.find(([k]) => k === key)?.[1];

describe('F-82 money fence (static claims pin)', () => {
  it('S0: all six F-82 files exist (R10 — no "when present")', () => {
    const missing = F82_FILES.filter((rel) => !has(rel));
    expect(missing, `F-82 files missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('S1: no F-82 file names a desk input, an engine output, a cost column, a commission or the vehicle mutation hooks (comments stripped)', () => {
    for (const rel of [ROUTES, SCHEMA, ...WEB]) {
      if (!has(rel)) continue; // S0 reds; the scan stays meaningful on what exists
      const src = stripComments(read(rel));
      const m = S1_TS.exec(src);
      expect(m?.[0] ?? null, `${rel} names ${m?.[0] ?? ''}`).toBeNull();
    }
    const sql = stripComments(read(MIGRATION), true);
    const m = S1_SQL.exec(sql);
    expect(m?.[0] ?? null, `0075 names ${m?.[0] ?? ''}`).toBeNull();
    const w = WRITE_SHAPES.exec(sql.replace(TRIGGER_LINE, ''));
    expect(w?.[0] ?? null, `0075 carries a write shape: ${w?.[0] ?? ''}`).toBeNull();
    // Self-check (A1): the P7 value survived in BOTH restated lists, so the
    // scan is proven to run over the real CHECK lists, not a stripped file.
    expect(read(MIGRATION).match(/'commission_clawback'/g)?.length).toBe(2);
    expect(TRIGGER_LINE.test(read(MIGRATION))).toBe(true);
  });

  it('S2: the route file never UPDATEs an amount, PATCHABLE excludes money and receipts, MONEY_FIELDS is the six names, and the cost view is resolved before every withTenant', () => {
    const src = stripComments(read(ROUTES));
    for (const m of src.matchAll(/UPDATE\s+vehicle_expenses\s+SET([\s\S]*?)WHERE/g)) {
      expect(m[1], `an UPDATE names an amount: ${m[1]!.trim()}`).not.toMatch(/amount_cents|tax_cents|total_cents/);
    }
    const patchable = /const PATCHABLE = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    expect(patchable, 'PATCHABLE literal not found').not.toBeNull();
    expect(patchable![1]).not.toMatch(/amount_cents|tax_cents|total_cents|receipt_/);
    expect([...patchable![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(
      ['category', 'description', 'expense_date', 'invoice_number', 'status', 'vendor_name'],
    );
    const money = /const MONEY_FIELDS = \[([\s\S]*?)\] as const/.exec(src);
    expect(money, 'MONEY_FIELDS literal not found').not.toBeNull();
    expect([...money![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(
      ['amount_cents', 'receipt_content_sha256', 'receipt_content_type', 'receipt_size_bytes', 'tax_cents', 'total_cents'],
    );
    // A2: no `costViewOf(` between a `withTenant(` and its matching close —
    // a nested checkout under `FOR UPDATE OF e` self-deadlocks the pool.
    let depth = 0;
    let inTenant = false;
    let tenantDepth = 0;
    for (let i = 0; i < src.length; i++) {
      if (!inTenant && src.startsWith('withTenant(', i)) { inTenant = true; tenantDepth = depth; }
      if (inTenant && src.startsWith('costViewOf(', i)) throw new Error(`costViewOf( nested under withTenant( at offset ${i}`);
      if (src[i] === '(') depth++;
      if (src[i] === ')') { depth--; if (inTenant && depth === tenantDepth) inTenant = false; }
    }
    expect(src.match(/withTenant\(/g)?.length).toBe(6);
    expect(src.match(/costViewOf\(/g)?.length).toBe(5);
    // The two literal gate lines the drift guard reads — never a ternary.
    expect(src).toMatch(/^\s*if \(fieldKeys\.length > 0\) await requirePermission\(c, user\.id, 'vehicle:update'\);$/m);
    expect(src).toMatch(/^\s*if \(input\.status !== undefined\) await requirePermission\(c, user\.id, 'expense:approve'\);$/m);
    expect(src).not.toMatch(/notify\(|conflictFrom\(|FOR NO KEY UPDATE|FOR UPDATE(?! OF e)/);
  });

  it('S3: f07 keeps the ONE formula site, the COST_FIELDS block, the four exports and the locked read-model prior — and never names the ledger', () => {
    const raw = read(F07);
    // Positive pins on COMMENT-STRIPPED code: a comment quoting the old line
    // must not satisfy them (review finding u2).
    const code = stripComments(raw);
    expect(code).toContain("total_cost_cents: n('acquisition_cost_cents') + n('transport_cost_cents') + n('recon_cost_cents'),");
    expect(code).toContain(
      `const COST_FIELDS = [\n  'acquisition_cost_cents', 'transport_cost_cents', 'recon_cost_cents',\n  'list_price_cents', 'total_cost_cents',\n] as const;`,
    );
    expect(code).toMatch(/^export function costAllowed\(storeId: string, view: CostView\): boolean/m);
    expect(code).toMatch(/^export async function vehicleOrg\(/m);
    expect(code).toMatch(/^export async function costViewOf\(/m);
    expect(code).toMatch(/^export type CostView = /m);
    expect(code).toContain('`SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`');
    expect(code).toContain('const prior = withTotalCost(beforeRow.rows[0]!);');
    // withTotalCost stays module-private: f82 never derives a vehicle cost.
    expect(raw).not.toMatch(/export function withTotalCost/);
    expect(code).not.toMatch(/vehicle_expenses|expense/);
  });

  it('S4: the desk copies the triplet — the prefill line verbatim, no expense token in the money files, and the page adds the ledger in exactly one pure call', () => {
    expect(stripComments(read(DESK))).toContain(
      "vehicle_cost: car.total_cost_cents === undefined ? d.vehicle_cost : (car.total_cost_cents / 100).toFixed(2)",
    );
    for (const rel of [
      DESK,
      'packages/core/src/desking.ts',
      'packages/core/src/commission.ts',
      'apps/api/src/deal-outputs.ts',
      'apps/api/src/f05-deals-routes.ts',
      'apps/api/src/f09-commissions-routes.ts',
      'apps/api/src/f66-leaderboard-routes.ts',
      'apps/api/src/f78-gm-dashboard-routes.ts',
    ]) {
      expect(has(rel), `${rel} missing`).toBe(true);
      expect(stripComments(read(rel)), `${rel} names the ledger`).not.toMatch(/expense|vexp|approved_cents|ExpenseSummary/);
    }
    for (const rel of WEB) {
      if (!has(rel)) continue; // S0 reds
      expect(stripComments(read(rel)), `${rel} names total_cost_cents`).not.toMatch(/total_cost_cents/);
    }
    const page = read(PAGE);
    expect(page).toContain("<dt>{t('totalCost')}</dt>");
    const patches = [...stripComments(page).matchAll(/patch\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const arg of patches) expect(arg).not.toMatch(/expense|summary|approved_cents/);
    if (has(WEB[1]!)) {
      // Wave 2's pin: ONE withExpenses(v.total_cost_cents, …) call and no other.
      expect(page.match(/withExpenses\(/g)?.length, 'withExpenses call count').toBe(1);
      expect(page).toMatch(/withExpenses\(\s*v\.total_cost_cents\s*,/);
    }
  });

  it('S5: the locales — expWithCost and the caption exact, no bare « Total » label, « registre » not « grand livre »', () => {
    if (!has(FR) || !has(EN)) return;
    const fr = expEntries(read(FR));
    const en = expEntries(read(EN));
    if (fr.length === 0 && en.length === 0) {
      // Wave 2 lands the keys; S0 already reds the slice until then.
      expect(has(WEB[2]!), 'the panel exists but the locales carry no exp* keys').toBe(false);
      return;
    }
    expect(valueOf(fr, 'expWithCost')).toBe('Coût avec dépenses');
    expect(valueOf(en, 'expWithCost')).toBe('Cost with expenses');
    expect(valueOf(fr, 'expWithCostCaption')).toBe(
      'Coût total plus les dépenses approuvées et payées du registre. La feuille de calcul copie le coût total, jamais ce montant.',
    );
    expect(valueOf(en, 'expWithCostCaption')).toBe(
      'Total cost plus the ledger’s approved and paid expenses. The desking worksheet copies the total cost, never this figure.',
    );
    expect(valueOf(fr, 'expWithCostCaption')).toContain('jamais ce montant');
    expect(valueOf(en, 'expWithCostCaption')).toContain('never this figure');
    expect(valueOf(fr, 'expReconCaption')).toContain('registre');
    for (const [locale, entries] of [['fr', fr], ['en', en]] as const) {
      for (const [key, value] of entries) {
        expect(value, `${locale}:${key} is a bare Total`).not.toMatch(/^\s*Total\s*$/i);
        if (key !== 'expWithCostCaption') expect(value, `${locale}:${key} carries Total`).not.toMatch(/\bTotal\b/i);
        expect(value, `${locale}:${key} says grand livre`).not.toMatch(/grand livre/i);
      }
    }
  });

  it('S6: the D-084 section, ROUND 30 and PROJECT.md’s F-82 row state the fence in words and never the formula (hard-required at ship)', () => {
    const decisions = join(root, 'docs', 'DECISIONS.md');
    const d084 = existsSync(decisions) ? /## D-084[\s\S]*?(?=\n## D-0|$(?![\r\n]))/.exec(readFileSync(decisions, 'utf8')) : null;
    if (d084) {
      expect(d084[0]).toMatch(/jamais un intrant de la feuille de calcul|never a desk input/);
      expect(d084[0], 'D-084 carries the formula').not.toMatch(FORMULA);
      expect(d084[0], 'D-084 presents total_invested as a column').not.toMatch(/total_invested\s+(column|colonne)|colonne\s+total_invested|column\s+total_invested/i);
    }
    const otm = join(root, 'docs', 'OWNER-TEST-MASTER.md');
    const round30 = existsSync(otm) ? /#+ ROUND 30[\s\S]*?(?=\n#+ ROUND 3[^0]|\n#+ ROUND [012-9]|$(?![\r\n]))/.exec(readFileSync(otm, 'utf8')) : null;
    if (round30) {
      expect(round30[0]).toMatch(/jamais un intrant de la feuille de calcul|never a desk input/);
      expect(round30[0], 'ROUND 30 carries the formula').not.toMatch(FORMULA);
    }
    const project = join(root, 'docs', 'PROJECT.md');
    // `F-82` alone, never the F-82a scrub's boundary line.
    const lines = existsSync(project)
      ? readFileSync(project, 'utf8').split('\n').filter((l) => /F-82(?![0-9a-z])|Dépenses du véhicule|Approuver … les dépenses/.test(l))
      : [];
    for (const line of lines) {
      expect(line, 'PROJECT.md F-82 line carries the formula').not.toMatch(FORMULA);
      expect(line, 'PROJECT.md F-82 line presents total_invested as a column').not.toMatch(/total_invested/);
    }
    if (lines.length > 0) expect(lines.join('\n')).toMatch(/jamais un intrant de la feuille de calcul|never a desk input/);
    // Recorded so the ship gate reads it: the three sections are required
    // once the docs wave lands — at ship every one of the three must exist.
    if (process.env['F82_DOCS_REQUIRED']) {
      expect(d084, 'D-084 section missing').not.toBeNull();
      expect(round30, 'ROUND 30 section missing').not.toBeNull();
      // The third of the three (review finding #1): the PROJECT.md row is the
      // owner-facing statement of the fence and must exist at ship.
      expect(lines.length, 'PROJECT.md carries no F-82 row').toBeGreaterThan(0);
    }
  });

  it('S7: the drift dangerous list carries expense:approve; IMPERSONATION_BLOCKED_PERMISSIONS does NOT (R3)', () => {
    const drift = read('apps/api/src/permission-drift.test.ts');
    const dangerous = /const dangerous = \[([\s\S]*?)\] as const;/.exec(drift);
    expect(dangerous, 'dangerous list not found').not.toBeNull();
    expect(dangerous![1]).toContain("'expense:approve'");
    const platform = stripComments(read('packages/schemas/src/platform.ts'));
    const blocked = /IMPERSONATION_BLOCKED_PERMISSIONS: readonly PermissionT\[\] = \[([\s\S]*?)\];/.exec(platform);
    expect(blocked, 'IMPERSONATION_BLOCKED_PERMISSIONS not found').not.toBeNull();
    expect(blocked![1]).not.toContain('expense:approve');
  });

  it('S8: no notification — expense.ts has no notif_ and notification.ts gains no F-82 key', () => {
    expect(read(SCHEMA)).not.toMatch(/notif_/);
    expect(read('packages/schemas/src/notification.ts')).not.toMatch(/expense|F-82/);
    expect(stripComments(read(ROUTES))).not.toMatch(/notify\(|notif_/);
  });
});
