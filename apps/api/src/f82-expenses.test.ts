import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { EXPENSE_STATUSES, Member, VehicleExpense, VehicleExpensesResult, type DeskingInputsT, type ExpenseStatusT } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import { computeOutputs, INPUT_COLUMNS } from './deal-outputs.js';
import { sha256, type StorageDriver, type StoredObject } from './storage.js';

/**
 * F-82 — the vehicle expenses ledger (expenses-accounting.md §1–§5, §7, §8;
 * D-084).
 *
 * Every persona call goes through the HTTP app as the APP role. Fixtures are
 * built through the API (cars through POST /vehicles, soft-deletes through
 * DELETE /vehicles/:id, overrides through PUT /permissions/user); the admin
 * pool is a read ORACLE only (the deals/commissions/vehicles rows the fence
 * snapshots, the receipt's storage key for the tamper case, the whole trail
 * for the no-money oracle). Every blocked-behaviour test builds its OWN row —
 * a shared row lets a gate pass on data an earlier test created.
 *
 * Personas: owner; gmA (gm, store-A membership); gmB (gm, store-B); ucm
 * (used_car_manager, org-wide — defaults to expense:approve); sm
 * (sales_manager — vehicle:update, no expense:approve, no read_costs: the
 * masked WRITER and the no-verb approver); sp (salesperson); bdc (bdc_agent);
 * a rival org. Cars: VA (store A, the 2 765 000 triplet), VB (store B).
 *
 * T-X6 is the tenant-isolation proof rls-coverage cites; the schema-level
 * CHECK/FK probes live in packages/db/src/migration-0075-expenses.test.ts.
 * T-F1..T-F3 are the behavioural money fence (D-082 (4)'s shape applied to a
 * car); f82-money-fence.test.ts is its static twin.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

/** In-memory driver (f13c's): the routes are the subject, not the filesystem. */
class MemoryStorage implements StorageDriver {
  readonly kind = 'local' as const;
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<StoredObject> {
    this.objects.set(key, body);
    return { key, sha256: sha256(body), bytes: body.byteLength };
  }
  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw new Error(`no object at ${key}`);
    return found;
  }
}
const storage = new MemoryStorage();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('the first scan of the invoice')]);
const PNG2 = Buffer.concat([PNG_SIGNATURE, Buffer.from('a clearer second scan of the same invoice')]);
const PDF = Buffer.from('%PDF-1.7\nfacture LAE-1042\n%%EOF\n');

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let ownerCookie = '';
let gmACookie = '';
let gmBCookie = '';
let ucmCookie = '';
let ucmId = '';
let smCookie = '';
let spCookie = '';
let spId = '';
let bdcCookie = '';
let orgId = '';
let storeA = '';
let storeB = '';
let VA = '';
let VB = '';
let rivalOwnerCookie = '';
let rivalOrgId = '';
let rivalStoreId = '';
let rivalVehicle = '';

type Exp = Record<string, unknown> & { id: string; vehicle_id: string; store_id: string; status: string };
type Listing = { items: Exp[]; summary?: { approved_cents: number; pending_cents: number } };
interface ErrorBody { error: { code: string; details?: { path?: string; code: string; message: string }[] } }
interface EventRow {
  id: string; entity_type: string; entity_id: string; action: string;
  changes: Record<string, unknown>; parent_entity_type: string | null; parent_entity_id: string | null;
}

const MONEY_FIELDS = ['amount_cents', 'tax_cents', 'total_cents', 'receipt_content_sha256', 'receipt_content_type', 'receipt_size_bytes'] as const;
const TRIPLET = { acquisition_cost_cents: 2_600_000, transport_cost_cents: 50_000, recon_cost_cents: 115_000 };
const E1 = { category: 'detail', vendor_name: 'Lave-Auto Express', amount_cents: 34_000, tax_cents: 5_092, invoice_number: 'LAE-1042', expense_date: '2026-08-15', description: 'Lavage complet' };

const errorOf = (body: string) => JSON.parse(body) as ErrorBody;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function signUp(email: string, name: string): Promise<{ cookie: string; userId: string }> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode).toBe(200);
  const cookie = cookiesOf(res);
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  return { cookie, userId: (JSON.parse(me.body) as { user: { id: string } }).user.id };
}

async function addMember(
  adderCookie: string, org: string, email: string, name: string, roles: string[], store: string | null = null,
): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, name);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: adderCookie },
    payload: { organization_id: org, email, name, roles, ...(store === null ? {} : { store_id: store }) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie, userId: Member.parse(JSON.parse(res.body)).user_id };
}

