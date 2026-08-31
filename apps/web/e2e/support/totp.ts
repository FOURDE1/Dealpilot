import { createHmac } from 'node:crypto';

/**
 * The e2e-side TOTP oracle (RFC 4648 base32 + RFC 6238), lifted verbatim from
 * f41-two-factor.e2e.ts so every spec that must pass a real challenge shares
 * one implementation (F-41's two-factor journey, F-74's console door).
 *
 * This is one of the repo's two SHARED copies of the pure pair — the other is
 * apps/api/src/testing/totp.ts, and they cannot be merged as things stand:
 * that module imports `vitest` and its helpers take a Fastify `inject()`
 * injector, neither of which means anything inside a Playwright spec, and
 * `src/testing/**` is excluded from the api build so nothing outside the
 * api's own suites can import it. Three vitest suites also carry PRIVATE
 * copies by their own recorded choice (f41-two-factor.test, f41-mfa-gate.test,
 * announcement-fanout.test) — five definitions in all. The count is
 * `grep -rn 'function base32Decode' apps packages`, not this sentence.
 */
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

export function totp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
