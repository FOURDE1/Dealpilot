/**
 * Writes dist/tokens.css. All logic lives (and is unit-tested) in
 * src/theme/build-css.ts; this wrapper only runs the compiled build and
 * writes the artifact. Runs as part of `pnpm build`, after tsc.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { buildTokensCss } = await import(join(pkgRoot, 'dist/theme/build-css.js'));

writeFileSync(join(pkgRoot, 'dist/tokens.css'), buildTokensCss());
