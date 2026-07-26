import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { DealDocumentsResponse } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-13 deal documents. The rules are golden-tested in packages/core; this suite
 * is about the database, the lifecycle, and the thing the whole slice exists
 * for — that "the signed file is ready" stops being an unverifiable claim.
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
let storeId = '';

async function makeDeal(extra: Record<string, unknown> = {}) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
      interest_rate_bps: 599, term_months: 60, ...extra,
    },
  });
  return (JSON.parse(res.body) as { id: string }).id;
}

async function documents(dealId: string) {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return DealDocumentsResponse.parse(JSON.parse(res.body));
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

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f13-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F13', slug: `groupe-f13-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F13 Kia', code: 'F13-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-13 deal documents', () => {
  it('a deal gets the file its own shape requires', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ deal_type: 'finance', trade_lien_cents: 500_000 });
    const { items, wet_ink_prepared } = await documents(dealId);

    const types = items.map((i) => i.document_type);
    expect(types).toContain('bill_of_sale');
    expect(types).toContain('bank_contract');            // financed
    expect(types).toContain('trade_in_lien_authorization'); // lien on the trade
    expect(types).not.toContain('omvic_disclosure');     // Quebec, not Ontario
    // Nothing is printed yet, so the file cannot travel.
    expect(wet_ink_prepared).toBe(false);
  });

  it('an Ontario deal carries the OMVIC disclosure', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ province: 'ON' });
    expect((await documents(dealId)).items.map((i) => i.document_type)).toContain('omvic_disclosure');
  });

  it('a document cannot skip its lifecycle', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie },
      payload: { status: 'signed' },
    });
    // A document nobody has generated cannot have been signed.
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('invalid_transition');
  });

  it('printing and filing stamp who did it and when', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    for (const status of ['generated', 'printed'] as const) {
      const res = await app!.inject({
        method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
      });
      expect(res.statusCode).toBe(200);
    }
    const after = (await documents(dealId)).items.find((i) => i.id === doc.id)!;
    expect(after.printed_at).not.toBeNull();
    expect(after.printed_by).not.toBeNull();
  });

  it('THE POINT: the wet-ink tick is refused while paperwork is outstanding', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    await documents(dealId); // materialize the file

    // Before F-13 this was a bare assertion, and F-11b's dispatch gate trusted
    // it to send a driver with an incomplete file.
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/wet_ink_file`, headers: { cookie },
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { error: { code: string; details: { message: string }[] } };
    expect(body.error.code).toBe('documents_outstanding');
    // And it names what is missing, rather than just refusing.
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(body.error.details.some((d) => d.message.includes('Bill of sale'))).toBe(true);
  });

  it('once every signature is in, the tick goes through', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const { items } = await documents(dealId);
    for (const doc of items) {
      const path = doc.requires_signature
        ? ['generated', 'printed', 'in_file', 'signed']
        : ['generated', 'in_file'];
      for (const status of path) {
        await app!.inject({
          method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
        });
      }
    }
    expect((await documents(dealId)).wet_ink_complete).toBe(true);

    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/wet_ink_file`, headers: { cookie },
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('an unsigned document only needs to be IN the file', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A used car brings a Carfax nobody signs. Requiring a signature on it
    // would block every used-car delivery forever.
    const vehicle = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, stock_number: `F13-${run}`,
        year: 2021, make: 'Kia', model: 'Forte', acquisition_type: 'trade_in', vehicle_type: 'used',
      },
    });
    const vehicleId = (JSON.parse(vehicle.body) as { id: string }).id;
    const dealId = await makeDeal({ vehicle_id: vehicleId });

    const { items } = await documents(dealId);
    const carfax = items.find((i) => i.document_type === 'carfax_report')!;
    expect(carfax.requires_signature).toBe(false);

    for (const doc of items) {
      const path = doc.requires_signature
        ? ['generated', 'printed', 'in_file', 'signed']
        : ['generated', 'in_file'];
      for (const status of path) {
        await app!.inject({
          method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
        });
      }
    }
    expect((await documents(dealId)).wet_ink_complete).toBe(true);
  });

  it('a deal with no document list is not blocked by it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Deals written before F-13 must not become undeliverable because a table
    // arrived after them.
    const dealId = await makeDeal();
    await admin.query(`DELETE FROM deal_documents WHERE deal_id = $1`, [dealId]);
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/wet_ink_file`, headers: { cookie },
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('a signature document cannot reach "filed" without being signed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The shortcut exists for the Carfax path. Allowing it here let a bank
    // contract count as complete with signed_at_delivery NULL — the record
    // would say a customer signed something nobody watched them sign.
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items.find((i) => i.requires_signature)!;
    for (const status of ['generated', 'printed', 'in_file'] as const) {
      const step = await app!.inject({
        method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
      });
      expect(step.statusCode).toBe(200);
    }
    const shortcut = await app!.inject({
      method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status: 'filed' },
    });
    expect(shortcut.statusCode).toBe(422);
    expect(JSON.parse(shortcut.body).error.code).toBe('invalid_transition');
  });

  it('re-sending the same status does not reassign who did it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The exact bug F-08 fixed and this reintroduced: an unchanged status still
    // stamped printed_by, with the activity event suppressed — so anyone could
    // quietly become the person who handled a legal document.
    const dealId = await makeDeal();
    const doc = (await documents(dealId)).items[0]!;
    for (const status of ['generated', 'printed'] as const) {
      await app!.inject({
        method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
      });
    }
    const first = (await documents(dealId)).items.find((i) => i.id === doc.id)!;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status: 'printed' },
    });
    const again = (await documents(dealId)).items.find((i) => i.id === doc.id)!;
    expect(again.printed_at).toBe(first.printed_at);
  });

  it('editing the deal re-derives which documents it needs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A QC cash deal edited into an Ontario financed one used to keep its
    // original four documents and report a complete file — with no bank
    // contract and no OMVIC disclosure in it.
    // Explicitly CASH: the default deal_type is finance, which would already
    // carry a bank contract and make this test prove nothing.
    const dealId = await makeDeal({ deal_type: 'cash' });
    expect((await documents(dealId)).items.map((i) => i.document_type)).not.toContain('bank_contract');

    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { deal_type: 'finance', province: 'ON' },
    });
    expect(res.statusCode).toBe(200);

    const after = (await documents(dealId)).items.map((i) => i.document_type);
    expect(after).toContain('bank_contract');
    expect(after).toContain('omvic_disclosure');
  });

  it('another organization sees none of these documents', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rival = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f13-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
    });
    const rc = rival.headers['set-cookie'];
    const rivalCookie = (Array.isArray(rc) ? rc : [rc!]).map((c) => c!.split(';')[0]).join('; ');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival Motors', slug: `rival-f13-${run}` },
    });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/documents?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    // 404, never 403: a cross-tenant id must not confirm it exists.
    expect(res.statusCode).toBe(404);
  });
});
