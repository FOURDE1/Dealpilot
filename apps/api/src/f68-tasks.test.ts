import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { Task, TaskListPage, TaskSummary, type TaskT } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-68 — the unified task system (appointments-tasks-communications.md §3.3).
 *
 * What is worth proving: the permission follows the SUBJECT; buckets are
 * the store's calendar; completion is one fact (completed_at) with a trail
 * under the lead; bulk touches only open rows and says how many; the §2.4
 * appointment automations make exactly one task per (appointment, source);
 * a rival sees nothing and a store-bound manager sees their store.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const TZ = 'America/Toronto';

const WORKSHEET = {
  province: 'QC' as const,
  deal_type: 'finance' as const,
  sale_price_cents: 2_500_000,
  vehicle_cost_cents: 2_100_000,
  trade_allowance_cents: 0,
  trade_acv_cents: 0,
  trade_lien_cents: 0,
  rebate_cents: 0,
  fees_cents: 0,
  fees_taxable: false,
  fi_price_cents: 0,
  fi_cost_cents: 0,
};

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let salesCookie = '';
let managerCookie = '';
let rivalCookie = '';
let orgId = '';
let rivalOrgId = '';
let storeId = '';
let storeBId = '';
let ownerId = '';
let salesId = '';
let leadA = '';
let leadB = '';
let leadC = '';
let vehicleId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

/** The store's calendar date of an instant — the oracle for "due today". */
function localDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function addMember(email: string, name: string, roles: string[]): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email, name, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { user_id: string }).user_id;
}

async function lead(n: number, store = storeId): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: store, source: 'walk_in',
      first_name: `Tâche${n}`, phone: `+1514555${String(9500 + n)}`, vehicle_interest: 'Kia Seltos',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function createTask(body: Record<string, unknown>, who = cookie, expectStatus = 201): Promise<TaskT> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/tasks', headers: { cookie: who },
    payload: { organization_id: orgId, subject_type: 'lead', subject_id: leadA, title: 'Rappeler', ...body },
  });
  expect(res.statusCode, res.body).toBe(expectStatus);
  return expectStatus === 201 ? Task.parse(JSON.parse(res.body)) : (JSON.parse(res.body) as TaskT);
}

