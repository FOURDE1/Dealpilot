import { createHmac, timingSafeEqual } from 'node:crypto';
import { countSegments } from '@dealpilot/core';
import { MAX_SMS_BODY } from '@dealpilot/ai';
import type { Env } from './env.js';

/**
 * The carrier edge (F-30) — where a message actually leaves and arrives.
 *
 * Everything inside this boundary has been built and tested for weeks: the
 * compliance gate, the STOP pipeline, the send layer, handoff, the console.
 * None of it could move a byte, because `routeInbound` was called only by tests
 * and `sendMessage` terminated nowhere. This is the seam that unseals it.
 *
 * Two drivers, on the Mailer model:
 *  - `log` — the default outside production. Renders to the logger, returns a
 *    synthetic reference. Local development and CI need no Twilio account and
 *    cannot text a real person by accident.
 *  - `twilio` — the real one.
 *
 * There is deliberately no silent no-op driver, and that is the one place this
 * departs from the realtime `Emitter`. Silence is the right failure mode for a
 * dropped notification. It is the wrong one for a customer message, because by
 * the time the carrier is called `send_decisions` already records
 * `status='allowed'` and a `messages` row already claims we spoke to somebody.
 * An absent carrier has to be loud, so `createCarrier` throws in production.
 *
 * NO SDK. Signature verification is HMAC-SHA1 from `node:crypto` over a
 * documented canonical string, compared with `timingSafeEqual` — the same shape
 * the intake webhook has used since F-03 (f03-intake-routes.ts:58). Sending is
 * one `fetch` to a REST endpoint. Neither justifies a dependency, and the
 * smaller the supply chain at the edge that accepts unauthenticated traffic,
 * the better.
 */

/** E.164, restricted to +1 like every other phone column in this schema. */
const E164 = /^\+1[0-9]{10}$/;

export interface OutboundSms {
  /** The customer. Comes from the conversation row, never from a request body. */
  readonly to: string;
  /** The store's number. */
  readonly from: string;
  readonly body: string;
  /** Where the carrier should post delivery receipts, if it can. */
  readonly statusCallbackUrl?: string | undefined;
}

export type CarrierResult =
  | { kind: 'accepted'; providerRef: string; segments: number }
  /** The carrier refused. `code` is the provider's own, unmodified. */
  | { kind: 'rejected'; code: string; message: string; retryable: boolean };

export interface CarrierInbound {
  /** The URL exactly as configured at the provider — the signature covers it. */
  readonly url: string;
  /** Parsed form parameters. Repeated keys arrive as arrays. */
  readonly params: Record<string, string | string[]>;
  readonly signature: string | undefined;
}

export interface Carrier {
  readonly kind: 'twilio' | 'log';
  /**
   * Whether an accepted send actually reaches a handset.
   *
   * False for `log`, and worth carrying explicitly: with a log driver the
   * `messages` table records a conversation the customer never had, and
   * anything reasoning about delivery needs to know that.
   */
  readonly deliversToRecipient: boolean;
  send(message: OutboundSms): Promise<CarrierResult>;
  /** Fails closed: false on a missing header, a bad MAC, or a URL mismatch. */
  verifyInbound(req: CarrierInbound): boolean;
}

/**
 * What every driver refuses, in one place.
 *
 * Shared so the fake cannot be more permissive than the real one. A log driver
 * that accepted a malformed number would certify sends Twilio rejects, and the
 * first anyone heard of it would be in production — which is precisely the
 * "test that passes because nothing exercised the guard" failure this codebase
 * keeps finding.
 */
export function assertSendable(m: OutboundSms): void {
  if (!E164.test(m.to)) throw new Error(`carrier: destination is not E.164: ${m.to}`);
  if (!E164.test(m.from)) throw new Error(`carrier: sender is not E.164: ${m.from}`);
  if (m.body.length === 0) throw new Error('carrier: refusing to send an empty message');
  if (m.body.length > MAX_SMS_BODY) {
    throw new Error(`carrier: body is ${m.body.length} chars, over the ${MAX_SMS_BODY} ceiling`);
  }
}

/**
 * Twilio's request signature: base64(HMAC-SHA1(authToken, url + k1v1 + k2v2…)),
 * with keys sorted and no separators between them.
 *
 * Implemented rather than imported, and used by BOTH drivers — the log driver
 * runs the real algorithm too. That is what lets the forged-signature tests
 * mean something with no Twilio account: they exercise the same code that will
 * face the internet.
 */
export function expectedSignature(
  authToken: string,
  url: string,
  params: Record<string, string | string[]>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const value = params[key]!;
      return Array.isArray(value)
        ? acc + [...new Set(value)].sort().map((v) => key + v).join('')
        : acc + key + value;
    }, url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/** Constant-time compare, so a wrong signature leaks nothing through timing. */
