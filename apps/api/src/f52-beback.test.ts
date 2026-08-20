import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-52 — the be-back queue (leads.md §9).
 *
 * Fixtures are created through the product (POST + PATCH — transitions are
 * free in the vocabulary); admin SQL is used ONLY for time travel
 * (last_contacted_at) and the rules-engine-owned score, both unreachable
 * through the API by design. The one lead left never-contacted exercises the
 * COALESCE fallback to updated_at.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const DAY_MS = 24 * 60 * 60 * 1000;

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
const leadId: Record<string, string> = {};
let lostReasonId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function makeLead(
  name: string,
  fields: { first_name: string; last_name: string; vehicle_interest?: string; phone: string },
  status: string,
  daysDormant: number | null,
  score?: number,
): Promise<void> {
  const created = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', ...fields },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = (JSON.parse(created.body) as { id: string }).id;
  leadId[name] = id;
  if (status !== 'new') {
    // F-53: a loss carries its WHY — the fixture obeys the product's rule.
    const payload = status === 'lost' ? { status, lost_reason_id: lostReasonId } : { status };
    const moved = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${id}`, headers: { cookie },
      payload,
    });
    expect(moved.statusCode, moved.body).toBe(200);
  }
  if (daysDormant !== null) {
    await admin.query(`UPDATE leads SET last_contacted_at = now() - $2::interval WHERE id = $1`, [
      id, `${daysDormant} days`,
    ]);
  }
  if (score !== undefined) {
    await admin.query(`UPDATE leads SET score = $2 WHERE id = $1`, [id, score]);
  }
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

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f52-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Patron Relance' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Relance', slug: `groupe-relance-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Relance Mont-Laurier', code: 'RLML', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const reasons = await app!.inject({
    method: 'GET', url: `/api/v1/lost-reasons?organization_id=${orgId}`, headers: { cookie },
  });
  lostReasonId = (JSON.parse(reasons.body) as { items: { id: string }[] }).items[0]!.id;

  await makeLead('critical', { first_name: 'Yvon', last_name: 'Tremblay', vehicle_interest: 'Kia Sportage', phone: '+15145550101' }, 'lost', 100);
  await makeLead('high', { first_name: 'Manon', last_name: 'Bélanger', phone: '+15145550102' }, 'nurture', 45, 80);
  await makeLead('medium', { first_name: 'Réal', last_name: 'Gagnon', phone: '+15145550103' }, 'expired', 20);
  // Never contacted: dormant_since must fall back to updated_at (today → low).
  await makeLead('low', { first_name: 'Diane', last_name: 'Fortin', phone: '+15145550104' }, 'unresponsive', null);
  // Active pipeline — must NOT populate the queue.
  await makeLead('active', { first_name: 'Marc', last_name: 'Roy', phone: '+15145550105' }, 'contacted', 200);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

interface QueueBody {
  items: { id: string; dormant_since: string }[];
  total: number;
  critical: number;
}

async function queue(qs = ''): Promise<QueueBody> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/leads/be-back?organization_id=${orgId}${qs}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as QueueBody;
}

describe('be-back queue (F-52, leads.md §9)', () => {
  it('populates from exactly the four dormant statuses — an active lead is invisible even at 200 days', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue();
    const ids = q.items.map((i) => i.id);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain(leadId['active']);
    expect(q.total).toBe(4);
    expect(q.critical).toBe(1);
  });

  it('default aging sort surfaces the longest-silent lead first; never-contacted falls back to updated_at', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue();
    expect(q.items[0]!.id).toBe(leadId['critical']);
    expect(q.items[3]!.id).toBe(leadId['low']);
    const days = (Date.now() - new Date(q.items[3]!.dormant_since).getTime()) / DAY_MS;
    expect(days).toBeLessThan(1);
  });

  it('score sort puts the scored lead first, NULLS LAST', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue('&sort=score');
    expect(q.items[0]!.id).toBe(leadId['high']);
  });

  it('created sort is oldest first', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue('&sort=created');
    expect(q.items[0]!.id).toBe(leadId['critical']);
  });

  it('search matches vehicle of interest and treats LIKE metacharacters literally', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const hit = await queue('&q=Sportage');
    expect(hit.items.map((i) => i.id)).toEqual([leadId['critical']]);
    expect(hit.total).toBe(1);
    const wild = await queue(`&q=${encodeURIComponent('100%')}`);
    expect(wild.total).toBe(0);
  });

  it('search matches the FULL name as displayed, across the first/last boundary', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const full = await queue(`&q=${encodeURIComponent('Yvon Tremblay')}`);
    expect(full.items.map((i) => i.id)).toEqual([leadId['critical']]);
    const spanning = await queue(`&q=${encodeURIComponent('on Trem')}`);
    expect(spanning.items.map((i) => i.id)).toEqual([leadId['critical']]);
  });

  it('the critical alert is queue-wide: a search matching only calm leads does not hide it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue(`&q=${encodeURIComponent('Manon')}`);
    expect(q.items.map((i) => i.id)).toEqual([leadId['high']]);
    expect(q.total).toBe(1);
    expect(q.critical).toBe(1);
  });

  it('limit bounds the head while totals stay honest', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = await queue('&limit=2');
    expect(q.items).toHaveLength(2);
    expect(q.total).toBe(4);
  });

  it('reactivation through the existing PATCH removes the lead from the queue', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const moved = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId['medium']}`, headers: { cookie },
      payload: { status: 'contacted' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const q = await queue();
    expect(q.items.map((i) => i.id)).not.toContain(leadId['medium']);
    expect(q.total).toBe(3);
  });
});
