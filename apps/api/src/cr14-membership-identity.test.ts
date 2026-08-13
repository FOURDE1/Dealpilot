import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';
import type { EmailMessage, Mailer } from './email.js';

/**
 * A membership must belong to somebody who can sign in (CR-14, D-025).
 *
 * `POST /api/v1/members` used to mint a fresh uuid for the domain user row. That
 * id could never match the one Better Auth issues at sign-in, so the person was
 * `active` on the team and saw an empty application — and it was a DEAD END: the
 * repair path, an invitation, was refused with 409 "already a member" by the very
 * membership that broke them. Nothing in the product could get them out.
 *
 * The invariant at the bottom is the real deliverable. The route can be rewritten
 * a dozen ways; what must never change is that no active membership points at
 * somebody who cannot log in.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

const sent: EmailMessage[] = [];
const mailer: Mailer = { deliversToRecipient: true, async send(m) { sent.push(m); return true; } };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';

async function signUp(email: string, name: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name },
  });
  expect(res.statusCode, res.body).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { mailer }));

  cookie = await signUp(`cr14-owner-${run}@dealpilot.test`, 'Alice Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe CR14', slug: `groupe-cr14-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('adding a colleague', () => {
  it('links to the account they already have — and they can see the org', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `cr14-has-account-${run}@dealpilot.test`;
    const theirCookie = await signUp(email, 'Sam Sales');

    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: { organization_id: orgId, email, name: 'Sam Sales', roles: ['salesperson'] },
    });
    expect(added.statusCode, added.body).toBe(201);

    // The whole point: they log in and the organisation is THERE.
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: theirCookie } });
    const theirId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
    expect((JSON.parse(added.body) as { user_id: string }).user_id).toBe(theirId);

    const leads = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgId}`, headers: { cookie: theirCookie },
    });
    expect(leads.statusCode, 'an active member who can see nothing is the bug').toBe(200);
  });

  it('refuses somebody with no account, and names the door that works', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Refusing is not a limitation — it is the difference between "not added
    // yet" and "added and permanently locked out".
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: {
        organization_id: orgId, email: `cr14-nobody-${run}@dealpilot.test`,
        name: 'Ghost', roles: ['salesperson'],
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'needs_invitation' } });
    expect(JSON.parse(res.body).error.details[0].message).toContain('Invite');
  });

  it('the invitation path still works for that person, end to end', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `cr14-invited-${run}@dealpilot.test`;
    const inv = await app!.inject({
      method: 'POST', url: '/api/v1/invitations', headers: { cookie },
      payload: { organization_id: orgId, email, roles: ['salesperson'] },
    });
    expect(inv.statusCode, inv.body).toBe(201);

    const theirCookie = await signUp(email, 'Invited Person');
    // Backwards through the outbox: the sign-up verification mail lands AFTER
    // the invitation, so "the last email" is the wrong one.
    let token = '';
    for (let i = sent.length - 1; i >= 0 && !token; i -= 1) {
      token = /\/invitations\/([A-Za-z0-9_-]+)/.exec(sent[i]!.text)?.[1] ?? '';
    }
    expect(token, 'no invitation email was sent').not.toBe('');
    const accepted = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: theirCookie }, payload: { token },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);

    const leads = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgId}`, headers: { cookie: theirCookie },
    });
    expect(leads.statusCode).toBe(200);
  });
});

describe('the invariant', () => {
  it('no active membership belongs to somebody who cannot sign in', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Read straight from the database, across every row this suite created.
    // The route can be rewritten any number of ways; this must stay true.
    const orphans = await admin.query<{ email: string; user_id: string }>(
      `SELECT u.email, m.user_id::text AS user_id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.status = 'active'
         AND NOT EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.id::text)`,
    );
    expect(
      orphans.rows,
      `these people are active on a team and cannot log in: ${orphans.rows.map((o) => o.email).join(', ')}`,
    ).toEqual([]);
  });
});
