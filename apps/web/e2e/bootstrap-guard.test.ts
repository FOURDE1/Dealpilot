import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-74 — the suite's first cross-file ordering hazard, held by a guard, not
 * a comment.
 *
 * bootstrapSuperAdmin() spends the database-wide platform_staff one-shot,
 * and Playwright orders spec files arbitrarily: a SECOND spec importing the
 * helper is a PA010 at some point mid-suite that reads like a product bug.
 * ZERO importers must fail too — deleting the console journey has to redden
 * `checks`, or this guard is decoration.
 *
 * Why this vitest file lives in e2e/ and runs in the `checks` job: the root
 * vitest.config.ts has no `include` override (the default *.test.* glob
 * collects it) and excludes only node_modules/dist/reference; apps/web has
 * no vitest config of its own; Playwright's testMatch '**\/*.e2e.ts' keeps
 * it out of the browser job; root `fileParallelism: false` makes these fs
 * reads race-free; and apps/web/tsconfig.json includes "e2e", so it also
 * compiles under strict.
 */
const e2eDir = dirname(fileURLToPath(import.meta.url));

/** A file with its comments removed, so prose cannot satisfy a proof about code. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

it('exactly one spec file imports bootstrapSuperAdmin — in code, not in a comment', () => {
  const specs = readdirSync(e2eDir).filter((f) => f.endsWith('.e2e.ts'));
  // A glob or directory change that emptied the scan would make this vacuous.
  expect(specs.length).toBeGreaterThan(20);
  // Comments are stripped first: the journey's own header names the helper in
  // prose, so a refactor that deleted the import and the call but kept the
  // prose would otherwise still count as the one owner — the ZERO half of
  // this guard was satisfied by a comment until that mutation was run. The
  // bare name rather than an import-statement shape, so a namespace or
  // dynamic import in a SECOND spec is still caught.
  const importers = specs.filter((f) => codeOf(readFileSync(join(e2eDir, f), 'utf8')).includes('bootstrapSuperAdmin'));
  expect(
    importers,
    'the one-shot bootstrap has exactly one owner; a second importer hits PA010 mid-suite, zero means the console journey is gone',
  ).toEqual(['f74-console-door.e2e.ts']);
});

it('the CLI bootstrap verb is reachable only through support/platform-staff.ts', () => {
  // Guards the ACT, not just the import name: a spec shelling out to the CLI
  // directly (or importing the helper under an alias) still carries the verb
  // as a literal. The verb is split — and kept out of this test's title — so
  // the guard does not catch itself (it did, on its first run).
  const verb = ['platform', 'grant'].join('-');
  const allowed = 'support/platform-staff.ts';
  // Forward slashes on every OS, so the allow-list reads the same on the
  // owner's Windows box and the Linux runner.
  const rel = (full: string): string => relative(e2eDir, full).split(sep).join('/');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (readFileSync(full, 'utf8').includes(verb) && rel(full) !== allowed) {
        offenders.push(rel(full));
      }
    }
  };
  walk(e2eDir);
  expect(offenders, `only ${allowed} may name the bootstrap verb`).toEqual([]);
});
