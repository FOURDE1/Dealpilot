import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { CreateDealInput, CreateLeadInput, CreateVehicleInput } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * "Accepted but never stored" guard (CR-12, Hussein).
 *
 * `sold_as_is` was added to CreateDealInput and to the migration, and left out
 * of the INSERT's column list — so the API took the value, answered 201, and
 * threw it away. The as-is waiver could therefore never be derived, and the
 * worksheet could not show the box ticked because the read model omitted it
 * too. Nothing failed. Nothing warned.
 *
 * This is the shape of that bug, not the instance: a create schema field with
 * no path to the database. It compares what each Create input ACCEPTS against
 * what comes back from the API, so the next field added to a schema and
 * forgotten in a column list fails here instead of in someone's dealership.
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
let userId = '';
let leadId = '';
let vehicleId = '';
let contactId = '';
let lenderId = '';

/** Fields whose stored form legitimately differs from what was sent. */
const NOT_ECHOED: Record<string, readonly string[]> = {
  deals: ['organization_id', 'store_id'],
  leads: ['organization_id', 'store_id'],
  vehicles: ['organization_id', 'store_id'],
};

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
    payload: { email: `persist-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Persist', slug: `groupe-persist-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Persist Kia', code: 'PST-1', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  userId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: '+15145550101', source: 'walk_in' },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;
  const vehicle = await app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, stock_number: `SEED-${run}`,
      year: 2020, make: 'Kia', model: 'Rio', acquisition_type: 'auction',
    },
  });
  vehicleId = (JSON.parse(vehicle.body) as { id: string }).id;
  const contact = await app!.inject({
    method: 'POST', url: '/api/v1/contacts', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId,
      first_name: 'Persisted', last_name: 'Buyer', phone: '+15145550102',
    },
  });
  contactId = (JSON.parse(contact.body) as { contact: { id: string } }).contact.id;
  // F-80: resolved through the PRODUCT surface (never admin SQL), which
  // doubles as a live proof the birth seed ran — a fresh org must already
  // hold 'TD Auto Finance'.
  const lenders = await app!.inject({
    method: 'GET', url: `/api/v1/lenders?organization_id=${orgId}`, headers: { cookie },
  });
  lenderId = (JSON.parse(lenders.body) as { items: { id: string; name: string }[] })
    .items.find((l) => l.name === 'TD Auto Finance')!.id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

/** Everything the create schema will accept, so nothing is quietly dropped. */
function keysOf(schema: { _def?: unknown; shape?: Record<string, unknown> }): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape
    ?? ((schema as { _def?: { shape?: () => Record<string, unknown> } })._def?.shape?.() ?? {});
  return Object.keys(shape);
}

async function check(
  label: keyof typeof NOT_ECHOED,
  url: string,
  schema: Parameters<typeof keysOf>[0],
  payload: Record<string, unknown>,
) {
  const res = await app!.inject({ method: 'POST', url, headers: { cookie }, payload });
  expect(res.statusCode, `${label} create failed: ${res.body.slice(0, 200)}`).toBe(201);
  const row = JSON.parse(res.body) as Record<string, unknown>;

  const sent = Object.keys(payload).filter((k) => !NOT_ECHOED[label]!.includes(k));
  const missing = sent.filter((k) => !(k in row));
  expect(
    missing,
    `${label}: the API accepted these and did not return them — check the INSERT column list AND the read schema: ${missing.join(', ')}`,
  ).toEqual([]);

  const dropped = sent.filter((k) => k in row && String(row[k]) !== String(payload[k]));
  expect(
    dropped,
    `${label}: accepted but stored something else — ${dropped.map((k) => `${k}: sent ${String(payload[k])}, got ${String(row[k])}`).join('; ')}`,
  ).toEqual([]);

  // Every declared create field should be exercised here; an unexercised one is
  // exactly where the next silent drop hides.
  const declared = keysOf(schema).filter((k) => !NOT_ECHOED[label]!.includes(k));
  const untested = declared.filter((k) => !(k in payload));
  expect(untested, `${label}: create fields this guard never sends: ${untested.join(', ')}`).toEqual([]);
}

describe('what the API accepts, it stores', () => {
  it('deals — including sold_as_is, which it used to swallow (CR-12)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await check('deals', '/api/v1/deals', CreateDealInput, {
      organization_id: orgId, store_id: storeId,
      province: 'ON', deal_type: 'lease',
      sale_price_cents: 3_500_000, msrp_cents: 3_800_000, vehicle_cost_cents: 3_000_000,
      cash_down_cents: 200_000, trade_allowance_cents: 500_000, trade_acv_cents: 450_000,
      trade_lien_cents: 100_000, rebate_cents: 50_000, fees_cents: 49_900, fees_taxable: false,
      fi_price_cents: 250_000, fi_cost_cents: 150_000, interest_rate_bps: 599,
      term_months: 48, residual_percent: 55, tax_exempt: false,
      fi_reserve_cents: 50_000, sold_as_is: true,
      lead_id: leadId, vehicle_id: vehicleId, salesperson_id: userId,
      // F-80: the funding lender, seeded at birth (see beforeAll).
      lender_id: lenderId,
      // F-36: an explicit buyer. The deal echoes it because deals.contact_id is
      // trigger-maintained from the deal_parties row this creates.
      contact_id: contactId,
    });
  });

  it('leads', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await check('leads', '/api/v1/leads', CreateLeadInput, {
      organization_id: orgId, store_id: storeId,
      first_name: 'Marie', last_name: 'Tremblay', email: `marie-${run}@example.test`,
      phone: '+15145550142', source: 'walk_in', source_platform: 'organic',
      preferred_language: 'fr-CA', vehicle_interest: 'Kia Forte',
      // Deliberately different numbers: D-043 exists because a monthly figure
      // and a total are both plausible amounts of money, so a route that
      // crossed them would still look right with one shared value.
      total_budget_cents: 3_000_000, monthly_budget_cents: 45_000,
      // Not the column default, so a create route that dropped it would show up
      // as 'unknown' here rather than as a value that happens to match.
      trade_in_status: 'has_trade',
    });
  });

  it('vehicles', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await check('vehicles', '/api/v1/vehicles', CreateVehicleInput, {
      organization_id: orgId, store_id: storeId,
      stock_number: `PST-${run}`, vin: '1HGCM82633A004352',
      year: 2022, make: 'Kia', model: 'Forte', trim: 'EX', exterior_color: 'Blue',
      mileage_km: 32_000, vehicle_type: 'used', acquisition_type: 'trade_in',
      acquisition_cost_cents: 2_000_000, transport_cost_cents: 50_000,
      recon_cost_cents: 80_000, list_price_cents: 2_600_000,
      location_status: 'on_lot', location_details: 'Row 3',
      acquisition_date: '2026-07-01',
    });
  });
});
