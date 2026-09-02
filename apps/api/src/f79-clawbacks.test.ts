import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import {
  Commission,
  CommissionClawback,
  IMPERSONATION_BLOCKED_PERMISSIONS,
  Member,
  paginated,
  type CommissionT,
} from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-79 integration suite — commission clawbacks (commissions-clawbacks.md §8,
 * §11.4; FR-COM-004). The MATH is golden-tested in @dealpilot/core (T-C1…T-C6
 * beside the A-06 goldens); this proves the WIRING: flag → human confirm →
 * exactly ONE negative line derived from the STORED row, dated into the OPEN
 * period, with the right refusals, the right readers and the right bells.
 *
 * Fixtures are built through the API (a raw-SQL fixture is testing the
 * database). The ONE sanctioned admin-SQL act is T-A9's clock backdate —
 * setup-only time travel; every action and read still runs through the API.
 *
 * Canonical numbers re-derived from the engine (never hand-copied): $35,000
 * sale on a $30,000 car with a $2,000 F&I reserve on the 25% + $1,500-pad plan
 * → total_gross 700 000¢, gfc 550 000¢, amount 137 500¢ — the same
 * deskAndFund(3_500_000, 3_000_000, 200_000) the F-09 suite pins.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let ownerCookie = '';
let vickyCookie = '';
let fadiCookie = '';
let gabyCookie = '';
let orgId = '';
let storeId = '';
let vickyId = '';
let fadiId = '';
let rivalCookie = '';
let rivalOrgId = '';

/** deal 1 — the canonical 137 500¢ sale line, flagged in T-A1. */
let dealId = '';
let commissionId = '';
let ccId = '';
let confirmedAt = '';
/** deal 2 — T-A2's FRESH duplicate-flag fixture. */
let ccId2 = '';

const CommissionPage = paginated(Commission);
const ClawbackPage = paginated(CommissionClawback);

interface NotifItem {
  title_key: string;
  urgency: string;
  entity_id: string | null;
  params: Record<string, unknown>;
}
interface ActivityItem {
  entity_type: string;
  action: string;
  reason: string | null;
  parent_entity_id: string | null;
  changes: Record<string, unknown>;
}
interface ErrorBody {
  error: { code: string; details?: { path?: string; code: string }[] };
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

/** Sign the person up (they need an account first — CR-14), then add them. */
async function addMember(
  adderCookie: string, org: string, email: string, name: string, roles: string[],
): Promise<{ cookie: string; userId: string }> {
  const cookie = await signUp(email, name);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: adderCookie },
    payload: { organization_id: org, email, name, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie, userId: Member.parse(JSON.parse(res.body)).user_id };
}

/** Desk a deal, credit the seller, fund it — all through the API. */
async function deskAndFund(
  cookie: string, org: string, store: string, sellerId: string,
  salePrice: number, cost: number, fiReserve: number,
): Promise<string> {
  const created = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: org, store_id: store, province: 'QC',
      sale_price_cents: salePrice, vehicle_cost_cents: cost, fi_reserve_cents: fiReserve,
      salesperson_id: sellerId, interest_rate_bps: 599, term_months: 60,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = (JSON.parse(created.body) as { id: string }).id;
  const funded = await app!.inject({
    method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie },
    payload: { funding_status: 'funded' },
  });
  expect(funded.statusCode, funded.body).toBe(200);
  return id;
}

async function commissionLines(cookie: string, org: string, deal: string): Promise<CommissionT[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/commissions?organization_id=${org}&deal_id=${deal}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return CommissionPage.parse(JSON.parse(res.body)).items;
}

async function flag(
  cookie: string, org: string, commission: string, reversed: number, reason: string,
) {
  return app!.inject({
    method: 'POST', url: '/api/v1/commission-clawbacks', headers: { cookie },
    payload: {
      organization_id: org, commission_id: commission,
      reason, reversed_amount_cents: reversed,
    },
  });
}

async function confirm(cookie: string, id: string) {
  return app!.inject({
    method: 'POST', url: `/api/v1/commission-clawbacks/${id}/confirm`, headers: { cookie },
  });
}

