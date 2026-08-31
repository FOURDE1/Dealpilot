import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F-74 — the isolation proofs that replaced the rejected dev-database
 * fingerprint (D-075): static facts that cannot flake and open no database
 * connection at all. Together with the structure they pin — the database
 * name is a *_test literal in code, forced at every consumer; the API under
 * test is a child the runner spawned with an explicit DATABASE_URL — they
 * are what makes "e2e cannot touch dev" a property of the tree rather than
 * an observation about one run.
 *
 * (Collection facts — root vitest glob, testMatch exclusion, strict compile
 * — are recorded in bootstrap-guard.test.ts next door.)
 */
const e2eDir = dirname(fileURLToPath(import.meta.url));
const root = join(e2eDir, '..', '..', '..');
const runnerPath = join(root, 'scripts', 'e2e.mjs');
const configPath = join(e2eDir, '..', 'playwright.config.ts');

// The escape hatch's name, split so this guard does not catch itself.
const CONFIRM = ['DB_RESET', 'CONFIRM'].join('_');

function e2ePathFiles(): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [
    { name: 'scripts/e2e.mjs', content: readFileSync(runnerPath, 'utf8') },
    { name: 'apps/web/playwright.config.ts', content: readFileSync(configPath, 'utf8') },
  ];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ name: `apps/web/e2e/${relative(e2eDir, full)}`, content: readFileSync(full, 'utf8') });
    }
  };
  walk(e2eDir);
  return files;
}

it(`${CONFIRM} appears nowhere on the e2e path`, () => {
  const files = e2ePathFiles();
  expect(files.length).toBeGreaterThan(20); // an emptied scan must not pass vacuously
  for (const f of files) {
    expect(f.content.includes(CONFIRM), `${f.name} names the reset escape hatch`).toBe(false);
  }

  // …including the e2e job block of ci.yml. The `checks` job's occurrence is
  // a different job against its own ephemeral container and stays.
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const jobStart = ci.indexOf('\n  e2e:');
  expect(jobStart, 'ci.yml no longer has an e2e job — retarget this guard').toBeGreaterThan(-1);
  const after = ci.slice(jobStart + 1);
  const nextJob = after.slice('  e2e:'.length).search(/\n {2}\S[^\n]*:\s*\n/);
  const e2eBlock = nextJob === -1 ? after : after.slice(0, '  e2e:'.length + nextJob);
  expect(e2eBlock.includes(CONFIRM), `the e2e job block of ci.yml names ${CONFIRM}`).toBe(false);
  // Scope sanity: the checks job still carries its own confirmed reset — if
  // this ever goes, the slice above may have drifted off the real job.
  expect(ci.slice(0, jobStart).includes(CONFIRM)).toBe(true);
});

it('the runner owns the database name: a *_test constant, exactly once', () => {
  const runner = readFileSync(runnerPath, 'utf8');
  const name = runner.match(/const E2E_DB = '([^']+)'/)?.[1];
  expect(name, 'scripts/e2e.mjs lost its E2E_DB constant').toBeDefined();
  expect(name!).toMatch(/_test$/);
  // Exactly one occurrence: every other use derives from the constant, so a
  // second literal would be a fork of the name waiting to drift.
  expect(runner.split(name!).length - 1).toBe(1);
});

// The maintenance base is recognisable by its OWNER credentials (the API URL
// carries the dealpilot_app role). Split so this guard does not catch itself.
const OWNER_BASE_PREFIX = ['postgresql:', '//dealpilot:dealpilot@localhost:'].join('');

it('no postgresql:// literal on the e2e path names a non-_test database', () => {
  // One exemption, deliberately: the runner's host-shaped maintenance base
  // ends /dealpilot. That is the e2e path's single connection to that
  // database — CREATE DATABASE only, never a schema read or write — and it is
  // also the foreign-cluster refusal (another Postgres on the port has no
  // `dealpilot` database and fails loudly). The exemption is EXERCISED, not
  // merely permitted: the count below is asserted to be exactly one, so
  // losing the literal reddens this test as surely as adding a second does.
  let maintenanceBases = 0;
  for (const f of e2ePathFiles()) {
    // Template-aware: whitespace is allowed only inside `${…}`, so the base's
    // `${process.env.DEALPILOT_DB_PORT ?? 5434}` is consumed as part of the
    // literal and its REAL last segment is examined. (A scan that stopped at
    // the first space cut that literal before its /dealpilot tail, classified
    // the remainder as a template and skipped it — and this test then could
    // not fail on the one literal it was written around.)
    for (const literal of f.content.match(/postgresql:\/\/(?:\$\{[^}]*\}|[^\s'"`\\])+/g) ?? []) {
      const db = literal.slice(literal.lastIndexOf('/') + 1);
      if (db === '${E2E_DB}') continue; // the API URL derives from the constant (guarded above)
      if (/_test$/.test(db)) continue;
      if (db === 'dealpilot' && f.name === 'scripts/e2e.mjs' && literal.startsWith(OWNER_BASE_PREFIX)) {
        maintenanceBases += 1;
        continue;
      }
      throw new Error(`${f.name} carries a postgresql:// literal naming "${db}" — not a *_test database`);
    }
  }
  expect(maintenanceBases, 'the runner has exactly one maintenance-base literal (owner credentials, /dealpilot)').toBe(1);
});
