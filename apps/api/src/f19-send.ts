import type { PoolClient } from '@dealpilot/db';
import {
  evaluateSend,
  GATE_VERSION,
  type ComplianceFacts,
  type ConsentRow,
  type MessageClass,
  type SendDecision,
  type SendRequest,
} from '@dealpilot/core';
import { isSendable, outboundGuard, type Violation } from '@dealpilot/ai';
import { killSwitches } from './platform-settings.js';

/**
 * The send layer (compliance-and-quality.md §1, conversation-engine.md §10).
 *
 * One function may put a message in front of a customer, and it asks two
 * questions first, in this order:
 *
 *   1. May we contact this person at all, right now? — `evaluateSend`, the one
 *      compliance authority. This module does not re-derive a rule, add an
 *      "unless", or special-case a message type. If it needs an answer the gate
 *      does not give, the gate gets extended.
 *   2. Is this particular text safe to send? — `outboundGuard`, which blocks
 *      prices, rates, approval promises and invented inventory.
 *
 * Both run for every send regardless of who asked for it, so a jailbroken model
 * and a buggy worker are handled identically. The database backs this up: an
 * outbound `messages` row without a consent id violates a CHECK, so there is no
 * code path — present or future, however rewritten — that can record a sent
 * message with nothing authorising it.
 */

export interface OutboundRequest {
  readonly organizationId: string;
  readonly storeId: string;
  readonly conversationId: string;
  readonly leadId: string | null;
  readonly phoneE164: string;
  readonly body: string;
  readonly senderType: 'bot' | 'agent' | 'system' | 'drip';
  readonly messageClass: MessageClass;
  readonly scope: 'conversational' | 'marketing' | 'ai_outbound_call';
  readonly isSolicitation: boolean;
  /** Stock numbers the inventory tool returned, for the invented-vehicle check. */
  readonly allowedStockNumbers?: readonly string[];
  readonly nowUtc: Date;
  readonly jitterMs?: number;
}

/**
 * Machine-initiated client messaging is 'ai' (compliance-and-quality.md §1,
 * §3 classes drips with the assistant's sends): drips share and spend the
 * same per-lead daily budget. Only the SYSTEM sender — handoff notices,
 * D-060 — escapes the cap, and 'drip' mapping to 'system' was exactly how
 * three same-tick drips plus three assistant messages reached one person in
 * one day with no gate objecting (F-61 review).
 */
function originatorOf(senderType: OutboundRequest['senderType']): 'ai' | 'human' | 'system' {
  if (senderType === 'bot' || senderType === 'drip') return 'ai';
  return senderType === 'agent' ? 'human' : 'system';
}

export type SendOutcome =
  | { kind: 'sent'; messageId: string; decisionId: string; consentLedgerId: string }
  | { kind: 'deferred'; decisionId: string; runAt: Date; reason: string }
  | { kind: 'blocked'; decisionId: string; reason: string; remedy: string }
  | { kind: 'unsafe'; violations: readonly Violation[] };

