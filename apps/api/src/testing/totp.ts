import { createHmac } from 'node:crypto';
import { expect } from 'vitest';

/**
 * The test-side TOTP oracle (RFC 4648 base32 + RFC 6238), shared by the
 * F-41 suites and the F-69 admin suite.
 *
 * There are TWO copies of the pure pair in this repo, not one: this file, and
 * `apps/web/e2e/f41-two-factor.e2e.ts`. They cannot be merged as things stand —
 * this module imports `vitest` and its helpers take a Fastify `inject()`
 * injector, neither of which means anything inside a Playwright spec, and
 * `src/testing/**` is excluded from the api build so nothing outside the api's
 * own suites can import it. Two is the honest number; an earlier version of
 * this comment claimed one.
 */

/** RFC 4648 base32 → bytes (TOTP secrets are base32, no padding). */
export function base32Decode(input: string): Buffer {
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
export function totp(secretBase32: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

type Injector = { inject: (opts: { method: 'POST'; url: string; headers?: Record<string, string>; payload?: unknown }) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> };

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list
    .map((c) => String(c).split(';')[0] ?? '')
    .filter((c) => c !== '' && !c.endsWith('='))
    .join('; ');
}

/**
 * Enrol TOTP on a signed-in account and return the secret. Better Auth:
 * enable (password) → totpURI → verify-totp with a live code flips
 * "user"."twoFactorEnabled".
 */
export async function enrol(app: Injector, cookie: string, password: string): Promise<{ secret: string; backupCodes: string[] }> {
  const enable = await app.inject({
    method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie }, payload: { password },
  });
  expect(enable.statusCode, enable.body).toBe(200);
  const { totpURI, backupCodes } = JSON.parse(enable.body) as { totpURI: string; backupCodes: string[] };
  const secret = new URL(totpURI).searchParams.get('secret')!;
  const verify = await app.inject({
    method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie }, payload: { code: totp(secret) },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  return { secret, backupCodes };
}

/**
 * Sign in an ENROLLED account: password → twoFactorRedirect → verify-totp
 * mints the session. Returns the session cookie.
 */
export async function signInWithTotp(app: Injector, email: string, password: string, secret: string): Promise<string> {
  const first = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password } });
  expect(first.statusCode, first.body).toBe(200);
  expect(JSON.parse(first.body)).toMatchObject({ twoFactorRedirect: true });
  const pending = cookiesOf(first);
  const second = await app.inject({
    method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie: pending }, payload: { code: totp(secret) },
  });
  expect(second.statusCode, second.body).toBe(200);
  return cookiesOf(second);
}
