import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withUser, type Pool,
} from '@dealpilot/db';
import { buildApp } from '@dealpilot/api/app';
import type { AnnouncementFanoutJobT } from '@dealpilot/contracts';
import { runAnnouncementFanout, type AnnouncementFanoutResult } from './announcement-fanout.js';

/**
 * F-72 — the announcement fan-out (admin-console.md §8; D-073).
 *
 * What is worth proving here is everything the banner cannot show: the bell
 * row. Who gets one (every active member of every operational tenant the
 * audience names), who does not (a disabled account, a revoked seat, a
 * suspended or past-due tenant), how many (exactly one per PERSON, even across
 * two matching rooftops, on the first pass and on every replay), and how the
 * walk ends (a keyset cursor, a pre-check that skips rather than throws).
 *
 * Every announcement is published through the real console route and every
 * tenant status is reached through the real F-69 route, because a fan-out test
 * that INSERTs its own announcement is a test of `INSERT`.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
const sent: { to: string; text: string }[] = [];

let superCookie = '';
let corePlan = '';
let ownerAId = ''; let orgA = ''; let salesAId = '';
let ownerBId = ''; let orgB = '';

/**
 * RFC 4648 base32 + RFC 6238, the test-side oracle.
 *
 * `apps/api/src/testing/totp.ts` is the shared copy and this is deliberately
 * not a fourth one in that package's sense: `src/testing/**` is excluded from
 * the api build (tsconfig.build.json) and `@dealpilot/api` exports no subpath
 * for it, so a workers suite cannot reach it. The console routes this suite
 * drives sit behind mandatory MFA, so the alternative is not "no crypto in a
 * worker test", it is "no product route in a worker test".
 */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
}

/** A signed-in platform super admin with the second factor really enrolled. */
async function superAdmin(email: string, name: string): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [
    null, email, 'platform_super_admin', 'F-72 fan-out fixture',
  ]);
  const enable = await app!.inject({
    method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie: first }, payload: { password: PASSWORD },
  });
  expect(enable.statusCode, enable.body).toBe(200);
  const secret = new URL((JSON.parse(enable.body) as { totpURI: string }).totpURI).searchParams.get('secret')!;
  const verify = await app!.inject({
    method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie: first }, payload: { code: totp(secret) },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  const again = await app!.inject({
    method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD },
  });
  expect(JSON.parse(again.body)).toMatchObject({ twoFactorRedirect: true });
  const challenged = await app!.inject({
    method: 'POST', url: '/api/auth/two-factor/verify-totp',
    headers: { cookie: cookiesOf(again) }, payload: { code: totp(secret) },
  });
  expect(challenged.statusCode, challenged.body).toBe(200);
  return cookiesOf(challenged);
}

/** An organisation with a real owner. Born `active` — the foundation default. */
async function tenant(tag: string): Promise<{ cookie: string; orgId: string; ownerId: string }> {
  const email = `f72w-${tag}-${run}@dealpilot.test`;
  const cookie = await signUp(email, `Patron ${tag}`);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: `Groupe ${tag}`, slug: `groupe-${tag}-${run}` },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie, orgId: (JSON.parse(res.body) as { id: string }).id, ownerId: await userId(email) };
}

async function member(cookie: string, orgId: string, tag: string, roles = ['salesperson']): Promise<string> {
  const email = `f72w-${tag}-${run}@dealpilot.test`;
  await signUp(email, `Collègue ${tag}`);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email, name: `Collègue ${tag}`, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { user_id: string }).user_id;
}

function announcementBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: 'info',
    title_en: 'A note from the platform',
    title_fr: 'Un mot de la plateforme',
    body_en: 'Nothing is required of you today.',
    body_fr: "Rien n'est requis de votre part aujourd'hui.",
    audience: { type: 'all' },
    ...over,
  };
}

