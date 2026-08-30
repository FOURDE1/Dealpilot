import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withUser, type Pool } from '@dealpilot/db';
import {
  ActiveAnnouncements,
  AdminAnnouncement,
  Announcement,
  AdminAnnouncementList,
  AnnouncementSeverity,
  NOTIFICATION_TITLE_KEYS,
  PlanList,
  type AdminAnnouncementT,
} from '@dealpilot/schemas';
import { buildApp } from './app.js';
import type { DeferredSendQueue } from './deferred-queue.js';
import type { EmailMessage } from './email.js';
import { platformErrorFrom } from './platform.js';
import { resetKillSwitchCache } from './platform-settings.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-72 — announcements and broadcast (admin-console.md §8, §11, §12; D-073).
 * What is worth proving:
 *  - the publish form refuses in the publisher's own vocabulary — both
 *    languages, the status-page link, the window — rather than letting a CHECK
 *    answer with someone else's sentence;
 *  - §3's severity split holds in the route AND in the definer, and §12's
 *    immutability is a trigger: no PATCH, no delete, and `end` is the one
 *    legal mutation;
 *  - the audience means what it says — an `organizations` arm reaches exactly
 *    those tenants, a `plan` arm exactly that tier, and §8's marketing
 *    suppression spares `trial` while stopping `past_due` and `read_only`;
 *  - the tenant feed is self-scoped, names no tenant, survives a support
 *    session's scope, and cannot be dismissed by a staffer;
 *  - the doors: the app role reads neither announcement table and writes no
 *    dismissal — the definers are the only way in.
 *
 * Every blocked-behaviour case builds its OWN tenants inside the `it`, and
 * every status is reached through the real F-69 route
 * `POST /api/v1/admin/tenants/:id/status` — never by writing
 * `organizations.status` directly, which would be testing the database.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const MIGRATION = join(migrationsDir, '20260830000068_announcements-killswitches.sql');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const sent: EmailMessage[] = [];

/**
 * The publish route is the ONE producer of the fan-out job, and under the
 * default `noDeferredSendQueue` a lost enqueue is a warn line nothing reads.
 * Injected so the seam is asserted, and switchable so one case can make the
 * queue sick without standing up a second app.
 */
const fanouts: { announcement_id: string }[] = [];
let fanoutFails: (() => Promise<void>) | null = null;
const recordingQueue: DeferredSendQueue = {
  enqueue: () => Promise.resolve(),
  enqueueAssistantTurn: () => Promise.resolve(),
  enqueueExtraction: () => Promise.resolve(),
  enqueueFirstTouch: () => Promise.resolve(),
  enqueueLiveAnalysis: () => Promise.resolve(),
  enqueueAnnouncementFanout: (job) => {
    if (fanoutFails) return fanoutFails();
    fanouts.push({ announcement_id: job.announcement_id });
    return Promise.resolve();
  },
  close: () => Promise.resolve(),
};

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let superCookie = ''; let superId = '';
let supportCookie = ''; let supportId = '';
let billingCookie = '';
let corePlan = ''; let growthPlan = '';

type TenantStatus = 'trial' | 'active' | 'past_due' | 'read_only' | 'suspended' | 'offboarding';

interface Tenant {
  orgId: string;
  slug: string;
  ownerCookie: string;
  ownerId: string;
  ownerEmail: string;
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

/** Grant + enrol + sign in through TOTP: a console-ready staffer (the F-69 helper). */
async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

/**
 * The token from the last INVITATION email to `to` (the F-70 helper, narrowed
 * to the invitation link because signing the owner up afterwards puts a
 * verification mail to the same address at the top of the pile).
 */
function tokenFor(to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to && m.text.includes('/invitations/'));
  expect(mail, `no invitation email to ${to}`).toBeDefined();
  const m = /\/invitations\/([A-Za-z0-9_-]+)/.exec(mail!.text);
  expect(m).not.toBeNull();
  return m![1]!;
}

