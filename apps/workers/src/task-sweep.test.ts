import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool,
} from '@dealpilot/db';
import { buildApp } from '@dealpilot/api/app';
import { runTaskSweep, taskLink } from './task-sweep.js';

/**
 * F-68 — the overdue sweep (§3.3): overdue → assignee + the store's sales
 * managers, once; unacknowledged ten minutes later → the GM, once; reading
 * the alert IS the acknowledgement; a closed task is never nagged.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let ownerId = '';
let salesId = '';
let managerId = '';
let gmId = '';
let leadId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function member(email: string, name: string, roles: string[]): Promise<string> {
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name },
  });
  expect(su.statusCode, su.body).toBe(200);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email, name, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { user_id: string }).user_id;
}

async function overdueTask(title: string, hoursAgo = 2): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/tasks', headers: { cookie },
    payload: {
      organization_id: orgId, subject_type: 'lead', subject_id: leadId, title,
      due_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), assigned_to: salesId,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function alerts(taskId: string, titleKey: string): Promise<{ user_id: string; urgency: string; link: string | null }[]> {
  const r = await admin.query<{ user_id: string; urgency: string; link: string | null }>(
    `SELECT user_id, urgency, link FROM notifications
     WHERE entity_type = 'task' AND entity_id = $1 AND title_key = $2 ORDER BY user_id`,
    [taskId, titleKey],
  );
  return r.rows;
}

const minutesLater = (m: number) => new Date(Date.now() + m * 60_000);

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

  const ownerEmail = `f68w-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: ownerEmail, password: PASSWORD, name: 'Patron Balayage' },
  });
  cookie = cookiesOf(su);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Balayage', slug: `groupe-balayage-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  ownerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [ownerEmail])).rows[0]!.id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Balayage Laval', code: 'BALV', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  salesId = await member(`f68w-s-${run}@dealpilot.test`, 'Vendeur Balayage', ['salesperson']);
  managerId = await member(`f68w-m-${run}@dealpilot.test`, 'Gérant Balayage', ['sales_manager']);
  gmId = await member(`f68w-g-${run}@dealpilot.test`, 'DG Balayage', ['gm']);

  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'walk_in',
      first_name: 'Balayé', phone: '+15145559700', vehicle_interest: 'Kia Sorento',
    },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  leadId = (JSON.parse(lead.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('task sweep (F-68, §3.3)', () => {
  it('an overdue task alerts its assignee and the store’s sales managers — once', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const taskId = await overdueTask('Rappeler Balayé');
    const first = await runTaskSweep({ pool: appPool, now: () => new Date() });
    expect(first).toMatchObject({ overdue: 1, escalated: 0, failed: 0 });

    const sent = await alerts(taskId, 'notif_task_overdue');
    expect(sent.map((a) => a.user_id).sort()).toEqual([managerId, salesId].sort());
    expect(sent[0]).toMatchObject({ urgency: 'medium', link: `/leads/${leadId}` });
    // The GM is not on the first alert.
    expect(sent.find((a) => a.user_id === gmId)).toBeUndefined();

    const again = await runTaskSweep({ pool: appPool, now: () => new Date() });
    expect(again).toMatchObject({ scanned: 0, overdue: 0, escalated: 0 });
    expect(await alerts(taskId, 'notif_task_overdue')).toHaveLength(2);

    // Done with it — the later tests drive the clock forward, and an open
    // unacknowledged task from here would (correctly) escalate in theirs.
    const done = await app!.inject({
      method: 'PATCH', url: `/api/v1/tasks/${taskId}`, headers: { cookie }, payload: { status: 'completed' },
    });
    expect(done.statusCode, done.body).toBe(200);
  });

  it('ten minutes unacknowledged escalates to the GM — once; a task nobody read stays escalated', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const taskId = await overdueTask('Rappeler Balayé bis');
    await runTaskSweep({ pool: appPool, now: () => new Date() });

    // Nine minutes in: nothing yet.
    const early = await runTaskSweep({ pool: appPool, now: () => minutesLater(9) });
    expect(early).toMatchObject({ escalated: 0 });
    expect(await alerts(taskId, 'notif_task_escalated')).toHaveLength(0);

    const late = await runTaskSweep({ pool: appPool, now: () => minutesLater(11) });
    expect(late).toMatchObject({ escalated: 1 });
    const up = await alerts(taskId, 'notif_task_escalated');
    expect(up.map((a) => a.user_id).sort()).toEqual([gmId, ownerId].sort());
    expect(up[0]).toMatchObject({ urgency: 'high' });

    const evenLater = await runTaskSweep({ pool: appPool, now: () => minutesLater(30) });
    expect(evenLater).toMatchObject({ scanned: 0, escalated: 0 });
  });

  it('reading the alert IS the acknowledgement — no escalation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const taskId = await overdueTask('Rappeler Balayé ter');
    await runTaskSweep({ pool: appPool, now: () => new Date() });
    await admin.query(
      `UPDATE notifications SET read_at = now()
       WHERE entity_type = 'task' AND entity_id = $1 AND user_id = $2`,
      [taskId, managerId],
    );
    const later = await runTaskSweep({ pool: appPool, now: () => minutesLater(15) });
    expect(later).toMatchObject({ escalated: 0 });
    expect(await alerts(taskId, 'notif_task_escalated')).toHaveLength(0);
  });

  it('a task closed before the sweep is never nagged', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const taskId = await overdueTask('Déjà fait');
    const done = await app!.inject({
      method: 'PATCH', url: `/api/v1/tasks/${taskId}`, headers: { cookie }, payload: { status: 'completed' },
    });
    expect(done.statusCode, done.body).toBe(200);
    const sweep = await runTaskSweep({ pool: appPool, now: () => minutesLater(60) });
    expect(sweep).toMatchObject({ overdue: 0, escalated: 0 });
    expect(await alerts(taskId, 'notif_task_overdue')).toHaveLength(0);
  });
});

describe('task sweep — review regressions', () => {
  it('a revoked assignee is never told: the task returns to the pool and only the managers hear', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f68w-x-${run}@dealpilot.test`;
    const leaverId = await member(email, 'Partant Balayage', ['salesperson']);
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/tasks', headers: { cookie },
      payload: {
        organization_id: orgId, subject_type: 'lead', subject_id: leadId, title: 'Rappeler après départ',
        due_at: new Date(Date.now() - 3_600_000).toISOString(), assigned_to: leaverId,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = (JSON.parse(created.body) as { id: string }).id;
    const membership = await admin.query<{ id: string }>(
      `SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2`, [orgId, leaverId],
    );
    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${membership.rows[0]!.id}`, headers: { cookie }, payload: { status: 'revoked' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    // Belt and braces: even if a stale assignee survived somewhere, the
    // recipients query itself refuses a non-member.
    await admin.query(`UPDATE tasks SET assigned_to = $2 WHERE id = $1`, [taskId, leaverId]);

    await runTaskSweep({ pool: appPool, now: () => new Date() });
    const sent = await alerts(taskId, 'notif_task_overdue');
    expect(sent.map((a) => a.user_id)).toEqual([managerId]);
    // Close it: the next test drives the clock, and this unread alert would
    // (correctly) escalate in theirs.
    const done = await app!.inject({
      method: 'PATCH', url: `/api/v1/tasks/${taskId}`, headers: { cookie }, payload: { status: 'completed' },
    });
    expect(done.statusCode, done.body).toBe(200);
  });

  it('a task rescheduled after its first alert is not escalated, and is alerted again when late again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const taskId = await overdueTask('Reportée');
    await runTaskSweep({ pool: appPool, now: () => new Date() });
    expect(await alerts(taskId, 'notif_task_overdue')).toHaveLength(2);
    // Rescheduled to next week without anybody reading the bell.
    const moved = await app!.inject({
      method: 'PATCH', url: `/api/v1/tasks/${taskId}`, headers: { cookie },
      payload: { due_at: new Date(Date.now() + 6 * 24 * 3_600_000).toISOString() },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const later = await runTaskSweep({ pool: appPool, now: () => minutesLater(15) });
    expect(later).toMatchObject({ escalated: 0 });
    expect(await alerts(taskId, 'notif_task_escalated')).toHaveLength(0);
    // Late again next week: a fresh first alert, not silence.
    const nextWeek = await runTaskSweep({ pool: appPool, now: () => minutesLater(7 * 24 * 60) });
    expect(nextWeek.overdue).toBeGreaterThanOrEqual(1);
    expect(await alerts(taskId, 'notif_task_overdue')).toHaveLength(4);
  });

  it('the deep link names the task for non-lead subjects, and the lead for leads', () => {
    expect(taskLink({ id: 'task-1', subject_type: 'deal', subject_id: 'deal-1' })).toBe('/tasks?task=task-1');
    expect(taskLink({ id: 'task-2', subject_type: 'lead', subject_id: 'lead-1' })).toBe('/leads/lead-1');
  });
});
