import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-42 — the §7.3 cascade, wired. The funnel's math is golden-tested in
 * @dealpilot/core (13 cases); what this suite proves is the WIRING: the
 * candidate query reads real languages/caps/schedules (set through the
 * product's own routes, never raw SQL), the store-timezone verdict is
 * computed in SQL, escalation assigns the manager, and every hop lands in
 * lead_assignment_history under strategy 'cascade'.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let rivalCookie = '';
let orgId = '';
let storeId = '';
let userId = '';
let membershipId = '';

let seq = 700;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

/** Montreal wall-clock pieces, for windows guaranteed open or closed NOW. */
function montrealNow(): { dow: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dow, hhmm: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

async function makeLead(over: Record<string, unknown> = {}) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in', ...over },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as { id: string; assigned_to: string | null };
}

async function cascade(leadId: string) {
  const res = await app!.inject({
    method: 'POST', url: `/api/v1/leads/${leadId}/cascade-assign`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}

/** All agent-profile changes go through the product's own member PATCH. */
async function setProfile(profile: { preferred_languages?: string[]; max_active_leads?: number }) {
  const res = await app!.inject({
    method: 'PATCH', url: `/api/v1/members/${membershipId}`, headers: { cookie },
    payload: profile,
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as { preferred_languages: string[]; max_active_leads: number };
}

async function historyOf(leadId: string) {
  const r = await admin.query<{ rule_name: string; strategy: string; assigned_to: string }>(
    `SELECT rule_name, strategy, assigned_to FROM lead_assignment_history WHERE lead_id = $1 ORDER BY assigned_at DESC`,
    [leadId],
  );
  return r.rows;
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

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f42-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Cass Cade' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Cascade', slug: `groupe-cascade-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Cascade Kia', code: 'CAS-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  userId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
  const members = await app!.inject({
    method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie },
  });
  membershipId = (JSON.parse(members.body) as { items: Array<{ id: string }> }).items[0]!.id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f42-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Riva Lle' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival 42', slug: `groupe-rival42-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the funnel, wired (§7.3)', () => {
  it('assigns the sole capable member — backfilled languages, default cap, no schedule = available', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await makeLead(); // preferred_language defaults fr-CA
    const d = await cascade(lead.id);
    expect(d).toMatchObject({ outcome: 'assigned', user_id: userId, method: 'auto_availability' });

    const row = await admin.query<Record<string, unknown>>(
      `SELECT assigned_to, assignment_method, status FROM leads WHERE id = $1`, [lead.id],
    );
    expect(row.rows[0]).toMatchObject({ assigned_to: userId, assignment_method: 'auto_availability', status: 'assigned' });
    expect(await historyOf(lead.id)).toMatchObject([{ strategy: 'cascade', rule_name: 'funnel: auto_availability' }]);
  });

  it('language is LAW: an FR lead never lands on an EN-only agent — it escalates instead', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const updated = await setProfile({ preferred_languages: ['en-CA'] });
    expect(updated.preferred_languages).toEqual(['en-CA']);

    const lead = await makeLead(); // fr-CA
    const d = await cascade(lead.id);
    // The owner is also the escalation ladder's last rung — assigned anyway,
    // but as ESCALATION, and the history names the reason.
    expect(d).toMatchObject({ outcome: 'escalated', user_id: userId, method: 'escalation', reason: 'no_language_match' });
    expect(await historyOf(lead.id)).toMatchObject([{ strategy: 'cascade', rule_name: 'escalation: no_language_match' }]);

    await setProfile({ preferred_languages: ['fr-CA', 'en-CA'] });
  });

  it('the schedule verdict is computed in the STORE timezone — closed window filters, open window admits', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { dow, hhmm } = montrealNow();
    // A window guaranteed closed right now, on today's Montreal weekday.
    const closed = hhmm >= '12:00' ? { start_time: '00:00', end_time: '00:05' } : { start_time: '23:50', end_time: '23:55' };
    const sched = await app!.inject({
      method: 'POST', url: '/api/v1/staff-schedules', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, user_id: userId, day_of_week: dow, ...closed },
    });
    expect(sched.statusCode, sched.body).toBe(201);
    const schedId = (JSON.parse(sched.body) as { id: string }).id;

    const off = await makeLead();
    expect(await cascade(off.id)).toMatchObject({ outcome: 'escalated', reason: 'nobody_scheduled' });

    // Widen to the whole day: now they are working.
    const widen = await app!.inject({
      method: 'PATCH', url: `/api/v1/staff-schedules/${schedId}`, headers: { cookie },
      payload: { start_time: '00:00', end_time: '23:59' },
    });
    expect(widen.statusCode, widen.body).toBe(200);
    const on = await makeLead();
    expect(await cascade(on.id)).toMatchObject({ outcome: 'assigned', user_id: userId });

    // /schedules/today agrees with the funnel's verdict.
    const today = await app!.inject({
      method: 'GET', url: `/api/v1/schedules/today?organization_id=${orgId}`, headers: { cookie },
    });
    const items = (JSON.parse(today.body) as { items: Array<{ user_id: string; working_now: boolean }> }).items;
    expect(items.find((i) => i.user_id === userId)?.working_now).toBe(true);
  });

  it('at their own cap, an agent is skipped — and the manager takes it capacity notwithstanding', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await setProfile({ max_active_leads: 1 }); // they already hold leads from above
    const lead = await makeLead();
    const d = await cascade(lead.id);
    expect(d).toMatchObject({ outcome: 'escalated', user_id: userId, reason: 'all_at_capacity' });
    await setProfile({ max_active_leads: 10 });
  });

  it('the auto path never takes a lead off somebody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await makeLead();
    await cascade(lead.id);
    expect(await cascade(lead.id)).toMatchObject({ outcome: 'already_assigned' });
  });

  it("a manual PATCH stamps method 'manual'; unassigning clears it", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await makeLead();
    const assign = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${lead.id}`, headers: { cookie },
      payload: { assigned_to: userId },
    });
    expect(assign.statusCode, assign.body).toBe(200);
    expect((JSON.parse(assign.body) as { assignment_method: string }).assignment_method).toBe('manual');

    const unassign = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${lead.id}`, headers: { cookie },
      payload: { assigned_to: null },
    });
    expect((JSON.parse(unassign.body) as { assignment_method: string | null }).assignment_method).toBeNull();
  });
});

describe('the schedule grid guards its vocabulary', () => {
  it('a ghost user is refused 422, named', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/staff-schedules', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, user_id: '00000000-0000-4000-8000-000000000042',
        day_of_week: 1, start_time: '09:00', end_time: '17:00',
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('unknown_member');
  });

  it('another dealership gets 404 on our grid — never a hint that it exists', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/staff-schedules', headers: { cookie: rivalCookie },
      payload: {
        organization_id: orgId, store_id: storeId, user_id: userId,
        day_of_week: 1, start_time: '09:00', end_time: '17:00',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a window that ends before it starts never reaches the database', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/staff-schedules', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, user_id: userId,
        day_of_week: 1, start_time: '17:00', end_time: '09:00',
      },
    });
    expect(res.statusCode, res.body).toBe(422);
  });
});