async function setStatus(orgId: string, body: Record<string, unknown>) {
  return app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${orgId}/status`, headers: { cookie: superCookie }, payload: body });
}

/**
 * A real tenant at a real status.
 *
 * Provisioned through the console (which is what births a `trial` tenant), the
 * owner seat accepted through the real F-12 invitation, and every further
 * status reached through the F-69 lifecycle route. `suspended` and
 * `offboarding` are destructive targets and cost the slug typed back.
 */
let tenantSeq = 0;
async function tenant(label: string, opts: { plan?: string; status?: TenantStatus } = {}): Promise<Tenant> {
  tenantSeq += 1;
  const slug = `f72a-${label}-${run}-${tenantSeq}`;
  const ownerEmail = `owner-${slug}@dealpilot.test`;
  const provisioned = await app!.inject({
    method: 'POST', url: '/api/v1/admin/tenants', headers: { cookie: superCookie },
    payload: {
      legal_name: `Groupe ${label} inc.`, display_name: `Groupe ${label}`, slug, province: 'QC',
      plan_id: opts.plan ?? corePlan, owner_email: ownerEmail, owner_name: 'Propriétaire',
      stores: [{ name: 'Rooftop', code: `st-${tenantSeq}`, province: 'QC' }],
    },
  });
  expect(provisioned.statusCode, provisioned.body).toBe(201);
  const orgId = (JSON.parse(provisioned.body) as { tenant: { id: string } }).tenant.id;

  const ownerCookie = await signUp(ownerEmail, 'Propriétaire');
  const accepted = await app!.inject({
    method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie: ownerCookie },
    payload: { token: tokenFor(ownerEmail) },
  });
  expect(accepted.statusCode, accepted.body).toBe(201);

  const walk: Record<TenantStatus, { status: TenantStatus; confirm?: true }[]> = {
    trial: [],
    active: [{ status: 'active' }],
    past_due: [{ status: 'active' }, { status: 'past_due' }],
    read_only: [{ status: 'active' }, { status: 'past_due' }, { status: 'read_only' }],
    suspended: [{ status: 'suspended', confirm: true }],
    offboarding: [{ status: 'suspended', confirm: true }, { status: 'offboarding', confirm: true }],
  };
  for (const step of walk[opts.status ?? 'trial']) {
    const res = await setStatus(orgId, {
      status: step.status, reason: `fixture: move to ${step.status}`,
      ...(step.confirm ? { confirm_slug: slug } : {}),
    });
    expect(res.statusCode, `${slug} → ${step.status}: ${res.body}`).toBe(200);
  }

  return { orgId, slug, ownerCookie, ownerId: await userId(ownerEmail), ownerEmail };
}

/** A second person inside an existing tenant (the per-person dismissal case). */
async function member(host: Tenant, label: string): Promise<{ cookie: string; id: string; email: string }> {
  const email = `member-${label}-${run}-${tenantSeq}@dealpilot.test`;
  const cookie = await signUp(email, 'Collègue');
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: host.ownerCookie },
    payload: { organization_id: host.orgId, email, name: 'Collègue', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);
  return { cookie, id: await userId(email), email };
}

const TEXT = {
  title_en: 'Scheduled maintenance', title_fr: 'Entretien planifié',
  body_en: 'The console will be unavailable.', body_fr: 'La console sera indisponible.',
};

async function publish(payload: Record<string, unknown>, cookie = superCookie) {
  return app!.inject({ method: 'POST', url: '/api/v1/admin/announcements', headers: { cookie }, payload });
}

async function published(payload: Record<string, unknown>, cookie = superCookie): Promise<AdminAnnouncementT> {
  const res = await publish(payload, cookie);
  expect(res.statusCode, res.body).toBe(201);
  return AdminAnnouncement.parse(JSON.parse(res.body));
}

/** Publish to exactly these organizations — so one case's notices never reach another's. */
async function to(orgIds: string[], over: Record<string, unknown> = {}, cookie = superCookie): Promise<AdminAnnouncementT> {
  return published({ severity: 'info', ...TEXT, audience: { type: 'organizations', organization_ids: orgIds }, ...over }, cookie);
}

async function endAnnouncement(id: string, cookie = superCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/admin/announcements/${id}/end`, headers: { cookie } });
}

/** The tenant shell's own feed, as the signed-in person sees it. */
async function feed(cookie: string): Promise<{ id: string; severity: string; dismissible: boolean }[]> {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/announcements', headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return ActiveAnnouncements.parse(JSON.parse(res.body)).items;
}

/**
 * The same definer the route calls, for the two cases whose tenant has no
 * usable session: suspending a tenant revokes its members' sessions (F-69), so
 * the route cannot be reached to ask what a suspended member would see.
 */
async function feedOf(uid: string): Promise<{ id: string }[]> {
  return (await withUser(appPool, uid, (c) => c.query<{ id: string }>('SELECT * FROM announcements_for_user()'))).rows;
}

async function dismiss(id: string, cookie: string) {
  return app!.inject({ method: 'POST', url: `/api/v1/announcements/${id}/dismiss`, headers: { cookie } });
}

/** Capture the refusal itself, so its SQLSTATE and its envelope can both be read. */
async function refusal(fn: () => Promise<unknown>): Promise<{ code?: string }> {
  try {
    await fn();
  } catch (err) {
    return err as { code?: string };
  }
  throw new Error('expected a refusal, got success');
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
      mailer: { deliversToRecipient: true, async send(m) { sent.push(m); return true; } },
      deferredQueue: recordingQueue,
    },
  ));

  const superEmail = `f72a-super-${run}@dealpilot.test`;
  superCookie = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null);
  superId = await userId(superEmail);
  const supportEmail = `f72a-support-${run}@dealpilot.test`;
  supportCookie = await staffer(supportEmail, 'Soutien', 'platform_support', superId);
  supportId = await userId(supportEmail);
  billingCookie = await staffer(`f72a-billing-${run}@dealpilot.test`, 'Facturation', 'platform_billing', superId);

  const plans = PlanList.parse(JSON.parse((await app!.inject({ method: 'GET', url: '/api/v1/admin/plans', headers: { cookie: superCookie } })).body));
  corePlan = plans.items.find((p) => p.code === 'core')!.id;
  growthPlan = plans.items.find((p) => p.code === 'growth')!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

// A17: an apps/api suite resets through `./platform-settings.js`. Nothing here
// sends, but a switch left on by a neighbouring suite must not be inherited
// through a module-level snapshot.
beforeEach(() => {
  resetKillSwitchCache();
});

