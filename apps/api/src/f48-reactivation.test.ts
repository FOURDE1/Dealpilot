import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import type { LeadReassignJobT } from '@dealpilot/contracts';
import { buildApp } from './app.js';
import { createCarrier, expectedSignature, type CarrierLogger } from './carrier.js';
import { loadEnv } from './env.js';

/**
 * F-48 — reactivation on reply (FR-LEAD-012, leads.md:459, D-051).
 *
 * The whole promise in one journey: a lead written off as unresponsive TEXTS
 * BACK through the real signed webhook, and by the time the carrier gets its
 * 204 the lead is alive again — fresh ladder, re-funnelled if orphaned,
 * handed straight back if still owned, ten-minute timer armed.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const TOKEN = 'f48-twilio-auth-token';
const ORIGIN = 'https://hooks.f48.test';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let ownerId = '';
const armed: LeadReassignJobT[] = [];

const silentLogger: CarrierLogger = { info: () => {}, warn: () => {} };

function inbound(from: string, body: string) {
  const path = '/carrier/v1/sms/inbound';
  const params = { From: from, To: `+15145550000`, Body: body, MessageSid: `SM${run}${Math.random().toString(36).slice(2, 10)}` };
  return app!.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': expectedSignature(TOKEN, `${ORIGIN}${path}`, params),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

async function leadRow(id: string) {
  const r = await admin.query<Record<string, unknown>>(
    `SELECT status, assigned_to, assignment_method, previous_agents, assignment_attempts
     FROM leads WHERE id = $1`,
    [id],
  );
  return r.rows[0]!;
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
  const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test', TWILIO_AUTH_TOKEN: TOKEN, PUBLIC_WEBHOOK_ORIGIN: ORIGIN });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test', TWILIO_AUTH_TOKEN: TOKEN, PUBLIC_WEBHOOK_ORIGIN: ORIGIN },
    {
      carrier: createCarrier(env, silentLogger),
      reassignQueue: { arm: async (j) => { armed.push(j); }, close: async () => {} },
    },
  ));

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f48-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rea Vive' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Retour', slug: `groupe-retour-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Retour Kia', code: `F48-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  await app!.inject({
    method: 'PATCH', url: `/api/v1/stores/${storeId}`, headers: { cookie },
    payload: { sms_number: '+15145550000' },
  });
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  ownerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function makeDormantLead(phone: string, status: string, assignedTo: string | null) {
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone, source: 'walk_in' },
  });
  const id = (JSON.parse(lead.body) as { id: string }).id;
  // Through the product's own PATCH — transitions are free in the vocabulary.
  const patch = await app!.inject({
    method: 'PATCH', url: `/api/v1/leads/${id}`, headers: { cookie },
    payload: { status, ...(assignedTo === null ? {} : { assigned_to: assignedTo }) },
  });
  expect(patch.statusCode, patch.body).toBe(200);
  return id;
}

describe('a reply wakes the dead (leads.md:459)', () => {
  it('an ORPHANED unresponsive lead re-enters the funnel and the timer arms', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145558801';
    const leadId = await makeDormantLead(phone, 'unresponsive', null);
    armed.length = 0;

    const res = await inbound(phone, 'Bonjour, je suis encore intéressé par le VUS!');
    expect(res.statusCode, res.body).toBe(204);

    const row = await leadRow(leadId);
    expect(row['status']).toBe('assigned');
    expect(row['assigned_to']).toBe(ownerId);
    expect(row['previous_agents']).toEqual([]);
    expect(row['assignment_attempts']).toBe(0);
    expect(armed).toEqual([
      { organization_id: orgId, lead_id: leadId, assigned_to: ownerId, attempt: 0 },
    ]);
  });

  it('an EXPIRED lead still holding its agent goes straight back to them — no re-funnel, no fresh timer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145558802';
    const leadId = await makeDormantLead(phone, 'expired', ownerId);
    const before = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM lead_assignment_history WHERE lead_id = $1`, [leadId],
    );
    armed.length = 0;

    const res = await inbound(phone, 'Finalement oui, on peut se reparler?');
    expect(res.statusCode, res.body).toBe(204);

    const row = await leadRow(leadId);
    expect(row['status']).toBe('assigned');
    expect(row['assigned_to']).toBe(ownerId);
    const after = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM lead_assignment_history WHERE lead_id = $1`, [leadId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n); // the funnel did NOT run
    expect(armed).toHaveLength(0);
  });

  it('a LIVE lead replying is not touched by the hook', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145558803';
    const leadId = await makeDormantLead(phone, 'contacted', ownerId);
    armed.length = 0;
    const res = await inbound(phone, 'Merci pour la soumission.');
    expect(res.statusCode, res.body).toBe(204);
    const row = await leadRow(leadId);
    expect(row['status']).toBe('contacted');
    expect(armed).toHaveLength(0);
  });
});
