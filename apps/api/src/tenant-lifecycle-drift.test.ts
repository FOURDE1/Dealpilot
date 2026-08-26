import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { OrganizationStatus } from '@dealpilot/schemas';
import { OPERATIONAL_STATUSES, TENANT_STATUSES, TENANT_TRANSITIONS } from '@dealpilot/core';

/**
 * F-69 — the lifecycle matrix lives twice on purpose (the UI reads the core
 * copy, the definer enforces the SQL copy). This guard keeps them one.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
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
    const def = async (name: string) =>
      (await admin.query<{ d: string }>(`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = $1`, [name])).rows[0]!.d;
    const drip = await def('drip_due_enrollments');
    const inList = drip.match(/o\.status IN \(([^)]+)\)/)![1]!;
    const operational = [...inList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(operational).toEqual([...OPERATIONAL_STATUSES].sort());

    const sweep = await def('tasks_needing_attention');
    const notIn = sweep.match(/o\.status NOT IN \(([^)]+)\)/)![1]!;
    const paused = [...notIn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    // The sweep keeps reminding a read_only tenant (reads and notifications
    // stay available); it stops for the closing ones.
    expect(paused).toEqual(['offboarding', 'purged', 'suspended']);
  });
});
