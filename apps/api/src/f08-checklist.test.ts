import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { ChecklistReadiness, DealChecklistItem } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import { z } from 'zod';

/**
 * F-08 integration suite — the delivery checklist gate (delivery.md §2).
 * What must be true: a deal cannot reach `delivered` while a required item is
 * outstanding; a manager may waive a soft item WITH a reason; the safety
 * inspection can never be waived by anyone; and per-store policy is snapshot
 * onto the deal so later policy edits don't rewrite deals in flight.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const OWNER = { email: `f08-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieOwner = '';
let sellerCookie = '';
let orgId = '';
let storeId = '';
let dealId = '';

const ChecklistResponse = z.object({
  items: z.array(DealChecklistItem),
  readiness: ChecklistReadiness,
});

async function signUp(u: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: u });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

async function getChecklist(cookie = cookieOwner) {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/checklist`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return ChecklistResponse.parse(JSON.parse(res.body));
}

async function tick(code: string) {
  const res = await app!.inject({
    method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/${code}`, headers: { cookie: cookieOwner },
    payload: { completed: true },
  });
  expect(res.statusCode).toBe(200);
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
    payload: { name: 'Groupe F08', slug: `groupe-f08-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, name: 'F08 Kia', code: 'F08-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const deal = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000, interest_rate_bps: 599, term_months: 60,
    },
  });
  dealId = (JSON.parse(deal.body) as { id: string }).id;

  // A salesperson session for the "who may waive" checks.
  const sellerEmail = `f08-seller-${run}@dealpilot.test`;
  sellerCookie = await signUp({ email: sellerEmail, password: 'correct-horse-battery-staple', name: 'Sam Seller' });
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: sellerCookie } });
  const sellerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
  await admin.query(
    `INSERT INTO users (id, email, name, status) VALUES ($1,$2,'Sam Seller','active') ON CONFLICT (id) DO NOTHING`,
    [sellerId, sellerEmail],
  );
  await admin.query(
    `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1,$2,NULL,'{salesperson}')`,
    [sellerId, orgId],
  );
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-08 delivery checklist', () => {
  it('a deal gets the store’s 10 canonical items, none done yet', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { items, readiness } = await getChecklist();
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.code)).toContain('safety');
    // FR-first labels are present for both languages (Bill 96).
    expect(items[0]!.label_fr.length).toBeGreaterThan(0);
    expect(items[0]!.label_en.length).toBeGreaterThan(0);
    expect(readiness.ready_for_delivery).toBe(false);
    expect(readiness.outstanding).toHaveLength(10);
  });

  it('DELIVERED is refused while items are outstanding', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
      payload: { pipeline_stage: 'delivered' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('checklist_incomplete');
  });

  it('the safety inspection can never be waived — by anyone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/safety`, headers: { cookie: cookieOwner },
      payload: { overridden: true, override_reason: 'Customer is in a hurry' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('hard_block');
  });

  it('a waiver without a reason is refused; a salesperson cannot waive at all', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const noReason = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/void_cheque`, headers: { cookie: cookieOwner },
      payload: { overridden: true },
    });
    expect(noReason.statusCode).toBe(422);

    const bySalesperson = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/void_cheque`, headers: { cookie: sellerCookie },
      payload: { overridden: true, override_reason: 'Client will send it tomorrow' },
    });
    expect(bySalesperson.statusCode).toBe(403);
  });

  it('a manager waives a soft item, and the reason is recorded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/void_cheque`, headers: { cookie: cookieOwner },
      payload: { overridden: true, override_reason: 'Pre-authorized debit already on file' },
    });
    expect(res.statusCode).toBe(200);
    const item = DealChecklistItem.parse(JSON.parse(res.body));
    expect(item.override_reason).toBe('Pre-authorized debit already on file');
    expect(item.overridden_by).not.toBeNull();
    expect(item.overridden_at).not.toBeNull();
  });

  it('completing the rest opens the gate, and the deal delivers', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { readiness } = await getChecklist();
    for (const code of readiness.outstanding) await tick(code);

    const after = await getChecklist();
    expect(after.readiness.ready_for_delivery).toBe(true);
    expect(after.readiness.hard_blocked).toBe(false);

    const delivered = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
      payload: { pipeline_stage: 'delivered' },
    });
    expect(delivered.statusCode).toBe(200);
    expect((JSON.parse(delivered.body) as { delivered_at: string | null }).delivered_at).not.toBeNull();
  });

  /**
   * The defects an adversarial review found in the first cut of F-08. Each of
   * these passed a 422 test that only worked because an earlier test happened
   * to open the checklist first — a gate that exists only once you look at it
   * is not a gate. These tests use their OWN fresh deal so they cannot be
   * rescued by test ordering.
   */
  describe('the gate cannot be walked around', () => {
    async function freshDeal() {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
        payload: {
          organization_id: orgId, store_id: storeId, province: 'QC',
          sale_price_cents: 2_000_000, vehicle_cost_cents: 1_800_000, interest_rate_bps: 599, term_months: 60,
        },
      });
      return (JSON.parse(res.body) as { id: string }).id;
    }

    it('a deal nobody has opened the checklist on still cannot deliver', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const res = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie: cookieOwner },
        payload: { pipeline_stage: 'delivered' },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('checklist_incomplete');
    });

    it('"complete" — the stage AFTER delivered — is gated too', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const res = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie: cookieOwner },
        payload: { pipeline_stage: 'complete' },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('checklist_incomplete');
    });

    it('a salesperson cannot sign off the safety inspection by ticking it', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const res = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/safety`, headers: { cookie: sellerCookie },
        payload: { completed: true },
      });
      // Otherwise "cannot be waived" would just mean "use the other field".
      expect(res.statusCode).toBe(403);
    });

    it('a salesperson cannot erase a manager’s recorded waiver', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const waived = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: cookieOwner },
        payload: { overridden: true, override_reason: 'Proof received by email' },
      });
      expect(waived.statusCode).toBe(200);

      const erase = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: sellerCookie },
        payload: { overridden: false },
      });
      expect(erase.statusCode).toBe(403);

      const still = await app!.inject({
        method: 'GET', url: `/api/v1/deals/${id}/checklist`, headers: { cookie: cookieOwner },
      });
      const item = ChecklistResponse.parse(JSON.parse(still.body)).items.find((i) => i.code === 'insurance')!;
      expect(item.override_reason).toBe('Proof received by email');
    });

    it('an unknown checklist code is simply not a thing (404, no SQL reaches it)', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const res = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/active%20%3D%20false`,
        headers: { cookie: cookieOwner }, payload: { completed: true },
      });
      expect(res.statusCode).toBe(404);
    });

    it('a delivered deal’s checklist is frozen — the proof cannot be erased', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const list = await app!.inject({ method: 'GET', url: `/api/v1/deals/${id}/checklist`, headers: { cookie: cookieOwner } });
      for (const code of ChecklistResponse.parse(JSON.parse(list.body)).readiness.outstanding) {
        await app!.inject({
          method: 'PATCH', url: `/api/v1/deals/${id}/checklist/${code}`, headers: { cookie: cookieOwner },
          payload: { completed: true },
        });
      }
      const delivered = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie: cookieOwner },
        payload: { pipeline_stage: 'delivered' },
      });
      expect(delivered.statusCode).toBe(200);

      // Without this, a delivered deal could be stripped of every tick and then
      // walked on to 'complete' — the gate already passed, and no history exists.
      const untick = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: cookieOwner },
        payload: { completed: false },
      });
      expect(untick.statusCode).toBe(409);
      expect(JSON.parse(untick.body).error.code).toBe('deal_delivered');
    });

    it('walking a delivered deal BACK a stage does not unlock its evidence', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const list = await app!.inject({ method: 'GET', url: `/api/v1/deals/${id}/checklist`, headers: { cookie: cookieOwner } });
      for (const code of ChecklistResponse.parse(JSON.parse(list.body)).readiness.outstanding) {
        await app!.inject({
          method: 'PATCH', url: `/api/v1/deals/${id}/checklist/${code}`, headers: { cookie: cookieOwner },
          payload: { completed: true },
        });
      }
      await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie: cookieOwner },
        payload: { pipeline_stage: 'delivered' },
      });

      // Stage moves are unrestricted, so freezing on the CURRENT stage would let
      // anyone step back, strip the ticks, and step forward again — the gate
      // would still be satisfied and the proof would be gone. The freeze keys on
      // delivered_at, so stepping back changes nothing.
      const back = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie: cookieOwner },
        payload: { pipeline_stage: 'scheduled' },
      });
      expect(back.statusCode).toBe(200);

      const strip = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: sellerCookie },
        payload: { completed: false },
      });
      expect(strip.statusCode).toBe(409);
      expect(JSON.parse(strip.body).error.code).toBe('deal_delivered');
    });

    it('a reason with no waiver, and an empty body, are both refused', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      const orphanReason = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: cookieOwner },
        payload: { override_reason: 'Looks fine to me' },
      });
      // Previously accepted, silently dropped, and answered 200.
      expect(orphanReason.statusCode).toBe(422);

      const empty = await app!.inject({
        method: 'PATCH', url: `/api/v1/deals/${id}/checklist/insurance`, headers: { cookie: cookieOwner },
        payload: {},
      });
      expect(empty.statusCode).toBe(422);
    });

    it('a template edited after the deal exists does not touch that deal', async (ctx) => {
      if (!dbUp) return ctx.skip();
      const id = await freshDeal();
      // The snapshot is taken when the deal is created, not when someone first
      // looks at it — so this edit lands after the deal already owns its copy.
      const off = await app!.inject({
        method: 'PATCH', url: `/api/v1/stores/${storeId}/checklist-template/registration`,
        headers: { cookie: cookieOwner }, payload: { active: false },
      });
      expect(off.statusCode).toBe(200);

      const res = await app!.inject({ method: 'GET', url: `/api/v1/deals/${id}/checklist`, headers: { cookie: cookieOwner } });
      const { items } = ChecklistResponse.parse(JSON.parse(res.body));
      expect(items.map((i) => i.code)).toContain('registration');

      // A deal created from now on does not carry it.
      const later = await freshDeal();
      const laterRes = await app!.inject({ method: 'GET', url: `/api/v1/deals/${later}/checklist`, headers: { cookie: cookieOwner } });
      expect(ChecklistResponse.parse(JSON.parse(laterRes.body)).items.map((i) => i.code)).not.toContain('registration');
    });
  });

  it('a store can switch an item off — but never the safety inspection', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${storeId}/checklist-template/drivers_booked`,
      headers: { cookie: cookieOwner }, payload: { required: false },
    });
    expect(off.statusCode).toBe(200);

    const safety = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${storeId}/checklist-template/safety`,
      headers: { cookie: cookieOwner }, payload: { required: false },
    });
    expect(safety.statusCode).toBe(422);
    expect(JSON.parse(safety.body).error.code).toBe('hard_block');
  });

  it('policy changes never rewrite a deal already in flight', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // 'drivers_booked' was just switched off at the store, but this deal was
    // created under the old policy and keeps its own snapshot.
    const { items } = await getChecklist();
    const item = items.find((i) => i.code === 'drivers_booked')!;
    expect(item.required).toBe(true);
  });
});