async function bell(cookie: string): Promise<NotifItem[]> {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.body) as { items: NotifItem[] }).items;
}

const clawbackBells = (items: NotifItem[], entityId: string) =>
  items.filter((n) => n.title_key === 'notif_commission_clawback' && n.entity_id === entityId);

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

  ownerCookie = await signUp(`f79-owner-${run}@dealpilot.test`, 'Olivia Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe F79', slug: `groupe-f79-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'F79 Kia', code: 'F79-KIA', province: 'QC' },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;

  ({ cookie: vickyCookie, userId: vickyId } = await addMember(
    ownerCookie, orgId, `f79-vicky-${run}@dealpilot.test`, 'Vicky Vendeuse', ['salesperson'],
  ));
  ({ cookie: fadiCookie, userId: fadiId } = await addMember(
    ownerCookie, orgId, `f79-fadi-${run}@dealpilot.test`, 'Fadi Finance', ['fi_manager'],
  ));
  ({ cookie: gabyCookie } = await addMember(
    ownerCookie, orgId, `f79-gaby-${run}@dealpilot.test`, 'Gaby GM', ['gm'],
  ));

  const plan = await app!.inject({
    method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, user_id: vickyId, commission_rate: 0.25, has_pad: true, pad_cents: 150_000 },
  });
  expect(plan.statusCode, plan.body).toBe(201);

  dealId = await deskAndFund(ownerCookie, orgId, storeId, vickyId, 3_500_000, 3_000_000, 200_000);
  const lines = await commissionLines(ownerCookie, orgId, dealId);
  const sale = lines.find((l) => l.kind === 'sale')!;
  expect(sale.amount_cents).toBe(137_500); // the canonical line, engine-derived
  commissionId = sale.id;

  // The rival: their own org, full authority THERE, none here.
  rivalCookie = await signUp(`f79-rival-${run}@dealpilot.test`, 'Rita Rival');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival 79', slug: `groupe-rival-79-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-79 flagging (T-A1…T-A3) and the confirm gate (T-A3b)', () => {
  it('T-A1: an fi_manager flags a partial 50 000¢ reversal — the golden row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await flag(fadiCookie, orgId, commissionId, 50_000, 'Financement annulé');
    expect(res.statusCode, res.body).toBe(201);
    const cc = CommissionClawback.parse(JSON.parse(res.body));
    expect(cc.status).toBe('flagged');
    expect(cc.original_amount_cents).toBe(137_500);
    expect(cc.reversed_amount_cents).toBe(50_000);
    expect(cc.flagged_by).toBe(fadiId); // pins the NOT NULL end
    expect(cc.commission_id).toBe(commissionId);
    expect(cc.deal_id).toBe(dealId);
    expect(cc.confirmed_at).toBeNull();
    expect(cc.confirmed_by).toBeNull();
    ccId = cc.id;
  });

  it('T-A2: a duplicate flag is a 409 from the partial index, on a FRESH fixture', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Fresh second funded deal INSIDE this test (the shared-fixture lesson).
    const deal2 = await deskAndFund(ownerCookie, orgId, storeId, vickyId, 3_500_000, 3_000_000, 200_000);
    const sale2 = (await commissionLines(ownerCookie, orgId, deal2)).find((l) => l.kind === 'sale')!;
    const first = await flag(fadiCookie, orgId, sale2.id, 30_000, 'Retour du véhicule');
    expect(first.statusCode, first.body).toBe(201);
    ccId2 = CommissionClawback.parse(JSON.parse(first.body)).id;
    // No pre-SELECT guards this — the 409 is the index's answer (mutation M3
    // reds HERE if commission_clawbacks_one_flagged is dropped).
    const second = await flag(gabyCookie, orgId, sale2.id, 20_000, 'Retour du véhicule');
    expect(second.statusCode, second.body).toBe(409);
    const err = JSON.parse(second.body) as ErrorBody;
    expect(err.error.details?.[0]?.path).toBe('commission_id');
    // The 409 REFUSED — it did not silently dedupe: exactly one row exists.
    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/commission-clawbacks?organization_id=${orgId}&commission_id=${sale2.id}`,
      headers: { cookie: ownerCookie },
    });
    expect(ClawbackPage.parse(JSON.parse(list.body)).items).toHaveLength(1);
  });

  it('T-A3: refusals — 403 without the permission, 404 cross-tenant, 422 over-amount, 422 on the reachable $0 loss line', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Vicky (salesperson) holds no commission:clawback → 403.
    const asVicky = await flag(vickyCookie, orgId, commissionId, 10_000, 'Je proteste');
    expect(asVicky.statusCode).toBe(403);
    // A rival-org owner flags OUR commission id: RLS hides the row, 404 —
    // driven as the APP role (the rls-coverage behavioural case).
    const asRival = await flag(rivalCookie, rivalOrgId, commissionId, 10_000, 'Tentative rivale');
    expect(asRival.statusCode).toBe(404);
    // Reversing more than the line paid.
    const over = await flag(fadiCookie, orgId, commissionId, 137_501, 'Trop demandé');
    expect(over.statusCode).toBe(422);
    expect((JSON.parse(over.body) as ErrorBody).error.details?.[0]?.path).toBe('reversed_amount_cents');
    // POSITIVE $0 fixture: a loss deal DOES write a kind='sale' line with
    // amount_cents = 0 (unconditional funding INSERT + the engine's floor), so
    // the nothing-to-recover refusal is proven against a real reachable row,
    // never by absence.
    const lossDeal = await deskAndFund(ownerCookie, orgId, storeId, vickyId, 2_000_000, 2_200_000, 0);
    const lossLine = (await commissionLines(ownerCookie, orgId, lossDeal)).find((l) => l.kind === 'sale')!;
    expect(lossLine.amount_cents).toBe(0);
    const zero = await flag(fadiCookie, orgId, lossLine.id, 1, 'Rien à reprendre');
    expect(zero.statusCode).toBe(422);
    expect((JSON.parse(zero.body) as ErrorBody).error.details?.[0]?.path).toBe('commission_id');
  });

  it('T-A3b: the CONFIRM gate itself — a salesperson without commission:clawback gets a 403, the flag stays flagged, no line is written', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // FRESH fixture (the shared-fixture lesson): its own funded deal and flag,
    // so no other test's state can stand in for this refusal. Vicky is the
    // EARNER here, so clawbackOrg resolves her org and the confirm's
    // requirePermission is the only refusal left standing between her and the
    // money write (T-A3 proved only the FLAG half of the permission claim).
    const deal3b = await deskAndFund(ownerCookie, orgId, storeId, vickyId, 3_500_000, 3_000_000, 200_000);
    const sale3b = (await commissionLines(ownerCookie, orgId, deal3b)).find((l) => l.kind === 'sale')!;
    const flagged = await flag(fadiCookie, orgId, sale3b.id, 25_000, 'Reprise à confirmer par un gestionnaire');
    expect(flagged.statusCode, flagged.body).toBe(201);
    const cc3b = CommissionClawback.parse(JSON.parse(flagged.body));

    const asVicky = await confirm(vickyCookie, cc3b.id);
    expect(asVicky.statusCode, asVicky.body).toBe(403);

    // The row did not move and no money was written.
    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/commission-clawbacks?organization_id=${orgId}&commission_id=${sale3b.id}`,
      headers: { cookie: ownerCookie },
    });
    const row = ClawbackPage.parse(JSON.parse(list.body)).items.find((c) => c.id === cc3b.id)!;
    expect(row.status).toBe('flagged');
    expect(row.confirmed_at).toBeNull();
    const lines = await commissionLines(ownerCookie, orgId, deal3b);
    expect(lines.filter((l) => l.kind === 'clawback')).toHaveLength(0);
  });
});

