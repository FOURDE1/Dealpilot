import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { AdminTenantDetail, AdminTenantSnapshot, type AdminTenantSnapshotT } from '@dealpilot/schemas';
import { countSegments } from '@dealpilot/core';
import { buildApp } from './app.js';
import type { Carrier, OutboundSms } from './carrier.js';
import { loadEnv } from './env.js';
import { deliverMessage } from './f30-deliver.js';
import { sendMessage } from './f19-send.js';
import type { AdminTenantSnapshotBody } from './f73-usage-routes.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-73 §9 — the tenant snapshot: the page a support person opens when a
 * dealership says "the bot is silent" or "our leads stopped arriving".
 *
 * What is worth proving here is mostly about what the page must NOT do:
 *
 *  - it must not become a second copy of the tenant record (every shared fact
 *    comes from `admin_get_tenant`, spread whole);
 *  - it must not put an intake credential on a screen;
 *  - it must not say "last seen" about a stamp that only moves on acceptance;
 *  - it must not answer a question the product cannot ask (no deploy version);
 *  - and its platform-wide facts must not read as facts about this tenant.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let superCookie = '';
let phoneSeq = 0;

/** Every send the suite makes — the snapshot must add none of them. */
let carrierCalls = 0;
const carrier: Carrier = {
  kind: 'log',
  deliversToRecipient: false,
  async send(m: OutboundSms) {
    carrierCalls += 1;
    return { kind: 'accepted' as const, providerRef: `SM-${randomUUID()}`, segments: countSegments(m.body).segments };
  },
  verifyInbound: () => true,
};

const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

interface Tenant { orgId: string; storeId: string; cookie: string; ownerId: string }

async function tenant(tag: string): Promise<Tenant> {
  const email = `f73s-${tag}-${run}@dealpilot.test`;
  const cookie = await signUp(email, `Patronne ${tag}`);
  const o = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: `Groupe ${tag}`, slug: `groupe-s-${tag}-${run}` },
  });
  expect(o.statusCode, o.body).toBe(201);
  const orgId = (JSON.parse(o.body) as { id: string }).id;
  return { orgId, storeId: await store(cookie, orgId, `${tag}1`), cookie, ownerId: await userId(email) };
}

async function store(cookie: string, orgId: string, code: string): Promise<string> {
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: `Point de vente ${code}`, code: code.toUpperCase().slice(0, 20), province: 'QC' },
  });
  expect(s.statusCode, s.body).toBe(201);
  return (JSON.parse(s.body) as { id: string }).id;
}

async function snapshotRes(orgId: string, cookie = superCookie) {
  return app!.inject({ method: 'GET', url: `/api/v1/admin/tenants/${orgId}/snapshot`, headers: { cookie } });
}

/**
 * PARSED, not cast.
 *
 * `AdminTenantSnapshot` (packages/schemas) is the 200 body the contract
 * publishes at v1.ts:1278, but the route builds its own hand-written
 * `AdminTenantSnapshotBody` and casts the definer's `jsonb` columns straight
 * into it. Casting here too would leave the published shape with no producer
 * check, no runtime check and no test check — three declarations of one shape
 * with nothing holding them together, so a key dropped from
 * `admin_tenant_snapshot`'s `jsonb_build_object` would ship green. Every case
 * in this suite goes through this helper, so every case now proves the wire
 * shape is the shape the contract advertises. (The usage card's helper has
 * parsed through `AdminTenantUsage` from the start; this is the same bar.)
 */