async function publish(over: Record<string, unknown> = {}): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/admin/announcements', headers: { cookie: superCookie },
    payload: announcementBody(over),
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function endAnnouncement(id: string): Promise<void> {
  const res = await app!.inject({
    method: 'POST', url: `/api/v1/admin/announcements/${id}/end`, headers: { cookie: superCookie },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function setTenantStatus(orgId: string, status: string, reason: string): Promise<void> {
  const res = await app!.inject({
    method: 'POST', url: `/api/v1/admin/tenants/${orgId}/status`, headers: { cookie: superCookie },
    payload: { status, reason },
  });
  expect(res.statusCode, res.body).toBe(200);
}

interface Walk {
  runs: AnnouncementFanoutResult[];
  armed: { job: AnnouncementFanoutJobT; delayMs?: number }[];
}

/** Run the job and every link it re-arms, exactly as the worker registration does. */
async function walk(announcementId: string, batchSize?: number): Promise<Walk> {
  const armed: Walk['armed'] = [];
  const pending: AnnouncementFanoutJobT[] = [{ announcement_id: announcementId }];
  const runs: AnnouncementFanoutResult[] = [];
  const deps = {
    pool: appPool,
    next: async (job: AnnouncementFanoutJobT, opts?: { delayMs?: number }) => {
      armed.push({ job, ...(opts?.delayMs === undefined ? {} : { delayMs: opts.delayMs }) });
      // A delayed link is the scheduler's business, not this walk's: re-arming
      // it here would spin until the announcement's start time.
      if (opts?.delayMs === undefined) pending.push(job);
    },
    ...(batchSize === undefined ? {} : { batchSize }),
  };
  while (pending.length > 0) {
    runs.push(await runAnnouncementFanout(pending.shift()!, deps));
    expect(runs.length, 'the keyset walk did not terminate').toBeLessThan(50);
  }
  return { runs, armed };
}

interface BellRow {
  user_id: string;
  organization_id: string;
  urgency: string;
  title_key: string;
  link: string | null;
  params: Record<string, unknown>;
}

async function bell(announcementId: string): Promise<BellRow[]> {
  const r = await admin.query<BellRow>(
    `SELECT user_id, organization_id, urgency, title_key, link, params
       FROM notifications WHERE entity_type = 'announcement' AND entity_id = $1
      ORDER BY user_id`,
    [announcementId],
  );
  return r.rows;
}

/** The recipient ids in the order the keyset walks them — asked of Postgres. */
async function inKeysetOrder(ids: string[]): Promise<string[]> {
  const r = await admin.query<{ id: string }>(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids],
  );
  return r.rows.map((x) => x.id);
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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
      mailer: {
        deliversToRecipient: true,
        async send(m) { sent.push({ to: m.to, text: m.text }); return true; },
      },
    },
  ));

  superCookie = await superAdmin(`f72w-super-${run}@dealpilot.test`, 'Exploitante Plateforme');
  corePlan = (await admin.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'core'`)).rows[0]!.id;

  const a = await tenant('a');
  orgA = a.orgId;
  ownerAId = a.ownerId;
  salesAId = await member(a.cookie, orgA, 'a-sales');
  const b = await tenant('b');
  orgB = b.orgId;
  ownerBId = b.ownerId;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('announcement fan-out (F-72, §8)', () => {
  it('an `all` announcement writes one bell row per active member of every operational tenant, with urgency by severity', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const info = await publish();
    const maintenance = await publish({
      severity: 'maintenance', title_en: 'Planned maintenance', title_fr: 'Entretien planifié',
      body_en: 'Sunday 02:00–04:00 Eastern.', body_fr: 'Dimanche 02 h–04 h, heure de l’Est.',
    });
    const incident = await publish({
      severity: 'incident', title_en: 'Sending is degraded', title_fr: 'Envoi dégradé',
      body_en: 'Outbound texts are delayed.', body_fr: 'Les textos sortants sont retardés.',
      status_incident_url: 'https://status.example.ca/incidents/42',
    });

    for (const id of [info, maintenance, incident]) await walk(id);

    const rows = await bell(info);
    // Two different rooftops, three people, one row each.
    expect(rows.map((r) => r.user_id).sort()).toEqual([ownerAId, salesAId, ownerBId].sort());
    for (const row of rows) {
      expect(row.title_key).toBe('notif_announcement_published');
      // The banner is the surface; there is no announcement page to link to,
      // and bell.tsx guards a null link.
      expect(row.link).toBeNull();
      expect(row.urgency).toBe('low');
    }
    expect(rows.find((r) => r.user_id === ownerAId)!.organization_id).toBe(orgA);
    expect(rows.find((r) => r.user_id === ownerBId)!.organization_id).toBe(orgB);

    expect((await bell(maintenance)).map((r) => r.urgency)).toEqual(['medium', 'medium', 'medium']);
    expect((await bell(incident)).map((r) => r.urgency)).toEqual(['high', 'high', 'high']);
  });

  it('every row carries BOTH titles — the language is decided when the bell is read, not when it is written', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const id = await publish({
      title_en: 'Two languages, one row', title_fr: 'Deux langues, une rangée',
    });
    await walk(id);
    const rows = await bell(id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.params).toEqual({
        title_en: 'Two languages, one row',
        title_fr: 'Deux langues, une rangée',
      });
      // `users.language_pref` is written by NOTHING in this product, so a
      // pre-picked `title` would ship one language to everybody.
      expect(row.params).not.toHaveProperty('title');
    }
  });

  it('a second pass inserts nothing — idempotence is a unique index, not a promise', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const id = await publish({ title_en: 'Said once', title_fr: 'Dit une fois' });
    const first = await walk(id);
    const before = await bell(id);
    expect(before.length).toBeGreaterThan(0);
    expect(first.runs.reduce((n, r) => n + (r.kind === 'ran' ? r.inserted : 0), 0)).toBe(before.length);

    const second = await walk(id);
    expect(second.runs.every((r) => r.kind === 'ran' && r.inserted === 0)).toBe(true);
    expect(await bell(id)).toHaveLength(before.length);
  });

  it('the keyset walk visits every recipient once and reports done at the end, and each page reports its GREATEST user id', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('keyset');
    const one = await member(t.cookie, t.orgId, 'keyset-1');
    const two = await member(t.cookie, t.orgId, 'keyset-2');
    const ordered = await inKeysetOrder([t.ownerId, one, two]);
    expect(ordered).toHaveLength(3);

    const solo = await publish({
      title_en: 'One at a time', title_fr: 'Un à la fois',
      audience: { type: 'organizations', organization_ids: [t.orgId] },
    });
    const singles = await walk(solo, 1);
    // Three pages of one, then the empty page that proves the walk is over:
    // `done` is `count(*) < limit`, so a page that fills exactly cannot know
    // it was the last.
    expect(singles.armed.map((a) => a.job.after_user_id)).toEqual(ordered);
    expect(singles.runs).toEqual([
      { kind: 'ran', inserted: 1, done: false },
      { kind: 'ran', inserted: 1, done: false },
      { kind: 'ran', inserted: 1, done: false },
      { kind: 'ran', inserted: 0, done: true },
    ]);
    expect((await bell(solo)).map((r) => r.user_id)).toEqual(ordered);

    const pairs = await publish({
      title_en: 'Two at a time', title_fr: 'Deux à la fois',
      audience: { type: 'organizations', organization_ids: [t.orgId] },
    });
    const doubles = await walk(pairs, 2);
    // The cursor is the GREATEST id of the page, not the last one inserted and
    // not `max(uuid)`, which PostgreSQL 16 does not have.
    expect(doubles.armed.map((a) => a.job.after_user_id)).toEqual([ordered[1]]);
    expect(doubles.runs).toEqual([
      { kind: 'ran', inserted: 2, done: false },
      { kind: 'ran', inserted: 1, done: true },
    ]);
    expect((await bell(pairs)).map((r) => r.user_id)).toEqual(ordered);
  });

  it('an `organizations` audience reaches that tenant and nobody else', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('targeted');
    const colleague = await member(t.cookie, t.orgId, 'targeted-sales');
    const id = await publish({
      title_en: 'For you alone', title_fr: 'Pour vous seuls',
      audience: { type: 'organizations', organization_ids: [t.orgId] },
    });
    await walk(id);
    expect((await bell(id)).map((r) => r.user_id).sort()).toEqual([t.ownerId, colleague].sort());
  });

  it('marketing skips a past_due tenant and still reaches a trial one — trial is operational', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const late = await tenant('pastdue');
    await setTenantStatus(late.orgId, 'past_due', 'F-72 fixture: the invoice failed');
    const trialOwner = await trialTenant('trial');

    const id = await publish({
      severity: 'marketing', title_en: 'New this quarter', title_fr: 'Nouveau ce trimestre',
      body_en: 'Ask us about the new board.', body_fr: 'Demandez-nous le nouveau tableau.',
    });
    await walk(id);
    const reached = (await bell(id)).map((r) => r.user_id);
    // §8: past_due and read_only are spared the marketing, trial is not.
    expect(reached).not.toContain(late.ownerId);
    expect(reached).toContain(trialOwner);
    // And the suppression is about MARKETING only — the same tenant still
    // hears about an incident.
    const notice = await publish({ title_en: 'Still informed', title_fr: 'Toujours informés' });
    await walk(notice);
    expect((await bell(notice)).map((r) => r.user_id)).toContain(late.ownerId);
  });

  it('no bell row for a disabled account and none for a revoked seat', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('excluded');
    const leaver = await member(t.cookie, t.orgId, 'excluded-leaver');
    const shutOut = await member(t.cookie, t.orgId, 'excluded-disabled');

    const seat = await admin.query<{ id: string }>(
      `SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2`, [t.orgId, leaver],
    );
    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${seat.rows[0]!.id}`, headers: { cookie: t.cookie },
      payload: { status: 'revoked' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    // `users.status = 'disabled'` has no writer anywhere in the product today
    // — every route that creates a person creates them 'active'. The join
    // guards the column the schema declares, so the only way to reach the
    // disabled half is to write the column.
    await admin.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [shutOut]);

    const id = await publish({
      title_en: 'Only the present', title_fr: 'Seulement les présents',
      audience: { type: 'organizations', organization_ids: [t.orgId] },
    });
    await walk(id);
    expect((await bell(id)).map((r) => r.user_id)).toEqual([t.ownerId]);
  });

  it('a person on TWO matching rooftops gets exactly one bell row and one feed row, filed under the lower tenant id', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const left = await tenant('twohats-l');
    const right = await tenant('twohats-r');
    const email = `f72w-twohats-${run}@dealpilot.test`;
    await signUp(email, 'Deux Chapeaux');
    for (const t of [left, right]) {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/members', headers: { cookie: t.cookie },
        payload: { organization_id: t.orgId, email, name: 'Deux Chapeaux', roles: ['sales_manager'] },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const personId = await userId(email);
    const lower = (await admin.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = ANY($1::uuid[]) ORDER BY id LIMIT 1`,
      [[left.orgId, right.orgId]],
    )).rows[0]!.id;

    const id = await publish({
      title_en: 'One person, one row', title_fr: 'Une personne, une rangée',
      audience: { type: 'organizations', organization_ids: [left.orgId, right.orgId] },
    });
    await walk(id);
    const mine = (await bell(id)).filter((r) => r.user_id === personId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.organization_id).toBe(lower);

    // The banner does not double either: the feed is per person, not per seat.
    const feed = await withUser(appPool, personId, async (c) =>
      (await c.query<{ id: string }>('SELECT id FROM announcements_for_user()')).rows,
    );
    expect(feed.filter((r) => r.id === id)).toHaveLength(1);

    await walk(id);
    const replayed = (await bell(id)).filter((r) => r.user_id === personId);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.organization_id).toBe(lower);
  });

  it('the pre-check skips a gone announcement and one whose window closed, and re-arms a scheduled one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const gone = await walk(randomUUID());
    expect(gone.runs).toEqual([{ kind: 'skipped', reason: 'announcement_gone' }]);
    expect(gone.armed).toEqual([]);

    // Ended between the publish and the consume — a deliberate act, not a
    // failure, so it must not raise PA021 out of the batch and land in a DLQ.
    const ended = await publish({ title_en: 'Called off', title_fr: 'Annulé' });
    await endAnnouncement(ended);
    const closed = await walk(ended);
    expect(closed.runs).toEqual([{ kind: 'skipped', reason: 'window_closed' }]);
    expect(await bell(ended)).toHaveLength(0);

    const startsAt = new Date(Date.now() + 3_600_000);
    const later = await publish({
      title_en: 'Not yet', title_fr: 'Pas encore', starts_at: startsAt.toISOString(),
    });
    const early = await walk(later);
    expect(early.runs).toEqual([{ kind: 'skipped', reason: 'not_started' }]);
    expect(early.armed).toHaveLength(1);
    expect(early.armed[0]!.job).toEqual({ announcement_id: later });
    // Re-armed for the start, never sooner than a second.
    expect(early.armed[0]!.delayMs).toBeGreaterThan(1000);
    expect(early.armed[0]!.delayMs).toBeLessThanOrEqual(3_600_000);
    expect(await bell(later)).toHaveLength(0);
  });

  it('an announcement published into a window that has already closed tells nobody, and nothing errors', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Legal by construction: `starts_at` is only CHECKed against `ends_at`,
    // never against now(). Backdating one is how an operator records something
    // after the fact, and the fan-out must treat it as spent, not as an error.
    const id = await publish({
      title_en: 'Already over', title_fr: 'Déjà terminé',
      starts_at: new Date(Date.now() - 7_200_000).toISOString(),
      ends_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const spent = await walk(id);
    expect(spent.runs).toEqual([{ kind: 'skipped', reason: 'window_closed' }]);
    expect(spent.armed).toEqual([]);
    expect(await bell(id)).toHaveLength(0);
  });
});

/**
 * A tenant on `trial` with a real member. Provisioning is the only birth that
 * starts there, and the seat only becomes a membership when the invited owner
 * accepts — so this is the whole F-70 path, not a status written by hand.
 */
async function trialTenant(tag: string): Promise<string> {
  const slug = `groupe-${tag}-${run}`;
  const ownerEmail = `f72w-${tag}-owner-${run}@dealpilot.test`;
  const provisioned = await app!.inject({
    method: 'POST', url: '/api/v1/admin/tenants', headers: { cookie: superCookie },
    payload: {
      legal_name: `Groupe ${tag} inc.`, display_name: `Groupe ${tag}`, slug, province: 'QC',
      plan_id: corePlan, owner_email: ownerEmail, owner_name: 'Propriétaire Essai',
      stores: [{ name: `Kia ${tag}`, code: `${tag.slice(0, 6)}-1`, province: 'QC' }],
    },
  });
  expect(provisioned.statusCode, provisioned.body).toBe(201);
  const born = (JSON.parse(provisioned.body) as { tenant: { id: string; status: string } }).tenant;
  expect(born.status).toBe('trial');

  const mail = [...sent].reverse().find((m) => m.to === ownerEmail.toLowerCase());
  expect(mail, `no invitation email to ${ownerEmail}`).toBeDefined();
  const token = /\/invitations\/([A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
  const cookie = await signUp(ownerEmail, 'Propriétaire Essai');
  const accepted = await app!.inject({
    method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie }, payload: { token },
  });
  expect(accepted.statusCode, accepted.body).toBe(201);
  return userId(ownerEmail.toLowerCase());
}
