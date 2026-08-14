import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSendable, createCarrier, expectedSignature, signaturesMatch,
  type CarrierInbound, type CarrierLogger,
} from './carrier.js';
import { loadEnv } from './env.js';

/**
 * The carrier edge, without a Twilio account.
 *
 * Signature verification is the security boundary of this whole slice: a
 * forged webhook injects a fake customer message into a compliance-critical
 * CRM — one that would be routed, replied to, and could trigger a STOP or a
 * handoff. It is verified with the REAL algorithm here, because the log driver
 * runs the same code the internet will face.
 */

function logger(): CarrierLogger & { lines: { obj: Record<string, unknown>; msg: string }[] } {
  const lines: { obj: Record<string, unknown>; msg: string }[] = [];
  return {
    lines,
    info: (obj, msg) => lines.push({ obj, msg }),
    warn: (obj, msg) => lines.push({ obj, msg }),
  };
}

const TOKEN = 'test-auth-token-not-a-real-one';
const URL_ = 'https://api.example.test/api/v1/carrier/inbound';

function signed(params: Record<string, string | string[]>): CarrierInbound {
  return { url: URL_, params, signature: expectedSignature(TOKEN, URL_, params) };
}

describe('the signature algorithm', () => {
  it('matches Twilio’s published canonical string', () => {
    // From Twilio's own documented worked example: the URL, then every key
    // and value concatenated in sorted key order with no separators.
    const params = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    // Sorted keys are Caller, Digits, From, To.
    const manual = `${url}Caller+14158675310Digits1234From+14158675310To+18005551212`;
    expect(expectedSignature('12345', url, params)).toBe(
      createHmac('sha1', '12345').update(Buffer.from(manual, 'utf-8')).digest('base64'),
    );
  });

  it('sorts keys rather than trusting insertion order', () => {
    const a = expectedSignature(TOKEN, URL_, { b: '2', a: '1' });
    const b = expectedSignature(TOKEN, URL_, { a: '1', b: '2' });
    // Two identical requests whose params happened to parse in a different
    // order must produce the same signature, or valid webhooks fail at random.
    expect(a).toBe(b);
  });

  it('de-duplicates and sorts repeated keys', () => {
    const one = expectedSignature(TOKEN, URL_, { k: ['b', 'a', 'b'] });
    const two = expectedSignature(TOKEN, URL_, { k: ['a', 'b'] });
    expect(one).toBe(two);
  });

  it('covers the URL, so the same body sent elsewhere does not verify', () => {
    const params = { Body: 'hello' };
    expect(expectedSignature(TOKEN, URL_, params)).not.toBe(
      expectedSignature(TOKEN, 'https://evil.test/api/v1/carrier/inbound', params),
    );
  });
});

describe('verifying an inbound request', () => {
  const carrier = createCarrier(loadEnv({ TWILIO_AUTH_TOKEN: TOKEN }), logger());

  it('accepts a correctly signed request', () => {
    expect(carrier.verifyInbound(signed({ From: '+15145550100', Body: 'Bonjour' }))).toBe(true);
  });

  it('refuses a request with NO signature', () => {
    // The first thing an attacker sends.
    expect(carrier.verifyInbound({ url: URL_, params: { Body: 'x' }, signature: undefined })).toBe(false);
  });

  it('refuses a forged signature', () => {
    expect(carrier.verifyInbound({ url: URL_, params: { Body: 'x' }, signature: 'bm90LWEtc2lnbmF0dXJl' })).toBe(false);
  });

  it('refuses a signature that was valid for a DIFFERENT body', () => {
    // The replay that matters: a real signature lifted from a real webhook and
    // reused with the message swapped for "STOP", or for a price quote.
    const real = signed({ From: '+15145550100', Body: 'Bonjour' });
    const tampered: CarrierInbound = {
      url: real.url,
      params: { From: '+15145550100', Body: 'STOP' },
      signature: real.signature,
    };
    expect(carrier.verifyInbound(tampered)).toBe(false);
  });

  it('refuses a signature that was valid at a different URL', () => {
    const real = signed({ Body: 'x' });
    expect(carrier.verifyInbound({ ...real, url: 'https://evil.test/hook' })).toBe(false);
  });

  it('refuses when the token is wrong', () => {
    const other = createCarrier(loadEnv({ TWILIO_AUTH_TOKEN: 'a-different-token' }), logger());
    expect(other.verifyInbound(signed({ Body: 'x' }))).toBe(false);
  });
});

describe('signaturesMatch', () => {
  it('is length-safe and does not throw on mismatched lengths', () => {
    // timingSafeEqual throws when the buffers differ in length; guarding it is
    // the difference between a 401 and a 500 that leaks a stack trace.
    expect(signaturesMatch('abc', 'abcd')).toBe(false);
    expect(signaturesMatch('', 'x')).toBe(false);
    expect(signaturesMatch('same', 'same')).toBe(true);
  });
});

describe('what every driver refuses before sending', () => {
  it('rejects a destination that is not E.164', () => {
    for (const to of ['5145550100', '+33612345678', '+1514555010', 'null', '']) {
      expect(() => assertSendable({ to, from: '+15145550199', body: 'x' }), to).toThrow(/not E\.164/);
    }
  });

  it('rejects a sender that is not E.164', () => {
    expect(() => assertSendable({ to: '+15145550100', from: 'DEALPILOT', body: 'x' })).toThrow(/not E\.164/);
  });

  it('rejects an empty body', () => {
    expect(() => assertSendable({ to: '+15145550100', from: '+15145550199', body: '' }))
      .toThrow(/empty message/);
  });

  it('rejects a body over the ceiling', () => {
    expect(() => assertSendable({ to: '+15145550100', from: '+15145550199', body: 'a'.repeat(1601) }))
      .toThrow(/over the 1600 ceiling/);
  });
});

