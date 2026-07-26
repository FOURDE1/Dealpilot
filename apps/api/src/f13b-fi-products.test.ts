import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { DealDocumentsResponse } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-13b itemised F&I — the path that makes three document types reachable.
 *
 * The reachability guard proves the RULE can produce them. This proves a
 * dealership can actually get there: sell a warranty through the API, and the
 * warranty agreement is in the deal's file, named after the product, without
 * anyone remembering to ask for it.
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
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function addProduct(dealId: string, payload: Record<string, unknown>) {
  return app!.inject({
    method: 'POST', url: `/api/v1/deals/${dealId}/fi-products`, headers: { cookie }, payload,
  });
}

async function documents(dealId: string) {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return DealDocumentsResponse.parse(JSON.parse(res.body));
}

async function dealRow(dealId: string) {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}`, headers: { cookie } });
  return JSON.parse(res.body) as { fi_price_cents: number; fi_cost_cents: number };
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
    payload: { email: `f13b-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F13b', slug: `groupe-f13b-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F13b Kia', code: 'F13B-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('selling an F&I product puts its agreement in the file', () => {
  it('a warranty produces a warranty agreement named after the product', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    // Before: the deal's file cannot contain a warranty agreement at all.
    expect((await documents(dealId)).items.map((d) => d.document_type)).not.toContain('warranty_agreement');

    const res = await addProduct(dealId, {
      kind: 'warranty', name: 'Safe-Guard 5yr / 100 000 km', provider: 'Safe-Guard',
      price_cents: 250_000, cost_cents: 150_000, term_months: 60,
    });
    expect(res.statusCode, res.body).toBe(201);

    const doc = (await documents(dealId)).items.find((d) => d.document_type === 'warranty_agreement');
    expect(doc, 'the warranty agreement is missing from the file').toBeDefined();
    // Named after the product: a clerk holding the folder has to know WHICH
    // warranty this page is, not just that a warranty exists.
    expect(doc!.document_name).toContain('Safe-Guard 5yr');
    expect(doc!.requires_signature).toBe(true);
  });

  it('GAP and aftermarket too — all three formerly unreachable types', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    await addProduct(dealId, { kind: 'gap', name: 'GAP Plus', price_cents: 90_000, cost_cents: 40_000 });
    await addProduct(dealId, { kind: 'aftermarket', name: 'Rustproofing', price_cents: 60_000, cost_cents: 20_000 });

    const types = (await documents(dealId)).items.map((d) => d.document_type);
    expect(types).toContain('gap_agreement');
    expect(types).toContain('aftermarket_agreement');
  });

  it('two aftermarket products get two agreements a clerk can tell apart', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    await addProduct(dealId, { kind: 'aftermarket', name: 'Rustproofing', price_cents: 60_000 });
    await addProduct(dealId, { kind: 'aftermarket', name: 'Paint protection', price_cents: 70_000 });

    const names = (await documents(dealId)).items
      .filter((d) => d.document_type === 'aftermarket_agreement')
      .map((d) => d.document_name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('reading the file twice does not duplicate the aftermarket agreements', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The file is regenerated on every read, and `aftermarket_agreement` is
    // excluded from the one-per-type index — so without a name-keyed unique
    // index, every page load added another copy of every aftermarket
    // agreement. A customer's file would grow each time someone opened it.
    const dealId = await makeDeal();
    await addProduct(dealId, { kind: 'aftermarket', name: 'Rustproofing', price_cents: 60_000 });
    await documents(dealId);
    await documents(dealId);
    const after = await documents(dealId);
    expect(after.items.filter((d) => d.document_type === 'aftermarket_agreement')).toHaveLength(1);
  });

  it('removing one of two aftermarket products removes only that agreement', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const rust = JSON.parse((await addProduct(dealId, {
      kind: 'aftermarket', name: 'Rustproofing', price_cents: 60_000,
    })).body) as { id: string };
    await addProduct(dealId, { kind: 'aftermarket', name: 'Paint protection', price_cents: 70_000 });

    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/fi-products/${rust.id}`, headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    // Cleanup used to compare document TYPES, so removing one of two left the
    // other product's agreement and an orphan for the product nobody sold.
    const names = (await documents(dealId)).items
      .filter((d) => d.document_type === 'aftermarket_agreement')
      .map((d) => d.document_name);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Paint protection');
  });

  it('an agreement already printed survives its product being removed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const p = JSON.parse((await addProduct(dealId, {
      kind: 'warranty', name: 'Safe-Guard 5yr', price_cents: 250_000,
    })).body) as { id: string };
    const doc = (await documents(dealId)).items.find((d) => d.document_type === 'warranty_agreement')!;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie },
      payload: { status: 'generated' },
    });
    await app!.inject({
      method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie },
      payload: { status: 'printed' },
    });

    await app!.inject({ method: 'DELETE', url: `/api/v1/fi-products/${p.id}`, headers: { cookie } });

    // Once the paper physically exists it is part of the record. Vanishing it
    // because a line item was deleted would erase evidence of what was printed.
    const still = (await documents(dealId)).items.find((d) => d.document_type === 'warranty_agreement');
    expect(still, 'a printed agreement was deleted with its product').toBeDefined();
    expect(still!.status).toBe('printed');
  });
});

describe("the deal's F&I total is the sum of its products", () => {
  it('adding, editing and removing products all move the aggregate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const w = JSON.parse((await addProduct(dealId, {
      kind: 'warranty', name: 'Warranty', price_cents: 250_000, cost_cents: 150_000,
    })).body) as { id: string };
    await addProduct(dealId, { kind: 'gap', name: 'GAP', price_cents: 90_000, cost_cents: 40_000 });

    expect(await dealRow(dealId)).toMatchObject({ fi_price_cents: 340_000, fi_cost_cents: 190_000 });

    await app!.inject({
      method: 'PATCH', url: `/api/v1/fi-products/${w.id}`, headers: { cookie },
      payload: { price_cents: 300_000 },
    });
    expect((await dealRow(dealId)).fi_price_cents).toBe(390_000);

    await app!.inject({ method: 'DELETE', url: `/api/v1/fi-products/${w.id}`, headers: { cookie } });
    expect(await dealRow(dealId)).toMatchObject({ fi_price_cents: 90_000, fi_cost_cents: 40_000 });
  });

  it('replacing a hand-entered aggregate is recorded, not silent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Someone typed 250 000 into the F&I box before products existed. Adding
    // the first product replaces that number — defensible, but it is money
    // moving without them asking, so it has to be in the trail.
    const dealId = await makeDeal({ fi_price_cents: 250_000, fi_cost_cents: 100_000 });
    await addProduct(dealId, { kind: 'gap', name: 'GAP', price_cents: 90_000, cost_cents: 40_000 });
    expect((await dealRow(dealId)).fi_price_cents).toBe(90_000);

    const trail = await app!.inject({
      // No entity_type filter: a deal's timeline includes what happened UNDER
      // it (CR-04), and this event's own entity is the product.
      method: 'GET', url: `/api/v1/activity?entity_id=${dealId}`, headers: { cookie },
    });
    const events = (JSON.parse(trail.body) as { items: { changes: Record<string, unknown> }[] }).items;
    const moved = events.find((e) => 'fi_price_cents' in (e.changes ?? {}));
    expect(moved, 'the F&I total changed with nothing in the activity trail').toBeDefined();
    expect(moved!.changes['fi_price_cents']).toMatchObject({ from: 250_000, to: 90_000 });
  });
});

describe('what the API refuses', () => {
  it('a second warranty on the same deal — it would leave a product unpapered', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    expect((await addProduct(dealId, { kind: 'warranty', name: 'First', price_cents: 100_000 })).statusCode).toBe(201);
    const second = await addProduct(dealId, { kind: 'warranty', name: 'Second', price_cents: 100_000 });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body)).toMatchObject({ error: { code: 'product_exists' } });
  });

  it('cost above price, on the way in AND on the way through', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const bad = await addProduct(dealId, { kind: 'gap', name: 'GAP', price_cents: 50_000, cost_cents: 90_000 });
    expect(bad.statusCode).toBe(422);

    const ok = JSON.parse((await addProduct(dealId, {
      kind: 'gap', name: 'GAP', price_cents: 90_000, cost_cents: 40_000,
    })).body) as { id: string };
    // Dropping the price under an untouched cost is the same loss by a
    // different route; a create-only check would have let it through.
    const patched = await app!.inject({
      method: 'PATCH', url: `/api/v1/fi-products/${ok.id}`, headers: { cookie },
      payload: { price_cents: 10_000 },
    });
    expect(patched.statusCode, patched.body).toBe(422);
  });

  it('an empty PATCH, rather than answering 200 to a change that never happened', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const p = JSON.parse((await addProduct(dealId, {
      kind: 'gap', name: 'GAP', price_cents: 90_000,
    })).body) as { id: string };
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/fi-products/${p.id}`, headers: { cookie }, payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it("another organisation's product is a 404, not a 403", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal();
    const p = JSON.parse((await addProduct(dealId, {
      kind: 'gap', name: 'GAP', price_cents: 90_000,
    })).body) as { id: string };

    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f13b-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob Outsider' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');

    for (const [method, url] of [
      ['PATCH', `/api/v1/fi-products/${p.id}`],
      ['DELETE', `/api/v1/fi-products/${p.id}`],
      ['GET', `/api/v1/deals/${dealId}/fi-products`],
    ] as const) {
      const res = await app!.inject({
        method, url, headers: { cookie: outCookie },
        ...(method === 'PATCH' ? { payload: { price_cents: 1 } } : {}),
      });
      // 404 everywhere: a 403 would confirm the id exists (ADR-021).
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
