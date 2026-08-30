import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';

/**
 * F-72 — the dead-vocabulary rule applied to `platform_audit_events.event`.
 *
 * The audit vocabulary is a list of things the platform claims it records.
 * Adding a value to the CHECK is free; writing the definer that emits it is
 * the work, and the two have no compiler between them. A value nothing INSERTs
 * is a promise in the schema that the trail silently never keeps — and the
 * console's event filter would offer it as a choice that matches nothing.
 *
 * The obvious form of this guard is vacuous, which is why it is written the way
 * it is. "Every value in the CHECK appears as a quoted literal in a migration"
 * is true of every value by construction: the CHECK itself is in a migration
 * and quotes all of them. So the constraint spans are STRIPPED first, and what
 * survives has to appear inside an `INSERT INTO platform_audit_events` — a
 * producer, not a declaration.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const ADMIN_URL = testAdminUrl();

let admin: Pool;
let dbUp = false;

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
});

afterAll(async () => {
  await admin?.end();
});

/** Every migration, concatenated. The vocabulary is cumulative across them. */
function migrationCorpus(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  // A path that resolved to nothing would make every assertion below pass.
  expect(files.length, 'found no migrations — this guard is looking at nothing').toBeGreaterThan(30);
  return files.map((f) => readFileSync(join(migrationsDir, f), 'utf8')).join('\n');
}

describe('platform audit vocabulary (F-72)', () => {
  it('every declared event has a producer, and the declarations are not the proof', async (ctx) => {
    if (!dbUp) return ctx.skip();

    const live = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
       WHERE con.conname = 'platform_audit_events_event_check'`,
    );
    expect(live.rows, 'platform_audit_events_event_check is gone').toHaveLength(1);
    const declared = [...live.rows[0]!.def.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!);
    expect(declared.length, 'the event vocabulary read as near-empty').toBeGreaterThan(3);

    // Both forms the constraint has taken: 0065 declares it inline on the
    // column, 0068 re-adds it by name. Strip both before looking for evidence.
    const stripped = migrationCorpus()
      .replace(/event\s+text\s+NOT NULL\s+CHECK\s*\([^)]*\)/g, '')
      .replace(/ADD CONSTRAINT platform_audit_events_event_check[\s\S]*?;/g, '');
    // If a reformat ever makes those patterns miss, the guard goes vacuous
    // rather than red. So the strip itself is checked.
    expect(stripped, 'the constraint spans were not stripped — every value would match itself').not.toMatch(
      /CHECK \(event IN/,
    );

    const producers = [...stripped.matchAll(/INSERT INTO platform_audit_events[\s\S]*?;/g)].map((m) => m[0]);
    expect(producers.length, 'no INSERT INTO platform_audit_events survived the strip').toBeGreaterThanOrEqual(6);

    for (const event of declared) {
      expect(
        producers.some((p) => p.includes(`'${event}'`)),
        `'${event}' is declared in platform_audit_events_event_check and no migration ever writes it — either a definer is missing or the value is dead vocabulary`,
      ).toBe(true);
    }
  });
});
