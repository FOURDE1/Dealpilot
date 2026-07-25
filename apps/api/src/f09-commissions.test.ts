import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { Commission, Member, PayPlan, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-09 integration suite — pay plans and the commissions a funded deal writes.
 * The math itself is golden-tested in @dealpilot/core (A-06); this proves the
 * WIRING: the right plan, the right overriders, the right month, exactly once,
 * and only the right people can read it.
 *
 * Scenario mirrors the owner's real plans (commissions §2): a salesperson on
 * 25% with a $1,500 pad, and a manager taking a 5% override on their deals.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const OWNER = { email: `f09-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieOwner = '';
let sellerCookie = '';
let orgId = '';
let storeId = '';
let sellerId = '';
let managerId = '';

const CommissionPage = paginated(Commission);
const PayPlanPage = paginated(PayPlan);

async function signUp(u: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: u });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

/** Desk a deal, credit the seller, then fund it. Returns the deal id. */
async function deskAndFund(salePrice: number, cost: number, fiReserve: number): Promise<string> {
  const created = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: salePrice, vehicle_cost_cents: cost, fi_reserve_cents: fiReserve,
      salesperson_id: sellerId, interest_rate_bps: 599, term_months: 60,
    },
  });
  expect(created.statusCode).toBe(201);
  const dealId = (JSON.parse(created.body) as { id: string }).id;
  const funded = await app!.inject({
    method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
    payload: { funding_status: 'funded' },
  });
  expect(funded.statusCode).toBe(200);
  return dealId;
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

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOwner },
    payload: { name: 'Groupe F09', slug: `groupe-f09-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, name: 'F09 Kia', code: 'F09-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  // The seller needs a real SESSION (pay is personal, so we test what they can
  // see). Identity first, then the domain user + membership under the same id —
  // exactly what the org bootstrap does for a founder. Going through
  // POST /members instead would mint a second, unrelated user row: linking an
  // invited person to the identity they later create is the deferred invite
  // flow, not something this suite should pretend works.
  const sellerEmail = `f09-seller-${run}@dealpilot.test`;
  sellerCookie = await signUp({ email: sellerEmail, password: 'correct-horse-battery-staple', name: 'Sam Seller' });
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: sellerCookie } });
  sellerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
  await admin.query(
    `INSERT INTO users (id, email, name, status) VALUES ($1, $2, 'Sam Seller', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [sellerId, sellerEmail],
  );
  await admin.query(
    `INSERT INTO memberships (user_id, organization_id, store_id, roles)
     VALUES ($1, $2, NULL, '{salesperson}')`,
    [sellerId, orgId],
  );

  const manager = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, email: `f09-mgr-${run}@dealpilot.test`, name: 'Mia Manager', roles: ['gm'] },
  });
  managerId = Member.parse(JSON.parse(manager.body)).user_id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-09 pay plans', () => {
  it('the owner records a 25% plan with a $1,500 pad', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: cookieOwner },
      payload: {
        organization_id: orgId, user_id: sellerId,
        commission_rate: 0.25, has_pad: true, pad_cents: 150_000,
      },
    });
    expect(res.statusCode).toBe(201);
    const plan = PayPlan.parse(JSON.parse(res.body));
    expect(plan.commission_rate).toBe(0.25);
    // The pad is CENTS — the audited legacy bug turned $1,500 into $15.
    expect(plan.pad_cents).toBe(150_000);
  });

  it('a manager takes a 5% override on that seller', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: cookieOwner },
      payload: {
        organization_id: orgId, user_id: managerId, commission_rate: 0.1,
        override_on_user_id: sellerId, override_rate: 0.05,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(PayPlan.parse(JSON.parse(res.body)).override_rate).toBe(0.05);
  });

  it('an override needs both the person and the rate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, user_id: managerId, commission_rate: 0.1, override_rate: 0.05 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('F-09 commissions on funding', () => {
  let dealId = '';

  it('funding a deal pays the seller AND the overrider (golden numbers)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // $35,000 sale on a $30,000 car with $2,000 F&I reserve:
    // gross $7,000 − $1,500 pad = $5,500 → 25% = $1,375.00; override 5% = $275.00
    dealId = await deskAndFund(3_500_000, 3_000_000, 200_000);

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}&deal_id=${dealId}`,
      headers: { cookie: cookieOwner },
    });
    expect(res.statusCode).toBe(200);
    const lines = CommissionPage.parse(JSON.parse(res.body)).items;
    expect(lines).toHaveLength(2);

    const sale = lines.find((l) => l.kind === 'sale')!;
    expect(sale.user_id).toBe(sellerId);
    expect(sale.total_gross_cents).toBe(700_000);
    expect(sale.gross_for_commission_cents).toBe(550_000); // pad BEFORE rate
    expect(sale.amount_cents).toBe(137_500);

    const override = lines.find((l) => l.kind === 'override')!;
    expect(override.user_id).toBe(managerId);
    expect(override.amount_cents).toBe(27_500);
  });

  it('re-funding the same deal never pays twice', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
      payload: { funding_status: 'funded' },
    });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}&deal_id=${dealId}`,
      headers: { cookie: cookieOwner },
    });
    expect(CommissionPage.parse(JSON.parse(res.body)).items).toHaveLength(2);
  });

  it('a deal with no salesperson credited writes nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 2_000_000, vehicle_cost_cents: 1_800_000, interest_rate_bps: 0, term_months: 60,
      },
    });
    const uncredited = (JSON.parse(created.body) as { id: string }).id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${uncredited}`, headers: { cookie: cookieOwner },
      payload: { funding_status: 'funded' },
    });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}&deal_id=${uncredited}`,
      headers: { cookie: cookieOwner },
    });
    expect(CommissionPage.parse(JSON.parse(res.body)).items).toEqual([]);
  });

  it('a loss pays zero, and never a negative commission', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lossDeal = await deskAndFund(2_000_000, 2_200_000, 0);
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}&deal_id=${lossDeal}`,
      headers: { cookie: cookieOwner },
    });
    const sale = CommissionPage.parse(JSON.parse(res.body)).items.find((l) => l.kind === 'sale')!;
    expect(sale.total_gross_cents).toBe(-200_000);
    expect(sale.amount_cents).toBe(0);
  });
});

describe('F-09 pay is personal', () => {
  it('a salesperson sees their own commissions but not the manager’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}`, headers: { cookie: sellerCookie },
    });
    expect(res.statusCode).toBe(200);
    const lines = CommissionPage.parse(JSON.parse(res.body)).items;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.user_id === sellerId)).toBe(true);
  });

  it('asking for someone else’s pay still returns only your own', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/commissions?organization_id=${orgId}&user_id=${managerId}`,
      headers: { cookie: sellerCookie },
    });
    expect(CommissionPage.parse(JSON.parse(res.body)).items.every((l) => l.user_id === sellerId)).toBe(true);
  });

  it('a salesperson cannot write pay plans', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: sellerCookie },
      payload: { organization_id: orgId, user_id: sellerId, commission_rate: 0.9 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('the owner sees the whole org’s plans', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/pay-plans?organization_id=${orgId}`, headers: { cookie: cookieOwner },
    });
    expect(PayPlanPage.parse(JSON.parse(res.body)).items.length).toBe(2);
  });
});
