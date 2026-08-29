import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { ActivityAction, ActivityEntityType, ActivityEvent } from '@dealpilot/schemas';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { buildApp } from './app.js';
import { recordEvent } from './activity.js';
import { z } from 'zod';

/**
 * F-10 activity trail (ADR-009).
 *
 * The claim being tested is not "rows appear" — it is that the trail and the
 * thing it describes are the SAME transaction. A change that rolls back must
 * leave no event, and a change that commits must never lack one. Anything less
 * and the log is a second, slightly-wrong copy of the database.
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
let dealId = '';

const Page = z.object({ items: z.array(ActivityEvent), next_cursor: z.string().nullable() });

async function activity(params = '') {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/activity${params}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return Page.parse(JSON.parse(res.body)).items;
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
    payload: { email: `f10-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F10', slug: `groupe-f10-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F10 Kia', code: 'F10-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-10 activity trail', () => {
  it('creating a deal is recorded, with who did it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000, interest_rate_bps: 599, term_months: 60,
      },
    });
    dealId = (JSON.parse(res.body) as { id: string }).id;

    const events = await activity(`?entity_type=deal&entity_id=${dealId}`);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('created');
    expect(events[0]!.actor_user_id).not.toBeNull();
  });

  it('a stage move and a funding move get their own verbs, not "updated"', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const staged = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'submitted' },
    });
    expect(staged.statusCode).toBe(200);
    // The funding vocabulary is not_submitted / submitted / stips_required /
    // funded — asserting the call succeeded, because a silently-refused PATCH
    // would look exactly like a missing event.
    const funded = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { funding_status: 'submitted' },
    });
    expect(funded.statusCode).toBe(200);

    const events = await activity(`?entity_type=deal&entity_id=${dealId}`);
    const actions = events.map((e) => e.action);
    expect(actions).toContain('stage_changed');
    expect(actions).toContain('funding_changed');
    const stage = events.find((e) => e.action === 'stage_changed')!;
    expect(stage.changes['pipeline_stage']).toEqual({ from: 'new', to: 'submitted' });
  });

  it('a PATCH that changes nothing records nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = (await activity(`?entity_type=deal&entity_id=${dealId}`)).length;
    // Same stage it already has. A trail full of no-ops is a trail nobody reads.
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'submitted' },
    });
    expect((await activity(`?entity_type=deal&entity_id=${dealId}`)).length).toBe(before);
  });

  it('a refused change writes no event', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = (await activity()).length;

    // The F-08 gate refuses this: the checklist is not complete.
    // NOTE what this does and does not prove. The gate throws BEFORE the UPDATE
    // and before any recordEvent, so this shows the route does not pre-emptively
    // log an intention — useful, but it would also pass if events were written
    // on a separate connection after commit. The transaction property itself is
    // proven by the test below, which rolls back AFTER an event exists.
    const refused = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'delivered' },
    });
    expect(refused.statusCode).toBe(422);

    const after = await activity();
    expect(after.length).toBe(before);
    expect(after.some((e) => e.action === 'delivered')).toBe(false);
  });

  it('an event written then rolled back does not survive — the actual claim', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const appPool = createPool({ connectionString: APP_URL, max: 2 });
    try {
      const before = (await activity()).length;
      const marker = randomUUID();

      // Write an event, then fail — the shape of any real handler that records
      // a change and then hits a constraint, a lock timeout, or a downstream
      // write like writeCommissionsForFundedDeal. If recordEvent used its own
      // connection, or ran after commit, this row would outlive the failure and
      // the trail would assert something that never happened.
      await expect(
        withTenant(appPool, orgId, async (c) => {
          await recordEvent(c, {
            organizationId: orgId,
            actorUserId: null,
            entityType: 'deal',
            entityId: marker,
            action: 'updated',
            changes: { probe: true },
          });
          // Prove the row is visible INSIDE the transaction, so a later absence
          // means it was rolled back rather than never written.
          const seen = await c.query('SELECT 1 FROM activity_events WHERE entity_id = $1', [marker]);
          expect(seen.rows).toHaveLength(1);
          throw new Error('deliberate failure after the event was written');
        }),
      ).rejects.toThrow('deliberate failure');

      const after = await activity();
      expect(after.length).toBe(before);
      expect(after.some((e) => e.entity_id === marker)).toBe(false);
    } finally {
      await appPool.end();
    }
  });

  it('a waiver keeps its reason in the trail — the history F-08 lacked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/void_cheque`, headers: { cookie },
      payload: { overridden: true, override_reason: 'Pre-authorized debit on file' },
    });
    expect(res.statusCode).toBe(200);

    const events = await activity('?entity_type=checklist_item');
    const waived = events.find((e) => e.action === 'checklist_waived')!;
    expect(waived.reason).toBe('Pre-authorized debit on file');
    expect(waived.changes['code']).toBe('void_cheque');

    // And un-waiving still erases the item's fields — but no longer erases the
    // fact that someone did it (this is what D-034 needs).
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/void_cheque`, headers: { cookie },
      payload: { overridden: false },
    });
    const after = await activity('?entity_type=checklist_item');
    expect(after.some((e) => e.action === 'checklist_unwaived')).toBe(true);
    // The original waiver and its reason are still there.
    expect(after.some((e) => e.action === 'checklist_waived' && e.reason === 'Pre-authorized debit on file')).toBe(true);
  });

  it('the trail cannot be edited or deleted, by anyone the app connects as', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const grants = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name = 'activity_events'`,
    );
    const held = grants.rows.map((g) => g.privilege_type).sort();
    // A correction is a new row. Nothing else is honest.
    expect(held).toEqual(['INSERT', 'SELECT']);
  });

  it('a deal’s timeline includes what happened to its checklist (CR-04)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const tick = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/idv`, headers: { cookie },
      payload: { completed: true },
    });
    expect(tick.statusCode).toBe(200);

    // One query, filtered by the DEAL, returns the checklist act too — Hussein
    // was otherwise pulling the whole org's checklist events and filtering in
    // the browser, which goes wrong the moment a store is busy.
    const events = await activity(`?entity_id=${dealId}`);
    const item = events.find((e) => e.entity_type === 'checklist_item');
    expect(item, 'checklist events must roll up to their deal').toBeDefined();
    expect(item!.parent_entity_id).toBe(dealId);
    expect(item!.parent_entity_type).toBe('deal');
    // And it did not drag in some other deal's checklist.
    expect(events.every((e) => e.entity_id === dealId || e.parent_entity_id === dealId)).toBe(true);
  });

  it('no dead vocabulary — every entity type and action is actually emitted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The first cut of F-10 declared 8 entity types and wired 3, so five of them
    // could never appear and nobody could tell by reading the enum. A vocabulary
    // that outruns the code is a promise of coverage that does not exist.
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = (await readdir(dir))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const code = (
      await Promise.all(sources.map((f) => readFile(join(dir, f), 'utf8')))
    ).join('\n');

    // F-71: an entity whose ONLY producer is SQL is vouched for by the named
    // migration — an `INSERT INTO activity_events` naming it — not by API
    // code. The map is the promise; pointing it at the wrong file fails.
    const SQL_PRODUCED_ENTITIES: Record<string, string> = {
      impersonation_session: '20260827000067_impersonation.sql',
    };
    const migrationsDir = join(dir, '..', '..', '..', 'packages', 'db', 'migrations');
    const producedBySql = async (entity: string): Promise<boolean> => {
      const sql = await readFile(join(migrationsDir, SQL_PRODUCED_ENTITIES[entity]!), 'utf8');
      return new RegExp(String.raw`INSERT INTO activity_events[\s\S]{0,1200}?'` + entity + `'`).test(sql);
    };
    const unusedEntities: string[] = [];
    for (const v of ActivityEntityType.options) {
      const used = v in SQL_PRODUCED_ENTITIES ? await producedBySql(v) : new RegExp(`entityType:\\s*'${v}'`).test(code);
      if (!used) unusedEntities.push(v);
    }
    expect(unusedEntities, `entity types no code path ever writes: ${unusedEntities.join(', ')}`).toEqual([]);

    // Must match a CALL SITE, not any quoted occurrence: 'delivered' also
    // appears in DELIVERY_STAGES and 'revoked' in a status comparison, so a
    // bare quoted-string search made this half of the guard vacuous.
    const unusedActions = ActivityAction.options.filter(
      // Same LINE as an `action:` key, which covers the ternaries
      // (`action: x ? 'a' : 'b'`) without matching an unrelated quoted string
      // elsewhere in the file. String.raw so the backslashes reach the RegExp
      // instead of being eaten by the template literal (\s there is just "s").
      (v) => !new RegExp(String.raw`action:[^\n]*'` + v + `'`).test(code),
    );
    expect(unusedActions, `actions no code path ever writes: ${unusedActions.join(', ')}`).toEqual([]);
  });

  it('another tenant sees none of it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rival = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f10-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
    });
    const rc = rival.headers['set-cookie'];
    const rivalCookie = (Array.isArray(rc) ? rc : [rc!]).map((c) => c!.split(';')[0]).join('; ');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival Motors', slug: `rival-f10-${run}` },
    });

    const res = await app!.inject({ method: 'GET', url: '/api/v1/activity', headers: { cookie: rivalCookie } });
    expect(res.statusCode).toBe(200);
    const items = Page.parse(JSON.parse(res.body)).items;
    // Their own org creation IS there (F-10 records it); nothing of ours ever is.
    expect(items.every((e) => e.organization_id !== orgId)).toBe(true);
  });
});