async function snapshot(orgId: string, cookie = superCookie): Promise<AdminTenantSnapshotT> {
  const res = await snapshotRes(orgId, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return AdminTenantSnapshot.parse(JSON.parse(res.body));
}

async function detail(orgId: string) {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/admin/tenants/${orgId}`, headers: { cookie: superCookie } });
  expect(res.statusCode, res.body).toBe(200);
  return AdminTenantDetail.parse(JSON.parse(res.body));
}

/** The generic_json intake scheme: HMAC-SHA256 of `${ts}.${rawBody}` (api-design §10). */
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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
      mailer: { deliversToRecipient: true, async send() { return true; } },
      carrier,
    },
  ));

  superCookie = await staffer(`f73s-super-${run}@dealpilot.test`, 'Super Admin', 'platform_super_admin', null);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the snapshot has exactly one producer for a tenant fact (§9)', () => {
  it('every field the tenant page already answers is the tenant page’s answer, byte for byte', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('same');
    await store(t.cookie, t.orgId, `same2${run.slice(-3)}`);

    const page = await detail(t.orgId);
    const body = await snapshot(t.orgId);
    for (const [key, value] of Object.entries(page)) {
      // A forked org query in the snapshot definer would drift from
      // admin_get_tenant the first time either changed, and nothing would say so.
      expect(body[key as keyof AdminTenantSnapshotT], `snapshot.${key} disagrees with the tenant page`).toEqual(value);
    }
  });

  it('the rooftop array is store_health and does not shadow the tenant page’s stores', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('shadow');
    const body = await snapshot(t.orgId);
    const page = await detail(t.orgId);

    expect(body.stores, 'the tenant page’s array survives untouched').toEqual(page.stores);
    expect(Array.isArray(body.store_health)).toBe(true);
    expect(body.store_health).toHaveLength(1);
    // Two arrays under one name with different members is how two screens start
    // disagreeing in public — so the members are deliberately different.
    expect(Object.keys(body.store_health[0]!).sort()).not.toEqual(Object.keys(page.stores[0]!).sort());
    expect(Object.keys(body.store_health[0]!)).toContain('traffic_30d');
  });

  it('a soft-deleted tenant still answers, with nothing left to drive; an unknown one is 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('gone');
    expect((await snapshot(t.orgId)).allowed_transitions.length).toBeGreaterThan(0);

    const deleted = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${t.orgId}`, headers: { cookie: t.cookie } });
    expect(deleted.statusCode, deleted.body).toBe(204);

    const after = await snapshot(t.orgId);
    // Support still has to be able to look at it — that is the whole point of
    // the page — but every write on it is a 404, so the console offers nothing.
    expect(after.deleted_at).not.toBeNull();
    expect(after.allowed_transitions).toEqual([]);
    expect(after.store_health).toHaveLength(1);

    expect((await snapshotRes(randomUUID())).statusCode).toBe(404);
  });
});

