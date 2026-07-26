import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { AA_TEXT, contrastRatio, oklchToHex, parseColor, SURFACE_LIGHT } from '@dealpilot/core';
import { buildApp } from './app.js';
import type { EmailMessage, Mailer } from './email.js';

/**
 * F-14 white-label branding.
 *
 * The colour maths is golden-tested in packages/core. This is about the two
 * things only the server can promise: that a draft is never served to the sales
 * floor, and that the accessibility guarantee survives a client which is free to
 * ask for unreadable colours.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
const sent: EmailMessage[] = [];
const mailer: Mailer = {
  deliversToRecipient: true,
  async send(message) {
    sent.push(message);
    return true;
  },
};

let cookie = '';
let orgId = '';

async function putBranding(payload: Record<string, unknown>) {
  return app!.inject({
    method: 'PUT', url: `/api/v1/organizations/${orgId}/branding`, headers: { cookie }, payload,
  });
}

async function publish() {
  return app!.inject({
    method: 'POST', url: `/api/v1/organizations/${orgId}/branding/publish`, headers: { cookie }, payload: {},
  });
}

async function current() {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/branding', headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as null | {
    palette: Record<string, Record<string, string>>;
    version: number;
    display_name: string | null;
  };
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

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `brand-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Brand', slug: `groupe-brand-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('a draft never reaches the sales floor', () => {
  it('an unbranded tenant gets null, not an error', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // 404 here would break first paint for every tenant who has not opened the
    // editor. The platform's own theme is a perfectly good answer.
    expect(await current()).toBeNull();
  });

  it('saving a colour changes nothing for anyone until it is published', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const saved = await putBranding({ display_name: 'Groupe Hassan', primary_color: '#1e3a8a' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(JSON.parse(saved.body).status).toBe('draft');

    // Somebody trying colours at 4pm on a Friday must not repaint the app.
    expect(await current()).toBeNull();

    expect((await publish()).statusCode).toBe(200);
    const live = await current();
    expect(live).not.toBeNull();
    expect(live!.display_name).toBe('Groupe Hassan');
  });

  it('editing a published brand puts it back in draft and leaves the live one alone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await current();
    await putBranding({ primary_color: '#7c3aed' });

    const stillLive = await current();
    // The live palette is the PUBLISHED one, unchanged by an unpublished edit.
    expect(stillLive!.palette).toEqual(before!.palette);
    expect(stillLive!.version).toBe(before!.version);

    await publish();
    const after = await current();
    expect(after!.version).toBe(before!.version + 1);
    expect(after!.palette).not.toEqual(before!.palette);
  });
});

describe('the accessibility promise survives a hostile client', () => {
  it('publishes an unreadable brand — with the text variant fixed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Pale yellow: about 1.1:1 on white. Refusing it would leave the tenant
    // unable to use their own brand; shipping it raw would leave links nobody
    // can read. The spec's answer is publish, and fix the text variant.
    await putBranding({ primary_color: '#fde047' });
    const res = await publish();
    expect(res.statusCode, res.body).toBe(200);

    const live = await current();
    // The FILL is exactly what they asked for.
    expect(oklchToHex(parseColor(live!.palette['fills']!['primary']!))).toBe('#fde047');
    // The TEXT variant is readable.
    expect(contrastRatio(parseColor(live!.palette['text']!['primary']!), SURFACE_LIGHT))
      .toBeGreaterThanOrEqual(AA_TEXT);
    // And the button label on that yellow is readable too.
    expect(
      contrastRatio(
        parseColor(live!.palette['foregrounds']!['primary']!),
        parseColor(live!.palette['fills']!['primary']!),
      ),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('records what it changed, with the numbers', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding`, headers: { cookie },
    });
    const body = JSON.parse(res.body) as {
      contrast_adjustments: { token: string; ratioBefore: number; ratioAfter: number }[];
    };
    const primary = body.contrast_adjustments.find((a) => a.token === 'primary');
    expect(primary, 'an auto-fix with nothing recorded is an unexplainable colour change').toBeDefined();
    expect(primary!.ratioBefore).toBeLessThan(AA_TEXT);
    expect(primary!.ratioAfter).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('normalises hex to OKLCH on the way in, so one colour has one spelling', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await putBranding({ primary_color: '#3b82f6' });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding`, headers: { cookie },
    });
    const stored = (JSON.parse(res.body) as { primary_color: string }).primary_color;
    expect(stored.startsWith('oklch(')).toBe(true);
    expect(oklchToHex(parseColor(stored))).toBe('#3b82f6');
  });

  it('refuses a colour it cannot understand rather than defaulting one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A silently-defaulted colour is a brand nobody chose.
    expect((await putBranding({ primary_color: 'cornflowerblue' })).statusCode).toBe(422);
    expect((await putBranding({ primary_color: 'rgb(1,2,3)' })).statusCode).toBe(422);
  });

  it('refuses a custom font with no file — it would silently fall back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await putBranding({ font_family: 'custom' })).statusCode).toBe(422);
    expect((await putBranding({ font_family: 'custom', font_woff2_key: 'k/font.woff2' })).statusCode).toBe(200);
  });

  it('refuses an empty body rather than answering 200 to nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await putBranding({})).statusCode).toBe(422);
  });
});

describe('who may change the brand', () => {
  it("another organisation's branding is a 404, and its brand never leaks", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');

    for (const [method, url] of [
      ['GET', `/api/v1/organizations/${orgId}/branding`],
      ['PUT', `/api/v1/organizations/${orgId}/branding`],
      ['POST', `/api/v1/organizations/${orgId}/branding/publish`],
    ] as const) {
      const res = await app!.inject({
        method, url, headers: { cookie: outCookie },
        ...(method === 'PUT' ? { payload: { primary_color: '#000000' } } : {}),
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('a salesperson can SEE the brand but cannot change it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Reading is deliberately open to every member — the brand is the skin of
    // the app they are already inside, and gating it would render the page
    // unbranded for everyone but the owner.
    const sales = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-sales-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sam' },
    });
    const ssc = sales.headers['set-cookie'];
    const salesCookie = (Array.isArray(ssc) ? ssc : [ssc!]).map((c) => c!.split(';')[0]).join('; ');
    // Joined through the INVITATION flow, which is the only path that
    // establishes the 1:1 identity link between an account and a domain user
    // (D-025, migration 0015). Adding by email creates a placeholder row with a
    // different id, so a person who already has an account would be added to
    // the team and see nothing — filed as CR-14, not worked around here.
    const invited = await app!.inject({
      method: 'POST', url: '/api/v1/invitations', headers: { cookie },
      payload: { organization_id: orgId, email: `brand-sales-${run}@dealpilot.test`, roles: ['salesperson'] },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const token = /\/invitations\/([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1]!.text)![1]!;
    const accepted = await app!.inject({
      method: 'POST', url: '/api/v1/invitations/accept',
      headers: { cookie: salesCookie }, payload: { token },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);

    const read = await app!.inject({ method: 'GET', url: '/api/v1/branding', headers: { cookie: salesCookie } });
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.body)).not.toBeNull();

    const write = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${orgId}/branding`,
      headers: { cookie: salesCookie }, payload: { primary_color: '#ff0000' },
    });
    // A colleague with the wrong role is a 403 — they exist, they just may not.
    expect(write.statusCode).toBe(403);
  });
});
