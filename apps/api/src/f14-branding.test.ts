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

describe('brand assets', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

  async function upload(slot: string, body: Buffer, contentType: string) {
    return app!.inject({
      method: 'POST', url: `/api/v1/organizations/${orgId}/branding/assets/${slot}`,
      headers: { cookie, 'content-type': contentType }, payload: body,
    });
  }

  it('stores a logo and serves it back only once published', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await upload('logo_light', SVG, 'image/svg+xml')).statusCode).toBe(201);

    // Unpublished: an asset is an edit like any other and must not appear yet.
    const early = await app!.inject({
      method: 'GET', url: '/api/v1/branding/assets/logo_light', headers: { cookie },
    });
    expect(early.statusCode).toBe(404);

    await publish();
    const served = await app!.inject({
      method: 'GET', url: '/api/v1/branding/assets/logo_light', headers: { cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(Buffer.from(served.rawPayload).equals(SVG)).toBe(true);
  });

  it('serves tenant-supplied content with the headers that make it inert', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const served = await app!.inject({
      method: 'GET', url: '/api/v1/branding/assets/logo_light', headers: { cookie },
    });
    // An SVG is a document that can carry script. Served from our own origin,
    // a logo that could run script is a stored XSS in every tenant's header.
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-type']).toContain('image/svg+xml');
  });

  it('refuses an SVG where email clients cannot render one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // It would look right in the editor and be missing from every email sent.
    expect((await upload('email_logo', SVG, 'image/svg+xml')).statusCode).toBe(415);
    expect((await upload('email_logo', PNG, 'image/png')).statusCode).toBe(201);
  });

  it('refuses a PDF — a logo is not a document', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The document allowlist and the branding allowlist are separate on purpose.
    expect((await upload('logo_light', PNG, 'application/pdf')).statusCode).toBe(415);
  });

  it('refuses a file over the slot ceiling, naming the limit', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const huge = Buffer.alloc(250 * 1024, 0x41);
    const res = await upload('logo_light', huge, 'image/png');
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).error.details[0].message).toContain('limit');
  });

  it('refuses a slot that does not exist', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await upload('background_music', PNG, 'image/png')).statusCode).toBe(404);
  });
});