describe('what a support person actually needs to see (§9)', () => {
  it('store_health carries the dealership’s own number, says so when there is none, and calls no carrier', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('number');
    const silent = await store(t.cookie, t.orgId, `mute${run.slice(-3)}`);
    const number = `+1514555${String(4000 + (Date.now() % 900)).slice(0, 4)}`;
    const patched = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${t.storeId}`, headers: { cookie: t.cookie },
      payload: { sms_number: number },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const before = carrierCalls;
    const body = await snapshot(t.orgId);
    // Reading a snapshot must never touch the carrier: this page is opened
    // during an incident, and a page that sends is a page that makes it worse.
    expect(carrierCalls, 'the snapshot is a read').toBe(before);

    const withNumber = body.store_health.find((s) => s.id === t.storeId);
    const without = body.store_health.find((s) => s.id === silent);
    // The number itself, not a boolean: it is what a support person compares
    // against the carrier console when the dealership says nothing arrives.
    expect(withNumber!.sms_number).toBe(number);
    expect(without!.sms_number, 'a rooftop with no number says so, rather than reading as configured').toBeNull();
  });

  it('business hours read false for a rooftop the console cannot set them on', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('hours');
    const body = await snapshot(t.orgId);
    // `stores.business_hours` defaults to '{}' and the only web writer sends
    // '{}' too, so this is false for effectively every rooftop today. The field
    // is still the right one to show — it is what a person checks when asked
    // why the assistant is silent at 3am — and the console's caption is what
    // stops a structural false reading as a tenant misconfiguration.
    expect(body.store_health[0]!.business_hours_set).toBe(false);

    const set = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${t.storeId}`, headers: { cookie: t.cookie },
      payload: { business_hours: { mon: { open: '09:00', close: '18:00' } } },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await snapshot(t.orgId)).store_health[0]!.business_hours_set).toBe(true);
  });

  it('traffic is attributed to a rooftop through the conversation, because messages carry no store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('traffic');
    const quiet = await store(t.cookie, t.orgId, `quiet${run.slice(-3)}`);

    phoneSeq += 1;
    const phone = `+1514555${String(5000 + phoneSeq).slice(-4)}`;
    const consent = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie: t.cookie },
      payload: {
        organization_id: t.orgId, phone_e164: phone, channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual', evidence: { note: 'seeded for the snapshot suite' },
      },
    });
    expect(consent.statusCode, consent.body).toBe(201);
    const conversationId = await withTenant(appPool, t.orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
        [t.orgId, t.storeId, phone],
      );
      return r.rows[0]!.id;
    });
    const body = 'Bonjour! Votre véhicule est prêt pour un essai routier.';
    const outcome = await withTenant(appPool, t.orgId, async (c) =>
      sendMessage(c, {
        organizationId: t.orgId, storeId: t.storeId, conversationId, leadId: null,
        phoneE164: phone, body, senderType: 'bot', messageClass: 'inbound_reply',
        scope: 'conversational', isSolicitation: false, nowUtc: new Date(),
      }),
    );
    expect(outcome.kind, JSON.stringify(outcome)).toBe('sent');
    if (outcome.kind !== 'sent') return;
    await deliverMessage(appPool, carrier, env, {
      organizationId: t.orgId, messageId: outcome.messageId, to: phone, from: '+15145550000', body,
    });

    const snap = await snapshot(t.orgId);
    const busy = snap.store_health.find((s) => s.id === t.storeId)!;
    const idle = snap.store_health.find((s) => s.id === quiet)!;
    expect(busy.traffic_30d.outbound).toBe(1);
    expect(busy.traffic_30d.inbound).toBe(0);
    expect(busy.traffic_30d.last_message_at).not.toBeNull();
    // A rooftop with no thread is zeros and a null, never the tenant's totals.
    expect(idle.traffic_30d).toEqual({ inbound: 0, outbound: 0, delivered: 0, last_message_at: null });
  });

  it('comms_config answers for a tenant that has never set one, and then carries what the tenant set', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('comms');

    const before = (await snapshot(t.orgId)).comms_config;
    // The LEFT JOIN on `(VALUES (1))` is what makes this an ANSWER rather than
    // a missing row: a tenant that never opened the compliance screen has no
    // tenant_comms_config row, and the support page has to say so — "no row"
    // and "quiet hours off" are different facts during an incident.
    expect(before.org_row_present, 'no row yet, and the page says which').toBe(false);
    expect(before.sms_quiet_start).toBeNull();
    expect(before.sms_quiet_end).toBeNull();
    expect(before.first_touch_quiet_exempt).toBeNull();
    expect(before.ai_daily_contact_cap).toBeNull();

    const set = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${t.orgId}/comms-config`, headers: { cookie: t.cookie },
      payload: { sms_quiet_start: '10:00', sms_quiet_end: '20:00', first_touch_quiet_exempt: false, ai_daily_contact_cap: 2 },
    });
    expect(set.statusCode, set.body).toBe(200);

    const after = (await snapshot(t.orgId)).comms_config;
    expect(after.org_row_present).toBe(true);
    // The window the dealership actually operates under — the first thing a
    // support person checks when told "the bot went quiet at 8".
    expect(after.sms_quiet_start).toMatch(/^10:00/);
    expect(after.sms_quiet_end).toMatch(/^20:00/);
    expect(after.first_touch_quiet_exempt, 'this tenant turned the greeting exemption OFF').toBe(false);
    expect(after.ai_daily_contact_cap).toBe(2);
    // No route in the product writes a store-scoped tenant_comms_config row
    // (f15-compliance-routes.ts:305-352 is org-level only), so this is 0 for
    // every tenant today — asserted so that the day a store override becomes
    // writable, the number that is supposed to disclose it is known to move.
    expect(after.store_overrides).toBe(0);
  });

  it('branding tells "no brand", "edited but not live" and "published" apart', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('brand');

    const none = (await snapshot(t.orgId)).branding;
    // 'none' means no brand row exists at all; it is not a status the table
    // can hold, which is why COALESCE has to invent it.
    expect(none).toEqual({ state: 'none', version: null, published_at: null });

    const edited = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${t.orgId}/branding`, headers: { cookie: t.cookie },
      payload: { primary_color: '#0055aa', display_name: 'Groupe Brand' },
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const draft = (await snapshot(t.orgId)).branding;
    // 'draft' here means "has unpublished edits", NOT "nothing is live" — the
    // distinction the definer's own comment promises, and the one a support
    // person needs when a dealer says "we changed our logo and nothing moved".
    expect(draft.state).toBe('draft');
    expect(draft.version).not.toBeNull();
    expect(draft.published_at, 'edited is not published').toBeNull();

    const published = await app!.inject({
      method: 'POST', url: `/api/v1/organizations/${t.orgId}/branding/publish`, headers: { cookie: t.cookie },
    });
    expect(published.statusCode, published.body).toBe(200);

    const live = (await snapshot(t.orgId)).branding;
    expect(live.state).toBe('published');
    expect(live.version, 'publishing mints a new version').toBe(draft.version! + 1);
    expect(live.published_at).not.toBeNull();
  });

  it('connectors_active counts the live ones, and a deactivated connector stops counting', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('conn');
    expect((await snapshot(t.orgId)).connectors_active).toBe(0);

    const created = await app!.inject({
      method: 'POST', url: '/api/v1/connectors', headers: { cookie: t.cookie },
      payload: {
        organization_id: t.orgId, source_key: `portail_${run.slice(-6)}`, label: 'Portail auto',
        default_source: 'marketplace',
        field_map: { first_name: ['client.prenom'], phone: ['client.cellulaire'] },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const connectorId = (JSON.parse(created.body) as { id: string }).id;
    expect((await snapshot(t.orgId)).connectors_active, 'a registered connector is a live front door').toBe(1);

    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/connectors/${connectorId}`, headers: { cookie: t.cookie },
      payload: { is_active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    // The row survives — deactivation is the soft-off, and a support page that
    // kept counting it would say a dead provider is still delivering leads.
    expect((await snapshot(t.orgId)).connectors_active).toBe(0);
  });
});

describe('the intake keys, and the one thing they must never carry (§9)', () => {
  it('no key on the snapshot carries a token or a secret, in any field', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('keys');
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: t.cookie },
      payload: { organization_id: t.orgId, store_id: t.storeId, label: 'Formulaire du site', default_source: 'website' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const key = JSON.parse(created.body) as { id: string; token: string; secret: string };

    const res = await snapshotRes(t.orgId);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as AdminTenantSnapshotBody;
    expect(body.intake_keys).toHaveLength(1);
    expect(Object.keys(body.intake_keys[0]!).sort()).toEqual(
      ['active', 'id', 'label', 'last_lead_accepted_at', 'provider', 'revoked_at', 'store_id'],
    );
    // Not "no field NAMED token" — no field CARRYING the value. A projection
    // that renamed it would still put a live credential on a support screen.
    expect(res.body, 'the serialized snapshot must not contain the key’s token').not.toContain(key.token);
    expect(res.body, 'the serialized snapshot must not contain the key’s secret').not.toContain(key.secret);
  });

  it('a revoked key is distinguishable from a live one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('revoked');
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: t.cookie },
      payload: { organization_id: t.orgId, store_id: t.storeId, label: 'Clé retirée', default_source: 'website' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const keyId = (JSON.parse(created.body) as { id: string }).id;
    expect((await snapshot(t.orgId)).intake_keys[0]).toMatchObject({ active: true, revoked_at: null });

    const revoked = await app!.inject({ method: 'DELETE', url: `/api/v1/intake-keys/${keyId}`, headers: { cookie: t.cookie } });
    expect(revoked.statusCode, revoked.body).toBe(204);

    const after = (await snapshot(t.orgId)).intake_keys[0]!;
    // `revoked_at` rides beside `active` because the columns are independent in
    // the schema (0005:26, :30) and the org index is partial on `revoked_at`,
    // which is the schema's own evidence that revocation is the operative
    // state. The revoke ROUTE writes both, so today they agree — the field
    // exists so that a key revoked any other way cannot read as live.
    expect(after.revoked_at).not.toBeNull();
    expect(after.active).toBe(false);
  });

  it('last_lead_accepted_at moves when a lead is accepted, and only then', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('accepted');
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: t.cookie },
      payload: { organization_id: t.orgId, store_id: t.storeId, label: 'Fournisseur', default_source: 'website' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { token, secret } = JSON.parse(created.body) as { token: string; secret: string };
    expect((await snapshot(t.orgId)).intake_keys[0]!.last_lead_accepted_at).toBeNull();

    const post = async (body: string, signingKey: string) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      return app!.inject({
        method: 'POST', url: `/in/v1/leads/${token}`,
        headers: {
          'content-type': 'application/json',
          'x-intake-timestamp': ts,
          'x-intake-signature': sign(ts, body, signingKey),
        },
        payload: body,
      });
    };

    phoneSeq += 1;
    const payload = JSON.stringify({ phone: `+1514555${String(6000 + phoneSeq).slice(-4)}`, first_name: 'Intake' });
    const forged = await post(payload, 'not-the-secret');
    expect(forged.statusCode, forged.body).toBe(401);
    // "Last seen" would be a false claim: the stamp lives INSIDE the accepted-
    // lead transaction (f03-intake-routes.ts:542), so a bad signature, a
    // suspended tenant or a dedupe rejection all leave it exactly where it was.
    expect((await snapshot(t.orgId)).intake_keys[0]!.last_lead_accepted_at).toBeNull();

    const accepted = await post(payload, secret);
    expect(accepted.statusCode, accepted.body).toBe(202);
    expect((await snapshot(t.orgId)).intake_keys[0]!.last_lead_accepted_at).not.toBeNull();
  });
});

describe('what the snapshot deliberately does not say (§9)', () => {
  it('the three transports are one platform-wide object and carry no tenant fact', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('transport');
    const body = await snapshot(t.orgId);
    expect(Object.keys(body.platform).sort()).toEqual(['ai_transport', 'email_transport', 'sms_transport']);
    // Identical for every tenant: two loose `platform_`-prefixed fields beside
    // tenant state would read as a per-tenant switch that does not exist.
    const serialized = JSON.stringify(body.platform);
    expect(serialized).not.toContain(t.orgId);
    expect(serialized).not.toContain(body.slug);

    const other = await tenant('transport2');
    expect((await snapshot(other.orgId)).platform).toEqual(body.platform);
  });

  it('the snapshot carries no deploy version and no schema version', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('deploy');
    const res = await snapshotRes(t.orgId);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;

    // A SCHEMA version is global, it is created ad hoc by the migration runner
    // with no GRANT, and there is no deploy pipeline for it to describe — on a
    // TENANT card it would invite "this tenant is on…". Cut by name, and this
    // is what keeps it cut.
    expect(Object.keys(body).filter((k) => /deploy|migration|build|release/i.test(k))).toEqual([]);
    const latest = (await admin.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`,
    )).rows[0]!.filename;
    expect(res.body, 'a migration filename reached a tenant snapshot').not.toContain(latest);
    expect(res.body).not.toContain('schema_migrations');
  });
});