async function list(qs: string, who = cookie): Promise<TaskT[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/tasks?organization_id=${orgId}&${qs}`, headers: { cookie: who },
  });
  expect(res.statusCode, res.body).toBe(200);
  return TaskListPage.parse(JSON.parse(res.body)).items;
}

async function patch(id: string, body: Record<string, unknown>, who = cookie, expectStatus = 200): Promise<TaskT> {
  const res = await app!.inject({ method: 'PATCH', url: `/api/v1/tasks/${id}`, headers: { cookie: who }, payload: body });
  expect(res.statusCode, res.body).toBe(expectStatus);
  return expectStatus === 200 ? Task.parse(JSON.parse(res.body)) : (JSON.parse(res.body) as TaskT);
}

async function book(leadId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const starts = new Date(Date.now() + 24 * 3_600_000);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/appointments', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, lead_id: leadId, kind: 'test_drive',
      starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 45 * 60_000).toISOString(),
      ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function flip(appointmentId: string, status: string): Promise<void> {
  const res = await app!.inject({
    method: 'PATCH', url: `/api/v1/appointments/${appointmentId}`, headers: { cookie }, payload: { status },
  });
  expect(res.statusCode, res.body).toBe(200);
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const ownerEmail = `f68-${run}@dealpilot.test`;
  cookie = await signUp(ownerEmail, 'Patronne Tâches');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Tâches', slug: `groupe-taches-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  ownerId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [ownerEmail])).rows[0]!.id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Tâches Laval', code: 'TALV', province: 'QC', timezone: TZ },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const storeB = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Tâches Québec', code: 'TAQC', province: 'QC', timezone: TZ },
  });
  storeBId = (JSON.parse(storeB.body) as { id: string }).id;

  const salesEmail = `f68-s-${run}@dealpilot.test`;
  salesCookie = await signUp(salesEmail, 'Vendeur Tâches');
  salesId = await addMember(salesEmail, 'Vendeur Tâches', ['salesperson']);

  const mgrEmail = `f68-m-${run}@dealpilot.test`;
  managerCookie = await signUp(mgrEmail, 'Gérant Québec');
  await addMember(mgrEmail, 'Gérant Québec', ['sales_manager']);
  await admin.query(
    `UPDATE memberships SET store_id = $3
     WHERE organization_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
    [orgId, mgrEmail, storeBId],
  );

  rivalCookie = await signUp(`f68-r-${run}@dealpilot.test`, 'Rival Tâches');
  const rival = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival', slug: `groupe-rival-${run}` },
  });
  rivalOrgId = (JSON.parse(rival.body) as { id: string }).id;

  leadA = await lead(1);
  leadB = await lead(2, storeBId);
  leadC = await lead(3);
  const car = await app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId,
      stock_number: 'T6801', vin: '5XYP34GC1NG168001', year: 2024, make: 'Kia', model: 'Seltos', trim: 'EX',
      exterior_color: 'Gravity Grey', mileage_km: 12_000, acquisition_type: 'trade_in',
      acquisition_cost_cents: 2_400_000, transport_cost_cents: 40_000, recon_cost_cents: 100_000,
    },
  });
  expect(car.statusCode, car.body).toBe(201);
  vehicleId = (JSON.parse(car.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('tasks (F-68, §3.3 Target)', () => {
  it('creates a follow-up on a lead — store from the lead, bucket from the clock, trail under the lead', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ due_at: hoursFromNow(48), assigned_to: salesId, title: 'Rappeler Tâche1' });
    expect(t).toMatchObject({
      store_id: storeId, subject_type: 'lead', subject_id: leadA, status: 'pending', source: 'manual',
      task_type: 'follow_up', priority: 'medium', assigned_to: salesId, created_by: ownerId, bucket: 'week',
      completed_at: null, overdue_notified_at: null,
    });
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${t.id}`, headers: { cookie } });
    const events = (JSON.parse(trail.body) as { items: { action: string; parent_entity_id: string | null }[] }).items;
    expect(events.find((e) => e.action === 'created')).toMatchObject({ parent_entity_id: leadA });
  });

  it('refuses an unknown subject, a store that is not the subject’s, and a stranger assignee', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ghost = await createTask({ subject_id: '00000000-0000-4000-8000-000000000000' }, cookie, 422);
    expect(JSON.stringify(ghost)).toContain('invalid_reference');
    const wrongStore = await createTask({ store_id: storeBId }, cookie, 422);
    expect(JSON.stringify(wrongStore)).toContain('store_mismatch');
    const stranger = await createTask({ assigned_to: '00000000-0000-4000-8000-000000000001' }, cookie, 422);
    expect(JSON.stringify(stranger)).toContain('not_a_member');
  });

  it('the board: open first, by due date, undated last; history only when asked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const late = await createTask({ subject_id: leadC, due_at: hoursFromNow(72), title: 'C tard' });
    const undated = await createTask({ subject_id: leadC, title: 'C sans date' });
    const soon = await createTask({ subject_id: leadC, due_at: hoursFromNow(1), title: 'C bientôt' });
    const done = await createTask({ subject_id: leadC, due_at: hoursFromNow(2), title: 'C fait' });
    await patch(done.id, { status: 'completed' });

    const open = await list(`subject_type=lead&subject_id=${leadC}`);
    expect(open.map((t) => t.id)).toEqual([soon.id, late.id, undated.id]);
    const all = await list(`subject_type=lead&subject_id=${leadC}&open=false`);
    expect(all.map((t) => t.id)).toEqual([soon.id, late.id, undated.id, done.id]);
    const completed = await list(`subject_type=lead&subject_id=${leadC}&status=completed`);
    expect(completed.map((t) => t.id)).toEqual([done.id]);
  });

  it('completing is one fact: completed_at travels with the status, and the lead’s trail says task_completed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ due_at: hoursFromNow(3), title: 'À terminer' });
    const finished = await patch(t.id, { status: 'completed' });
    expect(finished.status).toBe('completed');
    expect(finished.completed_at).not.toBeNull();
    expect(finished.bucket).toBeNull();

    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${t.id}`, headers: { cookie } });
    const events = (JSON.parse(trail.body) as { items: { action: string; parent_entity_type: string | null }[] }).items;
    expect(events.find((e) => e.action === 'task_completed')).toMatchObject({ parent_entity_type: 'lead' });

    const reopened = await patch(t.id, { status: 'pending' });
    expect(reopened.completed_at).toBeNull();
    expect(reopened.bucket).not.toBeNull();
  });

  it('the summary buckets by the STORE’s calendar, and the board filters by bucket', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const todayAt = hoursFromNow(1 / 60);
    // If the next minute is already tomorrow in Laval, "today" is empty and
    // that task is a week task — the oracle decides, not the wall clock.
    const stillToday = localDate(todayAt) === localDate(new Date().toISOString());
    const overdue = await createTask({ subject_id: leadB, due_at: hoursFromNow(-24), assigned_to: salesId, title: 'B en retard' });
    await createTask({ subject_id: leadB, due_at: todayAt, assigned_to: salesId, title: 'B aujourd’hui' });
    await createTask({ subject_id: leadB, due_at: hoursFromNow(72), assigned_to: salesId, title: 'B semaine' });
    await createTask({ subject_id: leadB, due_at: hoursFromNow(24 * 20), assigned_to: salesId, title: 'B plus tard' });
    await createTask({ subject_id: leadB, assigned_to: salesId, title: 'B sans date' });

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/tasks/summary?organization_id=${orgId}&assigned_to=${salesId}&store_id=${storeBId}`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const summary = TaskSummary.parse(JSON.parse(res.body));
    expect(summary).toEqual({
      overdue: 1, today: stillToday ? 1 : 0, week: stillToday ? 1 : 2, later: 1, undated: 1, total_open: 5,
    });

    const onlyOverdue = await list(`assigned_to=${salesId}&bucket=overdue`);
    expect(onlyOverdue.map((t) => t.id)).toEqual([overdue.id]);
  });

  it('bulk touches only open rows and says how many; reassign validates the member', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = await createTask({ subject_id: leadC, title: 'Lot A' });
    const b = await createTask({ subject_id: leadC, title: 'Lot B' });
    const c = await createTask({ subject_id: leadC, title: 'Lot C' });
    await patch(c.id, { status: 'completed' });

    const done = await app!.inject({
      method: 'POST', url: '/api/v1/tasks/bulk/complete', headers: { cookie },
      payload: { organization_id: orgId, task_ids: [a.id, b.id, c.id] },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(JSON.parse(done.body)).toEqual({ updated: 2 });

    const d = await createTask({ subject_id: leadC, title: 'Lot D', assigned_to: salesId });
    const same = await app!.inject({
      method: 'POST', url: '/api/v1/tasks/bulk/reassign', headers: { cookie },
      payload: { organization_id: orgId, task_ids: [d.id, a.id], assigned_to: salesId },
    });
    // d already belongs to them; a is completed — nothing moved.
    expect(JSON.parse(same.body)).toEqual({ updated: 0 });
    const moved = await app!.inject({
      method: 'POST', url: '/api/v1/tasks/bulk/reassign', headers: { cookie },
      payload: { organization_id: orgId, task_ids: [d.id], assigned_to: ownerId },
    });
    expect(JSON.parse(moved.body)).toEqual({ updated: 1 });
    const stranger = await app!.inject({
      method: 'POST', url: '/api/v1/tasks/bulk/reassign', headers: { cookie },
      payload: { organization_id: orgId, task_ids: [d.id], assigned_to: '00000000-0000-4000-8000-000000000001' },
    });
    expect(stranger.statusCode, stranger.body).toBe(422);
  });

  it('the permission follows the subject: a salesperson schedules lead work, not inventory work', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await createTask({ subject_type: 'vehicle', subject_id: vehicleId, title: 'Photos' }, salesCookie, 403);
    const own = await createTask({ subject_id: leadA, title: 'Mon rappel', assigned_to: salesId }, salesCookie);
    const closed = await patch(own.id, { status: 'completed' }, salesCookie);
    expect(closed.status).toBe('completed');
    // The owner may schedule inventory work.
    const photos = await createTask({ subject_type: 'vehicle', subject_id: vehicleId, title: 'Photos', task_type: 'other' });
    expect(photos.store_id).toBe(storeId);
  });

  it('a rival organization sees none of it — and the owner does (D-046)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Confidentiel' });
    const rivalList = await app!.inject({
      method: 'GET', url: `/api/v1/tasks?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(rivalList.statusCode).toBe(404);
    const rivalOwn = await app!.inject({
      method: 'GET', url: `/api/v1/tasks?organization_id=${rivalOrgId}&open=false`, headers: { cookie: rivalCookie },
    });
    expect(rivalOwn.statusCode, rivalOwn.body).toBe(200);
    expect(TaskListPage.parse(JSON.parse(rivalOwn.body)).items.find((x) => x.id === t.id)).toBeUndefined();
    await patch(t.id, { title: 'Volé' }, rivalCookie, 404);
    const mine = await list(`subject_id=${leadA}&open=false`);
    expect(mine.find((x) => x.id === t.id)).toBeDefined();
  });

  it('a store-bound manager sees THEIR store; a foreign store_id is a 404 (F-55 scope)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const theirs = await list('open=false', managerCookie);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((t) => t.store_id === storeBId)).toBe(true);
    const foreign = await app!.inject({
      method: 'GET', url: `/api/v1/tasks?organization_id=${orgId}&store_id=${storeId}`, headers: { cookie: managerCookie },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
  });

  it('§2.4: a no-show owes ONE be-back task; a visit with no deal owes a follow-up; a visit with a deal owes nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadD = await lead(4);
    const appt = await book(leadD, { });
    await flip(appt, 'no_show');
    let auto = await list(`subject_id=${leadD}`);
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({
      source: 'appointment_no_show', appointment_id: appt, priority: 'high', task_type: 'follow_up',
      title: 'Be-back — rendez-vous manqué (essai routier)',
    });
    const dueIn = new Date(auto[0]!.due_at!).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(50 * 60_000);
    expect(dueIn).toBeLessThanOrEqual(60 * 60_000);

    // Marked no-show, customer walked in late, then marked no-show again by
    // mistake: still ONE be-back task, plus one follow-up for the visit.
    await flip(appt, 'completed');
    await flip(appt, 'no_show');
    auto = await list(`subject_id=${leadD}`);
    expect(auto.filter((t) => t.source === 'appointment_no_show')).toHaveLength(1);
    const visit = auto.find((t) => t.source === 'appointment_showed_no_deal');
    expect(visit).toMatchObject({ title: 'Suivi après la visite (essai routier)', appointment_id: appt });

    // A visit that produced a deal owes nothing.
    const leadE = await lead(5);
    const deal = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, lead_id: leadE, ...WORKSHEET },
    });
    expect(deal.statusCode, deal.body).toBe(201);
    const sold = await book(leadE);
    await flip(sold, 'completed');
    expect(await list(`subject_id=${leadE}`)).toHaveLength(0);
  });

  it('delete is soft: the row leaves the board and the trail says so', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'À supprimer' });
    const res = await app!.inject({ method: 'DELETE', url: `/api/v1/tasks/${t.id}`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(204);
    expect((await list(`subject_id=${leadA}&open=false`)).find((x) => x.id === t.id)).toBeUndefined();
    await patch(t.id, { title: 'Revenant' }, cookie, 404);
    const row = await admin.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM tasks WHERE id = $1`, [t.id]);
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });
});