describe('publishing (§8, §11)', () => {
  it('an info announcement to everyone is 201 and dismissible', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = await published({ severity: 'info', ...TEXT, audience: { type: 'all' } });
    try {
      expect(a).toMatchObject({
        severity: 'info', dismissible: true, ends_at: null, status_incident_url: null,
        audience: { type: 'all' }, recipients_notified: 0,
        published_by_email: `f72a-super-${run}@dealpilot.test`,
      });
      expect(new Date(a.starts_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      // The register reads back the same row.
      const got = await app!.inject({ method: 'GET', url: `/api/v1/admin/announcements/${a.id}`, headers: { cookie: superCookie } });
      expect(got.statusCode, got.body).toBe(200);
      expect(AdminAnnouncement.parse(JSON.parse(got.body))).toEqual(a);
    } finally {
      // An `all` audience would otherwise stand in every later case's feed.
      await endAnnouncement(a.id);
    }
  });

  it('an empty title_fr and body_fr are ONE 422 carrying TWO missing_translation details', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await publish({
      severity: 'info', title_en: 'Hello', title_fr: '   ', body_en: 'Something', body_fr: '',
      audience: { type: 'all' },
    });
    expect(res.statusCode, res.body).toBe(422);
    const details = (JSON.parse(res.body) as { error: { code: string; details: { path: string; code: string }[] } }).error;
    expect(details.code).toBe('validation_failed');
    // Bill 96 in one round trip: the form marks both fields at once, which is
    // what ApiError.detailPaths was built for.
    expect(details.details.filter((d) => d.code === 'missing_translation').map((d) => d.path).sort()).toEqual(['body_fr', 'title_fr']);
    expect(await count(`SELECT count(*) AS n FROM platform_announcements WHERE title_en = 'Hello'`)).toBe(0);
  });

  it('the status-page link rule is the Zod message, never the CHECK’s sentence about a reason', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const missing = await publish({ severity: 'incident', ...TEXT, audience: { type: 'all' } });
    expect(missing.statusCode, missing.body).toBe(422);
    expect(JSON.parse(missing.body)).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'status_incident_url', code: 'status_incident_required' }] },
    });
    const forbidden = await publish({
      severity: 'info', ...TEXT, audience: { type: 'all' },
      status_incident_url: 'https://status.dealpilot.test/incidents/42',
    });
    expect(forbidden.statusCode, forbidden.body).toBe(422);
    expect(JSON.parse(forbidden.body)).toMatchObject({
      error: { details: [{ path: 'status_incident_url', code: 'status_incident_forbidden' }] },
    });
    // MUTATION: delete the two superRefine arms and the biconditional CHECK
    // answers instead — 23514, which platformErrorFrom renders as
    // "Reason required" on path `reason`. That is why the keys were reinstated.
    expect(forbidden.body).not.toContain('reason_required');
  });

  it('a non-https status link is refused by the form and, independently, by the CHECK', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await publish({
      severity: 'incident', ...TEXT, audience: { type: 'all' },
      status_incident_url: 'http://status.dealpilot.test/incidents/42',
    });
    expect(res.statusCode, res.body).toBe(422);
    // Its OWN code. MUTATION: point this arm back at `status_incident_required`
    // and this goes red — a client keying on the code, which is the stated
    // contract, would tell the publisher to add a link they already supplied.
    expect(JSON.parse(res.body)).toMatchObject({
      error: { details: [{ path: 'status_incident_url', code: 'status_incident_scheme' }] },
    });
    // The Zod refusal is the message; the CHECK is the guarantee.
    const err = await refusal(() =>
      admin.query(
        'SELECT admin_publish_announcement($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,NULL,NULL,$8)',
        [superId, 'incident', TEXT.title_en, TEXT.title_fr, TEXT.body_en, TEXT.body_fr,
          JSON.stringify({ type: 'all' }), 'http://status.dealpilot.test/incidents/42'],
      ),
    );
    expect(err.code).toBe('23514');
  });

  it('an `ends_at` in the past with a blank `starts_at` is invalid_window on ends_at', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // "Starts" is optional on the form and the definer substitutes
    // COALESCE(p_starts_at, now()), so the window rule has to be checked
    // against the EFFECTIVE start. A `datetime-local` truncates to the minute,
    // so picking the current minute at :40 seconds already lands here.
    const res = await publish({ severity: 'info', ...TEXT, audience: { type: 'all' }, ends_at: iso(-60_000) });
    expect(res.statusCode, res.body).toBe(422);
    // MUTATION: restore the `v.starts_at != null` conjunct to the superRefine
    // and this goes red — the table CHECK answers instead with 23514, which
    // platformErrorFrom renders as "Reason required" on path `reason`, a field
    // the compose form does not have and cannot anchor to.
    expect(JSON.parse(res.body)).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'ends_at', code: 'invalid_window' }] },
    });
    expect(res.body).not.toContain('reason_required');
    // An explicit start still governs when one is given.
    const both = await publish({
      severity: 'info', ...TEXT, audience: { type: 'all' },
      starts_at: iso(-2 * 60 * 60 * 1000), ends_at: iso(-60 * 60 * 1000),
    });
    expect(both.statusCode, both.body).toBe(201);
    await endAnnouncement(AdminAnnouncement.parse(JSON.parse(both.body)).id);
  });

  it('an `organizations` audience given an UPPER-CASE id still reaches that tenant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('upper', { status: 'active' });
    const a = await published({
      severity: 'info', ...TEXT,
      audience: { type: 'organizations', organization_ids: [t.orgId.toUpperCase()] },
    });
    // MUTATION: drop the `toLowerCase` from `AudienceOrgId` and this goes red.
    // The publish guard compares the id as a uuid (case-insensitive) while
    // `announcement_matches` tests the jsonb array as TEXT (byte-exact), so an
    // upper-case id published happily and reached nobody — and §12
    // immutability makes `audience` uncorrectable afterwards.
    expect(a.audience).toEqual({ type: 'organizations', organization_ids: [t.orgId] });
    expect((await feed(t.ownerCookie)).map((x) => x.id)).toContain(a.id);
    const fan = await appPool.query<{ inserted: number }>(
      'SELECT * FROM announcement_fanout_batch($1::uuid, NULL, 500)', [a.id],
    );
    expect(fan.rows[0]!.inserted).toBeGreaterThan(0);
  });

  it('a publish enqueues exactly one fan-out job; a refused publish enqueues none', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('fanout', { status: 'active' });
    const before = fanouts.length;
    const a = await to([t.orgId]);
    // MUTATION: delete the `enqueueAnnouncementFanout` call in
    // f72-announcement-routes.ts (or drop `registerF72AnnouncementRoutes`'s
    // third argument) and this goes red. Nothing else notices: the banner
    // still shows, and `recipients_notified` simply stays 0 forever.
    expect(fanouts.slice(before)).toEqual([{ announcement_id: a.id }]);
    const refused = await publish({
      severity: 'info', title_en: 'Only English', title_fr: '', body_en: 'Body', body_fr: '',
      audience: { type: 'all' },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    // Nothing was committed, so nothing may be fanned out.
    expect(fanouts.slice(before)).toHaveLength(1);
  });

  it('a sick queue does not cost the publish: 201, readable, and only the log complains', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('sickq', { status: 'active' });
    fanoutFails = () => Promise.reject(new Error('redis is gone'));
    try {
      // MUTATION: `await` the enqueue bare again and this goes red with a 500
      // (or, with REDIS_URL set and Redis unreachable, hangs). The row is
      // already committed and immutable, so the operator's retry mid-incident
      // would publish a SECOND banner that cannot be deleted.
      const a = await to([t.orgId]);
      const got = await app!.inject({
        method: 'GET', url: `/api/v1/admin/announcements/${a.id}`, headers: { cookie: superCookie },
      });
      expect(got.statusCode, got.body).toBe(200);
      // The banner is the primary delivery and needs no queue at all.
      expect((await feed(t.ownerCookie)).map((x) => x.id)).toContain(a.id);
    } finally {
      fanoutFails = null;
    }
  });

  it('an incident is non-dismissible, and a request cannot ask to be told otherwise', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('incid', { status: 'active' });
    const a = await to([t.orgId], {
      severity: 'incident', status_incident_url: 'https://status.dealpilot.test/incidents/7',
    });
    expect(a.dismissible).toBe(false);
    expect((await feed(t.ownerCookie)).find((x) => x.id === a.id)).toMatchObject({ dismissible: false });
    // `dismissible` is derived by the definer and tied by a CHECK, so it is
    // not an input key at all — strictObject gives the 422 for free.
    const smuggled = await publish({
      severity: 'incident', ...TEXT, audience: { type: 'all' }, dismissible: true,
      status_incident_url: 'https://status.dealpilot.test/incidents/8',
    });
    expect(smuggled.statusCode, smuggled.body).toBe(422);
  });

  it('§3’s severity split is enforced TWICE — in the route and in the definer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('split', { status: 'active' });
    // Support publishes `info`…
    const info = await to([t.orgId], {}, supportCookie);
    expect(info.severity).toBe('info');
    // MUTATION: delete the second `requirePlatform(request,
    // 'announcements:publish_elevated')` and this goes green.
    const loud = await publish({ severity: 'maintenance', ...TEXT, audience: { type: 'organizations', organization_ids: [t.orgId] } }, supportCookie);
    expect(loud.statusCode, loud.body).toBe(403);
    expect(JSON.parse(loud.body)).toMatchObject({ error: { code: 'forbidden', details: [{ message: 'announcements:publish_elevated' }] } });
    // MUTATION: delete the `v_role` re-check from admin_publish_announcement
    // and this goes green — a route mistake could then widen what the database
    // allows, which is the whole reason the rule lives in both places.
    const direct = await refusal(() =>
      admin.query(
        'SELECT admin_publish_announcement($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,NULL,NULL,NULL)',
        [supportId, 'maintenance', TEXT.title_en, TEXT.title_fr, TEXT.body_en, TEXT.body_fr, JSON.stringify({ type: 'all' })],
      ),
    );
    expect(direct.code).toBe('PA009');
    expect(platformErrorFrom(direct)).toMatchObject({ statusCode: 403, apiCode: 'forbidden' });
    // Support may end its own info notice; the definer decides on severity.
    expect((await endAnnouncement(info.id, supportCookie)).statusCode).toBe(200);
  });

  it('platform_billing is refused on the whole announcements surface', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // §3 gives billing no broadcast duty. It is a 403 naming the capability,
    // not the gate's 404: billing IS platform staff, so the console door is
    // open and only this act is closed. (The manifest line says 404; that is
    // the tenant-user refusal, and `requirePlatform` only 404s when there is
    // no platform actor at all.)
    const one = await to([(await tenant('bill', { status: 'active' })).orgId]);
    for (const [method, url] of [
      ['POST', '/api/v1/admin/announcements'],
      ['GET', '/api/v1/admin/announcements'],
      ['GET', `/api/v1/admin/announcements/${one.id}`],
      ['POST', `/api/v1/admin/announcements/${one.id}/end`],
    ] as const) {
      const res = await app!.inject({
        method, url, headers: { cookie: billingCookie },
        ...(method === 'POST' && url.endsWith('/announcements') ? { payload: { severity: 'info', ...TEXT, audience: { type: 'all' } } } : {}),
      });
      expect(res.statusCode, `${method} ${url} → ${res.body}`).toBe(403);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'forbidden' } });
    }
  });

  it('a typo’d organization id in the audience is a 422 on `audience`, not a bare 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await publish({
      severity: 'info', ...TEXT, audience: { type: 'organizations', organization_ids: [randomUUID()] },
    });
    // MUTATION: raise PA001 instead of PA026 and this becomes a 404 that tells
    // the publisher nothing about which field is wrong.
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'audience', code: 'unknown_organization' }] },
    });
  });
});

