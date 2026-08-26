import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { buildApp } from '@dealpilot/api/app';
import { tenantOperational } from './tenant-status.js';
import { runTaskSweep } from './task-sweep.js';

/**
 * F-69 — a tenant that is not operational sends nothing: the event-driven
 * workers ask `tenantOperational`, the scheduled scans exclude it in SQL.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let leadId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function setStatus(status: string): Promise<void> {
  await admin.query(
    `UPDATE organizations SET status = $2, suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END WHERE id = $1`,
    [orgId, status],
  );
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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f69w-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Statut' },
  });
  cookie = cookiesOf(su);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Statut', slug: `groupe-statut-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Statut Laval', code: 'STLV', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', first_name: 'Statut', phone: '+15145559600', vehicle_interest: 'Kia Soul' },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('tenant status and the workers (F-69)', () => {
  it('tenantOperational: active, trial and past_due run; read_only, suspended, offboarding do not', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const [status, expected] of [
      ['active', true], ['trial', true], ['past_due', true],
      ['read_only', false], ['suspended', false], ['offboarding', false],
    ] as const) {
      await setStatus(status);
      expect(await withTenant(appPool, orgId, tenantOperational), status).toBe(expected);
    }
    await setStatus('active');
  });

  it('the task sweep skips a suspended tenant and resumes when it is reinstated; a read_only tenant is still reminded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const task = await app!.inject({
      method: 'POST', url: '/api/v1/tasks', headers: { cookie },
      payload: { organization_id: orgId, subject_type: 'lead', subject_id: leadId, title: 'Rappeler', due_at: new Date(Date.now() - 3_600_000).toISOString() },
    });
    expect(task.statusCode, task.body).toBe(201);
    const taskId = (JSON.parse(task.body) as { id: string }).id;

    await setStatus('suspended');
    const paused = await runTaskSweep({ pool: appPool, now: () => new Date() });
    expect(paused.scanned).toBe(0);
    const still = await admin.query<{ overdue_notified_at: Date | null }>(`SELECT overdue_notified_at FROM tasks WHERE id = $1`, [taskId]);
    expect(still.rows[0]!.overdue_notified_at).toBeNull();

    await setStatus('read_only');
    const reminded = await runTaskSweep({ pool: appPool, now: () => new Date() });
    expect(reminded.scanned).toBe(1);
    await setStatus('active');
  });

  it('the drip scan excludes a read_only tenant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const def = await admin.query<{ d: string }>(`SELECT pg_get_functiondef('drip_due_enrollments(timestamptz)'::regprocedure) AS d`);
    expect(def.rows[0]!.d).toContain(`o.status IN ('active','trial','past_due')`);
  });
});
