import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { Deal, Vehicle, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-07 integration suite — inventory.
 * Journey: stock a car → see it in inventory → attach it to a deal → the deal
 * carries the vehicle. Negatives: duplicate stock number, bad VIN, cross-tenant
 * 404, another org's car cannot be attached, a committed car cannot be deleted.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const OWNER = { email: `f07-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };
const OUTSIDER = { email: `f07-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Olive Outsider' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieOwner = '';
let cookieOutsider = '';
let orgId = '';
let storeId = '';
let vehicleId = '';

const VehiclePage = paginated(Vehicle);

const CAR = {
  stock_number: 'K2601',
  vin: '5XYP34GC1NG123456',
  year: 2024,
  make: 'Kia',
  model: 'Sportage',
  trim: 'EX AWD',
  exterior_color: 'Gravity Grey',
  mileage_km: 18_500,
  acquisition_type: 'trade_in' as const,
  acquisition_cost_cents: 2_600_000,
  transport_cost_cents: 45_000,
  recon_cost_cents: 120_000,
  list_price_cents: 3_290_000,
};

async function signUp(u: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: u });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
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
  cookieOwner = await signUp(OWNER);
  cookieOutsider = await signUp(OUTSIDER);

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOwner },
    payload: { name: 'Groupe F07', slug: `groupe-f07-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, name: 'F07 Kia', code: 'F07-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-07 inventory', () => {
  it('stocks a car with its true cost built up from acquisition + transport + recon', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, organization_id: orgId, store_id: storeId },
    });
    expect(res.statusCode).toBe(201);
    const vehicle = Vehicle.parse(JSON.parse(res.body));
    expect(vehicle.stock_number).toBe('K2601');
    expect(vehicle.deal_status).toBe('available');
    expect(vehicle.location_status).toBe('on_lot');
    // $26,000 + $450 + $1,200 = $27,650 — what the car really cost on the lot.
    expect(vehicle.total_cost_cents).toBe(2_765_000);
    vehicleId = vehicle.id;
  });

  it('normalizes and validates the VIN (17 chars, no I/O/Q)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const bad = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, stock_number: 'K2602', vin: '5XYP34GC1NG12345I', organization_id: orgId, store_id: storeId },
    });
    expect(bad.statusCode).toBe(422);

    const lower = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, stock_number: 'K2603', vin: '5xyp34gc1ng654321', organization_id: orgId, store_id: storeId },
    });
    expect(lower.statusCode).toBe(201);
    expect(Vehicle.parse(JSON.parse(lower.body)).vin).toBe('5XYP34GC1NG654321');
  });

  it('a stock number cannot repeat in the same store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, vin: undefined, organization_id: orgId, store_id: storeId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('lists inventory and filters by availability', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const all = await app!.inject({
      method: 'GET', url: `/api/v1/vehicles?organization_id=${orgId}`, headers: { cookie: cookieOwner },
    });
    expect(all.statusCode).toBe(200);
    expect(VehiclePage.parse(JSON.parse(all.body)).items.length).toBeGreaterThanOrEqual(2);

    const available = await app!.inject({
      method: 'GET', url: `/api/v1/vehicles?organization_id=${orgId}&deal_status=available`,
      headers: { cookie: cookieOwner },
    });
    expect(VehiclePage.parse(JSON.parse(available.body)).items.map((v) => v.id)).toContain(vehicleId);
  });

  it('a non-member sees nothing: get 404, list 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const get = await app!.inject({ method: 'GET', url: `/api/v1/vehicles/${vehicleId}`, headers: { cookie: cookieOutsider } });
    expect(get.statusCode).toBe(404);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/vehicles?organization_id=${orgId}`, headers: { cookie: cookieOutsider },
    });
    expect(list.statusCode).toBe(404);
  });
});

describe('F-07 vehicle on a deal', () => {
  it('a deal can be desked against a real car', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
      payload: {
        organization_id: orgId, store_id: storeId, vehicle_id: vehicleId,
        province: 'QC', sale_price_cents: 3_290_000, vehicle_cost_cents: 2_765_000,
        interest_rate_bps: 599, term_months: 60,
      },
    });
    expect(res.statusCode).toBe(201);
    const deal = Deal.parse(JSON.parse(res.body));
    expect(deal.vehicle_id).toBe(vehicleId);
    // Gross from the car's REAL cost: $32,900 − $27,650 = $5,250.
    expect(deal.front_gross_cents).toBe(525_000);
  });

  it("another organization's car cannot be attached", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rivalOrg = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOutsider },
      payload: { name: 'Groupe Rival F07', slug: `groupe-rival-f07-${run}` },
    });
    const rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
    const rivalStore = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOutsider },
      payload: { organization_id: rivalOrgId, name: 'Rival', code: 'RIVAL-7', province: 'ON' },
    });
    const rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;

    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOutsider },
      payload: {
        organization_id: rivalOrgId, store_id: rivalStoreId, vehicle_id: vehicleId,
        province: 'ON', sale_price_cents: 3_000_000, interest_rate_bps: 0, term_months: 60,
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('a committed car cannot be removed from inventory', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const commit = await app!.inject({
      method: 'PATCH', url: `/api/v1/vehicles/${vehicleId}`, headers: { cookie: cookieOwner },
      payload: { deal_status: 'sold_pending' },
    });
    expect(commit.statusCode).toBe(200);

    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/vehicles/${vehicleId}`, headers: { cookie: cookieOwner } });
    expect(del.statusCode).toBe(409);
    expect(JSON.parse(del.body).error.details?.[0]?.code).toBe('vehicle_committed');
  });
});