describe('F-79 confirming (T-A4…T-A6)', () => {
  it('T-A4: confirming writes EXACTLY ONE negative line, derived from the stored row, dated by the confirm stamp', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await confirm(fadiCookie, ccId);
    expect(res.statusCode, res.body).toBe(200);
    const cc = CommissionClawback.parse(JSON.parse(res.body));
    expect(cc.status).toBe('reversed');
    expect(cc.confirmed_by).toBe(fadiId);
    expect(cc.confirmed_at).not.toBeNull();
    confirmedAt = cc.confirmed_at!;

    const lines = await commissionLines(ownerCookie, orgId, dealId);
    const clawbacks = lines.filter((l) => l.kind === 'clawback');
    expect(clawbacks).toHaveLength(1);
    const line = clawbacks[0]!;
    expect(line.user_id).toBe(vickyId);
    expect(line.amount_cents).toBe(-50_000);
    // The explanatory columns copied VERBATIM from the original (a partial
    // reversal, so amount ≠ gfc × rate on this row by design).
    expect(line.total_gross_cents).toBe(700_000);
    expect(line.gross_for_commission_cents).toBe(550_000);
    expect(line.applied_rate).toBe(0.25); // a NUMBER — the num() boundary
    // ONE clock: the line's pay period IS the confirmation instant, byte-equal.
    expect(line.funded_at).toBe(confirmedAt);
    const sale = lines.find((l) => l.kind === 'sale')!;
    expect(Date.parse(line.funded_at)).toBeGreaterThan(Date.parse(sale.funded_at));
  });

  it('T-A5: a second confirm is a 422, never a silent 200 — and never a second line', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await confirm(fadiCookie, ccId);
    expect(res.statusCode).toBe(422);
    expect((JSON.parse(res.body) as ErrorBody).error.code).toBe('already_reversed');
    const lines = await commissionLines(ownerCookie, orgId, dealId);
    expect(lines.filter((l) => l.kind === 'clawback')).toHaveLength(1);
    // The deal's money story: 137 500 − 50 000 = 87 500 (guards the
    // ON-CONFLICT-DO-NOTHING silent-drop class, with mutation M7).
    expect(lines.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(87_500);
  });

  it('T-A5b: the same-person sale+override edge — the second confirm is a 422 clawback_cap_reached and rolls back WHOLE', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The ONE reachable path to the commissions 23505 the confirm route maps
    // in-route: a seller whose own plan carries an override on themselves gets
    // TWO lines per deal — (deal, sam, 'sale') and (deal, sam, 'override') —
    // but only ONE (deal, sam, 'clawback') slot. Fresh fixtures throughout.
    // This is mutation M7's red: with ON CONFLICT DO NOTHING the second
    // confirm would answer 200 with a flipped status and NO line — the
    // recorded no-op-feature class — instead of refusing whole.
    const { userId: samId } = await addMember(
      ownerCookie, orgId, `f79-sam-${run}@dealpilot.test`, 'Sam Selfover', ['salesperson'],
    );
    const samPlan = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: ownerCookie },
      payload: {
        organization_id: orgId, user_id: samId, commission_rate: 0.25,
        has_pad: true, pad_cents: 150_000,
        override_on_user_id: samId, override_rate: 0.05,
      },
    });
    expect(samPlan.statusCode, samPlan.body).toBe(201);
    const samDeal = await deskAndFund(ownerCookie, orgId, storeId, samId, 3_500_000, 3_000_000, 200_000);
    const samLines = await commissionLines(ownerCookie, orgId, samDeal);
    const samSale = samLines.find((l) => l.kind === 'sale')!;
    const samOverride = samLines.find((l) => l.kind === 'override')!;
    expect(samSale.amount_cents).toBe(137_500);
    expect(samOverride.amount_cents).toBeGreaterThan(0); // flaggable too

    // First reversal (on the sale line) confirms fine.
    const first = await flag(fadiCookie, orgId, samSale.id, 20_000, 'Financement annulé');
    expect(first.statusCode, first.body).toBe(201);
    const cc1 = CommissionClawback.parse(JSON.parse(first.body));
    const ok = await confirm(fadiCookie, cc1.id);
    expect(ok.statusCode, ok.body).toBe(200);

    // Second flag is a DIFFERENT commission — the partial index allows it.
    const second = await flag(fadiCookie, orgId, samOverride.id, 10_000, 'Surcommission à reprendre');
    expect(second.statusCode, second.body).toBe(201);
    const cc2 = CommissionClawback.parse(JSON.parse(second.body));
    // …but its confirm hits the commissions UNIQUE: the sibling line holds the
    // (deal, sam, 'clawback') slot. 422 cap_reached, never a silent flip.
    const refused = await confirm(fadiCookie, cc2.id);
    expect(refused.statusCode, refused.body).toBe(422);
    expect((JSON.parse(refused.body) as ErrorBody).error.code).toBe('clawback_cap_reached');

    // The WHOLE transaction rolled back: the row is still 'flagged', there is
    // still exactly ONE negative line, and the deal's money story is intact:
    // 137 500 + 27 500 − 20 000 = 145 000.
    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/commission-clawbacks?organization_id=${orgId}&commission_id=${samOverride.id}`,
      headers: { cookie: ownerCookie },
    });
    const row = ClawbackPage.parse(JSON.parse(list.body)).items.find((c) => c.id === cc2.id)!;
    expect(row.status).toBe('flagged');
    expect(row.confirmed_at).toBeNull();
    const after = await commissionLines(ownerCookie, orgId, samDeal);
    expect(after.filter((l) => l.kind === 'clawback')).toHaveLength(1);
    expect(after.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(145_000);
  });

  it('T-A6: a reversed commission is terminal — re-flagging answers 422, and a clawback line itself is never flaggable', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const again = await flag(fadiCookie, orgId, commissionId, 10_000, 'Deuxième tentative');
    expect(again.statusCode).toBe(422);
    expect((JSON.parse(again.body) as ErrorBody).error.code).toBe('clawback_terminal');
    // T-A3's deferred subcase (the line is created above): flagging the
    // NEGATIVE line's own id is refused too.
    const negLine = (await commissionLines(ownerCookie, orgId, dealId)).find((l) => l.kind === 'clawback')!;
    const onClawback = await flag(fadiCookie, orgId, negLine.id, 10_000, 'Reprise de reprise');
    expect(onClawback.statusCode).toBe(422);
    expect((JSON.parse(onClawback.body) as ErrorBody).error.details?.[0]?.path).toBe('commission_id');
  });
});

describe('F-79 who sees what (T-A7, T-A8)', () => {
  it('T-A7: the list clamps to the caller’s OWN lines without commission:read_all', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Positive case first (D-046: a negative needs its positive beside it):
    // Vicky sees the clawback on HER line.
    const vicky = await app!.inject({
      method: 'GET', url: `/api/v1/commission-clawbacks?organization_id=${orgId}`,
      headers: { cookie: vickyCookie },
    });
    expect(vicky.statusCode).toBe(200);
    const vickyIds = ClawbackPage.parse(JSON.parse(vicky.body)).items.map((c) => c.id);
    expect(vickyIds).toContain(ccId);
    // Gaby holds commission:read_all (gm default) and sees it too.
    const gaby = await app!.inject({
      method: 'GET', url: `/api/v1/commission-clawbacks?organization_id=${orgId}`,
      headers: { cookie: gabyCookie },
    });
    expect(ClawbackPage.parse(JSON.parse(gaby.body)).items.map((c) => c.id)).toContain(ccId);
    // A SECOND salesperson gets an empty view of Vicky's pay (mutation M8's red).
    const { cookie: zoeCookie } = await addMember(
      ownerCookie, orgId, `f79-zoe-${run}@dealpilot.test`, 'Zoé Vendeuse', ['salesperson'],
    );
    const zoe = await app!.inject({
      method: 'GET', url: `/api/v1/commission-clawbacks?organization_id=${orgId}`,
      headers: { cookie: zoeCookie },
    });
    expect(zoe.statusCode).toBe(200);
    const zoeIds = ClawbackPage.parse(JSON.parse(zoe.body)).items.map((c) => c.id);
    expect(zoeIds).not.toContain(ccId);
    expect(zoeIds).not.toContain(ccId2);
  });

  it('T-A8: a rival organization cannot confirm our clawback — 404 from the clawbackOrg walk', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await confirm(rivalCookie, ccId2);
    expect(res.statusCode).toBe(404);
    // And the row did not move: still flagged for us.
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/commission-clawbacks?organization_id=${orgId}`,
      headers: { cookie: ownerCookie },
    });
    const row = ClawbackPage.parse(JSON.parse(list.body)).items.find((c) => c.id === ccId2)!;
    expect(row.status).toBe('flagged');
  });
});