describe('§12 immutability', () => {
  it('the history cannot be rewritten or deleted, even by the owner of the schema', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('immut', { status: 'active' });
    const a = await to([t.orgId]);
    // MUTATION: relax the `to_jsonb(NEW) - 'ends_at'` compare and the first
    // half goes green — a column added by a later migration would then become
    // silently writable too.
    const rewritten = await refusal(() => admin.query(`UPDATE platform_announcements SET body_en = 'x' WHERE id = $1`, [a.id]));
    expect(rewritten.code).toBe('PA000');
    const deleted = await refusal(() => admin.query(`DELETE FROM platform_announcements WHERE id = $1`, [a.id]));
    expect(deleted.code).toBe('PA000');
    expect(await count(`SELECT count(*) AS n FROM platform_announcements WHERE id = $1 AND body_en = $2`, [a.id, TEXT.body_en])).toBe(1);
  });

  it('ending a LIVE announcement stops the banner and writes one announcement.ended row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('endlive', { status: 'active' });
    const a = await to([t.orgId]);
    expect((await feed(t.ownerCookie)).map((x) => x.id)).toContain(a.id);

    const ended = await endAnnouncement(a.id);
    expect(ended.statusCode, ended.body).toBe(200);
    expect(AdminAnnouncement.parse(JSON.parse(ended.body)).ends_at).not.toBeNull();
    expect((await feed(t.ownerCookie)).map((x) => x.id)).not.toContain(a.id);

    const rows = await admin.query<{ changes: Record<string, unknown>; reason: string | null; actor_user_id: string; target_user_id: string | null }>(
      `SELECT changes, reason, actor_user_id, target_user_id FROM platform_audit_events
        WHERE event = 'announcement.ended' AND changes->>'announcement_id' = $1`, [a.id],
    );
    expect(rows.rows).toHaveLength(1);
    // The route collects no reason for an end, so the row must not invent one.
    expect(rows.rows[0]).toMatchObject({ reason: null, actor_user_id: superId, target_user_id: null });
  });

  it('ending a SCHEDULED announcement succeeds, and it never appears', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('endsched', { status: 'active' });
    const a = await to([t.orgId], { starts_at: iso(60 * 60 * 1000) });
    expect((await feed(t.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
    // MUTATION: `now()` instead of `GREATEST(now(), starts_at)` — or the
    // column CHECK back at `ends_at > starts_at` — and this is a 23514: the
    // window would have to end before it began.
    const ended = await endAnnouncement(a.id);
    expect(ended.statusCode, ended.body).toBe(200);
    const after = AdminAnnouncement.parse(JSON.parse(ended.body));
    expect(after.ends_at).toBe(after.starts_at);
    expect((await feed(t.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
  });

  it('the three refusals produce three different envelopes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('three', { status: 'active' });
    const a = await to([t.orgId]);
    expect((await endAnnouncement(a.id)).statusCode).toBe(200);

    const again = await endAnnouncement(a.id);
    expect(again.statusCode, again.body).toBe(409);
    expect(JSON.parse(again.body)).toMatchObject({ error: { code: 'already_ended' } });

    const alreadyEnded = await refusal(() => admin.query('SELECT admin_end_announcement($1::uuid, $2::uuid)', [superId, a.id]));
    const unknownKey = await refusal(() => admin.query('SELECT admin_set_platform_setting($1::uuid, $2, true, $3)', [superId, 'webhook_delivery_pause', 'a reason long enough']));
    // The window may only be SHORTENED: reopening it is the trigger's PA022.
    const reopened = await refusal(() => admin.query(`UPDATE platform_announcements SET ends_at = NULL WHERE id = $1`, [a.id]));

    expect([alreadyEnded.code, unknownKey.code, reopened.code]).toEqual(['PA025', 'PA024', 'PA022']);
    const envelopes = [alreadyEnded, unknownKey, reopened].map((e) => {
      const mapped = platformErrorFrom(e)!;
      return `${mapped.statusCode} ${mapped.apiCode}`;
    });
    expect(envelopes).toEqual(['409 already_ended', '404 not_found', '409 invalid_window']);
    expect(new Set(envelopes).size).toBe(3);
  });
});

describe('who an announcement is for (§8)', () => {
  it('an organizations audience reaches exactly those organizations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const mine = await tenant('audm', { status: 'active' });
    const theirs = await tenant('audt', { status: 'active' });
    // MUTATION: rename the jsonb key to `tenant_ids` in announcement_matches
    // and this goes red — the silent zero-reach bug the vocabulary deviation
    // exists to prevent.
    const a = await to([mine.orgId]);
    expect((await feed(mine.ownerCookie)).map((x) => x.id)).toContain(a.id);
    // MUTATION: drop the membership EXISTS clause from announcement_visible
    // and the rival sees it too.
    expect((await feed(theirs.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
  });

  it('a plan audience matches by plan_tier', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const growth = await tenant('growth', { plan: growthPlan, status: 'active' });
    const core = await tenant('core', { plan: corePlan, status: 'active' });
    const a = await published({ severity: 'info', ...TEXT, audience: { type: 'plan', plan_codes: ['growth'] } });
    try {
      expect((await feed(growth.ownerCookie)).map((x) => x.id)).toContain(a.id);
      expect((await feed(core.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
    } finally {
      await endAnnouncement(a.id);
    }
  });

  it('marketing is suppressed for past_due and read_only, and NOT for trial — across four fresh tenants', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const trial = await tenant('mtrial');
    const active = await tenant('mactive', { status: 'active' });
    const pastDue = await tenant('mpast', { status: 'past_due' });
    const readOnly = await tenant('mread', { status: 'read_only' });
    const all = [trial, active, pastDue, readOnly];
    const ids = all.map((t) => t.orgId);

    const marketing = await to(ids, { severity: 'marketing' });
    const info = await to(ids, { severity: 'info' });

    const sees = async (t: Tenant, id: string) => (await feed(t.ownerCookie)).map((x) => x.id).includes(id);
    // §8's rule exactly. MUTATION: delete the marketing clause from
    // announcement_matches and the last two go red; add 'trial' to
    // MARKETING_SUPPRESSED_STATUSES and the first goes red — a trial tenant is
    // OPERATIONAL and is precisely who marketing is for.
    expect(await sees(trial, marketing.id), 'trial sees marketing').toBe(true);
    expect(await sees(active, marketing.id), 'active sees marketing').toBe(true);
    expect(await sees(pastDue, marketing.id), 'past_due is spared marketing').toBe(false);
    expect(await sees(readOnly, marketing.id), 'read_only is spared marketing').toBe(false);
    // …and the suppression is about MARKETING, not about the tenant being
    // unreachable: everybody still gets the operational notice.
    for (const t of all) expect(await sees(t, info.id), `${t.slug} sees info`).toBe(true);
  });

  it('a member of a suspended organization sees nothing, and an offboarding one likewise', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const suspended = await tenant('susp', { status: 'suspended' });
    const offboarding = await tenant('offb', { status: 'offboarding' });
    const a = await to([suspended.orgId, offboarding.orgId]);
    // Suspension revokes the tenant's sessions (F-69), so the question is put
    // to the definer the route calls, with the same GUC the route sets.
    expect((await feedOf(suspended.ownerId)).map((x) => x.id)).not.toContain(a.id);
    expect((await feedOf(offboarding.ownerId)).map((x) => x.id)).not.toContain(a.id);
  });

  it('the window works at both ends', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('window', { status: 'active' });
    const future = await to([t.orgId], { starts_at: iso(60 * 60 * 1000) });
    const past = await to([t.orgId], { starts_at: iso(-2 * 60 * 60 * 1000), ends_at: iso(-60 * 60 * 1000) });
    const live = await to([t.orgId]);
    const shown = (await feed(t.ownerCookie)).map((x) => x.id);
    expect(shown).toContain(live.id);
    expect(shown).not.toContain(future.id);
    expect(shown).not.toContain(past.id);
  });

  it('the tenant payload names no tenant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('opaque', { status: 'active' });
    await to([t.orgId]);
    const res = await app!.inject({ method: 'GET', url: '/api/v1/announcements', headers: { cookie: t.ownerCookie } });
    const items = (JSON.parse(res.body) as { items: Record<string, unknown>[] }).items;
    expect(items.length).toBeGreaterThan(0);
    // The payload is opaque because `announcementOf` builds a fresh object, so
    // the loop below pins the ROUTE MAPPER. The layer that actually touches
    // `organizations`, `plan_tier` and `audience` is the definer, and it needs
    // its own assertion: MUTATION: add `a.audience` to
    // `announcements_for_user()`'s RETURNS TABLE and this goes red, while the
    // hand-written mapper would keep the wire clean and hide the widening.
    const def = await admin.query<{ result: string }>(
      `SELECT pg_get_function_result(oid) AS result FROM pg_proc WHERE proname = 'announcements_for_user'`,
    );
    expect(def.rows).toHaveLength(1);
    const projection = def.rows[0]!.result.replace(/^TABLE\(|\)$/g, '').split(', ')
      .map((c) => c.split(' ')[0]!);
    expect([...projection].sort()).toEqual(Object.keys(Announcement.shape).sort());

    for (const item of items) {
      for (const forbidden of ['organization_id', 'tenant_id', 'plan_tier', 'audience']) {
        expect(Object.keys(item), JSON.stringify(item)).not.toContain(forbidden);
      }
    }
    expect(res.body).not.toContain(t.orgId);
  });
});

describe('dismissing (§8)', () => {
  it('a dismissal is per-person and idempotent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('dismiss', { status: 'active' });
    const other = await member(t, 'b');
    const a = await to([t.orgId]);
    expect((await feed(t.ownerCookie)).map((x) => x.id)).toContain(a.id);

    expect((await dismiss(a.id, t.ownerCookie)).statusCode).toBe(204);
    // MUTATION: drop the dismissals NOT EXISTS from announcement_visible and
    // this goes red — the ✕ would do nothing at all.
    expect((await feed(t.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
    // A second dismiss is a no-op, not an error: a double-click must not show
    // the reader a 404 for something that already worked.
    // MUTATION: delete the "already dismissed" early RETURN from
    // `announcement_dismiss` (0068) and this goes red with 404 — the
    // visibility gate would run first, and a dismissal is precisely what makes
    // an announcement invisible, which also leaves the definer's
    // `ON CONFLICT DO NOTHING` unreachable dead code.
    const twice = await dismiss(a.id, t.ownerCookie);
    expect(twice.statusCode, twice.body).toBe(204);
    expect(await count(`SELECT count(*) AS n FROM announcement_dismissals WHERE announcement_id = $1`, [a.id])).toBe(1);
    expect((await feed(t.ownerCookie)).map((x) => x.id)).not.toContain(a.id);
    // Their colleague was not silenced by it.
    expect((await feed(other.cookie)).map((x) => x.id)).toContain(a.id);
  });

  it('a dismissal survives a crowded feed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('crowd', { status: 'active' });
    // Twenty-one maintenance notices outrank an info one in the feed's
    // ordering, so the twenty-second is beyond announcements_for_user()'s
    // LIMIT 20 and is never returned to the shell.
    for (let i = 0; i < 21; i += 1) {
      await to([t.orgId], { severity: 'maintenance', title_en: `Maintenance ${i}`, title_fr: `Entretien ${i}` });
    }
    const info = await to([t.orgId], { severity: 'info' });
    const shown = await feed(t.ownerCookie);
    expect(shown).toHaveLength(20);
    expect(shown.map((x) => x.id)).not.toContain(info.id);
    // MUTATION: point announcement_dismiss's visibility check back at
    // announcements_for_user() and this goes red — every dismissible notice
    // would become undismissable the moment twenty louder ones were live.
    expect((await dismiss(info.id, t.ownerCookie)).statusCode).toBe(204);
    expect(await count(`SELECT count(*) AS n FROM announcement_dismissals WHERE announcement_id = $1`, [info.id])).toBe(1);
  });

  it('an incident cannot be dismissed, and the refusal is in SQL', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('nodis', { status: 'active' });
    const a = await to([t.orgId], { severity: 'incident', status_incident_url: 'https://status.dealpilot.test/incidents/9' });
    const res = await dismiss(a.id, t.ownerCookie);
    // MUTATION: drop the `dismissible` check from announcement_dismiss and
    // this goes green — the rule would live only in a disabled attribute.
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'not_dismissible', details: [{ path: 'id' }] } });
    expect(await count(`SELECT count(*) AS n FROM announcement_dismissals WHERE announcement_id = $1`, [a.id])).toBe(0);
  });

  it('dismissing something the caller cannot see is a 404 with no oracle', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const mine = await tenant('oracle', { status: 'active' });
    const theirs = await tenant('oraclet', { status: 'active' });
    const notMine = await to([theirs.orgId]);
    const unknown = await dismiss(randomUUID(), mine.ownerCookie);
    const notYours = await dismiss(notMine.id, mine.ownerCookie);
    // "Does not exist" and "is not yours" are the same refusal, byte for byte.
    expect([unknown.statusCode, notYours.statusCode]).toEqual([404, 404]);
    expect(JSON.parse(unknown.body).error.code).toBe(JSON.parse(notYours.body).error.code);
    expect(await count(`SELECT count(*) AS n FROM announcement_dismissals WHERE announcement_id = $1`, [notMine.id])).toBe(0);
  });
});

