import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redactHighRiskPII } from '@dealpilot/ai';
import { withTenant, type Pool } from '@dealpilot/db';
import { routeInbound } from './f23-inbound-router.js';
import type { ReassignQueue } from './reassign-queue.js';
import type { Carrier } from './carrier.js';
import type { DeferredSendQueue } from './deferred-queue.js';
import type { Env } from './env.js';

/**
 * The carrier webhooks (F-30) — where a real customer message arrives.
 *
 * This is the only unauthenticated write path into the conversation engine, so
 * it is built like one:
 *
 *  - A missing or wrong signature is a 403 and nothing else happens. Not a 401,
 *    because there is no credential to supply and no point inviting a retry.
 *  - An unknown number is the same refusal as a bad signature. A scanner
 *    probing the endpoint learns nothing about which numbers are real.
 *  - Every effect runs in ONE transaction before the response, because
 *    compliance-and-quality.md §5 requires exactly that of a STOP, and the
 *    router cannot know a message is a STOP until it has read it.
 *  - The same message delivered twice does not become two messages. Carriers
 *    retry on any non-2xx and on a timeout, so "delivered twice" is the normal
 *    case and idempotency is a feature rather than a safeguard.
 */

/** Twilio posts form-encoded. This is the shape after parsing. */
type FormBody = Record<string, string | string[]>;

/**
 * A public error body: no request id, no details.
 *
 * Same shape and same reason as the intake webhook's
 * (f03-intake-routes.ts:310) — an unauthenticated caller gets the fact of a
 * refusal and nothing that helps them refine the next attempt.
 */
function envelopePublic(code: string, message: string) {
  return { error: { code, message } };
}

/**
 * The URL the carrier signed.
 *
 * Built from configuration, never from the Host header — a spoofed Host would
 * otherwise let an attacker choose the string the signature is computed over,
 * which is the whole point of signing the URL. Same reasoning as
 * BETTER_AUTH_URL (A-05.1).
 */
function signedUrl(env: Env, request: FastifyRequest): string {
  const origin = env.PUBLIC_WEBHOOK_ORIGIN ?? env.BETTER_AUTH_URL;
  return new URL(request.url, origin).toString();
}

