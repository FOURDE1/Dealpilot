import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-47 — the bell, wired (D-050). What this suite proves: an assignment
 * rings the RIGHT person's bell and nobody else's; the actor never
 * self-notifies; read-marking is self-only; and the whole surface is
 * addressed — one person's list simply contains no way to ask about another.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let ownerCookie = '';
let colleagueCookie = '';
let colleagueId = '';
let orgId = '';
let storeId = '';

let seq = 8200;
function nextPhone(): string {
  seq += 1;
  return `+1514555${seq}`;
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function bellOf(cookie: string) {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as { items: Array<Record<string, unknown>>; unread: number };
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
    payload: { email: `f47-${run}@dealpilot.test`, password: PASSWORD, name: 'Belle Cloche' },
  });
  ownerCookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Cloche', slug: `groupe-cloche-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'Cloche Kia', code: 'CLO-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const colleague = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f47-b-${run}@dealpilot.test`, password: PASSWORD, name: 'Colin Collègue' },
  });
  colleagueCookie = cookiesOf(colleague);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, email: `f47-b-${run}@dealpilot.test`, name: 'Colin Collègue', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);
  colleagueId = (JSON.parse(added.body) as { user_id: string }).user_id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the assignment rings the right bell (M9)', () => {
  it('cascade-assign to the colleague notifies THEM — never the actor, never anyone else', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Load the owner with one active lead so least-loaded MUST pick the
    // colleague (a 0–0 tie breaks by roster age, i.e. the owner).
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: ownerCookie } });
    const ownerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
    const ballast = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in' },
    });
    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${(JSON.parse(ballast.body) as { id: string }).id}`,
      headers: { cookie: ownerCookie }, payload: { assigned_to: ownerId },
    });

    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in', first_name: 'Nadia', last_name: 'Notif' },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    const cas = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${leadId}/cascade-assign`, headers: { cookie: ownerCookie },
    });
    const d = JSON.parse(cas.body) as { outcome: string; user_id: string };
    // Least-loaded picks the fresh colleague over the owner.
    expect(d).toMatchObject({ outcome: 'assigned', user_id: colleagueId });

    const theirs = await bellOf(colleagueCookie);
    expect(theirs.unread).toBe(1);
    expect(theirs.items[0]).toMatchObject({
      title_key: 'notif_lead_assigned',
      urgency: 'medium',
      link: `/leads/${leadId}`,
      read_at: null,
    });
    expect((theirs.items[0]!['params'] as { lead: string }).lead).toBe('Nadia Notif');

    // The actor's bell is silent, and it cannot see the colleague's row.
    const mine = await bellOf(ownerCookie);
    expect(mine.unread).toBe(0);
    expect(mine.items.find((i) => i['link'] === `/leads/${leadId}`)).toBeUndefined();
  });

  it('reading is self-only: mark one, then all — and a foreign id is a 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const theirs = await bellOf(colleagueCookie);
    const id = String(theirs.items[0]!['id']);

    // The owner cannot mark the colleague's notification — it does not exist for them.
    const foreign = await app!.inject({
      method: 'POST', url: `/api/v1/notifications/${id}/read`, headers: { cookie: ownerCookie },
    });
    expect(foreign.statusCode).toBe(404);

    const read = await app!.inject({
      method: 'POST', url: `/api/v1/notifications/${id}/read`, headers: { cookie: colleagueCookie },
    });
    expect(read.statusCode).toBe(204);
    expect((await bellOf(colleagueCookie)).unread).toBe(0);

    // A second assignment, then read-all clears the badge. Ballast again:
    // the colleague took test 1's lead, so 1–1 would tie back to the owner.
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: ownerCookie } });
    const ownerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
    const ballast = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in' },
    });
    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${(JSON.parse(ballast.body) as { id: string }).id}`,
      headers: { cookie: ownerCookie }, payload: { assigned_to: ownerId },
    });
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in' },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    await app!.inject({ method: 'POST', url: `/api/v1/leads/${leadId}/cascade-assign`, headers: { cookie: ownerCookie } });
    expect((await bellOf(colleagueCookie)).unread).toBe(1);
    const all = await app!.inject({
      method: 'POST', url: '/api/v1/notifications/read-all', headers: { cookie: colleagueCookie },
    });
    expect(all.statusCode).toBe(204);
    expect((await bellOf(colleagueCookie)).unread).toBe(0);
  });

  it('a PERSON handing a person a lead rings the bell too — and never their own', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in', first_name: 'Manu', last_name: 'Elle' },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    const before = (await bellOf(colleagueCookie)).unread;
    const patch = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie: ownerCookie },
      payload: { assigned_to: colleagueId },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const after = await bellOf(colleagueCookie);
    expect(after.unread).toBe(before + 1);
    expect(after.items[0]).toMatchObject({ title_key: 'notif_lead_assigned', link: `/leads/${leadId}` });
    expect((after.items[0]!['params'] as { lead: string }).lead).toBe('Manu Elle');
  });
});