let stock = 0;
async function makeVehicle(store: string, extra: Record<string, unknown> = {}, cookie = ownerCookie, org = orgId): Promise<string> {
  stock += 1;
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
    payload: {
      organization_id: org, store_id: store, stock_number: `F82-${run}-${stock}`, year: 2024, make: 'Kia', model: 'Sportage',
      acquisition_type: 'trade_in', acquisition_date: '2026-07-01', ...TRIPLET, ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}
async function getVehicle(id: string, cookie = ownerCookie): Promise<Record<string, unknown>> {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/vehicles/${id}`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Record<string, unknown>;
}
/** The product's own door — never admin SQL for a state the product can reach. */
async function softDelete(vehicleId: string): Promise<void> {
  const res = await app!.inject({ method: 'DELETE', url: `/api/v1/vehicles/${vehicleId}`, headers: { cookie: ownerCookie } });
  expect(res.statusCode, res.body).toBe(204);
}

async function log(vehicleId: string, body: Record<string, unknown>, cookie = ucmCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/vehicles/${vehicleId}/expenses`, headers: { cookie }, payload: body });
}
async function logOk(vehicleId: string, body: Record<string, unknown> = E1, cookie = ucmCookie): Promise<Exp> {
  const res = await log(vehicleId, body, cookie);
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as Exp;
}
async function patchExp(id: string, body: Record<string, unknown>, cookie = ownerCookie) {
  return app!.inject({ method: 'PATCH', url: `/api/v1/expenses/${id}`, headers: { cookie }, payload: body });
}
async function patchOk(id: string, body: Record<string, unknown>, cookie = ownerCookie): Promise<Exp> {
  const res = await patchExp(id, body, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Exp;
}
async function listRaw(vehicleId: string, cookie = ownerCookie) {
  return app!.inject({ method: 'GET', url: `/api/v1/vehicles/${vehicleId}/expenses`, headers: { cookie } });
}
async function list(vehicleId: string, cookie = ownerCookie): Promise<Listing> {
  const res = await listRaw(vehicleId, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Listing;
}
async function upload(id: string, body: Buffer, contentType = 'image/png', cookie = ucmCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/expenses/${id}/receipt`, headers: { cookie, 'content-type': contentType }, payload: body });
}
async function download(id: string, cookie = ownerCookie) {
  return app!.inject({ method: 'GET', url: `/api/v1/expenses/${id}/receipt`, headers: { cookie } });
}
/** A fresh row driven to `status` along the legal path, by the owner. */
async function rowAt(status: ExpenseStatusT, vehicleId = VA): Promise<Exp> {
  const row = await logOk(vehicleId);
  if (status === 'pending') return row;
  if (status === 'paid') {
    await patchOk(row.id, { status: 'approved' });
    return patchOk(row.id, { status: 'paid' });
  }
  return patchOk(row.id, { status });
}
async function eventsOf(entityId: string): Promise<EventRow[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&entity_id=${entityId}&limit=100`,
    headers: { cookie: ownerCookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: EventRow[] }).items;
}
const updatedEvents = (events: EventRow[]) => events.filter((e) => e.entity_type === 'vehicle_expense' && e.action === 'updated');

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
  appPool = createPool({ connectionString: APP_URL, max: 2 });
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { storage }));

  ({ cookie: ownerCookie } = await signUp(`f82-owner-${run}@dealpilot.test`, 'Olivia Owner'));
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Dépenses', slug: `groupe-depenses-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = async (name: string, code: string, cookie = ownerCookie, org = orgId) => {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: org, name, code, province: 'QC' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  };
  storeA = await store('Dépenses Kia', 'F82-A');
  storeB = await store('Dépenses Hyundai', 'F82-B');

  ({ cookie: gmACookie } = await addMember(ownerCookie, orgId, `f82-gma-${run}@dealpilot.test`, 'Gaston Gérant', ['gm'], storeA));
  ({ cookie: gmBCookie } = await addMember(ownerCookie, orgId, `f82-gmb-${run}@dealpilot.test`, 'Gilberte Gérante', ['gm'], storeB));
  ({ cookie: ucmCookie, userId: ucmId } = await addMember(ownerCookie, orgId, `f82-ucm-${run}@dealpilot.test`, 'Ulysse Usagé', ['used_car_manager']));
  ({ cookie: smCookie } = await addMember(ownerCookie, orgId, `f82-sm-${run}@dealpilot.test`, 'Simone Ventes', ['sales_manager']));
  ({ cookie: spCookie, userId: spId } = await addMember(ownerCookie, orgId, `f82-sp-${run}@dealpilot.test`, 'Vicky Vendeuse', ['salesperson']));
  ({ cookie: bdcCookie } = await addMember(ownerCookie, orgId, `f82-bdc-${run}@dealpilot.test`, 'Benoît BDC', ['bdc_agent']));

  VA = await makeVehicle(storeA);
  VB = await makeVehicle(storeB);

  ({ cookie: rivalOwnerCookie } = await signUp(`f82-rival-${run}@dealpilot.test`, 'Rita Rivale'));
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalOwnerCookie },
    payload: { name: 'Groupe Rival', slug: `groupe-rival-f82-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  rivalStoreId = await store('Rival Kia', 'F82-RIV', rivalOwnerCookie, rivalOrgId);
  rivalVehicle = await makeVehicle(rivalStoreId, {}, rivalOwnerCookie, rivalOrgId);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('T-X1 — log', () => {
  it('ucm POSTs every CreateExpenseInput key → 201, born pending, every key echoes, total = amount + tax', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await log(VA, E1);
    expect(res.statusCode, res.body).toBe(201);
    const row = VehicleExpense.parse(JSON.parse(res.body));
    expect(row).toMatchObject({
      ...E1, organization_id: orgId, store_id: storeA, vehicle_id: VA, status: 'pending', total_cents: 39_092,
      receipt_content_sha256: null, receipt_content_type: null, receipt_size_bytes: null,
    });
    expect(row.expense_date).toBe('2026-08-15');
    expect('receipt_storage_key' in row).toBe(false);
  });

  it('tax_cents omitted → 0; invoice and description omitted → null', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await logOk(VA, { category: 'parts', vendor_name: 'Pièces Kia Laval', amount_cents: 12_000, expense_date: '2026-08-16' });
    expect(row).toMatchObject({ tax_cents: 0, total_cents: 12_000, invoice_number: null, description: null });
  });

  it('sm (vehicle:update, no read_costs) logs → 201 with amount/tax/total/receipt_* ABSENT — the masked writer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await log(VA, E1, smCookie);
    expect(res.statusCode, res.body).toBe(201);
    const row = JSON.parse(res.body) as Exp;
    for (const f of MONEY_FIELDS) expect(f in row, f).toBe(false);
    expect(row).toMatchObject({ status: 'pending', vendor_name: 'Lave-Auto Express', category: 'detail' });
    // …and the row itself is whole: the owner reads the number the writer typed blind.
    expect((await list(VA)).items.find((r) => r.id === row.id)).toMatchObject({ amount_cents: 34_000, total_cents: 39_092 });
  });

  it('sp and bdc (no vehicle:update) → 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const cookie of [spCookie, bdcCookie]) {
      const res = await log(VA, E1, cookie);
      expect(res.statusCode, res.body).toBe(403);
      expect(errorOf(res.body).error.code).toBe('forbidden');
    }
  });

  it('bodies carrying total_cents / status / deal_id / amount → 422; a missing expense_date → 422', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const extra of [{ total_cents: 1 }, { status: 'approved' }, { deal_id: VA }, { amount: 340 }]) {
      const res = await log(VA, { ...E1, ...extra });
      expect(res.statusCode, `${JSON.stringify(extra)}: ${res.body}`).toBe(422);
      expect(errorOf(res.body).error.code).toBe('validation_failed');
    }
    const { expense_date: _omitted, ...noDate } = E1;
    void _omitted;
    const res = await log(VA, noDate);
    expect(res.statusCode, res.body).toBe(422);
    expect(errorOf(res.body).error.details?.[0]?.path).toBe('expense_date');
  });

  it('POST on a soft-deleted vehicle → 404 (liveVehicle); POST on a rival vehicle → 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const gone = await makeVehicle(storeA);
    await softDelete(gone);
    expect((await log(gone, E1)).statusCode).toBe(404);
    expect((await log(rivalVehicle, E1)).statusCode).toBe(404);
  });
});

describe('T-X2 — the ladder on FRESH rows (25 cells) and its gates', () => {
  const LEGAL: Record<ExpenseStatusT, readonly ExpenseStatusT[]> = {
    pending: ['approved', 'rejected', 'void'], approved: ['paid', 'void'], paid: ['void'], rejected: [], void: [],
  };

  it('6 legal pairs → 200 + an updated event {status:{from,to}}; 5 same-status → 200 and NO event; 14 illegal → 422 invalid_transition "<prior> → <next>"', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cells = { legal: 0, same: 0, illegal: 0 };
    for (const prior of EXPENSE_STATUSES) {
      for (const next of EXPENSE_STATUSES) {
        const row = await rowAt(prior);
        const before = updatedEvents(await eventsOf(row.id)).length;
        const res = await patchExp(row.id, { status: next }, gmACookie);
        const label = `${prior} → ${next}: ${res.body}`;
        if (prior === next) {
          expect(res.statusCode, label).toBe(200);
          expect((JSON.parse(res.body) as Exp).status).toBe(prior);
          expect(updatedEvents(await eventsOf(row.id)).length, label).toBe(before);
          cells.same += 1;
        } else if (LEGAL[prior].includes(next)) {
          expect(res.statusCode, label).toBe(200);
          expect((JSON.parse(res.body) as Exp).status).toBe(next);
          const after = updatedEvents(await eventsOf(row.id));
          expect(after.length, label).toBe(before + 1);
          expect(after[0]!.changes).toEqual({ status: { from: prior, to: next } });
          cells.legal += 1;
        } else {
          expect(res.statusCode, label).toBe(422);
          expect(errorOf(res.body).error.code).toBe('invalid_transition');
          expect(errorOf(res.body).error.details).toEqual([{ path: 'status', code: 'invalid_transition', message: `${prior} → ${next}` }]);
          expect(updatedEvents(await eventsOf(row.id)).length, label).toBe(before);
          cells.illegal += 1;
        }
      }
    }
    expect(cells).toEqual({ legal: 6, same: 5, illegal: 14 });
  });

  it('sm (no expense:approve): approve → 403; {status:"pending"} on a pending row → 403 (the verb gates ANY status key); pending → void → 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = await rowAt('pending');
    const approve = await patchExp(a.id, { status: 'approved' }, smCookie);
    expect(approve.statusCode, approve.body).toBe(403);
    expect(errorOf(approve.body).error.details?.[0]).toMatchObject({ code: 'forbidden', message: 'expense:approve' });
    const same = await patchExp(a.id, { status: 'pending' }, smCookie);
    expect(same.statusCode, same.body).toBe(403);
    const b = await rowAt('pending');
    expect((await patchExp(b.id, { status: 'void' }, smCookie)).statusCode).toBe(403);
    expect((await list(VA)).items.find((r) => r.id === b.id)!.status).toBe('pending');
  });

  it('ucm (defaults to expense:approve) approves → 200; the owner walks every legal move', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    expect((await patchOk(row.id, { status: 'approved' }, ucmCookie)).status).toBe('approved');
    expect((await patchOk(row.id, { status: 'paid' }, ownerCookie)).status).toBe('paid');
    expect((await patchOk(row.id, { status: 'void' }, ownerCookie)).status).toBe('void');
  });

  it('T-X2c: gmB (store B) approving a store-A expense → 403 forbidden with detail {store_id, cost_masked}', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending', VA);
    const res = await patchExp(row.id, { status: 'approved' }, gmBCookie);
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res.body).error.code).toBe('forbidden');
    expect(errorOf(res.body).error.details).toEqual([{ path: 'store_id', code: 'cost_masked', message: storeA }]);
    // Positive control: the same GM approves their OWN store's line.
    const own = await rowAt('pending', VB);
    expect((await patchOk(own.id, { status: 'approved' }, gmBCookie)).status).toBe('approved');
  });

  it('PATCH on an expense whose vehicle was soft-deleted → 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    const row = await rowAt('pending', car);
    await softDelete(car);
    expect((await patchExp(row.id, { status: 'approved' })).statusCode).toBe(404);
    expect((await patchExp(row.id, { vendor_name: 'x' })).statusCode).toBe(404);
  });
});

describe('T-X3 — field edits while pending', () => {
  it('each of the five fields edits on a pending row → 200 + an updated diff over exactly the changed keys', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    const edits: [string, unknown, unknown][] = [
      ['category', 'detail', 'sublet'],
      ['vendor_name', 'Lave-Auto Express', 'Esthétique Rive-Nord'],
      ['invoice_number', 'LAE-1042', 'ERN-77'],
      ['expense_date', '2026-08-15', '2026-08-20'],
      ['description', 'Lavage complet', 'Lavage et cirage'],
    ];
    for (const [key, from, to] of edits) {
      const before = updatedEvents(await eventsOf(row.id)).length;
      const after = await patchOk(row.id, { [key]: to }, ucmCookie);
      expect(after[key], key).toBe(to);
      expect(after.status).toBe('pending');
      const events = updatedEvents(await eventsOf(row.id));
      expect(events.length, key).toBe(before + 1);
      expect(events[0]!.changes, key).toEqual({ [key]: { from, to } });
    }
    // Nullable optionals clear visibly.
    const cleared = await patchOk(row.id, { invoice_number: null, description: null }, ucmCookie);
    expect(cleared).toMatchObject({ invoice_number: null, description: null });
    expect(updatedEvents(await eventsOf(row.id))[0]!.changes).toEqual({
      invoice_number: { from: 'ERN-77', to: null }, description: { from: 'Lavage et cirage', to: null },
    });
  });

  it('a field edit on approved / paid / rejected / void → 422 expense_not_pending with the prior status', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const status of ['approved', 'paid', 'rejected', 'void'] as const) {
      const row = await rowAt(status);
      const res = await patchExp(row.id, { vendor_name: 'Trop tard' }, ownerCookie);
      expect(res.statusCode, `${status}: ${res.body}`).toBe(422);
      expect(errorOf(res.body).error.code).toBe('expense_not_pending');
      expect(errorOf(res.body).error.details).toEqual([{ path: 'status', code: 'expense_not_pending', message: status }]);
      expect((await list(VA)).items.find((r) => r.id === row.id)!.vendor_name).toBe('Lave-Auto Express');
    }
  });

  it('{} → 422; amount_cents / tax_cents in the body → 422 (strict — money is INSERT-only); sp field edit → 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    expect((await patchExp(row.id, {})).statusCode).toBe(422);
    for (const body of [{ amount_cents: 1 }, { tax_cents: 1 }, { vendor_name: 'x', amount_cents: 1 }, { total_cents: 1 }, { receipt_content_sha256: 'a'.repeat(64) }]) {
      const res = await patchExp(row.id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(errorOf(res.body).error.code).toBe('validation_failed');
    }
    expect((await patchExp(row.id, { vendor_name: 'x' }, spCookie)).statusCode).toBe(403);
    expect((await list(VA)).items.find((r) => r.id === row.id)).toMatchObject({ vendor_name: 'Lave-Auto Express', amount_cents: 34_000 });
  });

  it('a mixed body (field + status) runs both gates in order: sm → 403 on the verb; ucm → 200 with both applied in one event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    const refused = await patchExp(row.id, { vendor_name: 'Mixte', status: 'approved' }, smCookie);
    expect(refused.statusCode, refused.body).toBe(403);
    expect(errorOf(refused.body).error.details?.[0]?.message).toBe('expense:approve');
    const after = await patchOk(row.id, { vendor_name: 'Mixte', status: 'approved' }, ucmCookie);
    expect(after).toMatchObject({ vendor_name: 'Mixte', status: 'approved' });
    expect(updatedEvents(await eventsOf(row.id))[0]!.changes).toEqual({
      vendor_name: { from: 'Lave-Auto Express', to: 'Mixte' }, status: { from: 'pending', to: 'approved' },
    });
    // Once approved, the same mixed body is refused on the FIELD (state), not the verb.
    const late = await patchExp(row.id, { vendor_name: 'Encore', status: 'paid' }, ucmCookie);
    expect(late.statusCode, late.body).toBe(422);
    expect(errorOf(late.body).error.code).toBe('expense_not_pending');
  });
});

describe('T-X4 — the sums, with a positive case', () => {
  it('approved + paid feed approved_cents; pending feeds pending_cents; rejected and void move neither (49 092 before and after)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    expect((await list(car)).summary).toEqual({ approved_cents: 0, pending_cents: 0 });
    await rowAt('approved', car);                                                        // E1: 34 000 + 5 092
    const e2 = await logOk(car, { ...E1, amount_cents: 10_000, tax_cents: 0 });         // E2: 10 000, paid
    await patchOk(e2.id, { status: 'approved' });
    await patchOk(e2.id, { status: 'paid' });
    expect((await list(car)).summary).toEqual({ approved_cents: 49_092, pending_cents: 0 });
    await logOk(car, { ...E1, amount_cents: 5_000, tax_cents: 0 });                     // E3: pending
    expect((await list(car)).summary).toEqual({ approved_cents: 49_092, pending_cents: 5_000 });
    const e4 = await logOk(car, { ...E1, amount_cents: 70_000, tax_cents: 0 });
    await patchOk(e4.id, { status: 'rejected' });
    const e5 = await logOk(car, { ...E1, amount_cents: 80_000, tax_cents: 0 });
    await patchOk(e5.id, { status: 'void' });
    expect((await list(car)).summary).toEqual({ approved_cents: 49_092, pending_cents: 5_000 });
    expect((await list(car)).items).toHaveLength(5);
  });

  it('T-X4b the five-row walk: 110/210/310/410/510 → {320, 310}; void #2 → {110, 310}; approve #3 → {420, 0}', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    const rows: Exp[] = [];
    for (const amount of [100, 200, 300, 400, 500]) {
      rows.push(await logOk(car, { category: 'other', vendor_name: `Ligne ${amount}`, amount_cents: amount, tax_cents: 10, expense_date: '2026-08-01' }));
    }
    await patchOk(rows[0]!.id, { status: 'approved' });
    await patchOk(rows[1]!.id, { status: 'approved' });
    await patchOk(rows[1]!.id, { status: 'paid' });
    await patchOk(rows[3]!.id, { status: 'rejected' });
    await patchOk(rows[4]!.id, { status: 'void' });
    expect((await list(car)).summary).toEqual({ approved_cents: 320, pending_cents: 310 });
    await patchOk(rows[1]!.id, { status: 'void' });
    expect((await list(car)).summary).toEqual({ approved_cents: 110, pending_cents: 310 });
    await patchOk(rows[2]!.id, { status: 'approved' });
    expect((await list(car)).summary).toEqual({ approved_cents: 420, pending_cents: 0 });
  });
});

describe('T-X5 — masking: absent, never null, never {0, 0}', () => {
  it('sp lists rows with no money key and no summary; gmB on VA likewise; owner and gmA see money and summary', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('approved');
    for (const [who, cookie] of [['sp', spCookie], ['gmB', gmBCookie], ['bdc', bdcCookie]] as const) {
      const body = await list(VA, cookie);
      expect(body.items.length, who).toBeGreaterThan(0);
      expect('summary' in body, who).toBe(false);
      for (const r of body.items) for (const f of MONEY_FIELDS) expect(f in r, `${who}: ${f}`).toBe(false);
      expect(body.items.find((r) => r.id === row.id), who).toMatchObject({ status: 'approved', vendor_name: 'Lave-Auto Express', expense_date: '2026-08-15' });
    }
    for (const [who, cookie] of [['owner', ownerCookie], ['gmA', gmACookie], ['ucm', ucmCookie]] as const) {
      const body = VehicleExpensesResult.parse(await list(VA, cookie));
      expect(body.summary, who).toBeDefined();
      expect(body.summary!.approved_cents).toBeGreaterThanOrEqual(39_092);
      expect(body.items.find((r) => r.id === row.id), who).toMatchObject({ amount_cents: 34_000, tax_cents: 5_092, total_cents: 39_092 });
    }
  });

  it('a GRANTED viewer of a zero-expense car reads summary {0, 0} — a real zero, not a masked absence', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    expect(await list(car, gmACookie)).toEqual({ items: [], summary: { approved_cents: 0, pending_cents: 0 } });
    expect(await list(car, spCookie)).toEqual({ items: [] });
  });

  it('the receipt is the amount: sp and gmB GET a store-A receipt → 404; owner → 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('approved');
    expect((await upload(row.id, PNG)).statusCode).toBe(201);
    expect((await download(row.id, spCookie)).statusCode).toBe(404);
    expect((await download(row.id, gmBCookie)).statusCode).toBe(404);
    expect((await download(row.id, ownerCookie)).statusCode).toBe(200);
  });
});

describe('T-X6 — cross-tenant, as the APP role (the rls-coverage behavioural citation)', () => {
  it("a rival owner's GET/POST on our vehicle → 404; a rival's PATCH / receipt POST / receipt GET on our expense → 404", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('approved');
    expect((await listRaw(VA, rivalOwnerCookie)).statusCode).toBe(404);
    expect((await log(VA, E1, rivalOwnerCookie)).statusCode).toBe(404);
    expect((await patchExp(row.id, { status: 'paid' }, rivalOwnerCookie)).statusCode).toBe(404);
    expect((await upload(row.id, PNG, 'image/png', rivalOwnerCookie)).statusCode).toBe(404);
    expect((await download(row.id, rivalOwnerCookie)).statusCode).toBe(404);
    expect((await list(VA)).items.find((r) => r.id === row.id)).toMatchObject({ status: 'approved', receipt_content_sha256: null });
    // The POLICY itself, as the app role under the RIVAL tenant: the row is
    // invisible to a SELECT and untouchable by an UPDATE. Wave 4's M31
    // (USING (true) / WITH CHECK (true)) left every route 404 above GREEN —
    // the vehicles policy (liveVehicle) and the cost view were fencing the
    // rival, not this table's policy — so the policy is probed directly.
    const asRival = (sql: string, params: unknown[]) => withTenant(appPool, rivalOrgId, (c) => c.query(sql, params));
    expect((await asRival('SELECT id FROM vehicle_expenses WHERE id = $1', [row.id])).rows).toEqual([]);
    expect((await asRival("UPDATE vehicle_expenses SET description = 'rival' WHERE id = $1", [row.id])).rowCount).toBe(0);
    // Positive control: under OUR tenant the same SELECT sees the row.
    expect((await withTenant(appPool, orgId, (c) => c.query('SELECT id FROM vehicle_expenses WHERE id = $1', [row.id]))).rows).toHaveLength(1);
    expect((await list(VA)).items.find((r) => r.id === row.id)).toMatchObject({ description: E1.description });
    // Our POST naming the rival's vehicle is the same 404 (vehicleOrg).
    expect((await log(rivalVehicle, E1, ownerCookie)).statusCode).toBe(404);
  });

  it('as the app role, a mismatched (organization_id, vehicle_id | store_id) is refused by the composite FK with 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const insert = (vehicleId: string, store: string) =>
      withTenant(appPool, orgId, (c) => c.query(
        `INSERT INTO vehicle_expenses (organization_id, store_id, vehicle_id, category, vendor_name, amount_cents, expense_date)
         VALUES ($1, $2, $3, 'other', 'Probe', 100, '2026-08-01')`,
        [orgId, store, vehicleId],
      ));
    await expect(insert(rivalVehicle, storeA)).rejects.toMatchObject({ code: '23503' });
    await expect(insert(VA, rivalStoreId)).rejects.toMatchObject({ code: '23503' });
    // Positive control: the same-org pair is accepted by the same statement.
    const car = await makeVehicle(storeA);
    await insert(car, storeA);
    expect((await list(car)).items).toHaveLength(1);
  });

  it('the list GET on a soft-deleted vehicle → 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    await rowAt('pending', car);
    await softDelete(car);
    expect((await listRaw(car)).statusCode).toBe(404);
  });
});

describe('T-X7 — receipts on the storage driver', () => {
  const receiptKeyOf = async (id: string) =>
    (await admin.query<{ k: string | null }>(`SELECT receipt_storage_key AS k FROM vehicle_expenses WHERE id = $1`, [id])).rows[0]!.k;

  it('PNG upload → 201 with the sha256, size and type; the download returns the bytes with the content-type; the event carries the hash', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    const res = await upload(row.id, PNG);
    expect(res.statusCode, res.body).toBe(201);
    const after = VehicleExpense.parse(JSON.parse(res.body));
    expect(after).toMatchObject({ receipt_content_sha256: sha256(PNG), receipt_size_bytes: PNG.byteLength, receipt_content_type: 'image/png' });
    expect('receipt_storage_key' in after).toBe(false);
    const back = await download(row.id);
    expect(back.statusCode).toBe(200);
    expect(back.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(back.rawPayload, PNG)).toBe(0);
    const ev = updatedEvents(await eventsOf(row.id))[0]!;
    expect(ev.changes).toEqual({ receipt_content_sha256: { from: null, to: sha256(PNG) }, receipt_size_bytes: PNG.byteLength });
    // A PDF is the other paper a dealership scans.
    const pdfRow = await rowAt('pending');
    const pdf = await upload(pdfRow.id, PDF, 'application/pdf');
    expect(pdf.statusCode, pdf.body).toBe(201);
    expect((await download(pdfRow.id)).headers['content-type']).toBe('application/pdf');
  });

  it('a tampered stored object → 409 content_mismatch (the recheck is the whole difference between stored and verifiable)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('approved');
    expect((await upload(row.id, PNG)).statusCode).toBe(201);
    const key = (await receiptKeyOf(row.id))!;
    expect(storage.objects.has(key)).toBe(true);
    storage.objects.set(key, Buffer.concat([PNG_SIGNATURE, Buffer.from('something else entirely')]));
    const back = await download(row.id);
    expect(back.statusCode).toBe(409);
    expect(errorOf(back.body).error.code).toBe('content_mismatch');
  });

  it('a re-upload replaces the pointer with the new hash and the OLD content-addressed object survives; an identical re-upload writes no event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    expect((await upload(row.id, PNG)).statusCode).toBe(201);
    const firstKey = (await receiptKeyOf(row.id))!;
    const events1 = updatedEvents(await eventsOf(row.id)).length;
    const again = await upload(row.id, PNG);
    expect(again.statusCode).toBe(201);
    expect(updatedEvents(await eventsOf(row.id)).length).toBe(events1);
    const second = await upload(row.id, PNG2);
    expect(second.statusCode).toBe(201);
    expect((JSON.parse(second.body) as Exp)['receipt_content_sha256']).toBe(sha256(PNG2));
    const secondKey = (await receiptKeyOf(row.id))!;
    expect(secondKey).not.toBe(firstKey);
    expect(storage.objects.has(firstKey)).toBe(true);
    expect(Buffer.compare(storage.objects.get(firstKey)!, PNG)).toBe(0);
    expect(Buffer.compare((await download(row.id)).rawPayload, PNG2)).toBe(0);
    const ev = updatedEvents(await eventsOf(row.id))[0]!;
    expect(ev.changes).toEqual({ receipt_content_sha256: { from: sha256(PNG), to: sha256(PNG2) }, receipt_size_bytes: PNG2.byteLength });
  });

  it('text/plain → 415 unsupported_media_type; an empty body → 422 empty_file', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    const txt = await upload(row.id, Buffer.from('not a receipt'), 'text/plain');
    expect(txt.statusCode, txt.body).toBe(415);
    expect(errorOf(txt.body).error.code).toBe('unsupported_media_type');
    const empty = await upload(row.id, Buffer.alloc(0));
    expect(empty.statusCode, empty.body).toBe(422);
    expect(errorOf(empty.body).error.code).toBe('empty_file');
    expect((await list(VA)).items.find((r) => r.id === row.id)!['receipt_content_sha256']).toBeNull();
  });

  it('upload on rejected and on void → 422 expense_closed; on paid → 201 (invoices arrive late)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const status of ['rejected', 'void'] as const) {
      const row = await rowAt(status);
      const res = await upload(row.id, PNG);
      expect(res.statusCode, `${status}: ${res.body}`).toBe(422);
      expect(errorOf(res.body).error.code).toBe('expense_closed');
      expect(errorOf(res.body).error.details).toEqual([{ path: 'status', code: 'expense_closed', message: status }]);
    }
    const paid = await rowAt('paid');
    expect((await upload(paid.id, PNG)).statusCode).toBe(201);
  });

  it('sm uploads → 201 with the receipt fields ABSENT; sp → 403; a soft-deleted vehicle → 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    const masked = await upload(row.id, PNG, 'image/png', smCookie);
    expect(masked.statusCode, masked.body).toBe(201);
    for (const f of MONEY_FIELDS) expect(f in (JSON.parse(masked.body) as Exp), f).toBe(false);
    expect((await list(VA)).items.find((r) => r.id === row.id)!['receipt_content_sha256']).toBe(sha256(PNG));
    expect((await upload(row.id, PNG2, 'image/png', spCookie)).statusCode).toBe(403);
    const car = await makeVehicle(storeA);
    const orphan = await rowAt('pending', car);
    await softDelete(car);
    expect((await upload(orphan.id, PNG)).statusCode).toBe(404);
  });
});

describe('T-X9 — the a13 override', () => {
  it('ucm with expense:approve DENIED via PUT /permissions/user → 403 on approve; cleared → 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const override = (allowed: boolean | null) => app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, user_id: ucmId, permission: 'expense:approve', allowed, reason: 'Révision des approbations' },
    });
    const deny = await override(false);
    expect(deny.statusCode, deny.body).toBe(204);
    const row = await rowAt('pending');
    const refused = await patchExp(row.id, { status: 'approved' }, ucmCookie);
    expect(refused.statusCode, refused.body).toBe(403);
    // The override touches the verb only: ucm still logs and edits.
    expect((await patchOk(row.id, { vendor_name: 'Toujours consignable' }, ucmCookie)).vendor_name).toBe('Toujours consignable');
    const clear = await override(null);
    expect(clear.statusCode, clear.body).toBe(204);
    expect((await patchOk(row.id, { status: 'approved' }, ucmCookie)).status).toBe('approved');
  });
});

describe('T-F — the behavioural money fence', () => {
  const commissionsOf = async (dealId: string) =>
    (await admin.query(`SELECT * FROM commissions WHERE deal_id = $1 ORDER BY id`, [dealId])).rows;
  const dealRow = async (dealId: string) => {
    const r = (await admin.query<Record<string, unknown>>(`SELECT * FROM deals WHERE id = $1`, [dealId])).rows[0]!;
    const { updated_at: _u, ...rest } = r;
    void _u;
    return rest;
  };
  const triplet = async (vehicleId: string) =>
    (await admin.query(`SELECT acquisition_cost_cents, transport_cost_cents, recon_cost_cents FROM vehicles WHERE id = $1`, [vehicleId])).rows[0];
  const report = async (url: string) => {
    const res = await app!.inject({ method: 'GET', url, headers: { cookie: ownerCookie } });
    expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    return JSON.parse(res.body) as unknown;
  };
  /** Accepted assumption: f78's aging buckets and day counts are built from
   * `today` / now() (f78-gm-dashboard-routes.ts inventory + attention) — stable
   * within a day, flaky across midnight — so they are deleted recursively;
   * every money field (gross, avg_front, avg_back, units, counts) stays. */
  const CLOCK_KEYS = new Set(['over_30_days', 'aging_0_30', 'aging_31_60', 'aging_over_60', 'days_in_stage', 'days_since_delivery']);
  const stableF78 = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stableF78);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !CLOCK_KEYS.has(k)).map(([k, x]) => [k, stableF78(x)]));
    }
    return v;
  };
  const snapshot = async (dealId: string, vehicleId: string) => {
    const { updated_at: _u, ...vehicle } = await getVehicle(vehicleId);
    void _u;
    return {
      deal: await dealRow(dealId),
      commissions: await commissionsOf(dealId),
      triplet: await triplet(vehicleId),
      vehicle,
      leaderboard: await report(`/api/v1/analytics/leaderboard?organization_id=${orgId}`),
      gmDashboard: stableF78(await report(`/api/v1/reports/gm-dashboard?organization_id=${orgId}`)),
    };
  };
  const makeDeal = async (vehicleId: string, extra: Record<string, unknown> = {}) => {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: ownerCookie },
      payload: {
        organization_id: orgId, store_id: storeA, province: 'QC', deal_type: 'finance', vehicle_id: vehicleId,
        vehicle_cost_cents: 2_765_000, sale_price_cents: 3_500_000, fees_cents: 49_900, fees_taxable: false,
        fi_reserve_cents: 25_000, fi_price_cents: 100_000, fi_cost_cents: 40_000, salesperson_id: spId,
        interest_rate_bps: 499, term_months: 48, ...extra,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body) as Record<string, unknown> & { id: string };
  };
  /** The whole ladder on one car: E1 approved → paid → receipted, E2 voided,
   * E3 rejected, E4 pending 5 000, and E5 — a recon_mech line APPROVED then
   * voided (wave 4's M4 stayed green without it: a recon write keyed on the
   * recon_mech category never fired; approved → void leaves every sum as it was). */
  const walkLedger = async (vehicleId: string) => {
    const e1 = await logOk(vehicleId, E1);
    await patchOk(e1.id, { status: 'approved' });
    await patchOk(e1.id, { status: 'paid' });
    expect((await upload(e1.id, PNG)).statusCode).toBe(201);
    const e2 = await logOk(vehicleId, { ...E1, amount_cents: 20_000, tax_cents: 0 });
    await patchOk(e2.id, { status: 'void' });
    const e3 = await logOk(vehicleId, { ...E1, amount_cents: 30_000, tax_cents: 0 });
    await patchOk(e3.id, { status: 'rejected' });
    await logOk(vehicleId, { ...E1, amount_cents: 5_000, tax_cents: 0 });
    const e5 = await logOk(vehicleId, { ...E1, category: 'recon_mech', vendor_name: 'Garage Mécanique Laval', amount_cents: 10_000, tax_cents: 0 });
    await patchOk(e5.id, { status: 'approved' });
    await patchOk(e5.id, { status: 'void' });
  };

  let fundedVehicle = '';

  it('T-F1 FUNDED: a pay-planned salesperson, a funded deal with commissions — the whole ledger walk changes nothing money reads', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const plan = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, user_id: spId, commission_rate: 0.25 },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    fundedVehicle = await makeVehicle(storeA);
    expect((await getVehicle(fundedVehicle))['total_cost_cents']).toBe(2_765_000);
    const deal = await makeDeal(fundedVehicle);
    const funded = await app!.inject({ method: 'PATCH', url: `/api/v1/deals/${deal.id}`, headers: { cookie: ownerCookie }, payload: { funding_status: 'funded' } });
    expect(funded.statusCode, funded.body).toBe(200);
    const before = await snapshot(deal.id, fundedVehicle);
    expect(before.deal).toMatchObject({ funding_status: 'funded', vehicle_cost_cents: 2_765_000, fees_cents: 49_900, fi_reserve_cents: 25_000, front_gross_cents: 735_000 });
    expect(before.deal['funded_at']).toBeTruthy();
    expect(before.commissions.length).toBeGreaterThanOrEqual(1);
    expect(before.triplet).toEqual(TRIPLET);

    await walkLedger(fundedVehicle);

    expect(await snapshot(deal.id, fundedVehicle)).toEqual(before);
    expect((await getVehicle(fundedVehicle))['total_cost_cents']).toBe(2_765_000);
    expect((await list(fundedVehicle)).summary).toEqual({ approved_cents: 39_092, pending_cents: 5_000 });
  });

  it('T-F2: a NEW desk on that car after the ledger moved copies the triplet — vehicle_cost 2 765 000, front gross 735 000, never 2 804 092 / 695 908', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await getVehicle(fundedVehicle);
    expect(car['total_cost_cents']).toBe(2_765_000);
    const deal = await makeDeal(fundedVehicle, { vehicle_cost_cents: car['total_cost_cents'] });
    expect(deal['vehicle_cost_cents']).toBe(2_765_000);
    const inputs = Object.fromEntries(INPUT_COLUMNS.map((k) => [k, deal[k]])) as unknown as DeskingInputsT;
    expect(deal['front_gross_cents']).toBe(computeOutputs(inputs).front_gross_cents);
    expect(deal['front_gross_cents']).toBe(735_000);
    expect(deal['front_gross_cents']).not.toBe(695_908);
    expect(await dealRow(deal.id)).toMatchObject({ vehicle_cost_cents: 2_765_000, front_gross_cents: 735_000 });
  });

  it('T-F3 UNFUNDED twin: funding_status stays not_submitted, funded_at null, zero commissions before and after the same walk', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const car = await makeVehicle(storeA);
    const deal = await makeDeal(car);
    expect(await dealRow(deal.id)).toMatchObject({ funding_status: 'not_submitted', funded_at: null });
    expect(await commissionsOf(deal.id)).toEqual([]);
    const before = await snapshot(deal.id, car);
    await walkLedger(car);
    expect(await snapshot(deal.id, car)).toEqual(before);
    expect(await dealRow(deal.id)).toMatchObject({ funding_status: 'not_submitted', funded_at: null, vehicle_cost_cents: 2_765_000 });
    expect(await commissionsOf(deal.id)).toEqual([]);
    expect((await list(car)).summary).toEqual({ approved_cents: 39_092, pending_cents: 5_000 });
  });
});

describe('T-X8 — the trail (last: the oracle reads every event the suite wrote)', () => {
  it('created = {category, vendor_name, expense_date} exactly; approve = {status:{pending → approved}}; parent = the vehicle on every event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    await patchOk(row.id, { status: 'approved' }, gmACookie);
    const events = await eventsOf(row.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ action: 'created', entity_type: 'vehicle_expense', parent_entity_type: 'vehicle', parent_entity_id: VA });
    expect(events[1]!.changes).toEqual({ category: 'detail', vendor_name: 'Lave-Auto Express', expense_date: '2026-08-15' });
    expect(events[0]).toMatchObject({ action: 'updated', parent_entity_type: 'vehicle', parent_entity_id: VA });
    expect(events[0]!.changes).toEqual({ status: { from: 'pending', to: 'approved' } });
  });

  it("an expense_date edit lands as 'YYYY-MM-DD' on BOTH sides", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const row = await rowAt('pending');
    await patchOk(row.id, { expense_date: '2026-09-01' }, ucmCookie);
    expect(updatedEvents(await eventsOf(row.id))[0]!.changes).toEqual({ expense_date: { from: '2026-08-15', to: '2026-09-01' } });
  });

  it('the oracle: no vehicle_expense event carries amount_cents / tax_cents / total_cents; every key ⊆ the facts; every parent is the row’s vehicle', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ALLOWED = new Set(['category', 'vendor_name', 'invoice_number', 'expense_date', 'description', 'status', 'receipt_content_sha256', 'receipt_size_bytes']);
    const r = await admin.query<{ changes: Record<string, unknown>; parent_entity_type: string | null; parent_entity_id: string | null; vehicle_id: string | null }>(
      `SELECT a.changes, a.parent_entity_type, a.parent_entity_id, e.vehicle_id
       FROM activity_events a LEFT JOIN vehicle_expenses e ON e.id = a.entity_id
       WHERE a.entity_type = 'vehicle_expense'`,
    );
    // The suite must have written a real trail, or the assertions below are a 0 → 0.
    expect(r.rows.length).toBeGreaterThan(60);
    const keys = new Set<string>();
    for (const row of r.rows) {
      for (const k of Object.keys(row.changes)) keys.add(k);
      expect(row.parent_entity_type).toBe('vehicle');
      expect(row.parent_entity_id).toBe(row.vehicle_id);
    }
    for (const money of ['amount_cents', 'tax_cents', 'total_cents']) expect(keys.has(money), money).toBe(false);
    const stray = [...keys].filter((k) => !ALLOWED.has(k));
    expect(stray, `changes keys outside the facts: ${stray.join(', ')}`).toEqual([]);
    // Positive: the trail carries the ladder, the facts and the receipt hash.
    for (const k of ['status', 'category', 'vendor_name', 'expense_date', 'receipt_content_sha256']) expect(keys.has(k), k).toBe(true);
  });
});
