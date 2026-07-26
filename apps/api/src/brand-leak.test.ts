import { expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative } from 'node:path';

/**
 * ADR-018 release blocker: no hardcoded dealer branding in shipped source.
 *
 * The product is white-label. One deployment serves Groupe Hassan, ReadyCar and
 * Riverside, and each has to see its own name and colours — so the FIRST
 * tenant's identity must not survive anywhere in the code as a default, a
 * placeholder or a stray hex. white-labeling.md §1 enumerates the as-is
 * occurrences as a removal checklist; this is that checklist, executable.
 *
 * It scans SHIPPED source only. A vehicle whose `make` is 'Kia' in a test
 * fixture is a car, not branding — the string that matters is the dealership
 * naming itself, and the legacy palette that was chosen to match its logo.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where the product's own user-facing code lives. */
const SHIPPED = [
  join('apps', 'api', 'src'),
  join('apps', 'web', 'src'),
  join('packages', 'ui', 'src'),
  join('packages', 'i18n', 'src'),
  join('packages', 'core', 'src'),
  join('packages', 'schemas', 'src'),
];

/**
 * The first tenant's identity. Each entry is something that would be WRONG on
 * a second tenant's screen.
 */
const BRAND_LEAKS: { pattern: RegExp; what: string }[] = [
  { pattern: /Kia\s+Mont-?Laurier/i, what: 'the first dealership by name' },
  { pattern: /KIA\s+Command/i, what: "the legacy palette's name" },
  { pattern: /kia-tracker/i, what: 'the legacy project name' },
  // The legacy brand red, chosen to match one dealership's logo. A second
  // tenant inherits it as "the app's colour" if it is anywhere in the source.
  { pattern: /#E53935\b/i, what: 'the legacy Kia brand red' },
  { pattern: /#EF5350\b/i, what: 'the legacy Kia brand red (dark variant)' },
  { pattern: /ReadyLoans/, what: 'the former working name of the product' },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a package that does not exist yet is not a failure
  }
  for (const entry of entries) {
    // Not shipped to a tenant: build output, and the component demo whose
    // sample data is deliberately a real dealership.
    if (entry === 'node_modules' || entry === 'dist' || entry === 'demo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // Tests are not shipped either, and they legitimately use a real dealership
    // name as a fixture and the legacy red as a colour-maths sample. Scanning
    // them would force fixtures to be renamed to keep a guard quiet, which
    // teaches people to work around the guard rather than heed it.
    else if (/\.(test|spec)\.[jt]sx?$/.test(entry)) continue;
    else if (['.ts', '.tsx', '.css', '.html', '.json'].includes(extname(entry))) out.push(full);
  }
  return out;
}

it('no tenant is hardcoded into the product (ADR-018)', () => {
  const offences: string[] = [];

  for (const area of SHIPPED) {
    for (const file of walk(join(repoRoot, area))) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (const { pattern, what } of BRAND_LEAKS) {
        lines.forEach((line, i) => {
          if (pattern.test(line)) {
            offences.push(`${relative(repoRoot, file)}:${i + 1} — ${what}: ${line.trim().slice(0, 80)}`);
          }
        });
      }
    }
  }

  expect(
    offences,
    `hardcoded branding is a release blocker — a second tenant would see the first one's identity:\n${offences.join('\n')}`,
  ).toEqual([]);
});