describe('the log driver', () => {
  it('accepts a valid message and reports segments', async () => {
    const log = logger();
    const carrier = createCarrier(loadEnv({}), log);
    const res = await carrier.send({ to: '+15145550100', from: '+15145550199', body: 'ça va' });
    expect(res.kind).toBe('accepted');
    if (res.kind !== 'accepted') return;
    // 'ça va' is UCS-2 because of the lowercase ç — one segment, but the
    // encoding matters and the count comes from the same code the biller uses.
    expect(res.segments).toBe(1);
    expect(res.providerRef).toMatch(/^log-/);
  });

  it('never writes the message body to the log', async () => {
    const log = logger();
    const carrier = createCarrier(loadEnv({}), log);
    const secret = 'Votre NAS est 123 456 789';
    await carrier.send({ to: '+15145550100', from: '+15145550199', body: secret });
    const dumped = JSON.stringify(log.lines);
    // A customer's SMS is their private message and carries nothing a
    // developer needs. The mailer logs its body because a dev needs the
    // verification link; this deliberately does not.
    expect(dumped).not.toContain(secret);
    expect(dumped).toContain('+15145550100');
  });

  it('is honest that it delivered nothing', () => {
    expect(createCarrier(loadEnv({}), logger()).deliversToRecipient).toBe(false);
  });

  it('applies the same refusals as the real driver', async () => {
    const carrier = createCarrier(loadEnv({}), logger());
    await expect(carrier.send({ to: 'nonsense', from: '+15145550199', body: 'x' }))
      .rejects.toThrow(/not E\.164/);
  });
});

/** A production env that passes env.ts's own dev-default checks (PROD_REQUIRED). */
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/dealpilot',
  BETTER_AUTH_SECRET: 'a-real-secret-at-least-sixteen-chars',
  BETTER_AUTH_URL: 'https://api.dealpilot.ca',
  WEB_ORIGIN: 'https://app.dealpilot.ca',
  // env.ts refuses the local disk in production too — Fargate tasks have
  // ephemeral disks, so a file uploaded to one is gone at the next deploy.
  DOCUMENT_STORAGE_DRIVER: 's3',
} as const;

describe('choosing a driver', () => {
  it('refuses to boot in production on the log transport', () => {
    // An API that starts, accepts conversations, records decisions saying the
    // messages were allowed, and delivers none of them fails silently until
    // somebody notices the dealership stopped replying.
    expect(() => createCarrier(loadEnv({ ...PROD, SMS_TRANSPORT: 'log' }), logger()))
      .toThrow(/refused in production/);
  });

  it('refuses twilio without credentials', () => {
    expect(() => createCarrier(loadEnv({ SMS_TRANSPORT: 'twilio' }), logger()))
      .toThrow(/requires TWILIO_ACCOUNT_SID/);
    // And in production too, where it matters most.
    expect(() => createCarrier(loadEnv({ ...PROD, SMS_TRANSPORT: 'twilio' }), logger()))
      .toThrow(/requires TWILIO_ACCOUNT_SID/);
  });

  it('builds the real driver when credentials are present', () => {
    const carrier = createCarrier(
      loadEnv({ SMS_TRANSPORT: 'twilio', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: TOKEN }),
      logger(),
    );
    expect(carrier.kind).toBe('twilio');
    expect(carrier.deliversToRecipient).toBe(true);
  });
});

describe('the real driver, against a stubbed transport', () => {
  const env = loadEnv({ SMS_TRANSPORT: 'twilio', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: TOKEN });

  it('prefers the carrier’s own segment count over ours', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM123', num_segments: '3' }), { status: 201 }),
    );
    try {
      const res = await createCarrier(env, logger()).send({
        to: '+15145550100', from: '+15145550199', body: 'short',
      });
      // Our count says 1. Theirs says 3. They are the ones billing.
      expect(res).toMatchObject({ kind: 'accepted', providerRef: 'SM123', segments: 3 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports a 4xx as rejected and NOT retryable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 21610, message: 'unsubscribed recipient' }), { status: 400 }),
    );
    try {
      const res = await createCarrier(env, logger()).send({
        to: '+15145550100', from: '+15145550199', body: 'hello',
      });
      // Retrying sends the same wrong message again — and 21610 in particular
      // means the carrier itself knows they opted out.
      expect(res).toMatchObject({ kind: 'rejected', code: '21610', retryable: false });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports a 5xx as retryable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 503 }),
    );
    try {
      const res = await createCarrier(env, logger()).send({
        to: '+15145550100', from: '+15145550199', body: 'hello',
      });
      expect(res).toMatchObject({ kind: 'rejected', retryable: true });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('turns a network failure into a rejection, never a delivery', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    try {
      const res = await createCarrier(env, logger()).send({
        to: '+15145550100', from: '+15145550199', body: 'hello',
      });
      // The dangerous alternative is throwing here and having a caller treat an
      // unknown outcome as success.
      expect(res).toMatchObject({ kind: 'rejected', code: 'network_error', retryable: true });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('never puts the auth token in a URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SM1', num_segments: '1' }), { status: 201 }),
    );
    try {
      await createCarrier(env, logger()).send({ to: '+15145550100', from: '+15145550199', body: 'x' });
      const [url, init] = fetchSpy.mock.calls[0]!;
      // Query strings end up in proxy logs and browser history; credentials
      // belong in a header.
      expect(String(url)).not.toContain(TOKEN);
      expect((init as RequestInit).headers).toMatchObject({
        authorization: expect.stringMatching(/^Basic /),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