/** Gather everything the pure gate needs, for this organisation, right now. */
async function facts(c: PoolClient, req: OutboundRequest): Promise<ComplianceFacts> {
  // F-72: first, because a platform pause makes every other fact moot.
  const switches = await killSwitches(c);
  const rows = await c.query<{
    id: string; channel: string; scope: string; consent_type: string;
    granted_at: Date; expires_at: Date | null; revoked_at: Date | null;
  }>(
    `SELECT id, channel, scope, consent_type, granted_at, expires_at, revoked_at
     FROM consent_ledger
     WHERE organization_id = $1 AND (phone_e164 = $2 OR lead_id = $3)`,
    [req.organizationId, req.phoneE164, req.leadId],
  );
  const consentRows: ConsentRow[] = rows.rows.map((x) => ({
    id: x.id,
    channel: x.channel as ConsentRow['channel'],
    scope: x.scope as ConsentRow['scope'],
    consentType: x.consent_type as ConsentRow['consentType'],
    grantedAt: x.granted_at,
    expiresAt: x.expires_at,
    revokedAt: x.revoked_at,
  }));

  const suppressed = await c.query<{ channel: string; createdAt: Date }>(
    `SELECT channel, created_at AS "createdAt" FROM suppression_list
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms' AND cleared_at IS NULL`,
    [req.organizationId, req.phoneE164],
  );
  const dnc = await c.query(
    `SELECT 1 FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`,
    [req.organizationId, req.phoneE164],
  );
  const store = await c.query<{ timezone: string }>(
    `SELECT timezone FROM stores WHERE id = $1`, [req.storeId],
  );
  const cfg = await c.query<{
    sms_quiet_start: string; sms_quiet_end: string;
    first_touch_quiet_exempt: boolean; ai_daily_contact_cap: number;
  }>(
    `SELECT sms_quiet_start::text, sms_quiet_end::text, first_touch_quiet_exempt, ai_daily_contact_cap
     FROM tenant_comms_config
     WHERE organization_id = $1 AND (store_id = $2 OR store_id IS NULL) AND deleted_at IS NULL
     ORDER BY store_id NULLS LAST LIMIT 1`,
    [req.organizationId, req.storeId],
  );
  // The cap protects a PERSON from being contacted too often, so it counts by
  // who was reached, not by which record happened to be attached. Counting
  // `lead_id IS NOT DISTINCT FROM $lead` looked right and was not: with no lead
  // it matched every lead-less decision in the organisation, so one anonymous
  // conversation spent the budget of every other one. Phone OR lead, because
  // the same person can be reached under either.
  const capUsed = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM send_decisions
     WHERE organization_id = $1
       AND (phone_e164 = $2 OR ($3::uuid IS NOT NULL AND lead_id = $3))
       AND status = 'allowed' AND originator = 'ai' AND decided_at >= date_trunc('day', now())`,
    [req.organizationId, req.phoneE164, req.leadId],
  );
  // A conversation a person has taken over is one the assistant is done with.
  const conv = await c.query<{ status: string }>(
    `SELECT status FROM conversations WHERE id = $1`, [req.conversationId],
  );
  const takenOver = ['handed_off', 'agent_active', 'closed'].includes(conv.rows[0]?.status ?? '');

  const conf = cfg.rows[0];
  return {
    suppressed: suppressed.rows[0] ?? null,
    consentRows,
    postalCode: null,
    storeTimezone: store.rows[0]?.timezone ?? 'America/Toronto',
    quietHours: {
      smsQuietStart: conf?.sms_quiet_start ?? '09:00',
      smsQuietEnd: conf?.sms_quiet_end ?? '21:00',
      firstTouchQuietExempt: conf?.first_touch_quiet_exempt ?? true,
    },
    onInternalDnc: dnc.rows.length > 0,
    // No national list is loaded; the gate fails closed on solicitation calls.
    newestDnclDownloadedAt: null,
    phoneOnDnclList: false,
    aiInitiatedSoFarToday: Number(capUsed.rows[0]?.n ?? '0'),
    aiDailyContactCap: conf?.ai_daily_contact_cap ?? 3,
    aiSendsSuspended: req.senderType === 'bot' && takenOver,
    // F-72 §5.3 — the platform kill switches, on the caller's own client so a
    // cache miss is read inside the transaction that writes the decision row.
    platformSmsPaused: switches.sms_send_killswitch,
    platformAiPaused: switches.ai_outbound_killswitch,
  };
}

/** Record the decision, whatever it was. Every send attempt leaves a row. */
async function writeDecision(
  c: PoolClient,
  req: OutboundRequest,
  d: SendDecision,
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO send_decisions
       (organization_id, store_id, lead_id, phone_e164, channel, scope, message_class,
        originator, status, reason, consent_ledger_id, timezone, timezone_source,
        recipient_local_at, window_applied, deferred_until, gate_version)
     VALUES ($1,$2,$3,$4,'sms',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      req.organizationId, req.storeId, req.leadId, req.phoneE164, req.scope, req.messageClass,
      originatorOf(req.senderType),
      d.status,
      d.status === 'allowed' ? null : d.reason,
      d.status === 'allowed' ? d.consentLedgerId : null,
      d.tz, d.tzSource, d.recipientLocalTime,
      d.status === 'blocked' ? null : d.windowApplied,
      d.status === 'deferred' ? d.runAt : null,
      GATE_VERSION,
    ],
  );
  return r.rows[0]!.id;
}

/**
 * Send one message, or explain why not.
 *
 * The compliance question is asked BEFORE the content check, deliberately: a
 * message to somebody who withdrew consent is unlawful whether or not its
 * wording is impeccable, and reporting a wording problem first would send the
 * operator to fix the wrong thing.
 */
export async function sendMessage(c: PoolClient, req: OutboundRequest): Promise<SendOutcome> {
  const gateRequest: SendRequest = {
    organizationId: req.organizationId,
    storeId: req.storeId,
    leadId: req.leadId,
    phoneE164: req.phoneE164,
    email: null,
    channel: 'sms',
    scope: req.scope,
    messageClass: req.messageClass,
    originator: originatorOf(req.senderType),
    isSolicitation: req.isSolicitation,
    // Read at execution time, never at enqueue time: a job queued at 20:00 and
    // run at 21:40 must be judged against 21:40.
    nowUtc: req.nowUtc,
    jitterMs: req.jitterMs ?? 0,
  };

  const decision = evaluateSend(gateRequest, await facts(c, req));
  const decisionId = await writeDecision(c, req, decision);

  if (decision.status === 'blocked') {
    return { kind: 'blocked', decisionId, reason: decision.reason, remedy: decision.remedy };
  }
  if (decision.status === 'deferred') {
    return { kind: 'deferred', decisionId, runAt: decision.runAt, reason: decision.reason };
  }

  // Lawful to contact them. Is this particular text safe to send?
  const violations = outboundGuard(req.body, {
    allowedStockNumbers: req.allowedStockNumbers ?? [],
    isServerTemplate: req.senderType === 'system',
  });
  if (violations.length > 0) {
    // No message row, and the decision above stands as the record that a send
    // was attempted. The caller regenerates with the violations quoted back.
    return { kind: 'unsafe', violations };
  }

  const message = await c.query<{ id: string }>(
    `INSERT INTO messages
       (organization_id, conversation_id, direction, sender_type, channel, body,
        consent_ledger_id, send_decision_id)
     VALUES ($1,$2,'outbound',$3,'sms',$4,$5,$6)
     RETURNING id`,
    [
      req.organizationId, req.conversationId, req.senderType, req.body,
      decision.consentLedgerId, decisionId,
    ],
  );

  return {
    kind: 'sent',
    messageId: message.rows[0]!.id,
    decisionId,
    consentLedgerId: decision.consentLedgerId,
  };
}

/** Record something the customer sent us. Never gated — they contacted us. */
export async function recordInbound(
  c: PoolClient,
  req: { organizationId: string; conversationId: string; body: string; providerRef: string | null },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO messages
       (organization_id, conversation_id, direction, sender_type, channel, body, provider_ref)
     VALUES ($1,$2,'inbound','client','sms',$3,$4)
     RETURNING id`,
    [req.organizationId, req.conversationId, req.body, req.providerRef],
  );
  return r.rows[0]!.id;
}

export { isSendable };
