import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { TOOLS } from '@dealpilot/ai';
import { buildApp } from './app.js';
import { createToolRunner, type ToolContext } from './f33-tool-runner.js';
import { recordInbound } from './f19-send.js';

/**
 * What the assistant can actually do (§4).
 *
 * This is where a model's output becomes an action, so the cases that matter
 * are the ones where a model is WRONG or has been talked into something. The
 * schemas already refuse an organisation id by having no field for it; these
 * check the rest — that a booking cannot name a vehicle the conversation was
 * never shown, that consent cannot be recorded on the model's account of what
 * the customer said, and that a bad argument is an answer rather than a crash.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const NOW = new Date('2026-08-13T18:00:00Z');

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let rivalOrgId = '';
let rivalStock = '';

let seq = 800;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

async function fixture() {
  const phone = nextPhone();
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, phone,
      first_name: 'Marie', source: 'website', preferred_language: 'fr-CA',
    },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  const leadId = (JSON.parse(lead.body) as { id: string }).id;

  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [orgId, storeId, leadId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, leadId, conversationId };
}

function ctx(f: { phone: string; leadId: string; conversationId: string }): ToolContext {
  return {
    organizationId: orgId,
    storeId,
    conversationId: f.conversationId,
    leadId: f.leadId,
    phoneE164: f.phone,
    language: 'fr',
    nowUtc: NOW,
  };
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f33-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie Tremblay' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F33', slug: `groupe-f33-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F33-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  for (const [stock, model] of [[`ST-${run}-1`, 'Sorento'], [`ST-${run}-2`, 'Sportage']] as const) {
    const v = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, stock_number: stock,
        vin: `1HGCM82633A0${String(seq++).padStart(5, '0')}`,
        year: 2024, make: 'Kia', model, vehicle_type: 'used',
        acquisition_type: 'trade_in', mileage_km: 30_000,
      },
    });
    expect(v.statusCode, v.body).toBe(201);
  }

  // A rival dealership with its own stock, for the isolation case.
  const rival = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Rival F33', slug: `rival-f33-${run}` },
  });
  rivalOrgId = (JSON.parse(rival.body) as { id: string }).id;
  const rivalStore = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: rivalOrgId, name: 'Rival lot', code: `R33-${run.slice(-4)}`, province: 'QC' },
  });
  const rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;
  rivalStock = `RIVAL-${run}`;
  await app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
    payload: {
      organization_id: rivalOrgId, store_id: rivalStoreId, stock_number: rivalStock,
      vin: `1HGCM82633A0${String(seq++).padStart(5, '0')}`,
      year: 2024, make: 'Kia', model: 'Telluride', vehicle_type: 'used',
      acquisition_type: 'trade_in', mileage_km: 10_000,
    },
  });
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('every tool in the catalogue', () => {
  it('has an implementation that answers', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    // A tool the model is offered and the server cannot run is a promise the
    // assistant makes on the dealership's behalf and cannot keep.
    await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      for (const tool of TOOLS) {
        const result = await runner.run(tool.name, {});
        expect(result, tool.name).toBeDefined();
        expect(typeof result['ok'], tool.name).toBe('boolean');
      }
    });
  });

  it('answers a bad argument instead of throwing', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      // Throwing would fail the whole turn and leave the customer with silence.
      const r = await runner.run('book_appointment', { type: 'teleportation' });
      expect(r).toMatchObject({ ok: false });
    });
  });
});

describe('lookup_inventory', () => {
  it('returns this store’s vehicles and no prices', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      const r = await runner.run('lookup_inventory', { vehicle_type: 'used', limit: 3 });
      expect(r['ok']).toBe(true);
      const vehicles = r['vehicles'] as Record<string, unknown>[];
      expect(vehicles.length).toBeGreaterThan(0);
      // §10 guardrail 1 is data starvation: a model cannot leak a number it
      // was never shown, so no price field exists in the result at all.
      for (const v of vehicles) {
        expect(Object.keys(v)).not.toContain('list_price_cents');
        expect(Object.keys(v)).not.toContain('acquisition_cost_cents');
      }
    });
  });

  it('cannot see another dealership’s stock', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      const r = await runner.run('lookup_inventory', { vehicle_type: 'used', limit: 3 });
      const stock = (r['vehicles'] as { stock_number: string }[]).map((v) => v.stock_number);
      expect(stock).not.toContain(rivalStock);
    });
  });
});

describe('book_appointment', () => {
  it('books a real appointment', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    const r = await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      return runner.run('book_appointment', {
        type: 'test_drive',
        start_time: '2026-08-15T14:00:00.000Z',
        end_time: '2026-08-15T15:00:00.000Z',
      });
    });
    expect(r['ok']).toBe(true);

    const rows = await admin.query<{ kind: string; booked_by: string }>(
      `SELECT kind, booked_by FROM appointments WHERE conversation_id = $1`, [f.conversationId],
    );
    // Before this slice the model could say "I have booked you in for Saturday"
    // and be describing something that existed nowhere.
    expect(rows.rows[0]).toMatchObject({ kind: 'test_drive', booked_by: 'assistant' });
  });

  it('refuses a vehicle this conversation was never shown', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    const r = await withTenant(appPool, orgId, async (c) => {
      const runner = createToolRunner(c, ctx(f));
      // No lookup_inventory call first, so nothing has been shown. The
      // outbound guard refuses an invented stock number in TEXT; this is the
      // same rule applied to an ACTION.
      return runner.run('book_appointment', {
        type: 'test_drive',
        start_time: '2026-08-15T14:00:00.000Z',
        end_time: '2026-08-15T15:00:00.000Z',
        vehicle_stock_number: rivalStock,
      });
    });
    expect(r).toMatchObject({ ok: false });
    const rows = await admin.query(
      `SELECT 1 FROM appointments WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('refuses a time in the past', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    const r = await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('book_appointment', {
        type: 'showroom_visit',
        start_time: '2026-08-01T14:00:00.000Z',
        end_time: '2026-08-01T15:00:00.000Z',
      }),
    );
    // A model that has lost track of the date will happily book last Tuesday.
    expect(r).toMatchObject({ ok: false });
  });
});

describe('record_consent', () => {
  it('refuses when the customer did not actually say yes', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId: f.conversationId,
        body: 'Je vais y penser', providerRef: `SM-${run}-think`,
      }),
    );

    const r = await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('record_consent', {
        scope: 'ai_outbound_call',
        // The model insists. It does not matter what it claims.
        consent_text_verbatim: 'Oui, appelez-moi quand vous voulez',
      }),
    );
    expect(r).toMatchObject({ ok: false });

    const consents = await admin.query(
      `SELECT 1 FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND scope = 'ai_outbound_call'`,
      [orgId, f.phone],
    );
    // This is the one that would cost $10M: express consent for an automated
    // call, recorded because a model said so.
    expect(consents.rows).toHaveLength(0);
  });

  it('records it when they did, using their words and not the model’s', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId: f.conversationId,
        body: 'OUI', providerRef: `SM-${run}-oui`,
      }),
    );

    const r = await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('record_consent', {
        scope: 'ai_outbound_call',
        consent_text_verbatim: 'something the model made up',
      }),
    );
    expect(r['ok']).toBe(true);

    const row = await admin.query<{ evidence: Record<string, unknown> }>(
      `SELECT evidence FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND scope = 'ai_outbound_call'`,
      [orgId, f.phone],
    );
    // The evidence is what the CUSTOMER sent, re-read from the database.
    expect(row.rows[0]!.evidence['reply_verbatim']).toBe('OUI');
  });
});

describe('another dealership', () => {
  it('sees none of these appointments', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('book_appointment', {
        type: 'showroom_visit',
        start_time: '2026-08-16T14:00:00.000Z',
        end_time: '2026-08-16T15:00:00.000Z',
      }),
    );

    const seen = await withTenant(appPool, rivalOrgId, async (c) => {
      const r = await c.query(
        `SELECT id FROM appointments WHERE conversation_id = $1`, [f.conversationId],
      );
      return r.rows.length;
    });
    // An appointment names a customer, a time and a place they will be. It is
    // one of the more useful things for a rival to read.
    expect(seen).toBe(0);
  });

  it('cannot write an appointment into this organisation', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    await expect(
      withTenant(appPool, rivalOrgId, (c) =>
        c.query(
          `INSERT INTO appointments (organization_id, store_id, conversation_id, kind, starts_at, ends_at)
           VALUES ($1,$2,$3,'test_drive', now() + interval '1 day', now() + interval '25 hours')`,
          [orgId, storeId, f.conversationId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('create_or_update_lead', () => {
  it('writes the fields the schema allows', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    const r = await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('create_or_update_lead', {
        fields: { last_name: 'Tremblay', vehicle_interest: 'Sorento 2024' },
      }),
    );
    expect(r['ok']).toBe(true);

    const lead = await admin.query<{ last_name: string; vehicle_interest: string }>(
      `SELECT last_name, vehicle_interest FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(lead.rows[0]).toMatchObject({ last_name: 'Tremblay', vehicle_interest: 'Sorento 2024' });
  });

  it('has no way to assign the lead or change its status', async (ctx_) => {
    if (!dbUp) return ctx_.skip();
    const f = await fixture();
    const before = await admin.query<{ status: string; assigned_to: string | null }>(
      `SELECT status, assigned_to FROM leads WHERE id = $1`, [f.leadId],
    );

    const r = await withTenant(appPool, orgId, async (c) =>
      createToolRunner(c, ctx(f)).run('create_or_update_lead', {
        fields: { last_name: 'Tremblay', status: 'won', assigned_to: f.leadId },
      }),
    );
    // strictObject: the schema rejects the whole call rather than silently
    // dropping the fields, so a model probing for them learns nothing works.
    expect(r).toMatchObject({ ok: false });

    const after = await admin.query<{ status: string; assigned_to: string | null }>(
      `SELECT status, assigned_to FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