export function signaturesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function verify(authToken: string, req: CarrierInbound): boolean {
  // No header is a refusal, not an error. An unsigned request is exactly what
  // an attacker sends first.
  if (!req.signature) return false;
  return signaturesMatch(req.signature, expectedSignature(authToken, req.url, req.params));
}

/** Somewhere to write a line. Structurally the subset of pino this file needs. */
export interface CarrierLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

class LogCarrier implements Carrier {
  readonly kind = 'log' as const;
  readonly deliversToRecipient = false;

  constructor(
    private readonly authToken: string,
    private readonly logger: CarrierLogger,
  ) {}

  async send(message: OutboundSms): Promise<CarrierResult> {
    assertSendable(message);
    const count = countSegments(message.body);
    // Shape only — never the body. The mailer's log transport prints its body
    // because a developer needs the verification link out of it; a customer's
    // SMS carries nothing a developer needs and is somebody's private message
    // (compliance-and-quality §11, and CLAUDE.md's no-PII-in-logs rule).
    this.logger.info(
      {
        to: message.to,
        from: message.from,
        chars: message.body.length,
        segments: count.segments,
        encoding: count.encoding,
      },
      'sms (log transport — not delivered)',
    );
    return {
      kind: 'accepted',
      providerRef: `log-${createHmac('sha1', 'log').update(`${message.to}${message.body}${Date.now()}`).digest('hex').slice(0, 32)}`,
      segments: count.segments,
    };
  }

  verifyInbound(req: CarrierInbound): boolean {
    return verify(this.authToken, req);
  }
}

class TwilioCarrier implements Carrier {
  readonly kind = 'twilio' as const;
  readonly deliversToRecipient = true;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly logger: CarrierLogger,
  ) {}

  async send(message: OutboundSms): Promise<CarrierResult> {
    assertSendable(message);
    const body = new URLSearchParams({
      To: message.to,
      From: message.from,
      Body: message.body,
      ...(message.statusCallbackUrl ? { StatusCallback: message.statusCallbackUrl } : {}),
    });

    let res: Response;
    try {
      res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
          // Every external call gets an explicit timeout (CLAUDE.md). A carrier
          // that hangs must not hold a database transaction open behind it.
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (cause) {
      // A network failure is retryable and must NOT be reported as delivered.
      return {
        kind: 'rejected',
        code: 'network_error',
        message: cause instanceof Error ? cause.message : 'carrier unreachable',
        retryable: true,
      };
    }

    const payload = (await res.json().catch(() => ({}))) as {
      sid?: string;
      num_segments?: string;
      code?: number;
      message?: string;
    };

    if (!res.ok) {
      this.logger.warn(
        { status: res.status, code: payload.code, to: message.to },
        'carrier rejected a message',
      );
      return {
        kind: 'rejected',
        code: String(payload.code ?? res.status),
        message: payload.message ?? `carrier returned ${res.status}`,
        // 5xx and 429 are worth another attempt; a 400 means the message is
        // wrong and retrying sends the same wrong message again.
        retryable: res.status >= 500 || res.status === 429,
      };
    }

    // Prefer the carrier's own count over ours — they are the ones billing.
    // Ours is the fallback and the cross-check, not the authority.
    const reported = Number(payload.num_segments);
    return {
      kind: 'accepted',
      providerRef: payload.sid ?? '',
      segments: Number.isFinite(reported) && reported > 0 ? reported : countSegments(message.body).segments,
    };
  }

  verifyInbound(req: CarrierInbound): boolean {
    return verify(this.authToken, req);
  }
}

/**
 * Build the carrier this environment should have.
 *
 * Production with no credentials is a boot failure, deliberately. The
 * alternative is an API that starts, accepts customer conversations, records
 * `send_decisions` rows saying messages were allowed, and delivers nothing —
 * silently, until somebody notices the dealership has stopped replying.
 */
export function createCarrier(env: Env, logger: CarrierLogger): Carrier {
  if (env.SMS_TRANSPORT === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new Error(
        'SMS_TRANSPORT=twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Refusing to start: an API that accepts conversations and delivers nothing is worse than one that will not boot.',
      );
    }
    return new TwilioCarrier(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, logger);
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SMS_TRANSPORT=log is refused in production — it writes a log line and no customer receives anything.',
    );
  }

  // The log driver still verifies signatures for real, so a developer running
  // it locally exercises the same rejection path the internet will.
  return new LogCarrier(env.TWILIO_AUTH_TOKEN ?? 'dev-auth-token', logger);
}