describe('F-79 the open pay period (T-A9)', () => {
  it('T-A9: confirming in month M+1 never restates month M — the negative line lands in the OPEN period', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal9 = await deskAndFund(ownerCookie, orgId, storeId, vickyId, 3_500_000, 3_000_000, 200_000);
    // The ONE sanctioned admin-SQL act: backdate the two CLOCKS a month
    // (deals.funded_at + the commission row's funded_at) to simulate a closed
    // month. Every action and read below is API-driven.
    await admin.query(`UPDATE deals SET funded_at = funded_at - interval '1 month' WHERE id = $1`, [deal9]);
    await admin.query(`UPDATE commissions SET funded_at = funded_at - interval '1 month' WHERE deal_id = $1`, [deal9]);

    const sale9 = (await commissionLines(ownerCookie, orgId, deal9)).find((l) => l.kind === 'sale')!;
    const flagged = await flag(fadiCookie, orgId, sale9.id, 137_500, 'Client retourné, reprise complète');
    expect(flagged.statusCode, flagged.body).toBe(201);
    const cc9 = CommissionClawback.parse(JSON.parse(flagged.body));
    const confirmed = await confirm(fadiCookie, cc9.id);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // Month-M sum computed FROM THE API's items over the half-open UTC month
    // window — no raw-SQL read anywhere.
    const lines = await commissionLines(ownerCookie, orgId, deal9);
    const saleAt = new Date(lines.find((l) => l.kind === 'sale')!.funded_at);
    const monthStart = Date.UTC(saleAt.getUTCFullYear(), saleAt.getUTCMonth(), 1);
    const nextMonthStart = Date.UTC(saleAt.getUTCFullYear(), saleAt.getUTCMonth() + 1, 1);
    const monthM = lines.filter((l) => {
      const t = Date.parse(l.funded_at);
      return t >= monthStart && t < nextMonthStart;
    });
    expect(monthM.reduce((sum, l) => sum + l.amount_cents, 0)).toBe(137_500); // UNCHANGED
    // …and the clawback line's period is M+1 (the confirmation instant).
    const neg = lines.find((l) => l.kind === 'clawback')!;
    expect(neg.amount_cents).toBe(-137_500);
    expect(Date.parse(neg.funded_at)).toBeGreaterThanOrEqual(nextMonthStart);
  });
});