describe('the doors (no grant, no policy, no oracle)', () => {
  it('the app role cannot write a dismissal', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('grantd', { status: 'active' });
    const a = await to([t.orgId]);
    // MUTATION: add `GRANT INSERT ON announcement_dismissals TO dealpilot_app`
    // and this goes red. The definer takes no user argument, so there is no
    // way to forge a dismissal — provided this is the only door.
    const err = await refusal(() =>
      withUser(appPool, t.ownerId, (c) =>
        c.query(`INSERT INTO announcement_dismissals (announcement_id, user_id) VALUES ($1, $2)`, [a.id, t.ownerId]),
      ),
    );
    expect(err.code).toBe('42501');
  });

  it('the app role cannot read platform_announcements directly', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('grantr', { status: 'active' });
    const err = await refusal(() => withUser(appPool, t.ownerId, (c) => c.query('SELECT id FROM platform_announcements')));
    expect(err.code).toBe('42501');
  });

  it('a contextless call sees nothing — the GUC is the only recipient source', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('noctx', { status: 'active' });
    await to([t.orgId]);
    // No app.user_id: no transaction, no person, nothing returned. There is no
    // parameter to pass instead, which is the point.
    const bare = await appPool.query('SELECT * FROM announcements_for_user()');
    expect(bare.rows).toHaveLength(0);
  });
});

