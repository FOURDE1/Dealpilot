import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { CreateIntakeKeyInput } from '@dealpilot/schemas';
import { findConnector } from '@dealpilot/core';
import { buildApp } from './app.js';

/**
 * FR-LEAD-004 — ADF/XML intake, end to end through the signed webhook.
 *
 * The parser was pure and golden-tested in @dealpilot/core; this suite proves
 * the WIRING — the part that was missing entirely (findConnector('adf_xml')
 * returned null until this slice; the dead-vocabulary pattern, again). An XML
 * document signed like any JSON lead must land as a lead: phone normalized to
 * E.164, the buy vehicle chosen over the trade-in, source from the intake key,
 * and NO consent rows invented for a syndicated lead (D-042).
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let token = '';
let secret = '';

function sign(ts: string, body: string, key: string): string {
  return `v1=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;
}

async function postXml(body: string, headers: Record<string, string>) {
  return app!.inject({
    method: 'POST',
    url: `/in/v1/leads/${token}`,
    headers: { 'content-type': 'application/xml', ...headers },
    payload: body,
  });
}

/** Sign correctly and post — the happy-path transport for every ADF test. */
async function postSignedXml(body: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  return postXml(body, { 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) });
}

const ADF_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<adf>
  <prospect>
    <requestdate>2026-08-19T09:15:00-04:00</requestdate>
    <vehicle interest="trade-in"><year>2018</year><make>Honda</make><model>Civic</model></vehicle>
    <vehicle interest="buy"><year>2026</year><make>Kia</make><model>EV6</model><trim>GT-Line</trim></vehicle>
    <customer>
      <contact>
        <name part="first">Marie</name>
        <name part="last">Tremblay</name>
        <phone type="cellphone">(514) 555-0134</phone>
        <phone type="work">514 555 0000</phone>
        <email>marie.tremblay@example.ca</email>
      </contact>
      <comments>Je cherche un EV6 GT-Line, financement possible?</comments>
    </customer>
    <provider><name>AutoTrader.ca</name></provider>
  </prospect>
</adf>`;

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
    payload: { email: `f03adf-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Adf Intake' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe ADF', slug: `groupe-adf-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'ADF Kia', code: 'ADF-KIA', province: 'QC' },
  });
  const storeId = (JSON.parse(store.body) as { id: string }).id;

  const key = await app!.inject({
    method: 'POST', url: '/api/v1/intake-keys', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, label: 'AutoTrader ADF',
      default_source: 'autotrader', connector_key: 'adf_xml',
    },
  });
  expect(key.statusCode, key.body).toBe(201);
  const created = JSON.parse(key.body) as { token: string; secret: string };
  token = created.token;
  secret = created.secret;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('vocabulary lockstep', () => {
  it('every mintable connector_key resolves to a real connector definition', () => {
    // The enum a dealer can pick from and the registry the webhook consults
    // must never drift — 'adf_xml' sat in core unreachable until this test's
    // slice, which is exactly the failure this pins.
    for (const key of CreateIntakeKeyInput.shape.connector_key.unwrap().options) {
      expect(findConnector(key), `connector_key '${key}' has no definition`).not.toBeNull();
    }
  });
});

describe('the signed ADF webhook', () => {
  it('a real AutoTrader-style document lands as a lead — E.164 phone, buy vehicle, no invented consent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await postSignedXml(ADF_DOC);
    expect(res.statusCode, res.body).toBe(202);
    const { lead_id } = JSON.parse(res.body) as { lead_id: string };

    const lead = await admin.query<Record<string, unknown>>(
      `SELECT phone, first_name, last_name, email, vehicle_interest, source FROM leads WHERE id = $1`,
      [lead_id],
    );
    expect(lead.rows[0]).toMatchObject({
      phone: '+15145550134', // the cellphone, preferred over work, normalized
      first_name: 'Marie',
      last_name: 'Tremblay',
      email: 'marie.tremblay@example.ca',
      vehicle_interest: '2026 Kia EV6 GT-Line', // the BUY vehicle, not the trade-in
      source: 'autotrader',
    });

    // D-042: a syndicated lead carries no consent evidence we witnessed —
    // inventing a ledger row would be worse than having none.
    const consent = await admin.query(`SELECT 1 FROM consent_ledger WHERE lead_id = $1`, [lead_id]);
    expect(consent.rows).toHaveLength(0);
  });

  it('XML that is not ADF is refused 422, creating nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM leads WHERE organization_id = $1`, [orgId]);
    const res = await postSignedXml('<catalogue><item>not a lead</item></catalogue>');
    expect(res.statusCode, res.body).toBe(422);
    const after = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM leads WHERE organization_id = $1`, [orgId]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('an ADF lead with no usable phone is refused 422 naming the field (documented: leads are SMS-first)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const doc = ADF_DOC.replace(/<phone[^>]*>[^<]*<\/phone>/g, '');
    const res = await postSignedXml(doc);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('phone');
  });

  it('the HMAC gate applies to XML exactly as to JSON — wrong signature is 401', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = Math.floor(Date.now() / 1000).toString();
    const res = await postXml(ADF_DOC, { 'x-intake-timestamp': ts, 'x-intake-signature': 'v1=deadbeef' });
    expect(res.statusCode).toBe(401);
  });
});
