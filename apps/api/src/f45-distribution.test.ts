import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-45 — the weighted queue, wired. The tally's math is golden-tested in
 * @dealpilot/core (10 cases); what this suite proves is the WIRING: an
 * ORG-LEVEL intake key lands leads store-less, the same transaction deals
 * them per the month's config, the ledger's percentages stay true, and the
 * money surface answers only to organization:update.
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
let storeA = '';
let storeB = '';
let token = '';
let secret = '';

let seq = 6500;
function nextPhone(): string {
  seq += 1;
  return `+1514555${seq}`;
}

const month = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

async function postIntake(payload: Record<string, unknown>) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  return app!.inject({
    method: 'POST', url: `/in/v1/leads/${token}`,
    headers: {
      'content-type': 'application/json',
      'x-intake-timestamp': ts,
      'x-intake-signature': `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`,
    },
    payload: body,
  });
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
    payload: { email: `f45-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Dist Ributor' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Partage', slug: `groupe-partage-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  for (const [name, code] of [['Partage Nord', 'PAR-N'], ['Partage Sud', 'PAR-S']] as const) {
    const store = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name, code, province: 'QC' },
    });
    if (code === 'PAR-N') storeA = (JSON.parse(store.body) as { id: string }).id;
    else storeB = (JSON.parse(store.body) as { id: string }).id;
  }

  // The dealer group's Meta front door: an ORG-LEVEL key, no store.
  const key = await app!.inject({
    method: 'POST', url: '/api/v1/intake-keys', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: null, label: 'Meta Lead Ads (groupe)',
      default_source: 'meta_lead_form', connector_key: 'meta_lead_ads',
    },
  });
  expect(key.statusCode, key.body).toBe(201);
  ({ token, secret } = JSON.parse(key.body) as { token: string; secret: string });

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f45-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Riva Le' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival 45', slug: `groupe-rival45-${run}` },
  });
  expect(rivalOrg.statusCode).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the central queue and the tally (§3)', () => {
  it('with no config, an org-level lead stays QUEUED — store-less, visible, real', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await postIntake({ phone: nextPhone(), first_name: 'Queue' });
    expect(res.statusCode, res.body).toBe(202);
    const { lead_id } = JSON.parse(res.body) as { lead_id: string };
    const row = await admin.query<{ store_id: string | null; source_platform: string }>(
      `SELECT store_id, source_platform FROM leads WHERE id = $1`, [lead_id],
    );
    expect(row.rows[0]).toEqual({ store_id: null, source_platform: 'meta' });
  });

  it('a 60/40 config deals arrivals in the spec\'s proportion, ledger percentages true', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/distribution/config', headers: { cookie },
      payload: {
        organization_id: orgId, platform: 'meta', month: month(),
        entries: [
          { store_id: storeA, contribution_amount_cents: 600_000 },
          { store_id: storeB, contribution_amount_cents: 400_000 },
        ],
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const items = (JSON.parse(put.body) as { items: Array<{ store_id: string; contribution_percentage: string }> }).items;
    expect(items.find((i) => i.store_id === storeA)?.contribution_percentage).toBe('60.00');
    expect(items.find((i) => i.store_id === storeB)?.contribution_percentage).toBe('40.00');

    const dealt: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const res = await postIntake({ phone: nextPhone() });
      expect(res.statusCode, res.body).toBe(202);
      const { lead_id } = JSON.parse(res.body) as { lead_id: string };
      const row = await admin.query<{ store_id: string | null }>(
        `SELECT store_id FROM leads WHERE id = $1`, [lead_id],
      );
      const sid = row.rows[0]!.store_id!;
      expect(sid).not.toBeNull();
      dealt[sid] = (dealt[sid] ?? 0) + 1;
    }
    expect(dealt[storeA]).toBe(6);
    expect(dealt[storeB]).toBe(4);

    const dash = await app!.inject({
      method: 'GET', url: `/api/v1/distribution?organization_id=${orgId}&platform=meta`, headers: { cookie },
    });
    const rows = (JSON.parse(dash.body) as { items: Array<Record<string, unknown>> }).items;
    expect(rows.find((r) => r['store_id'] === storeA)).toMatchObject({
      leads_received: 6, actual_percentage: '60.00', deviation: '0.00',
    });

    // The 3-month history covers the current month too — same rows, newest first.
    const hist = await app!.inject({
      method: 'GET', url: `/api/v1/distribution/history?organization_id=${orgId}&platform=meta`, headers: { cookie },
    });
    expect(hist.statusCode, hist.body).toBe(200);
    const histRows = (JSON.parse(hist.body) as { items: Array<Record<string, unknown>> }).items;
    expect(histRows.length).toBeGreaterThanOrEqual(2);
  });

  it('updating spend recalculates EVERY store\'s target share (leads.md:164)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/distribution/config', headers: { cookie },
      payload: {
        organization_id: orgId, platform: 'meta', month: month(),
        entries: [{ store_id: storeB, contribution_amount_cents: 600_000 }],
      },
    });
    const items = (JSON.parse(put.body) as { items: Array<{ store_id: string; contribution_percentage: string }> }).items;
    // A kept its 600k; B moved to 600k: both targets recomputed to 50/50.
    expect(items.find((i) => i.store_id === storeA)?.contribution_percentage).toBe('50.00');
    expect(items.find((i) => i.store_id === storeB)?.contribution_percentage).toBe('50.00');
  });
});

describe('the money surface answers to organization:update', () => {
  it('a rival organization gets 404 either way', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const read = await app!.inject({
      method: 'GET', url: `/api/v1/distribution?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(read.statusCode).toBe(404);
    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/distribution/config', headers: { cookie: rivalCookie },
      payload: {
        organization_id: orgId, platform: 'meta', month: month(),
        entries: [{ store_id: storeA, contribution_amount_cents: 1 }],
      },
    });
    expect(put.statusCode).toBe(404);
  });

  it('a ghost store is refused 422, named', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/distribution/config', headers: { cookie },
      payload: {
        organization_id: orgId, platform: 'google', month: month(),
        entries: [{ store_id: '00000000-0000-4000-8000-000000000045', contribution_amount_cents: 1000 }],
      },
    });
    expect(put.statusCode, put.body).toBe(422);
    expect(put.body).toContain('unknown_store');
  });

  it('a mid-month date never reaches the ledger', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/distribution/config', headers: { cookie },
      payload: {
        organization_id: orgId, platform: 'google', month: '2026-08-15',
        entries: [{ store_id: storeA, contribution_amount_cents: 1000 }],
      },
    });
    expect(put.statusCode, put.body).toBe(422);
  });
});