function one(body: FormBody, key: string): string | null {
  const v = body[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export function registerF30Routes(
  app: FastifyInstance,
  pool: Pool,
  carrier: Carrier,
  env: Env,
  queue: DeferredSendQueue,
  reassign: ReassignQueue,
): void {
  /**
   * An inbound SMS.
   *
   * Answers 204 with an empty body rather than TwiML. The assistant's reply
   * does not travel back down this response — it goes out through the send
   * layer, which runs the compliance gate first. A reply composed here would
   * be a second send path, and the second one is always the one that skips
   * something.
   */
  app.post('/carrier/v1/sms/inbound', async (request, reply) => {
    const body = (request.body ?? {}) as FormBody;

    if (!carrier.verifyInbound({
      url: signedUrl(env, request),
      params: body,
      signature: request.headers['x-twilio-signature'] as string | undefined,
    })) {
      request.log.warn({ path: request.url }, 'carrier webhook failed signature verification');
      return reply.status(403).send(envelopePublic('forbidden', 'Invalid signature'));
    }

    const to = one(body, 'To');
    const from = one(body, 'From');
    // §7 / RT-08: volunteered SINs and card numbers are redacted AT the door —
    // stored redacted, logged redacted, modelled redacted. STOP keywords are
    // words, not digits, so the opt-out pipeline is unaffected.
    const text = redactHighRiskPII(one(body, 'Body') ?? '');
    const messageSid = one(body, 'MessageSid') ?? one(body, 'SmsMessageSid');
    if (!to || !from || !messageSid) {
      return reply.status(400).send(envelopePublic('validation_failed', 'Missing To, From or MessageSid'));
    }

    // Which dealership owns this number? Resolved by an audited SECURITY
    // DEFINER function, because there is no tenant context yet — discovering
    // the tenant IS the question (0036, same shape as intake_resolve).
    const resolved = await pool
      .query<{ organization_id: string; store_id: string; timezone: string }>(
        'SELECT * FROM carrier_resolve_number($1)',
        [to],
      )
      .then((r) => r.rows[0] ?? null);

    // Deliberately the same refusal as a bad signature: an unknown number must
    // not be distinguishable from an unsigned request.
    if (!resolved) {
      request.log.warn({ path: request.url }, 'carrier webhook for an unknown number');
      return reply.status(403).send(envelopePublic('forbidden', 'Invalid signature'));
    }

    const answer = await withTenant(pool, resolved.organization_id, async (c) => {
      // Idempotency inside the transaction, so two concurrent retries cannot
      // both pass the check. The unique index on
      // (organization_id, provider_ref) from 0036 is the real guarantee; this
      // read just avoids doing the work twice in the common case.
      const seen = await c.query(
        `SELECT 1 FROM messages WHERE organization_id = $1 AND provider_ref = $2`,
        [resolved.organization_id, messageSid],
      );
      if (seen.rows.length > 0) return null;

      // ONE call. `routeInbound` is the spine (F-23): it matches keywords
      // first per §5, finds or creates the conversation, records the message —
      // including a STOP, because the text that withdrew consent is the
      // evidence it was withdrawn — and decides who handles it. Doing any of
      // that again here would be a second path through the same rules, and the
      // second one is always the one that drifts.
      const route = await routeInbound(c, {
        organizationId: resolved.organization_id,
        storeId: resolved.store_id,
        phoneE164: from,
        body: text,
        providerRef: messageSid,
      });
      // The router decides WHO answers. `to_assistant` wants a model, and so
      // does `reactivated` (F-61 review): the router just flipped that thread
      // back to bot_active because a drip landed — a customer who answered a
      // campaign and hears nothing back was re-engaged for nothing. A
      // handed-off thread still goes to a person, a suppressed number is
      // filed and not answered, and an opt-out has already been applied above.
      return {
        answer: route.kind === 'to_assistant' || route.kind === 'reactivated'
          ? { conversationId: route.conversationId, messageId: route.messageId }
          : null,
        // §5: the DATA pass rides every recorded client message — a customer
        // talking numbers with a human is exactly the window worth capturing.
        extract: { conversationId: route.conversationId, messageId: route.messageId },
        armReassign: route.armReassign ?? null,
      };
    });

    // Queued after the commit, so the assistant reads a thread that exists.
    if (answer?.answer) {
      await queue.enqueueAssistantTurn({
        organization_id: resolved.organization_id,
        conversation_id: answer.answer.conversationId,
        message_id: answer.answer.messageId,
        attempt: 0,
      });
    }
    if (answer?.extract) {
      await queue.enqueueExtraction({
        organization_id: resolved.organization_id,
        conversation_id: answer.extract.conversationId,
        message_id: answer.extract.messageId,
      });
    }
    // F-48: a reactivated lead's fresh assignment gets its ten-minute timer,
    // armed only once the row it guards is committed.
    if (answer?.armReassign) {
      await reassign.arm(answer.armReassign);
    }

    // 204, and only after everything above committed. §5's "synchronously in
    // one transaction before the 200" is the requirement; answering earlier
    // would let the carrier consider a STOP delivered while it was still being
    // applied.
    return reply.status(204).send();
  });

  /**
   * A delivery receipt.
   *
   * The carrier tells us what happened to a message we sent. This is the only
   * legitimate UPDATE on `messages` — the append-only trigger permits exactly
   * the delivery fields and nothing else (0031).
   */
  app.post('/carrier/v1/sms/status', async (request, reply) => {
    const body = (request.body ?? {}) as FormBody;

    if (!carrier.verifyInbound({
      url: signedUrl(env, request),
      params: body,
      signature: request.headers['x-twilio-signature'] as string | undefined,
    })) {
      return reply.status(403).send(envelopePublic('forbidden', 'Invalid signature'));
    }

    const sid = one(body, 'MessageSid') ?? one(body, 'SmsSid');
    const status = one(body, 'MessageStatus') ?? one(body, 'SmsStatus');
    const to = one(body, 'To');
    if (!sid || !status || !to) {
      return reply.status(400).send(envelopePublic('validation_failed', 'Missing MessageSid, MessageStatus or To'));
    }

    // A receipt names OUR message, so the tenant comes from the number it was
    // sent from — which for a status callback is the `From` we used.
    const resolved = await pool
      .query<{ organization_id: string }>('SELECT * FROM carrier_resolve_number($1)', [one(body, 'From')])
      .then((r) => r.rows[0] ?? null);
    if (!resolved) return reply.status(403).send(envelopePublic('forbidden', 'Invalid signature'));

    // Only terminal-positive statuses mark a message delivered. `sent` means
    // the carrier accepted it, not that a handset received it, and treating
    // the two the same would let the console claim a customer got something
    // that bounced.
    const delivered = status === 'delivered';
    const segments = Number(one(body, 'NumSegments') ?? '');

    await withTenant(pool, resolved.organization_id, async (c) => {
      await c.query(
        `UPDATE messages
         SET delivered = $2,
             delivered_at = CASE WHEN $2 THEN now() ELSE delivered_at END,
             segments = COALESCE($3, segments)
         WHERE organization_id = $1 AND provider_ref = $4`,
        [
          resolved.organization_id,
          delivered,
          Number.isFinite(segments) && segments > 0 ? segments : null,
          sid,
        ],
      );
    });

    return reply.status(204).send();
  });
}
