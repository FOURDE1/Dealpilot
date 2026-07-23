/**
 * Writes dist/tokens.css. All logic lives (and is unit-tested) in
 * src/theme/build-css.ts; this wrapper only runs the compiled build and
 * writes the artifact. Runs as part of `pnpm build`, after tsc.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// pathToFileURL: a raw absolute Windows path ("C:\...") is read by the ESM
// loader as a URL with protocol "c:" and crashes (HO-01).
const { buildTokensCss } = await import(pathToFileURL(join(pkgRoot, 'dist/theme/build-css.js')).href);

writeFileSync(join(pkgRoot, 'dist/tokens.css'), buildTokensCss());
