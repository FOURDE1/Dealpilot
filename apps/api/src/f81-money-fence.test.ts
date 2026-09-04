import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-81 money fence — the STATIC claims pin (D-082). The behavioural proof is
 * f81-submissions.test.ts T-S8a/T-S8b (fi_reserve_cents, funding_status,
 * funded_at, fi_price/fi_cost, commissions count and sum unchanged across a
 * select on a FUNDED and an UNFUNDED deal); this file pins the claim that the
 * ledger's surface never even NAMES the reserve, and that no rate spread is
 * wired into the three money route files.
 *
 * Scoped, deliberately: desking-page.tsx is excluded because it legitimately
 * types fi_reserve_cents; the web files and the doc sections are scanned
 * when present (they land in later waves of the same slice — the ship gate
 * runs this file after all of them exist, and a section that exists is
 * scanned in full).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

/** Every F-81 source file — API, schema, migration, web. */
const F81_FILES = [
  'apps/api/src/f81-submission-routes.ts',
  'packages/schemas/src/submission.ts',
  'packages/db/migrations/20260903000074_deal-submissions.sql',
  'apps/web/src/features/deals/submissions-panel.tsx',
  'apps/web/src/features/deals/submissions-api.ts',
  'apps/web/src/features/deals/submissions-model.ts',
];
/** The three that must exist in wave 1; the web three arrive with wave 2. */
const REQUIRED = F81_FILES.slice(0, 3);

/** The §2.1 formula in any spelling, FR or EN — never in a doc line either. */
const FORMULA = /rate_spread\s*[×x*]|spread\s*[×x*]\s*amount|[×x*]\s*amount_financed|écart\s*[×x*]\s*montant/i;

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('F-81 money fence (static claims pin)', () => {
  it('the wave-1 files exist and no F-81 file names fi_reserve or the spread formula', () => {
    for (const rel of REQUIRED) expect(existsSync(join(root, rel)), `${rel} missing`).toBe(true);
    for (const rel of F81_FILES) {
      if (!existsSync(join(root, rel))) continue;
      const src = read(rel);
      expect(src, `${rel} names the reserve`).not.toMatch(/fi_reserve/);
      expect(src, `${rel} carries the spread formula`).not.toMatch(FORMULA);
    }
  });

  it('no rate spread is wired into the deal, commission or leaderboard routes', () => {
    for (const rel of [
      'apps/api/src/f05-deals-routes.ts',
      'apps/api/src/f09-commissions-routes.ts',
      'apps/api/src/f66-leaderboard-routes.ts',
    ]) {
      if (!existsSync(join(root, rel))) continue;
      expect(read(rel), `${rel} reads a spread`).not.toMatch(/rate_spread|spreadBps/);
    }
    // The three route files must exist for the scan to mean anything.
    expect(existsSync(join(root, 'apps/api/src/f05-deals-routes.ts'))).toBe(true);
    expect(existsSync(join(root, 'apps/api/src/f09-commissions-routes.ts'))).toBe(true);
  });

  it('no deals-namespace subm* locale value mentions the reserve', () => {
    for (const rel of ['packages/i18n/src/locales/fr-CA.ts', 'packages/i18n/src/locales/en-CA.ts']) {
      const src = read(rel);
      for (const m of src.matchAll(/^\s*subm\w*:\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)) {
        expect(m[2], `${rel}: ${m[0].trim()}`).not.toMatch(/réserve|reserve/i);
        expect(m[2], `${rel}: ${m[0].trim()}`).not.toMatch(FORMULA);
      }
    }
  });

  it('the D-082, ROUND 28 and PROJECT.md F-81 lines carry no formula and no fi_reserve token', () => {
    const decisions = join(root, 'docs', 'DECISIONS.md');
    if (existsSync(decisions)) {
      const src = readFileSync(decisions, 'utf8');
      const m = /## D-082[\s\S]*?(?=\n## D-0|$(?![\r\n]))/.exec(src);
      if (m) {
        expect(m[0], 'D-082 names the reserve').not.toMatch(/fi_reserve/);
        expect(m[0], 'D-082 carries the formula').not.toMatch(FORMULA);
      }
    }
    const otm = join(root, 'docs', 'OWNER-TEST-MASTER.md');
    if (existsSync(otm)) {
      const src = readFileSync(otm, 'utf8');
      const m = /#+ ROUND 28[\s\S]*?(?=\n#+ ROUND 2[^8]|\n#+ ROUND [013-9]|$(?![\r\n]))/.exec(src);
      if (m) {
        expect(m[0], 'ROUND 28 names the reserve').not.toMatch(/fi_reserve/);
        expect(m[0], 'ROUND 28 carries the formula').not.toMatch(FORMULA);
      }
    }
    const project = join(root, 'docs', 'PROJECT.md');
    if (existsSync(project)) {
      for (const line of readFileSync(project, 'utf8').split('\n')) {
        if (!/F-81|Soumissions aux prêteurs|Choisir cette approbation/.test(line)) continue;
        expect(line, 'PROJECT.md F-81 line names the reserve').not.toMatch(/fi_reserve/);
        expect(line, 'PROJECT.md F-81 line carries the formula').not.toMatch(FORMULA);
      }
    }
  });
});