describe('review regressions (F-68)', () => {
  const ghost = '00000000-0000-4000-8000-00000000abcd';

  it('bulk endpoints prove membership before anything resolves — a stranger gets 404, never a count', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Sonde' });
    for (const ids of [[ghost], [t.id]]) {
      const c = await app!.inject({
        method: 'POST', url: '/api/v1/tasks/bulk/complete', headers: { cookie: rivalCookie },
        payload: { organization_id: orgId, task_ids: ids },
      });
      expect(c.statusCode, c.body).toBe(404);
      const r = await app!.inject({
        method: 'POST', url: '/api/v1/tasks/bulk/reassign', headers: { cookie: rivalCookie },
        payload: { organization_id: orgId, task_ids: ids, assigned_to: salesId },
      });
      expect(r.statusCode, r.body).toBe(404);
    }
    // Nothing moved.
    expect((await list(`subject_id=${leadA}`)).find((x) => x.id === t.id)).toMatchObject({ status: 'pending' });
  });

  it('a record’s own task list follows the record: a store-bound manager sees a foreign-store lead’s follow-ups', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Visible depuis Québec' });
    const viaSubject = await list(`subject_type=lead&subject_id=${leadA}&open=false`, managerCookie);
    expect(viaSubject.find((x) => x.id === t.id)).toBeDefined();
    // …while the BOARD keeps the store cut.
    const board = await list('open=false', managerCookie);
    expect(board.find((x) => x.id === t.id)).toBeUndefined();
    // And they may schedule on the lead they can open.
    const theirs = await createTask({ subject_id: leadA, title: 'Planifié depuis Québec' }, managerCookie);
    expect(theirs.store_id).toBe(storeId);
  });

  it('re-sending the current due_at is not a change — no UPDATE, no event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Inchangée', due_at: hoursFromNow(5) });
    const trailBefore = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${t.id}`, headers: { cookie } });
    const countBefore = (JSON.parse(trailBefore.body) as { items: unknown[] }).items.length;
    const same = await patch(t.id, { due_at: t.due_at!, title: t.title });
    expect(same.updated_at).toBe(t.updated_at);
    const trailAfter = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${t.id}`, headers: { cookie } });
    expect((JSON.parse(trailAfter.body) as { items: unknown[] }).items.length).toBe(countBefore);
    // …but moving it by a minute on the same day IS a change.
    const moved = await patch(t.id, { due_at: new Date(new Date(t.due_at!).getTime() + 60_000).toISOString() });
    expect(moved.due_at).not.toBe(t.due_at);
  });

  it('bulk complete records the status it actually left', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'En cours' });
    await patch(t.id, { status: 'in_progress' });
    const done = await app!.inject({
      method: 'POST', url: '/api/v1/tasks/bulk/complete', headers: { cookie },
      payload: { organization_id: orgId, task_ids: [t.id] },
    });
    expect(JSON.parse(done.body)).toEqual({ updated: 1 });
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${t.id}`, headers: { cookie } });
    const events = (JSON.parse(trail.body) as { items: { action: string; changes: Record<string, { from: unknown }> }[] }).items;
    expect(events.find((e) => e.action === 'task_completed')!.changes['status']).toMatchObject({ from: 'in_progress' });
  });

  it('§2.4 makes nothing for a lead that no longer exists', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadF = await lead(6);
    const appt = await book(leadF);
    const gone = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadF}`, headers: { cookie } });
    expect([200, 204]).toContain(gone.statusCode);
    await flip(appt, 'no_show');
    const rows = await admin.query(`SELECT 1 FROM tasks WHERE subject_id = $1`, [leadF]);
    expect(rows.rows).toHaveLength(0);
  });

  it('revoking a member releases their OPEN tasks (the F-04 cascade); completed ones keep their history', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f68-x-${run}@dealpilot.test`;
    await signUp(email, 'Partant Tâches');
    const leaverId = await addMember(email, 'Partant Tâches', ['salesperson']);
    const open = await createTask({ subject_id: leadA, title: 'Orphelin', assigned_to: leaverId });
    const done = await createTask({ subject_id: leadA, title: 'Fini avant de partir', assigned_to: leaverId });
    await patch(done.id, { status: 'completed' });
    const membership = await admin.query<{ id: string }>(
      `SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2`, [orgId, leaverId],
    );
    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${membership.rows[0]!.id}`, headers: { cookie }, payload: { status: 'revoked' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const after = await list(`subject_id=${leadA}&open=false`);
    expect(after.find((x) => x.id === open.id)).toMatchObject({ assigned_to: null, status: 'pending' });
    expect(after.find((x) => x.id === done.id)).toMatchObject({ assigned_to: leaverId, status: 'completed' });
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?entity_id=${open.id}`, headers: { cookie } });
    expect((JSON.parse(trail.body) as { items: { action: string }[] }).items.find((e) => e.action === 'unassigned')).toBeDefined();
  });

  it('a task is ABOUT somebody: the board carries the subject’s name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Nommée' });
    expect(t.subject_label).toBe('Tâche1');
    const photos = await createTask({ subject_type: 'vehicle', subject_id: vehicleId, title: 'Photos bis', task_type: 'other' });
    expect(photos.subject_label).toBe('2024 Kia Seltos #T6801');
  });

  it('a lost deal is not "a deal resulted": the visit still owes a follow-up', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadG = await lead(7);
    const deal = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, lead_id: leadG, ...WORKSHEET },
    });
    expect(deal.statusCode, deal.body).toBe(201);
    const dealId = (JSON.parse(deal.body) as { id: string }).id;
    const lost = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie }, payload: { pipeline_stage: 'lost' },
    });
    expect(lost.statusCode, lost.body).toBe(200);
    const appt = await book(leadG);
    await flip(appt, 'completed');
    const auto = await list(`subject_id=${leadG}`);
    expect(auto.map((x) => x.source)).toEqual(['appointment_showed_no_deal']);
  });

  it('a be-back completed and the appointment flipped again is still ONE be-back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadH = await lead(8);
    const appt = await book(leadH);
    await flip(appt, 'no_show');
    const [beBack] = await list(`subject_id=${leadH}`);
    await patch(beBack!.id, { status: 'completed' });
    await flip(appt, 'completed');
    await flip(appt, 'no_show');
    const all = await list(`subject_id=${leadH}&open=false`);
    expect(all.filter((x) => x.source === 'appointment_no_show')).toHaveLength(1);
  });

  it('the automation’s task lives in the LEAD’s store and never belongs to a revoked agent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f68-y-${run}@dealpilot.test`;
    await signUp(email, 'Agent Parti');
    const agentId = await addMember(email, 'Agent Parti', ['salesperson']);
    // Lead in store B, appointment booked in store A with the agent expected there.
    const leadI = await lead(9, storeBId);
    const appt = await book(leadI);
    const taken = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${appt}`, headers: { cookie }, payload: { assigned_agent_id: agentId },
    });
    expect(taken.statusCode, taken.body).toBe(200);
    const membership = await admin.query<{ id: string }>(
      `SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2`, [orgId, agentId],
    );
    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${membership.rows[0]!.id}`, headers: { cookie }, payload: { status: 'revoked' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    await flip(appt, 'no_show');
    const [beBack] = await list(`subject_id=${leadI}`);
    expect(beBack).toMatchObject({ store_id: storeBId, assigned_to: null });
  });

  it('deleting a lead cancels its open follow-ups', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadJ = await lead(10);
    const t = await createTask({ subject_id: leadJ, title: 'Bientôt orpheline', due_at: hoursFromNow(-1) });
    const gone = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadJ}`, headers: { cookie } });
    expect([200, 204]).toContain(gone.statusCode);
    const row = await admin.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [t.id]);
    expect(row.rows[0]!.status).toBe('cancelled');
  });

  it('rescheduling or reopening clears the sweep stamps — a new overdue episode', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await createTask({ subject_id: leadA, title: 'Épisode', due_at: hoursFromNow(-2) });
    await admin.query(`UPDATE tasks SET overdue_notified_at = now(), escalated_at = now() WHERE id = $1`, [t.id]);
    const moved = await patch(t.id, { due_at: hoursFromNow(48) });
    expect(moved.overdue_notified_at).toBeNull();
    expect(moved.escalated_at).toBeNull();
    await admin.query(`UPDATE tasks SET overdue_notified_at = now() WHERE id = $1`, [t.id]);
    await patch(t.id, { status: 'completed' });
    const reopened = await patch(t.id, { status: 'pending' });
    expect(reopened.overdue_notified_at).toBeNull();
    expect(reopened.completed_at).toBeNull();
  });
});
