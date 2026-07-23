import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

/**
 * A-05 integration tests — real Fastify app against the local Docker Postgres
 * (identity tables from migration 0002). Uses fastify.inject: full HTTP
 * semantics, no sockets. Self-skips without a database (RLS_REQUIRED=1 turns
 * that into a failure in CI, same convention as the db package).
 */

const ADMIN_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const APP_URL = 'postgresql://dealpilot_app:dealpilot_app_dev@localhost:5434/dealpilot';

let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

const EMAIL = `test-${Date.now().toString(36)}@dealpilot.test`;
const PASSWORD = 'correct-horse-battery-staple';

beforeAll(async () => {
  const probe = await buildApp({ DATABASE_URL: ADMIN_URL, NODE_ENV: 'test' });
  const health = await probe.app.inject({ method: 'GET', url: '/api/v1/health' });
  const dbState = (JSON.parse(health.body) as { db: string }).db;
  await probe.app.close();
  if (dbState !== 'up') {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  dbUp = true;
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));
});

afterAll(async () => {
  await app?.close();
});

describe('api skeleton', () => {
  it('health is public and reports db up', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', db: 'up' });
  });

  it('unknown routes return the canonical error envelope', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    // Deny-by-default: unauthenticated hits the 401 gate before routing.
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('unauthenticated');
    expect(typeof body.error.request_id).toBe('string');
  });

  it('protected routes reject unauthenticated requests (deny by default)', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('unauthenticated');
  });

  it('gate regression: path tricks never reach protected routes without a session', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    // The allowlist keys on the ROUTED pattern, so traversal/normalization
    // tricks either 404 inside the auth wildcard or hit the 401 gate — never
    // a protected handler (code-review M2, 2026-07-24).
    for (const url of ['/api/auth/../v1/me', '//api/v1/me', '/api/v1/me/../me']) {
      const res = await app.inject({ method: 'GET', url });
      expect([401, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain('"user"');
    }
  });

  it('malformed JSON gets the canonical envelope with a stable code', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.code).not.toMatch(/^FST_/);
  });

  it('sign-up → me → sign-out round-trip with HttpOnly cookie session', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();

    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: EMAIL, password: PASSWORD, name: 'Test Owner' },
    });
    expect(signUp.statusCode).toBe(200);
    const setCookie = signUp.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie!])
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(String(setCookie)).toMatch(/HttpOnly/i);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(200);
    const body = JSON.parse(me.body);
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.name).toBe('Test Owner');

    const signOut = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie: cookieHeader },
    });
    expect(signOut.statusCode).toBe(200);

    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader },
    });
    expect(meAfter.statusCode).toBe(401);
  });

  it('session cookie carries the hardened 7-day TTL (A-05.1)', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toMatch(/Max-Age=604800/);
  });

  it('CORS preflight is cached and headers are restricted (A-05.1)', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.headers['access-control-max-age']).toBe('86400');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
  });

  it('a spoofed Host header cannot redirect auth URLs (A-05.1: baseURL host)', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { host: 'evil.example' },
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).not.toContain('evil.example');
  });

  it('sign-in works for an existing account and rejects a wrong password', async (ctx) => {
    if (!dbUp || !app) return ctx.skip();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: EMAIL, password: 'wrong-password-123' },
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(good.statusCode).toBe(200);
    expect(good.headers['set-cookie']).toBeDefined();
  });
});
