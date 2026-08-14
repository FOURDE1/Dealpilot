import { expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * One number, one migration.
 *
 * The numeric prefix is the ordering key — `migrate.ts:33` sorts filenames and
 * applies them in that order. When two files share a prefix the order stops
 * being decided by the number and starts being decided by whatever comes after
 * the underscore, alphabetically. It still runs, and it runs the same way every
 * time, which is exactly what makes it dangerous: nothing fails, and the next
 * person writes a migration whose correctness depends on "0036 runs before
 * 0037" while two different files both claim to be 0036.
 *
 * It has already happened twice here, both while working fast: `carrier-edge`
 * collided with `speed-to-lead`, and `appointments` with `budget-columns`.
 * Neither can be renamed now — they are applied in the owner's dev database and
 * in every CI run, and renaming an applied migration makes every database with
 * history try to apply it again. So they are grandfathered by name, and no new
 * collision is allowed.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Collisions that shipped before this guard existed.
 *
 * Do not add to this list. Pick the next free number instead — the failure
 * message says how.
 */
const GRANDFATHERED = new Set(['20260727000036', '20260727000037']);

it('no two migrations share a numeric prefix', () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  // A path change that emptied this would make the assertion vacuous.
  expect(files.length).toBeGreaterThan(20);

  const byPrefix = new Map<string, string[]>();
  for (const file of files) {
    const prefix = file.split('_')[0]!;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
  }

  const collisions = [...byPrefix.entries()]
    .filter(([prefix, names]) => names.length > 1 && !GRANDFATHERED.has(prefix))
    .map(([prefix, names]) => `${prefix}: ${names.join(' + ')}`);

  expect(
    collisions,
    `two migrations claim the same number, so the prefix no longer says which runs first — the order falls to whatever follows the underscore, alphabetically, and the next person to depend on "N runs before N+1" will be wrong without anything failing. Renumber the NEW file to the next free prefix; never renumber one that has been applied:\n  ${collisions.join('\n  ')}`,
  ).toEqual([]);
});

it('every migration filename can be ordered', () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  for (const file of files) {
    const prefix = file.split('_')[0]!;
    // 14 digits: YYYYMMDDHHMMSS. A prefix that is not a number sorts as text
    // and would land in an arbitrary place in the sequence.
    expect(prefix, file).toMatch(/^\d{14}$/);
  }
});
