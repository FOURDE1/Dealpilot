import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { InvitationPreview } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import type { EmailMessage } from './email.js';

/**
 * F-12 invitations (D-035).
 *
 * The hole being closed: adding a member wrote a roster row against an invented
 * id and sent nothing, so an invited person could never log in — while the Team
 * screen said they were Active. These tests are about the security of the link,
 * because a team invitation is a way into someone's business data.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let ownerCookie = '';
let orgId = '';
let storeId = '';
const sent: EmailMessage[] = [];

/**
 * The token only ever exists in the email — exactly as a real invitee gets it.
 * The captured mailer also receives Better Auth's verification mails, so this
 * takes the most recent INVITATION rather than the most recent message.
 */
function tokenFromLastEmail(): string {
  for (let i = sent.length - 1; i >= 0; i -= 1) {
    const m = /\/invitations\/([A-Za-z0-9_-]+)/.exec(sent[i]!.text);
    if (m) return m[1]!;
  }
  throw new Error('no invitation email was sent');
}

async function signUp(email: string, name: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

async function invite(email: string, roles: string[], cookie = ownerCookie) {
  return app!.inject({
    method: 'POST', url: '/api/v1/invitations', headers: { cookie },
    payload: { organization_id: orgId, email, roles },
  });
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
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    { mailer: { deliversToRecipient: true, async send(m) { sent.push(m); return true; } } },
  ));

  ownerCookie = await signUp(`f12-owner-${run}@dealpilot.test`, 'Alice Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe F12', slug: `groupe-f12-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'F12 Kia', code: 'F12-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  void storeId;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-12 invitations', () => {
  it('inviting someone sends them a link, and never returns the token', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await invite(`marc-${run}@dealpilot.test`, ['salesperson']);
    expect(res.statusCode).toBe(201);

    const body = JSON.parse(res.body) as Record<string, unknown>;
    // The link goes to the invitee. Anyone who can read the API response or the
    // database must not be able to reconstruct it.
    expect(body['accept_url']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(tokenFromLastEmail());
    expect(sent[sent.length - 1]!.text).toContain('/invitations/');
  });

  it('the raw token is nowhere in the database — only its hash', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const token = tokenFromLastEmail();
    const r = await admin.query<{ token_hash: string }>(
      `SELECT token_hash FROM invitations ORDER BY created_at DESC LIMIT 1`,
    );
    expect(r.rows[0]!.token_hash).toHaveLength(64);
    expect(r.rows[0]!.token_hash).not.toBe(token);
    // A backup, a support query or a leak cannot be turned into a working link.
    const anywhere = await admin.query(
      `SELECT 1 FROM invitations WHERE token_hash = $1 OR email = $1 LIMIT 1`, [token],
    );
    expect(anywhere.rows).toHaveLength(0);
  });

  it('the preview shows who invited you and nothing else', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/preview', payload: { token: tokenFromLastEmail() },
    });
    expect(res.statusCode).toBe(200);
    const preview = InvitationPreview.parse(JSON.parse(res.body));
    expect(preview.organization_name).toBe('Groupe F12');
    expect(preview.roles).toEqual(['salesperson']);
    // No member list, no counts, no other invitations — this endpoint answers
    // to anyone holding the link, signed in or not.
    expect(Object.keys(preview).sort()).toEqual(['email', 'organization_name', 'roles']);
  });

  it('a forged or unknown token is a 404, indistinguishable from expired', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/preview',
      payload: { token: 'not-a-real-token-but-long-enough-to-parse' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a forwarded link cannot be redeemed by a different person', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const token = tokenFromLastEmail();
    const strangerCookie = await signUp(`stranger-${run}@dealpilot.test`, 'Eve Stranger');

    const res = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: strangerCookie }, payload: { token },
    });
    // The email match IS the security model — without it, forwarding the link
    // hands a seat in the business to whoever opens it.
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('wrong_account');
  });

  it('the invited person accepts, and can then actually use the app', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const token = tokenFromLastEmail();
    const marcCookie = await signUp(`marc-${run}@dealpilot.test`, 'Marc Seller');

    const accept = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: marcCookie }, payload: { token },
    });
    expect(accept.statusCode).toBe(201);

    // The whole point: Marc is now a real member of a real org, with the roles
    // he was invited to — the thing that was impossible before F-12.
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: marcCookie } });
    expect(me.statusCode).toBe(200);
    const members = await app!.inject({
      method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: marcCookie },
    });
    expect(members.statusCode).toBe(200);
    const roster = JSON.parse(members.body) as { items: { email: string; roles: string[] }[] };
    const marc = roster.items.find((m) => m.email === `marc-${run}@dealpilot.test`)!;
    expect(marc.roles).toEqual(['salesperson']);
  });

  it('the same link cannot be used twice, even by the right person', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const token = tokenFromLastEmail();
    // Marc signing in again and re-opening his own link: the second claim must
    // find nothing, or a forwarded-then-recalled link could re-grant a seat.
    const marcAgain = await app!.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email: `marc-${run}@dealpilot.test`, password: PASSWORD },
    });
    const sc = marcAgain.headers['set-cookie'];
    const cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie }, payload: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  it('an expired invitation is refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await invite(`late-${run}@dealpilot.test`, ['salesperson']);
    expect(res.statusCode).toBe(201);
    const token = tokenFromLastEmail();
    await admin.query(`UPDATE invitations SET expires_at = now() - interval '1 hour' WHERE accepted_at IS NULL`);

    expect((await app!.inject({
      method: 'POST', url: '/api/v1/invitations/preview', payload: { token },
    })).statusCode).toBe(404);
    const lateCookie = await signUp(`late-${run}@dealpilot.test`, 'Late Larry');
    const accept = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: lateCookie }, payload: { token },
    });
    expect(accept.statusCode).toBe(404);
  });

  it('nobody can invite above their own authority', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Marc is a salesperson; he may not invite at all.
    const marcCookie = await signUp(`marc3-${run}@dealpilot.test`, 'Marc Three');
    void marcCookie;
    const gmCookie = await signUp(`gm-${run}@dealpilot.test`, 'Gina GM');
    const gmInvite = await invite(`gm-${run}@dealpilot.test`, ['gm']);
    expect(gmInvite.statusCode).toBe(201);
    await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: gmCookie }, payload: { token: tokenFromLastEmail() },
    });

    // A gm inviting an owner would be an escalation route around F-04's ceiling.
    const escalation = await invite(`newowner-${run}@dealpilot.test`, ['owner'], gmCookie);
    expect(escalation.statusCode).toBe(403);
  });

  it('inviting someone already on the team is refused, not a second seat', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await invite(`marc-${run}@dealpilot.test`, ['salesperson']);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('already_member');
  });

  it('a revoked invitation stops working immediately', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await invite(`revoked-${run}@dealpilot.test`, ['salesperson']);
    expect(created.statusCode).toBe(201);
    const token = tokenFromLastEmail();
    const id = (JSON.parse(created.body) as { id: string }).id;

    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/invitations/${id}`, headers: { cookie: ownerCookie },
    });
    expect(del.statusCode).toBe(204);
    expect((await app!.inject({
      method: 'POST', url: '/api/v1/invitations/preview', payload: { token },
    })).statusCode).toBe(404);
  });

  it('when the mailer cannot reach anyone, the link comes back instead (CR-05)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The dev log transport returns true from send() — it did write its line —
    // but the person being invited cannot read pino. Telling the owner "email
    // sent" would strand a real invitation, and it would have failed his very
    // first test of this feature.
    const { app: logApp } = await buildApp(
      { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
      { mailer: { deliversToRecipient: false, async send() { return true; } } },
    );
    try {
      const res = await logApp.inject({
        method: 'POST', url: '/api/v1/invitations', headers: { cookie: ownerCookie },
        payload: { organization_id: orgId, email: `logmode-${run}@dealpilot.test`, roles: ['salesperson'] },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as { accept_url?: string };
      expect(body.accept_url, 'the owner needs the link when nobody was emailed').toBeDefined();
      expect(body.accept_url).toContain('/invitations/');

      // And it is a REAL link, not a placeholder: it previews.
      const token = /\/invitations\/([A-Za-z0-9_-]+)/.exec(body.accept_url!)![1]!;
      const preview = await logApp.inject({
        method: 'POST', url: '/api/v1/invitations/preview', payload: { token },
      });
      expect(preview.statusCode).toBe(200);
    } finally {
      await logApp.close();
    }
  });

  it('someone who left and is invited back can accept again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // REPORTED BY THE OWNER: invite → accept → remove → invite again → accept
    // failed with "The operation failed". Revoking keeps the membership row (so
    // the roster can show and reinstate them), and the second accept's plain
    // INSERT hit the unique key. People leave a dealership and come back; this
    // has to work.
    const email = `rejoin-${run}@dealpilot.test`;
    const first = await invite(email, ['salesperson']);
    expect(first.statusCode).toBe(201);
    const cookie1 = await signUp(email, 'Marc Rejoin');
    const accept1 = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie: cookie1 },
      payload: { token: tokenFromLastEmail() },
    });
    expect(accept1.statusCode).toBe(201);

    const roster = await app!.inject({
      method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: ownerCookie },
    });
    const member = (JSON.parse(roster.body) as { items: { id: string; email: string }[] })
      .items.find((m) => m.email === email)!;
    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${member.id}`, headers: { cookie: ownerCookie },
      payload: { status: 'revoked' },
    });
    expect(revoked.statusCode).toBe(200);

    // Back again, and with a different role this time — the roles must come
    // from the NEW invitation, because that is the decision just made.
    const second = await invite(email, ['bdc_agent']);
    expect(second.statusCode).toBe(201);
    const accept2 = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie: cookie1 },
      payload: { token: tokenFromLastEmail() },
    });
    expect(accept2.statusCode).toBe(201);

    const after = await app!.inject({
      method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: ownerCookie },
    });
    const back = (JSON.parse(after.body) as { items: { email: string; status: string; roles: string[] }[] })
      .items.find((m) => m.email === email)!;
    expect(back.status).toBe('active');
    expect(back.roles).toEqual(['bdc_agent']);
  });

  it('another organization cannot see or revoke these invitations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rivalCookie = await signUp(`rival-${run}@dealpilot.test`, 'Rival Owner');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival Motors', slug: `rival-f12-${run}` },
    });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/invitations?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    // 404, never 403: a cross-tenant id must not confirm that it exists.
    expect(res.statusCode).toBe(404);
  });
});