describe('a support session (F-71) does not widen this', () => {
  it('the staffer sees the scoped tenant’s notice and not the other one’s, and cannot dismiss either', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const one = await tenant('scope1', { status: 'active' });
    const two = await tenant('scope2', { status: 'active' });
    // One person, two dealerships — the shape F-71 built the scope GUC for.
    const email = `both-${run}-${tenantSeq}@dealpilot.test`;
    await signUp(email, 'Directeur');
    for (const host of [one, two]) {
      const added = await app!.inject({
        method: 'POST', url: '/api/v1/members', headers: { cookie: host.ownerCookie },
        payload: { organization_id: host.orgId, email, name: 'Directeur', roles: ['gm'] },
      });
      expect(added.statusCode, added.body).toBe(201);
    }
    const bothId = await userId(email);
    const forOne = await to([one.orgId]);
    const forTwo = await to([two.orgId]);

    const session = await app!.inject({
      method: 'POST', url: '/api/v1/admin/impersonation-sessions', headers: { cookie: superCookie },
      payload: { tenant_id: one.orgId, target_user_id: bothId, mode: 'full', reason: 'Ticket SUP-7714: the banner is stuck on their shell' },
    });
    expect(session.statusCode, session.body).toBe(201);
    const sessionId = (JSON.parse(session.body) as { id: string }).id;
    try {
      // MUTATION: drop `impersonation_scope_ok(o.id)` from
      // announcement_visible and the staffer sees the rival's notice too —
      // exactly the leak F-71 closed on notifications_self_read.
      const seen = (await feed(superCookie)).map((x) => x.id);
      expect(seen).toContain(forOne.id);
      expect(seen).not.toContain(forTwo.id);

      // MUTATION: remove the entry from IMPERSONATION_BLOCKED_ROUTES and this
      // goes green — a staffer would permanently silence a notice in the
      // dealer's name, with no undo and nothing to click to get it back.
      const refused = await dismiss(forOne.id, superCookie);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(JSON.parse(refused.body)).toMatchObject({ error: { code: 'impersonation_forbidden' } });
      expect(await count(`SELECT count(*) AS n FROM announcement_dismissals WHERE announcement_id = $1`, [forOne.id])).toBe(0);
    } finally {
      await app!.inject({ method: 'DELETE', url: `/api/v1/admin/impersonation-sessions/${sessionId}`, headers: { cookie: superCookie } });
    }
  });
});

