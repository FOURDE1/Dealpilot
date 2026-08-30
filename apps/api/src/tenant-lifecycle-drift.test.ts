import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { OrganizationStatus } from '@dealpilot/schemas';
import {
  MARKETING_SUPPRESSED_STATUSES,
  OPERATIONAL_STATUSES,
  TENANT_STATUSES,
  TENANT_TRANSITIONS,
} from '@dealpilot/core';

/**
 * F-69 — the lifecycle matrix lives twice on purpose (the UI reads the core
 * copy, the definer enforces the SQL copy). This guard keeps them one.
 *
 * F-72 adds a third definer to the same treatment: `announcement_matches` is
 * the one audience predicate the feed, the dismiss check and the fan-out all
 * call, so a tenant status that stops being reachable there stops receiving
 * broadcasts everywhere at once, silently.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const ADMIN_URL = testAdminUrl();
let admin: Pool;
let dbUp = false;

async function definition(name: string): Promise<string> {
  const r = await admin.query<{ d: string }>(
    `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = $1`,
    [name],
  );
  return r.rows[0]!.d;
}

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

describe('tenant lifecycle drift (F-69)', () => {
  it('core statuses equal the schema vocabulary', () => {
    expect([...TENANT_STATUSES].sort()).toEqual([...OrganizationStatus.options].sort());
  });

  it('tenant_transitions() equals TENANT_TRANSITIONS pair for pair', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ from_status: string; to_status: string }>('SELECT * FROM tenant_transitions()');
    const sql = r.rows.map((x) => `${x.from_status}>${x.to_status}`).sort();
    const core = TENANT_TRANSITIONS.map(([f, t]) => `${f}>${t}`).sort();
    expect(sql).toEqual(core);
  });

  it('the definer scans pause exactly the non-operational tenants', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const drip = await definition('drip_due_enrollments');
    const inList = drip.match(/o\.status IN \(([^)]+)\)/)![1]!;
    const operational = [...inList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(operational).toEqual([...OPERATIONAL_STATUSES].sort());

    const sweep = await definition('tasks_needing_attention');
    const notIn = sweep.match(/o\.status NOT IN \(([^)]+)\)/)![1]!;
    const paused = [...notIn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    // The sweep keeps reminding a read_only tenant (reads and notifications
    // stay available); it stops for the closing ones.
    expect(paused).toEqual(['offboarding', 'purged', 'suspended']);
  });

  it('announcement_matches carries both status rules, in the order it is indexed by', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const def = await definition('announcement_matches');
    // The two clauses have the same shape, so the file's usual first-match
    // `.match` would return the lifecycle list twice and report the marketing
    // rule as correct whatever it says. Both are read, positionally, and the
    // count is asserted so a third clause cannot slide in unnoticed.
    const lists = [...def.matchAll(/p_status NOT IN \(([^)]+)\)/g)];
    expect(lists, 'announcement_matches must carry exactly two status clauses').toHaveLength(2);
    const values = (i: number) => [...lists[i]![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    // First: a closing tenant receives nothing at all.
    expect(values(0)).toEqual(['offboarding', 'purged', 'suspended']);
    // Second: §8 marketing suppression. `trial` is operational and DOES get
    // marketing — only these two are silenced.
    expect(values(1)).toEqual([...MARKETING_SUPPRESSED_STATUSES].sort());
  });
});
