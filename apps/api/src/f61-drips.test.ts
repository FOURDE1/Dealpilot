import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-61 — drip sequences (automation-notifications.md §11): the config CRUD
 * and the lead.lost trigger — a lead marked lost with a matching reason is
 * enrolled in the same transaction, once per live ride.
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
let ghostedSeqId = '';
let salesCookie = '';

const STEPS = [
  {
    day: 0,
    body_fr: 'Bonjour {{first_name}}, toujours à la recherche de {{vehicle}}?',
    body_en: 'Hi {{first_name}}, still shopping for {{vehicle}}?',
  },
  {
    day: 7,
    body_fr: 'Des nouvelles de {{store_name}} — on peut aider!',
    body_en: 'News from {{store_name}} — we can help!',
  },
];

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function makeLead(phone: string): Promise<string> {
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', first_name: 'Chantal', phone },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  return (JSON.parse(lead.body) as { id: string }).id;
}

async function reasonId(name: string): Promise<string> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/lost-reasons?organization_id=${orgId}&limit=50`, headers: { cookie },
  });
  const items = (JSON.parse(res.body) as { items: { id: string; name: string }[] }).items;
  return items.find((r) => r.name === name)!.id;
}

async function enrollmentsOf(leadId: string): Promise<{ status: string; drip_sequence_id: string; current_step: number; expires_at: string }[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/drip-enrollments?organization_id=${orgId}&lead_id=${leadId}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: { status: string; drip_sequence_id: string; current_step: number; expires_at: string }[] }).items;
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
  appPool = createPool({ connectionString: APP_URL, max: 2 });
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f61-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Relance' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Relance', slug: `groupe-relance-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Relance Laval', code: 'RLLV', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  // A salesperson: may READ the config, may not author it.
  const sales = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f61-s-${run}@dealpilot.test`, password: PASSWORD, name: 'Vendeur Relance' },
  });
  salesCookie = cookiesOf(sales);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email: `f61-s-${run}@dealpilot.test`, name: 'Vendeur Relance', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('drip sequence config (F-61, §11.1)', () => {
  it('an owner authors a sequence; steps out of day order are refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const bad = await app!.inject({
      method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie },
      payload: {
        organization_id: orgId, name: 'Désordre', trigger_event: 'lead.lost',
        steps: [
          { day: 7, body_fr: 'Deuxième message en premier', body_en: 'Second message first' },
          { day: 0, body_fr: 'Premier message en deuxième', body_en: 'First message second' },
        ],
        duration_days: 90,
      },
    });
    expect(bad.statusCode, bad.body).toBe(422);

    const res = await app!.inject({
      method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie },
      payload: {
        organization_id: orgId, name: 'Sans réponse — relance', trigger_event: 'lead.lost',
        trigger_condition: { lost_reason: 'No response' },
        steps: STEPS, duration_days: 90,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const seq = JSON.parse(res.body) as { id: string; scope: string; active: boolean };
    ghostedSeqId = seq.id;
    expect(seq.scope).toBe('conversational');
    expect(seq.active).toBe(true);

    const dup = await app!.inject({
      method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie },
      payload: { organization_id: orgId, name: 'Sans réponse — relance', trigger_event: 'lead.lost', steps: STEPS, duration_days: 90 },
    });
    expect(dup.statusCode, dup.body).toBe(409);
  });

  it('a salesperson reads the config but cannot author it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/drip-sequences?organization_id=${orgId}`, headers: { cookie: salesCookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    expect((JSON.parse(list.body) as { items: unknown[] }).items).toHaveLength(1);

    const write = await app!.inject({
      method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie: salesCookie },
      payload: { organization_id: orgId, name: 'Interdit', trigger_event: 'lead.lost', steps: STEPS, duration_days: 30 },
    });
    expect(write.statusCode, write.body).toBe(403);
  });
});

describe('the lead.lost trigger (F-61, §11.2)', () => {
  it('losing a lead for the matching reason enrolls it — with the paper trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead('+15145550401');
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: await reasonId('No response') },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rides = await enrollmentsOf(leadId);
    expect(rides).toHaveLength(1);
    expect(rides[0]!.status).toBe('active');
    expect(rides[0]!.drip_sequence_id).toBe(ghostedSeqId);
    expect(rides[0]!.current_step).toBe(0);
    // duration_days=90 from enrollment, to the day.
    const horizonDays =
      (new Date(rides[0]!.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(horizonDays).toBeGreaterThan(89.9);
    expect(horizonDays).toBeLessThan(90.1);

    const trail = await withTenant(appPool, orgId, async (c) =>
      (
        await c.query(
          `SELECT 1 FROM activity_events WHERE entity_id = $1 AND action = 'drip_enrolled'`,
          [leadId],
        )
      ).rows,
    );
    expect(trail).toHaveLength(1);

    // Losing it AGAIN while the ride is live does not double-enroll.
    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'new' },
    });
    const again = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: await reasonId('No response') },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(await enrollmentsOf(leadId)).toHaveLength(1);
  });

  it('a loss for a reason the condition does not name enrolls nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead('+15145550402');
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: await reasonId('Price too high') },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await enrollmentsOf(leadId)).toHaveLength(0);
  });

  it('a deactivated sequence stops enrolling', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/drip-sequences/${ghostedSeqId}`, headers: { cookie },
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    const leadId = await makeLead('+15145550403');
    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: await reasonId('No response') },
    });
    expect(await enrollmentsOf(leadId)).toHaveLength(0);
    // Back on for the worker suite's sake — config PATCH round-trips.
    const on = await app!.inject({
      method: 'PATCH', url: `/api/v1/drip-sequences/${ghostedSeqId}`, headers: { cookie },
      payload: { active: true },
    });
    expect(on.statusCode, on.body).toBe(200);
  });
});