describe('F-79 bells (T-A10, T-A10b)', () => {
  it('T-A10: the earner rings HIGH, the GM rings MEDIUM, the actor rings not at all — and nobody twice', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // T-A4's confirm (Fadi, 50 000¢ on Vicky's line) already committed its
    // bells in the same transaction; scope by entity_id so T-A9's cannot blur.
    const vicky = clawbackBells(await bell(vickyCookie), ccId);
    expect(vicky).toHaveLength(1); // exactly one — never doubled
    expect(vicky[0]!.urgency).toBe('high'); // her pay moved
    // params carry ONE locale-free number: 500 (dollars), formatted by each
    // recipient's own locale at display time.
    expect(vicky[0]!.params['amount']).toBe(500);
    const gaby = clawbackBells(await bell(gabyCookie), ccId);
    expect(gaby).toHaveLength(1);
    expect(gaby[0]!.urgency).toBe('medium');
    expect(gaby[0]!.params['amount']).toBe(500);
    // Fadi confirmed it — the actor is dropped from the manager set.
    expect(clawbackBells(await bell(fadiCookie), ccId)).toHaveLength(0);
  });

  it('T-A10b: in a no-GM org the owner query is the FALLBACK — and the confirming owner is still excluded while the earner receives', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A fresh org with NO gm: owner2 (the actor), owner2b (a second owner —
    // the POSITIVE proof the fallback query fires), and Vicky2 the earner.
    const owner2Cookie = await signUp(`f79-owner2-${run}@dealpilot.test`, 'Odile Owner');
    const org2 = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: owner2Cookie },
      payload: { name: 'Groupe F79 Sans GM', slug: `groupe-f79-nogm-${run}` },
    });
    expect(org2.statusCode, org2.body).toBe(201);
    const org2Id = (JSON.parse(org2.body) as { id: string }).id;
    const store2 = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: owner2Cookie },
      payload: { organization_id: org2Id, name: 'F79 Nord', code: 'F79-NORD', province: 'QC' },
    });
    const store2Id = (JSON.parse(store2.body) as { id: string }).id;
    const { cookie: vicky2Cookie, userId: vicky2Id } = await addMember(
      owner2Cookie, org2Id, `f79-vicky2-${run}@dealpilot.test`, 'Vicky Deux', ['salesperson'],
    );
    const { cookie: owner2bCookie } = await addMember(
      owner2Cookie, org2Id, `f79-owner2b-${run}@dealpilot.test`, 'Omar Owner', ['owner'],
    );
    const plan2 = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: owner2Cookie },
      payload: { organization_id: org2Id, user_id: vicky2Id, commission_rate: 0.25, has_pad: true, pad_cents: 150_000 },
    });
    expect(plan2.statusCode, plan2.body).toBe(201);
    const deal2b = await deskAndFund(owner2Cookie, org2Id, store2Id, vicky2Id, 3_500_000, 3_000_000, 200_000);
    const sale2b = (await commissionLines(owner2Cookie, org2Id, deal2b)).find((l) => l.kind === 'sale')!;
    const flagged = await flag(owner2Cookie, org2Id, sale2b.id, 50_000, 'Financement refusé');
    expect(flagged.statusCode, flagged.body).toBe(201);
    const cc2b = CommissionClawback.parse(JSON.parse(flagged.body));
    const confirmed = await confirm(owner2Cookie, cc2b.id);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // The earner is NEVER dropped.
    const vicky2 = clawbackBells(await bell(vicky2Cookie), cc2b.id);
    expect(vicky2).toHaveLength(1);
    expect(vicky2[0]!.urgency).toBe('high');
    // The fallback query FIRED: the non-actor owner rang, medium.
    const owner2b = clawbackBells(await bell(owner2bCookie), cc2b.id);
    expect(owner2b).toHaveLength(1);
    expect(owner2b[0]!.urgency).toBe('medium');
    // The confirming owner is the ACTOR — excluded even as fallback.
    expect(clawbackBells(await bell(owner2Cookie), cc2b.id)).toHaveLength(0);
  });
});

