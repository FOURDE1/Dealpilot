import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-49 — tenant connectors, wired (FR-LEAD-019, D-053).
 *
 * The promise under test: "adding a new lead provider means registering a
 * connector — no code change, no deploy." So the suite registers a provider
 * nobody has ever heard of, whose payload calls a phone `client.cellulaire`,
 * mints a key for it, and posts the odd payload through the REAL signed
 * webhook — and a lead lands, mapped and consented per the config.
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
let connectorId = '';

function sign(ts: string, body: string, key: string): string {
  return `v1=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;
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
    payload: { email: `f49-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Connie Necteur' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Connecteur', slug: `groupe-connecteur-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Connecteur Kia', code: 'CON-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f49-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Riva Lle' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => String(c).split(';')[0]).join('; ');
  await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival 49', slug: `groupe-rival49-${run}` },
  });
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('registration is configuration (leads.md §2.3)', () => {
  it('registers an unheard-of provider: custom paths, its own consent basis', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/connectors', headers: { cookie },
      payload: {
        organization_id: orgId,
        source_key: 'quebec_auto_portal',
        label: 'Québec Auto Portal',
        default_source: 'marketplace',
        field_map: {
          first_name: ['client.prenom'],
          last_name: ['client.nom'],
          phone: ['client.cellulaire', 'client.telephone'],
          email: ['client.courriel'],
          vehicle_interest: ['vehicule.description'],
        },
        consent: {
          checkbox_path: 'consentement.coche',
          wording_path: 'consentement.texte',
          grants: { consent_type: 'express', channels: ['sms'], scopes: ['conversational'] },
        },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    connectorId = (JSON.parse(res.body) as { id: string }).id;
  });

  it('a built-in key is reserved — shadowing website_form is refused by name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/connectors', headers: { cookie },
      payload: {
        organization_id: orgId, source_key: 'website_form', label: 'Trap',
        default_source: 'website', field_map: {},
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('reserved_key');
  });

  it("the provider's odd payload lands as a mapped, consented lead through the signed webhook", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const key = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, label: 'Portal QC',
        default_source: 'marketplace', connector_key: 'quebec_auto_portal',
      },
    });
    expect(key.statusCode, key.body).toBe(201);
    const { token, secret } = JSON.parse(key.body) as { token: string; secret: string };

    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      // The canonical envelope's phone travels top-level for the schema gate;
      // everything ELSE wears the provider's own names.
      phone: '+15145550949',
      client: { prenom: 'Chantal', nom: 'Bergeron', cellulaire: '514-555-0949', courriel: 'chantal@example.ca' },
      vehicule: { description: 'Kia Sorento 2026 hybride' },
      consentement: { coche: true, texte: 'J’accepte de recevoir des textos au sujet de ma demande.' },
    });
    const res = await app!.inject({
      method: 'POST', url: `/in/v1/leads/${token}`,
      headers: {
        'content-type': 'application/json',
        'x-intake-timestamp': ts,
        'x-intake-signature': sign(ts, body, secret),
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(202);
    const { lead_id } = JSON.parse(res.body) as { lead_id: string };

    const consent = await admin.query<{ consent_type: string; channel: string; evidence: unknown }>(
      `SELECT consent_type, channel, evidence FROM consent_ledger WHERE lead_id = $1`,
      [lead_id],
    );
    expect(consent.rows).toHaveLength(1);
    expect(consent.rows[0]).toMatchObject({ consent_type: 'express', channel: 'sms' });
  });

  it('a ghost connector_key cannot mint a key — 422, named', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, label: 'Ghost',
        default_source: 'other', connector_key: 'nobody_home',
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('unknown_connector');
  });

  it('list, patch, and the in-use delete refusal', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/connectors?organization_id=${orgId}`, headers: { cookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    expect((JSON.parse(list.body) as { items: unknown[] }).items).toHaveLength(1);

    const patch = await app!.inject({
      method: 'PATCH', url: `/api/v1/connectors/${connectorId}`, headers: { cookie },
      payload: { label: 'Québec Auto Portal v2' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    // An active key still points here — deleting would silently rewire it.
    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/connectors/${connectorId}`, headers: { cookie },
    });
    expect(del.statusCode, del.body).toBe(409);
    expect(del.body).toContain('connector_in_use');
  });

  it('another dealership sees nothing and touches nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const create = await app!.inject({
      method: 'POST', url: '/api/v1/connectors', headers: { cookie: rivalCookie },
      payload: {
        organization_id: orgId, source_key: 'smuggled', label: 'X',
        default_source: 'other', field_map: {},
      },
    });
    expect(create.statusCode).toBe(404);
    const patch = await app!.inject({
      method: 'PATCH', url: `/api/v1/connectors/${connectorId}`, headers: { cookie: rivalCookie },
      payload: { label: 'Hijack' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/connectors/${connectorId}`, headers: { cookie: rivalCookie },
    });
    expect(del.statusCode).toBe(404);
  });
});
