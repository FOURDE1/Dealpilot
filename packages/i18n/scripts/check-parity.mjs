/**
 * CI gate (ADR-019): exits non-zero if any locale diverges from the default
 * (fr-CA) — missing/extra/empty keys or ICU argument mismatches. The locale
 * set is DERIVED from the package's `resources`, so a future locale is
 * covered the moment it ships. Logic lives (and is tested) in src/parity.ts;
 * run `pnpm build` first.
 */
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { checkParity, resources, DEFAULT_LOCALE } = await import(
  pathToFileURL(join(pkgRoot, 'dist/index.js')).href
);

const reference = resources[DEFAULT_LOCALE];
const others = Object.fromEntries(
  Object.entries(resources).filter(([locale]) => locale !== DEFAULT_LOCALE),
);

const issues = checkParity(reference, others, DEFAULT_LOCALE);
if (issues.length > 0) {
  process.stderr.write(`i18n parity FAILED — ${issues.length} issue(s):\n`);
  for (const issue of issues) {
    process.stderr.write(`  [${issue.locale}] ${issue.kind}: ${issue.key}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `i18n parity OK — ${Object.keys(others).join(', ')} match ${DEFAULT_LOCALE}\n`,
);
