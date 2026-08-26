import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-54 — duplicate detection & merge (leads.md §8). Every lead here arrives
 * through the product; admin SQL appears only to (a) plant a conversation
 * child for the re-point proof and (b) create two API-untouched leads so
 * the FULL scan has something the at-arrival detection never saw.
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

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function makeLead(payload: Record<string, unknown>): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

interface Pair {
  id: string; lead_id: string; duplicate_of: string; match_type: string;
  confidence: number; status: string;
  newer: { id: string; phone: string }; older: { id: string; phone: string };
}

async function pairs(status = 'pending'): Promise<Pair[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/duplicates?organization_id=${orgId}&status=${status}&limit=50`,
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: Pair[] }).items;
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

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f54-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Patron Doublons' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Doublons', slug: `groupe-doublons-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Doublons Laval', code: 'DBLV', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('duplicate detection & merge (F-54, leads.md §8)', () => {
  let older = '';
  let newer = '';

  it('the same phone arriving twice becomes a pending pair AT arrival — newer vs older keeper, confidence 100', async (ctx) => {
    if (!dbUp) return ctx.skip();
    older = await makeLead({ first_name: 'Yvon', last_name: 'Tremblay', phone: '+15145557001' });
    newer = await makeLead({ first_name: 'Y.', last_name: 'Tremblay', phone: '+15145557001', email: 'yvon@example.com' });
    const p = await pairs();
    expect(p).toHaveLength(1);
    expect(p[0]!.lead_id).toBe(newer);
    expect(p[0]!.duplicate_of).toBe(older);
    expect(p[0]!.match_type).toBe('phone');
    expect(p[0]!.confidence).toBe(100);
    expect(p[0]!.newer.id).toBe(newer);
    expect(p[0]!.older.id).toBe(older);
    // Both sides share the store, so the pair is store-scoped.
    expect((p[0] as unknown as { store_id: string }).store_id).toBe(storeId);
  });

  it('a name-only match is 90 — a suspicion, not a certainty', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await makeLead({ first_name: 'Manon', last_name: 'Bélanger', phone: '+15145557002' });
    const nameTwin = await makeLead({ first_name: 'manon', last_name: 'BÉLANGER', phone: '+15145557003' });
    const p = await pairs();
    const pair = p.find((x) => x.lead_id === nameTwin);
    expect(pair).toBeDefined();
    expect(pair!.match_type).toBe('name');
    expect(pair!.confidence).toBe(90);
  });

  it('dismiss resolves a pair once — the second dismissal is a 409, not a shrug', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const p = await pairs();
    const namePair = p.find((x) => x.match_type === 'name')!;
    const ok = await app!.inject({
      method: 'POST', url: `/api/v1/duplicates/${namePair.id}/dismiss`, headers: { cookie },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const again = await app!.inject({
      method: 'POST', url: `/api/v1/duplicates/${namePair.id}/dismiss`, headers: { cookie },
    });
    expect(again.statusCode, again.body).toBe(409);
  });

  it('merge: keeper backfilled, children re-pointed, source retired as Merged duplicate, sibling pairs dismissed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A conversation child on the SOURCE (newer) — must follow the keeper.
    const conv = await admin.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, channel, phone_e164)
       VALUES ($1, $2, $3, 'sms', '+15145557001') RETURNING id`,
      [orgId, storeId, newer],
    );
    // A third arrival on the same phone: pairs against BOTH sides.
    const third = await makeLead({ first_name: 'Yvon', last_name: 'T.', phone: '+15145557001' });
    const before = await pairs();
    expect(before.filter((x) => x.lead_id === third)).toHaveLength(2);

    // F-68: a follow-up on the SOURCE must follow the keeper too.
    const task = await app!.inject({
      method: 'POST', url: '/api/v1/tasks', headers: { cookie },
      payload: { organization_id: orgId, subject_type: 'lead', subject_id: newer, title: 'Rappeler Yvon' },
    });
    expect(task.statusCode, task.body).toBe(201);
    const taskId = (JSON.parse(task.body) as { id: string }).id;

    const mergePair = before.find((x) => x.lead_id === newer && x.duplicate_of === older)!;
    const merged = await app!.inject({
      method: 'POST', url: `/api/v1/duplicates/${mergePair.id}/merge`, headers: { cookie },
    });
    const movedTask = await admin.query<{ subject_id: string }>(`SELECT subject_id FROM tasks WHERE id = $1`, [taskId]);
    expect(movedTask.rows[0]!.subject_id).toBe(older);
    expect(merged.statusCode, merged.body).toBe(200);
    expect((JSON.parse(merged.body) as { status: string }).status).toBe('merged');

    // Keeper: empty email filled from the source; keeper's own data untouched.
    const keeper = await app!.inject({ method: 'GET', url: `/api/v1/leads/${older}`, headers: { cookie } });
    const keeperLead = JSON.parse(keeper.body) as { email: string; first_name: string };
    expect(keeperLead.email).toBe('yvon@example.com');
    expect(keeperLead.first_name).toBe('Yvon');

    // The conversation follows the keeper.
    const moved = await admin.query<{ lead_id: string }>(
      `SELECT lead_id FROM conversations WHERE id = $1`, [conv.rows[0]!.id],
    );
    expect(moved.rows[0]!.lead_id).toBe(older);

    // Source: lost, under the seeded system reason, note naming the keeper.
    const source = await app!.inject({ method: 'GET', url: `/api/v1/leads/${newer}`, headers: { cookie } });
    const sourceLead = JSON.parse(source.body) as { status: string; lost_reason_id: string; lost_reason_note: string };
    expect(sourceLead.status).toBe('lost');
    expect(sourceLead.lost_reason_note).toContain('Yvon');
    const reason = await admin.query<{ name: string }>(
      `SELECT name FROM lost_reasons WHERE id = $1`, [sourceLead.lost_reason_id],
    );
    expect(reason.rows[0]!.name).toBe('Merged duplicate');

    // The source's OTHER pending pair (vs the third lead) is now moot.
    const after = await pairs();
    expect(after.some((x) => x.lead_id === newer || x.duplicate_of === newer)).toBe(false);
    // The third lead still has its live pair against the KEEPER.
    expect(after.some((x) => x.lead_id === third && x.duplicate_of === older)).toBe(true);
  });

  it('merging an already-resolved pair is refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const done = await pairs('merged');
    expect(done.length).toBeGreaterThan(0);
    const again = await app!.inject({
      method: 'POST', url: `/api/v1/duplicates/${done[0]!.id}/merge`, headers: { cookie },
    });
    expect(again.statusCode, again.body).toBe(409);
  });

  it('the single-lead scan endpoint reports what it created and never duplicates a pair', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const p = await pairs();
    const anyLead = p[0]!.lead_id;
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${anyLead}/duplicate-scan`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((JSON.parse(res.body) as { created: number }).created).toBe(0);
  });

  it('name matching survives internal double spaces — SQL mirrors the core normalization', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await makeLead({ first_name: 'Jean  Pierre', last_name: 'Dupuis', phone: '+15145557011' });
    const twin = await makeLead({ first_name: 'Jean Pierre', last_name: 'Dupuis', phone: '+15145557012' });
    const p = await pairs();
    const pair = p.find((x) => x.lead_id === twin);
    expect(pair).toBeDefined();
    expect(pair!.match_type).toBe('name');
  });

  it('§8.2 #7: the keeper is RESCORED after backfill — merged-in facts change the band', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A rule that scores having an email; the keeper arrives without one.
    const rule = await app!.inject({
      method: 'POST', url: '/api/v1/scoring-rules', headers: { cookie },
      payload: { organization_id: orgId, name: 'Courriel connu', field: 'has_email', operator: 'exists', score: 20 },
    });
    expect(rule.statusCode, rule.body).toBe(201);
    const keeperId = await makeLead({ first_name: 'Luc', last_name: 'Bergeron', phone: '+15145557021' });
    const sourceId = await makeLead({ first_name: 'Luc', last_name: 'Bergeron', phone: '+15145557021', email: 'luc@example.com' });
    const keeperBefore = JSON.parse((await app!.inject({ method: 'GET', url: `/api/v1/leads/${keeperId}`, headers: { cookie } })).body) as { score: number | null };
    const p = await pairs();
    const pairRow = p.find((x) => x.lead_id === sourceId && x.duplicate_of === keeperId)!;
    const merged = await app!.inject({
      method: 'POST', url: `/api/v1/duplicates/${pairRow.id}/merge`, headers: { cookie },
    });
    expect(merged.statusCode, merged.body).toBe(200);
    const keeperAfter = JSON.parse((await app!.inject({ method: 'GET', url: `/api/v1/leads/${keeperId}`, headers: { cookie } })).body) as { score: number | null; email: string };
    expect(keeperAfter.email).toBe('luc@example.com');
    expect(keeperAfter.score ?? 0).toBeGreaterThan(keeperBefore.score ?? 0);
    // The retired source's score is gone WITH its breakdown row — synced, not stale.
    const src = JSON.parse((await app!.inject({ method: 'GET', url: `/api/v1/leads/${sourceId}`, headers: { cookie } })).body) as { score: number | null };
    expect(src.score).toBeNull();
  });

  it('a merged-away ghost never re-enters detection — a fresh arrival pairs with the KEEPER only', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // `newer` was merged into `older` earlier; a fourth same-phone arrival
    // must pair with the living keeper, never the ghost.
    const fourth = await makeLead({ first_name: 'Yvon', last_name: 'Trem.', phone: '+15145557001' });
    const p = await pairs();
    const mine = p.filter((x) => x.lead_id === fourth);
    expect(mine.some((x) => x.duplicate_of === older)).toBe(true);
    expect(mine.some((x) => x.duplicate_of === newer)).toBe(false);
  });

  it("soft-deleting a lead retires its pending pairs — the queue never serves a deleted person's details", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ghostA = await makeLead({ first_name: 'Rita', last_name: 'Lavoie', phone: '+15145557031' });
    const ghostB = await makeLead({ first_name: 'Rita', last_name: 'Lavoie', phone: '+15145557031' });
    const before = await pairs();
    const pairRow = before.find((x) => x.lead_id === ghostB && x.duplicate_of === ghostA)!;
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${ghostB}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const after = await pairs();
    expect(after.some((x) => x.id === pairRow.id)).toBe(false);
    const history = await pairs('dismissed');
    expect(history.some((x) => x.id === pairRow.id)).toBe(true);
  });

  it('the full scan finds pairs the at-arrival detection never saw, and is idempotent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Two API-untouched leads sharing an email (fixture: the scan's raison d'être).
    await admin.query(
      `INSERT INTO leads (organization_id, store_id, phone, source, email, first_name)
       VALUES ($1, $2, '+15145557008', 'walk_in', 'scan@example.com', 'Premier'),
              ($1, $2, '+15145557009', 'walk_in', 'scan@example.com', 'Second')`,
      [orgId, storeId],
    );
    const first = await app!.inject({
      method: 'POST', url: '/api/v1/duplicates/scan', headers: { cookie },
      payload: { organization_id: orgId },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect((JSON.parse(first.body) as { created: number }).created).toBeGreaterThanOrEqual(1);
    const second = await app!.inject({
      method: 'POST', url: '/api/v1/duplicates/scan', headers: { cookie },
      payload: { organization_id: orgId },
    });
    expect((JSON.parse(second.body) as { created: number }).created).toBe(0);
  });
});
