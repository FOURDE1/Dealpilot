import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-41 — TOTP two-factor (FR-AUTH-006), proven with REAL codes.
 *
 * The TOTP below is RFC 6238 implemented from node:crypto — twenty lines, no
 * dependency — because a 2FA test that mocks the authenticator proves the
 * mock. The full contract: enrolment requires a first code before anything
 * turns on; a 2FA account's sign-in yields a CHALLENGE, not a session; the
 * challenge accepts the current code; a backup code works exactly once.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

/** RFC 4648 base32 → bytes (TOTP secrets are base32, no padding). */
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

/** RFC 6238: HMAC-SHA1 over the 30s counter, dynamic truncation, 6 digits. */
function totp(secretBase32: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list
    .map((c) => String(c).split(';')[0] ?? '')
    .filter((c) => c !== '' && !c.endsWith('='))
    .join('; ');
}

async function signUp(email: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name: 'Olivia Otp' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
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
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('enrolment', () => {
  it('enable hands back a secret; nothing turns on until a real code proves it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cookie = await signUp(`f41-a-${run}@dealpilot.test`);

    const enable = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie },
      payload: { password: PASSWORD },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const { totpURI, backupCodes } = JSON.parse(enable.body) as { totpURI: string; backupCodes: string[] };
    expect(totpURI).toContain('otpauth://totp/');
    expect(totpURI).toContain('Dealpilot');
    expect(backupCodes.length).toBeGreaterThan(0);

    // Not yet: the flag flips only after the first verified code.
    const before = await admin.query<{ on: boolean | null }>(
      `SELECT "twoFactorEnabled" AS on FROM "user" WHERE email = $1`, [`f41-a-${run}@dealpilot.test`],
    );
    expect(before.rows[0]!.on).not.toBe(true);

    const secret = new URL(totpURI).searchParams.get('secret')!;
    const verify = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie },
      payload: { code: totp(secret) },
    });
    expect(verify.statusCode, verify.body).toBe(200);

    const after = await admin.query<{ on: boolean | null }>(
      `SELECT "twoFactorEnabled" AS on FROM "user" WHERE email = $1`, [`f41-a-${run}@dealpilot.test`],
    );
    expect(after.rows[0]!.on).toBe(true);
  });

  it('a wrong password cannot start enrolment', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const cookie = await signUp(`f41-b-${run}@dealpilot.test`);
    const res = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie },
      payload: { password: 'not-the-password-at-all' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('the sign-in challenge', () => {
  it('a 2FA account gets a challenge, not a session — until the code lands', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f41-c-${run}@dealpilot.test`;
    const cookie = await signUp(email);
    const enable = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie },
      payload: { password: PASSWORD },
    });
    const secret = new URL((JSON.parse(enable.body) as { totpURI: string }).totpURI).searchParams.get('secret')!;
    await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie },
      payload: { code: totp(secret) },
    });

    // Fresh sign-in: the password alone is no longer a session.
    const signIn = await app!.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email, password: PASSWORD },
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    expect(JSON.parse(signIn.body)).toMatchObject({ twoFactorRedirect: true });

    const challengeCookie = cookiesOf(signIn);
    const meBlocked = await app!.inject({
      method: 'GET', url: '/api/v1/me', headers: { cookie: challengeCookie },
    });
    // The half-signed-in cookie opens nothing.
    expect(meBlocked.statusCode).toBe(401);

    const verify = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie: challengeCookie },
      payload: { code: totp(secret) },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    const full = [challengeCookie, cookiesOf(verify)].filter(Boolean).join('; ');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: full } });
    expect(me.statusCode, me.body).toBe(200);
    expect((JSON.parse(me.body) as { mfa: { enabled: boolean } }).mfa.enabled).toBe(true);
  });

  it('a backup code opens the door exactly once', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f41-d-${run}@dealpilot.test`;
    const cookie = await signUp(email);
    const enable = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie },
      payload: { password: PASSWORD },
    });
    const body = JSON.parse(enable.body) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(body.totpURI).searchParams.get('secret')!;
    await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie },
      payload: { code: totp(secret) },
    });

    const signIn = await app!.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email, password: PASSWORD },
    });
    const challengeCookie = cookiesOf(signIn);
    const backup = body.backupCodes[0]!;
    const first = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-backup-code', headers: { cookie: challengeCookie },
      payload: { code: backup },
    });
    expect(first.statusCode, first.body).toBe(200);

    // The same code again, on a fresh challenge: spent means spent.
    const signIn2 = await app!.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email, password: PASSWORD },
    });
    const again = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-backup-code',
      headers: { cookie: cookiesOf(signIn2) },
      payload: { code: backup },
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('the policy flags (/me)', () => {
  it('an owner is REQUIRED; a user with no privileged role is not', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f41-e-${run}@dealpilot.test`;
    const cookie = await signUp(email);

    // No memberships yet: nothing requires MFA.
    const before = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect((JSON.parse(before.body) as { mfa: { required: boolean; enabled: boolean } }).mfa)
      .toEqual({ required: false, enabled: false });

    // Creating an organization makes them its OWNER — a role the policy names.
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie },
      payload: { name: 'Groupe F41', slug: `groupe-f41-${run}` },
    });
    expect(org.statusCode, org.body).toBe(201);

    const after = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    // Required the moment the role exists — not at next sign-in.
    expect((JSON.parse(after.body) as { mfa: { required: boolean } }).mfa.required).toBe(true);
  });
});
