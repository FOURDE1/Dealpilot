import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';
import { memoryRateLimiter } from './rate-limit.js';

/**
 * F-44 — rate limiting (D-048): the bucket's math with a spun clock, and the
 * three gated surfaces through real routes. The suite injects the MEMORY
 * limiter with its own clock — proving a 429 by sending thirty real requests
 * would be a slow test asserting the wrong thing.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

describe('the token bucket, golden', () => {
  it('a full bucket serves its burst, then refuses with an honest retry-after', async () => {
    const now = 0;
    const limiter = memoryRateLimiter(() => now);
    for (let i = 0; i < 5; i++) {
      expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(true);
    }
    const refused = await limiter.take('k', { ratePerMinute: 60, burst: 5 });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterS).toBe(1); // 60/min = 1 token per second
  });

  it('tokens refill at the rate, never past the burst', async () => {
    let now = 0;
    const limiter = memoryRateLimiter(() => now);
    for (let i = 0; i < 5; i++) await limiter.take('k', { ratePerMinute: 60, burst: 5 });
    now += 2000; // two tokens back
    expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(true);
    expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(true);
    expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(false);
    now += 60 * 60_000; // an hour later the bucket is FULL, not overflowing
    for (let i = 0; i < 5; i++) {
      expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(true);
    }
    expect((await limiter.take('k', { ratePerMinute: 60, burst: 5 })).allowed).toBe(false);
  });

  it('buckets are independent per key', async () => {
    const limiter = memoryRateLimiter(() => 0);
    await limiter.take('a', { ratePerMinute: 60, burst: 1 });
    expect((await limiter.take('a', { ratePerMinute: 60, burst: 1 })).allowed).toBe(false);
    expect((await limiter.take('b', { ratePerMinute: 60, burst: 1 })).allowed).toBe(true);
  });
});

describe('the gated surfaces', () => {
  let admin: Pool;
  let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
  let dbUp = false;
  let clock = 1_000_000;

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
      { rateLimiter: memoryRateLimiter(() => clock) },
    ));
  });

  afterAll(async () => {
    await app?.close();
    await admin?.end();
  });

  it('sign-in guessing runs into the per-EMAIL wall — and a different account is unaffected', async (ctx) => {
    if (!dbUp) return ctx.skip();
    clock += 10 * 60_000; // a fresh window
    const target = `victim-${run}@dealpilot.test`;
    let refused = 0;
    for (let i = 0; i < 10; i++) {
      const res = await app!.inject({
        method: 'POST', url: '/api/auth/sign-in/email',
        payload: { email: target, password: `wrong-${i}` },
      });
      if (res.statusCode === 429) refused++;
    }
    // Burst 8: the ninth and tenth guesses bounce with retry-after.
    expect(refused).toBe(2);
    const other = await app!.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email: `bystander-${run}@dealpilot.test`, password: 'x' },
    });
    expect(other.statusCode).not.toBe(429);
  });

  it('the per-IP bucket refuses a flood with retry-after, and recovers as the clock refills it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    clock += 60 * 60_000;
    let refusal: { statusCode: number; headers: Record<string, unknown> } | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await app!.inject({
        method: 'POST', url: '/api/auth/sign-up/email',
        payload: { email: `flood-${i}-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Flo Od' },
      });
      if (res.statusCode === 429) {
        refusal = res;
        break;
      }
    }
    expect(refusal, 'the flood was never refused').not.toBeNull();
    expect(Number(refusal!.headers['retry-after'])).toBeGreaterThan(0);
    clock += 5 * 60_000; // refill
    const after = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `after-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Aft Er' },
    });
    expect(after.statusCode).not.toBe(429);
  });

  it('the intake webhook budget holds per token, with the standard envelope', async (ctx) => {
    if (!dbUp) return ctx.skip();
    clock += 60 * 60_000;
    // A signed lead through a real key, then the bucket runs dry.
    const su = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f44-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Lim Iter' },
    });
    const sc = su.headers['set-cookie'];
    const cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie },
      payload: { name: 'Groupe Limite', slug: `groupe-limite-${run}` },
    });
    const orgId = (JSON.parse(org.body) as { id: string }).id;
    const store = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Limite Kia', code: 'LIM-KIA', province: 'QC' },
    });
    const key = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: (JSON.parse(store.body) as { id: string }).id,
        label: 'Limité', default_source: 'website',
      },
    });
    const { token, secret } = JSON.parse(key.body) as { token: string; secret: string };

    const post = async (n: number) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({ phone: `+1514555${String(6100 + n).padStart(4, '0')}` });
      return app!.inject({
        method: 'POST', url: `/in/v1/leads/${token}`,
        headers: {
          'content-type': 'application/json',
          'x-intake-timestamp': ts,
          'x-intake-signature': `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`,
        },
        payload: body,
      });
    };
    let refused = false;
    for (let n = 0; n < 31; n++) {
      const res = await post(n);
      if (res.statusCode === 429) {
        refused = true;
        expect(res.body).toContain('rate_limited');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        break;
      }
      expect(res.statusCode, res.body).toBe(202);
    }
    expect(refused, '31 posts never hit the 30/min budget').toBe(true);
  });

  it('the invitation preview refuses the enumeration shape', async (ctx) => {
    if (!dbUp) return ctx.skip();
    clock += 60 * 60_000;
    let refused = false;
    for (let i = 0; i < 31; i++) {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/invitations/preview',
        payload: { token: `guess-${i}-${'a'.repeat(30)}` },
      });
      if (res.statusCode === 429) {
        refused = true;
        break;
      }
      expect([404, 422]).toContain(res.statusCode);
    }
    expect(refused, '31 guesses never hit the preview budget').toBe(true);
  });
});