describe('F-79 the trail and the fences (T-A11, T-A12, T-DB1)', () => {
  it('T-A11: two status-only events under the deal — and NO amounts in changes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&entity_id=${ccId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const events = (JSON.parse(res.body) as { items: ActivityItem[] }).items
      .filter((e) => e.entity_type === 'commission_clawback');
    expect(events.map((e) => e.action).sort()).toEqual(['created', 'updated']);
    for (const evt of events) {
      expect(evt.parent_entity_id).toBe(dealId);
      // Events carry STATUS ONLY: activity:read is floor-wide and the f10 pay
      // filter is deliberately NOT extended — an amount here would hand the
      // whole floor a second door to pay.
      expect(evt.changes).not.toHaveProperty('reversed_amount_cents');
      expect(Object.keys(evt.changes)).toEqual(['status']);
    }
    const created = events.find((e) => e.action === 'created')!;
    expect(created.reason).toBe('Financement annulé');
    expect(created.changes['status']).toMatchObject({ from: null, to: 'flagged' });
    const updated = events.find((e) => e.action === 'updated')!;
    expect(updated.changes['status']).toMatchObject({ from: 'flagged', to: 'reversed' });
  });

  it('T-A12: platform support can never move pay — commission:clawback is impersonation-blocked', () => {
    expect(IMPERSONATION_BLOCKED_PERMISSIONS).toContain('commission:clawback');
  });

  it('T-DB1: dealpilot_app holds exactly SELECT/INSERT/UPDATE — no DELETE — on commission_clawbacks', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The rls-coverage no-DELETE list stays its closed 3-table immutable set;
    // this workflow table holds UPDATE by design (the status flip), so its
    // grant shape is pinned here instead.
    const r = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name = 'commission_clawbacks'
       ORDER BY privilege_type`,
    );
    expect(r.rows.map((x) => x.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });
});
