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

  it('a 409 names the field that clashed — stock number vs VIN (CR-02)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dupStock = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, vin: undefined, organization_id: orgId, store_id: storeId },
    });
    expect(dupStock.statusCode).toBe(409);
    expect(JSON.parse(dupStock.body).error.details?.[0]?.path).toBe('stock_number');

    const dupVin = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: { ...CAR, stock_number: 'K2699', organization_id: orgId, store_id: storeId },
    });
    expect(dupVin.statusCode).toBe(409);
    expect(JSON.parse(dupVin.body).error.details?.[0]?.path).toBe('vin');
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


describe('FR-TEN-006 — the cost build-up belongs to the store that paid it', () => {
  const persona = async (email: string, roles: string[], memberStore: string | null) => {
    const su = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email, password: 'correct-horse-battery-staple', name: 'Perso Na' },
    });
    const sc = su.headers['set-cookie'];
    const cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: {
        organization_id: orgId, email, name: 'Perso Na', roles,
        ...(memberStore === null ? {} : { store_id: memberStore }),
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    return cookie;
  };

  const listCosts = async (cookie: string) => {
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/vehicles?organization_id=${orgId}`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { items: Array<Record<string, unknown>> }).items;
  };

  it('a salesperson sees the CAR everywhere and the COST nowhere — absent, not zero', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cookie = await persona(`f07-sales-${run}@dealpilot.test`, ['salesperson'], null);
    const items = await listCosts(cookie);
    expect(items.length).toBeGreaterThan(0);
    for (const v of items) {
      expect(v['make']).toBeDefined(); // the unit itself is visible
      expect('acquisition_cost_cents' in v).toBe(false);
      expect('total_cost_cents' in v).toBe(false);
      expect('list_price_cents' in v).toBe(false);
    }
  });

  it("a SECOND store's GM sees cost only on their own store's units", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const storeB = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, name: 'F07 Deux', code: `F07B-${run.slice(-4)}`, province: 'QC' },
    });
    const storeBId = (JSON.parse(storeB.body) as { id: string }).id;
    const carB = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: {
        ...CAR, vin: `2HGBH41JXMN10${String(9100 + (Date.now() % 100))}`, stock_number: `STK-B-${run.slice(-5)}`,
        organization_id: orgId, store_id: storeBId, acquisition_cost_cents: 777700,
      },
    });
    expect(carB.statusCode, carB.body).toBe(201);

    const cookie = await persona(`f07-gmb-${run}@dealpilot.test`, ['gm'], storeBId);
    const items = await listCosts(cookie);
    const theirs = items.find((v) => v['store_id'] === storeBId)!;
    const foreign = items.find((v) => v['store_id'] === storeId)!;
    expect(theirs['acquisition_cost_cents']).toBe(777700);
    expect(theirs['total_cost_cents']).toBeDefined();
    expect('acquisition_cost_cents' in foreign).toBe(false);
    expect('total_cost_cents' in foreign).toBe(false);

    // The single-vehicle read masks by the SAME rule.
    const one = await app!.inject({
      method: 'GET', url: `/api/v1/vehicles/${String(foreign['id'])}`, headers: { cookie },
    });
    expect('total_cost_cents' in (JSON.parse(one.body) as Record<string, unknown>)).toBe(false);
  });

  it('the owner sees every number in every store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const items = await listCosts(cookieOwner);
    for (const v of items) expect(v['total_cost_cents']).toBeDefined();
  });

  // Review rider R3 (D-084): the cost view obeys the SAME precedence as
  // has_permission (0067:185-209) — a per-user override written through
  // PUT /api/v1/permissions/user (A-13) wins over the role. Red at tip:
  // costViewOf read role_permissions only, so a DENY was invisible and an
  // ALLOW was dead vocabulary for costs.
  const userIdOf = async (cookie: string) => {
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode, me.body).toBe(200);
    return (JSON.parse(me.body) as { user: { id: string } }).user.id;
  };
  const override = async (userId: string, allowed: boolean | null) => {
    const res = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, user_id: userId, permission: 'vehicle:read_costs', allowed, ...(allowed === null ? {} : { reason: 'Revue du contrôleur' }) },
    });
    expect(res.statusCode, res.body).toBe(204);
  };

  it('R3 (rider, red at tip): a per-user DENY of vehicle:read_costs masks a GM whose role grants it — list and single read alike', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cookie = await persona(`f07-gm-deny-${run}@dealpilot.test`, ['gm'], storeId);
    const userId = await userIdOf(cookie);
    const mine = (await listCosts(cookie)).find((v) => v['store_id'] === storeId)!;
    expect(mine['total_cost_cents']).toBeDefined(); // the role grants it
    await override(userId, false);
    for (const v of await listCosts(cookie)) {
      expect('acquisition_cost_cents' in v).toBe(false);
      expect('total_cost_cents' in v).toBe(false);
    }
    const one = await app!.inject({ method: 'GET', url: `/api/v1/vehicles/${vehicleId}`, headers: { cookie } });
    expect(one.statusCode, one.body).toBe(200);
    expect('total_cost_cents' in (JSON.parse(one.body) as Record<string, unknown>)).toBe(false);
  });

  it('R3b (rider, red at tip): a per-user ALLOW unmasks a store-scoped salesperson for THEIR store only; clearing it restores the role default', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cookie = await persona(`f07-sales-allow-${run}@dealpilot.test`, ['salesperson'], storeId);
    const userId = await userIdOf(cookie);
    for (const v of await listCosts(cookie)) expect('total_cost_cents' in v).toBe(false);
    await override(userId, true);
    const items = await listCosts(cookie);
    const own = items.filter((v) => v['store_id'] === storeId);
    expect(own.length).toBeGreaterThan(0);
    for (const v of own) expect(v['total_cost_cents']).toBeDefined();
    for (const v of items.filter((x) => x['store_id'] !== storeId)) expect('total_cost_cents' in v).toBe(false);
    await override(userId, null);
    for (const v of await listCosts(cookie)) expect('total_cost_cents' in v).toBe(false);
  });
});

describe('F-82 rider — the acquisition_date trail (D-082 (3)\'s class, D-084)', () => {
  const eventsOf = async (entityId: string) => {
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&entity_id=${entityId}&limit=100`,
      headers: { cookie: cookieOwner },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { items: { action: string; changes: Record<string, unknown> }[] }).items;
  };

  it('R1: a PATCH of acquisition_date lands on the trail as YYYY-MM-DD on BOTH sides (red at tip: `from` was a UTC instant)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: {
        ...CAR, vin: undefined, stock_number: `R1-${run.slice(-6)}`,
        organization_id: orgId, store_id: storeId, acquisition_date: '2026-07-01',
      },
    });
    expect(car.statusCode, car.body).toBe(201);
    const id = (JSON.parse(car.body) as { id: string }).id;
    const moved = await app!.inject({
      method: 'PATCH', url: `/api/v1/vehicles/${id}`, headers: { cookie: cookieOwner },
      payload: { acquisition_date: '2026-07-15' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((JSON.parse(moved.body) as { acquisition_date: string }).acquisition_date).toBe('2026-07-15');
    const updated = (await eventsOf(id)).filter((e) => e.action === 'updated');
    expect(updated).toHaveLength(1);
    // The prior row is locked THROUGH the read model, so the diff sees a
    // calendar day on both sides — never a pg Date serialized as an instant.
    expect(updated[0]!.changes).toEqual({ acquisition_date: { from: '2026-07-01', to: '2026-07-15' } });
  });

  it('R2 (regression pin, green at tip): a same-date PATCH writes no event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieOwner },
      payload: {
        ...CAR, vin: undefined, stock_number: `R2-${run.slice(-6)}`,
        organization_id: orgId, store_id: storeId, acquisition_date: '2026-07-01',
      },
    });
    expect(car.statusCode, car.body).toBe(201);
    const id = (JSON.parse(car.body) as { id: string }).id;
    const same = await app!.inject({
      method: 'PATCH', url: `/api/v1/vehicles/${id}`, headers: { cookie: cookieOwner },
      payload: { acquisition_date: '2026-07-01' },
    });
    expect(same.statusCode, same.body).toBe(200);
    // activity.ts' same() compares a Date against 'YYYY-MM-DD' by calendar
    // day; the rider must never regress that rule into a phantom event.
    expect((await eventsOf(id)).filter((e) => e.action === 'updated')).toEqual([]);
  });
});