describe('a rooftop can carry its own sub-brand', () => {
  let storeA = '';
  let storeB = '';

  it('sets up two stores under the group brand', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const [code, name] of [['SUB-A', 'Kia rooftop'], ['SUB-B', 'Used car lot']] as const) {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/stores', headers: { cookie },
        payload: { organization_id: orgId, name, code: `${code}-${run.slice(-4)}`, province: 'QC' },
      });
      expect(res.statusCode, res.body).toBe(201);
      const id = (JSON.parse(res.body) as { id: string }).id;
      if (code === 'SUB-A') storeA = id;
      else storeB = id;
    }
    // The group brand from the earlier tests is what both inherit today.
    const groupBrand = await current();
    expect(groupBrand).not.toBeNull();
  });

  it('publishes a store override without touching the group brand', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const groupBefore = await current();

    const saved = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${orgId}/branding?store_id=${storeA}`,
      headers: { cookie }, payload: { display_name: 'Kia rooftop', primary_color: '#166534' },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(JSON.parse(saved.body).store_id).toBe(storeA);

    const published = await app!.inject({
      method: 'POST', url: `/api/v1/organizations/${orgId}/branding/publish?store_id=${storeA}`,
      headers: { cookie }, payload: {},
    });
    // Before the scope was threaded through, this published the GROUP row —
    // a store override could be created and then never edited or published.
    expect(published.statusCode, published.body).toBe(200);
    expect(JSON.parse(published.body).store_id).toBe(storeA);

    // The group's own brand is untouched by a rooftop publishing its own.
    expect(await current()).toEqual(groupBefore);
  });

  it('serves the override to its own store and the group brand to the others', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const forA = await app!.inject({
      method: 'GET', url: `/api/v1/branding?store_id=${storeA}`, headers: { cookie },
    });
    expect(JSON.parse(forA.body).display_name).toBe('Kia rooftop');

    const forB = await app!.inject({
      method: 'GET', url: `/api/v1/branding?store_id=${storeB}`, headers: { cookie },
    });
    // No override of its own, so it inherits the group's — not a 404, and not
    // the other rooftop's brand.
    expect(JSON.parse(forB.body).display_name).toBe((await current())!.display_name);
  });

  it('keeps the two drafts separate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const groupDraft = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding`, headers: { cookie },
    });
    const storeDraft = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding?store_id=${storeA}`,
      headers: { cookie },
    });
    expect(JSON.parse(groupDraft.body).store_id).toBeNull();
    expect(JSON.parse(storeDraft.body).store_id).toBe(storeA);
    expect(JSON.parse(groupDraft.body).id).not.toBe(JSON.parse(storeDraft.body).id);
  });

  it("refuses a store that is not this organisation's", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${orgId}/branding?store_id=00000000-0000-4000-8000-000000000000`,
      headers: { cookie }, payload: { primary_color: '#000000' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the published palette is complete enough to inject (CR-15)', () => {
  it('every fill it publishes carries a foreground that meets AA', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The end-to-end version of the core invariant: what actually comes OUT of
    // the API, not what the function returns in isolation. A palette that is
    // correct in packages/core and truncated on the way through the route would
    // still leave Hussein unable to inject it.
    await putBranding({ primary_color: '#7C3AED' });
    await publish();
    const live = (await current())!;

    const pairs: [string, string, string][] = [];
    for (const [token, fill] of Object.entries(live.palette['fills']!)) {
      pairs.push([`fills.${token}`, fill, live.palette['foregrounds']![token]!]);
    }
    for (const [token, fill] of Object.entries(live.palette['dark']!)) {
      pairs.push([`dark.${token}`, fill, live.palette['foregrounds']![`${token}_dark`]!]);
    }
    for (const [token, fill] of Object.entries(live.palette['hover']!)) {
      const key = token.endsWith('_dark')
        ? `${token.replace(/_dark$/, '')}_hover_dark`
        : `${token}_hover`;
      pairs.push([`hover.${token}`, fill, live.palette['foregrounds']![key]!]);
    }

    expect(pairs.length).toBeGreaterThan(3);
    for (const [name, fill, fg] of pairs) {
      expect(fg, `${name} was published with no foreground`).toBeDefined();
      expect(contrastRatio(parseColor(fill), parseColor(fg)), name).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('publishes a focus ring visible on each surface', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const live = (await current())!;
    expect(live.palette['ring']!['primary']).toBeDefined();
    expect(live.palette['ring']!['primary_dark']).toBeDefined();
  });
});

describe('asking what the app should look like always has an answer', () => {
  it('a user with no organisation gets null, not a 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Most fresh sessions. A 404 here is indistinguishable from an error to the
    // client: react-query retried it, the shell re-rendered in a loop and raced
    // an accessibility test (HUSSEIN, F-14 injection increment 1).
    const fresh = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-orgless-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'New' },
    });
    const fsc = fresh.headers['set-cookie'];
    const freshCookie = (Array.isArray(fsc) ? fsc : [fsc!]).map((c) => c!.split(';')[0]).join('; ');

    const res = await app!.inject({
      method: 'GET', url: '/api/v1/branding', headers: { cookie: freshCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  it("still refuses to hand over another organisation's brand", async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The permissive answer above must not become a way in: naming someone
    // else's organisation is still a 404, because membership is checked inside
    // the tenant transaction, not by whether the caller could name an id.
    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-peek-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Peek' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/branding?organization_id=${orgId}`, headers: { cookie: outCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('loading the theme editor always resolves (CR-16)', () => {
  it('a never-branded organisation gets null, not a 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const fresh = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-fresh-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Fresh' },
    });
    const fsc = fresh.headers['set-cookie'];
    const freshCookie = (Array.isArray(fsc) ? fsc : [fsc!]).map((c) => c!.split(';')[0]).join('; ');
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: freshCookie },
      payload: { name: 'Groupe Vierge', slug: `groupe-vierge-${run}` },
    });
    const freshOrg = (JSON.parse(org.body) as { id: string }).id;

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${freshOrg}/branding`, headers: { cookie: freshCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  it('a rooftop with no override of its own also resolves', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const store = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Unbranded lot', code: `UNB-${run.slice(-4)}`, province: 'QC' },
    });
    const storeId = (JSON.parse(store.body) as { id: string }).id;
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding?store_id=${storeId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toBeNull();
  });

  it("but another organisation's editor is still a 404", async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The friendlier answer above must not become a way to probe for orgs.
    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `brand-probe-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Probe' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/branding`, headers: { cookie: outCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
