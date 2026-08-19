import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-41 slice 2 — the ENFORCED half of "MFA required" (FR-AUTH-006).
 *
 * Slice 1 made the requirement visible (/me flags, the banner). This proves it
 * BINDS: with REQUIRE_MFA on, a privileged permission held by an un-enrolled
 * owner is refused with `mfa_enrolment_required`, everyday reads still pass,
 * and enrolling with a real RFC-6238 code opens the door again.
 *
 * Own file on purpose: enforcement is a module-level switch set by buildApp,
 * and vitest isolates module state per test FILE — flipping it here cannot
 * leak into the other suites. Within this file the ORDER matters (the last
 * buildApp wins for every app in the process), so the default-off proof runs
 * first against its own app, which is then closed.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

// RFC 6238 from node:crypto, same twenty lines as f41-two-factor.test.ts —
// second in-package copy; extract a helper on the third.
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

let admin: Pool;
let dbUp = false;
type App = Awaited<ReturnType<typeof buildApp>>['app'];
const openApps: App[] = [];

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list
    .map((c) => String(c).split(';')[0] ?? '')
    .filter((c) => c !== '' && !c.endsWith('='))
    .join('; ');
}

/** Fresh owner with a fresh organization — every test builds its own fixture. */
async function ownerWithOrg(app: App, tag: string) {
  const email = `f41g-${tag}-${run}@dealpilot.test`;
  const signup = await app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name: 'Gates Mfa' },
  });
  expect(signup.statusCode, signup.body).toBe(200);
  const cookie = cookiesOf(signup);
  const org = await app.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: `Groupe Gate ${tag}`, slug: `groupe-gate-${tag}-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  const orgId = (JSON.parse(org.body) as { id: string }).id;
  return { cookie, orgId };
}

/**
 * Enrol the signed-in caller: enable → prove with a real code. Returns the
 * cookie to keep using — turning 2FA on ROTATES the session, so the caller's
 * old cookie dies with enrolment (this suite found that, too).
 */
async function enrol(app: App, cookie: string): Promise<string> {
  const enable = await app.inject({
    method: 'POST', url: '/api/auth/two-factor/enable', headers: { cookie },
    payload: { password: PASSWORD },
  });
  expect(enable.statusCode, enable.body).toBe(200);
  const secret = new URL((JSON.parse(enable.body) as { totpURI: string }).totpURI)
    .searchParams.get('secret')!;
  const verify = await app.inject({
    method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie },
    payload: { code: totp(secret) },
  });
  expect(verify.statusCode, verify.body).toBe(200);
  return cookiesOf(verify) || cookiesOf(enable) || cookie;
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
});

afterAll(async () => {
  for (const a of openApps) await a.close();
  await admin?.end();
});

describe('the MFA gate on privileged permissions', () => {
  it('is deploy configuration: with REQUIRE_MFA unset, an un-enrolled owner still runs their org', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });
    openApps.push(app);
    const { cookie, orgId } = await ownerWithOrg(app, 'off');
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/organizations/${orgId}`, headers: { cookie },
      payload: { name: 'Groupe Gate Off (renommé)' },
    });
    expect(patch.statusCode, patch.body).toBe(200);
  });

  it('enforced: privileged writes refuse the un-enrolled with a NAMED remedy; enrolment opens the door', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test', REQUIRE_MFA: 'true' });
    openApps.push(app);
    const { cookie, orgId } = await ownerWithOrg(app, 'on');

    // Everyday reads are NOT gated — the policy binds power, not presence.
    const read = await app.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}`, headers: { cookie },
    });
    expect(read.statusCode, read.body).toBe(200);

    // The bound permission is refused — and with the SPECIFIC code, so a
    // gate that silently stopped gating fails this test, not just a 403 check.
    const blocked = await app.inject({
      method: 'PATCH', url: `/api/v1/organizations/${orgId}`, headers: { cookie },
      payload: { name: 'Ne devrait pas passer' },
    });
    expect(blocked.statusCode, blocked.body).toBe(403);
    expect(JSON.parse(blocked.body) as object).toMatchObject({
      error: { code: 'mfa_enrolment_required' },
    });
    // …and the refused write really did not land.
    const untouched = await admin.query<{ name: string }>(
      `SELECT name FROM organizations WHERE id = $1`, [orgId],
    );
    expect(untouched.rows[0]!.name).toBe(`Groupe Gate on`);

    const enrolledCookie = await enrol(app, cookie);
    const allowed = await app.inject({
      method: 'PATCH', url: `/api/v1/organizations/${orgId}`, headers: { cookie: enrolledCookie },
      payload: { name: 'Groupe Gate On (renommé)' },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });
});