describe('the register (§11)', () => {
  it('paginates by keyset, filters by severity, and counts real notifications rows', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('reg', { status: 'active' });
    const mine = [
      await to([t.orgId], { severity: 'info' }),
      await to([t.orgId], { severity: 'maintenance' }),
      await to([t.orgId], { severity: 'marketing' }),
    ];

    const page = async (qs: string) => {
      const res = await app!.inject({ method: 'GET', url: `/api/v1/admin/announcements?${qs}`, headers: { cookie: superCookie } });
      expect(res.statusCode, res.body).toBe(200);
      return AdminAnnouncementList.parse(JSON.parse(res.body));
    };
    const first = await page('limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).not.toBeNull();
    // The cursor key is the Postgres TEXT rendering of published_at, at full
    // microsecond precision. MUTATION: encode it from
    // `published_at.toISOString()` instead and this goes red — a JS Date holds
    // milliseconds, and a row published inside the discarded remainder
    // satisfies neither the current page nor the next, permanently.
    const key = JSON.parse(
      Buffer.from(first.next_cursor!, 'base64url').toString('utf-8'),
    ) as { c: string; id: string };
    const exact = await admin.query<{ t: string }>(
      `SELECT published_at::text AS t FROM platform_announcements WHERE id = $1`, [key.id],
    );
    expect(key.c).toBe(exact.rows[0]!.t);

    const second = await page(`limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    // Newest first, and the cursor never repeats a row.
    expect(new Date(second.items[0]!.published_at).getTime())
      .toBeLessThanOrEqual(new Date(first.items[0]!.published_at).getTime());

    const marketing = await page('severity=marketing&limit=100');
    expect(marketing.items.every((a) => a.severity === 'marketing')).toBe(true);
    expect(marketing.items.map((a) => a.id)).toContain(mine[2]!.id);
    expect(marketing.items.map((a) => a.id)).not.toContain(mine[0]!.id);

    // `recipients_notified` is a COUNT of rows that exist, so it can only rise
    // when the fan-out actually wrote them.
    expect(mine[0]!.recipients_notified).toBe(0);
    const fan = await appPool.query<{ inserted: number; done: boolean }>(
      'SELECT * FROM announcement_fanout_batch($1::uuid, NULL, 500)', [mine[0]!.id],
    );
    expect(fan.rows[0]!.inserted).toBeGreaterThan(0);
    const detail = AdminAnnouncement.parse(JSON.parse(
      (await app!.inject({ method: 'GET', url: `/api/v1/admin/announcements/${mine[0]!.id}`, headers: { cookie: superCookie } })).body,
    ));
    expect(detail.recipients_notified).toBe(fan.rows[0]!.inserted);
    // MUTATION: replacing the count with a stored column is impossible to do
    // quietly — there is no column to store it in.
    expect(await count(
      `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_name = 'platform_announcements' AND column_name IN ('delivered_count','fanout_cursor','fanout_completed_at')`,
    )).toBe(0);
  });

  it('a tampered or stale cursor is a 400, not a 500', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // MUTATION: split the cursor on `|` and bind the halves into
    // `$3::timestamptz`/`$4::uuid` again and every line here goes red with a
    // 500 — Postgres raises 22007/22P02, which platformErrorFrom does not map,
    // so a hand-edited query string or a bookmarked console link becomes an
    // `unhandled error` in the log drain. Every other paginated endpoint in
    // this repo answers 400 invalid_cursor.
    for (const bad of [
      'x',
      'not|a-uuid',
      '2026-01-01T00:00:00Z|nope',
      '2026-01-01T00:00:00Z',
      Buffer.from(JSON.stringify({ c: 'garbage', id: randomUUID() }), 'utf-8').toString('base64url'),
    ]) {
      const res = await app!.inject({
        method: 'GET', url: `/api/v1/admin/announcements?cursor=${encodeURIComponent(bad)}`,
        headers: { cookie: superCookie },
      });
      expect(res.statusCode, `${bad} → ${res.body}`).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('invalid_cursor');
    }
  });

  it('SQL and TypeScript agree on the two vocabularies 0068 introduces', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const sql = readFileSync(MIGRATION, 'utf-8');
    const titleKeys = [...new Set([...sql.matchAll(/'(notif_[a-z0-9_]+)'/g)].map((m) => m[1]!))];
    expect(titleKeys.length).toBeGreaterThan(0);
    for (const key of titleKeys) expect(NOTIFICATION_TITLE_KEYS, key).toContain(key);

    const def = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'platform_announcements_severity_check'`,
    );
    expect(def.rows).toHaveLength(1);
    const values = [...def.rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(values).toEqual([...AnnouncementSeverity.options].sort());
  });
});
