import { createHash } from 'node:crypto';
import type { PoolClient } from '@dealpilot/db';
import { matchOptOutKeyword, matchReOptInKeyword } from '@dealpilot/core';
import { recordEvent } from './activity.js';

/**
 * Inbound SMS: the opt-out pipeline (compliance-and-quality.md §5).
 *
 * §5 is unusually precise about the shape of this, and the precision is the
 * point: the effects run "synchronously in one transaction before the 200".
 * Not queued, not eventually — before the acknowledgement. A partial opt-out is
 * the worst outcome available here, because every half of it looks like the
 * system working: the suppression row exists so the screen says "opted out",
 * and the consent rows are still live so the sender keeps sending.
 *
 * CASL allows ten days to honour an unsubscribe. The platform honours it in the
 * same transaction, which is not diligence for its own sake — a ten-day window
 * is ten days of somebody being messaged after they asked us to stop.
 */

/** The E.164 number, hashed for the cross-organisation list. */
function phoneHash(phoneE164: string): Buffer {
  return createHash('sha256').update(phoneE164).digest();
}

export interface InboundSms {
  readonly organizationId: string;
  readonly storeId: string | null;
  readonly phoneE164: string;
  readonly body: string;
  /** The provider's message id, so the file can point at the original. */
  readonly messageRef: string | null;
  /** True only when we have just asked them whether they want to resubscribe. */
  readonly awaitingReOptInPrompt?: boolean;
}

export type InboundOutcome =
  | { kind: 'opted_out'; keyword: string; language: 'en' | 'fr'; consentsRevoked: number }
  | { kind: 'resubscribed'; keyword: string; language: 'en' | 'fr' }
  | { kind: 'ordinary_message' };

/**
 * Apply an opt-out, completely, in the caller's transaction.
 *
 * Every effect below is part of one atomic act. The caller must not commit
 * between them and must not swallow a failure: if effect five fails, effects one
 * through four have to disappear too, or the customer is left in a state where
 * the system believes something different from what it does.
 */
async function applyOptOut(
  c: PoolClient,
  msg: InboundSms,
  keyword: string,
  language: 'en' | 'fr',
): Promise<InboundOutcome> {
  // 1. The suppression row. Organisation-wide, because §5 says so and because
  //    somebody who says stop has not said "stop, except from your other lot".
  const suppression = await c.query<{ id: string }>(
    `INSERT INTO suppression_list
       (organization_id, phone_e164, channel, source, source_message_ref, matched_keyword)
     VALUES ($1,$2,'sms','stop_keyword',$3,$4)
     ON CONFLICT (organization_id, phone_e164, channel) WHERE cleared_at IS NULL
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [msg.organizationId, msg.phoneE164, msg.messageRef, keyword],
  );

  // 2. Every consent this organisation held for that number, withdrawn. Not
  //    deleted — the ledger is evidence, and the withdrawal is a second fact
  //    about it rather than an erasure of the first.
  const revoked = await c.query(
    `UPDATE consent_ledger
     SET revoked_at = now(), revoked_reason = 'stop_keyword'
     WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_at IS NULL`,
    [msg.organizationId, msg.phoneE164],
  );

  // 3. The internal do-not-call list, which §4 says has no exemptions at all.
  //    §5's numbered effects omit this, but its own re-opt-in sentence proves
  //    the intent: coming back "never [clears] the internal DNC for voice —
  //    that requires explicit call consent again". A row that re-opt-in must
  //    not clear has to be written somewhere first.
  await c.query(
    `INSERT INTO internal_dnc (organization_id, phone_e164, reason, source, added_by)
     VALUES ($1,$2,'stop_keyword','sms',NULL)
     ON CONFLICT (organization_id, phone_e164) DO UPDATE SET updated_at = now()`,
    [msg.organizationId, msg.phoneE164],
  );

  // 4. The cross-organisation list. A group with four rooftops under three legal
  //    entities must not re-market to this number through a sister company
  //    tomorrow. Hash only: no tenant, no lead, nothing that would make this a
  //    directory of everyone who ever opted out.
  await c.query(
    `INSERT INTO platform_suppression (phone_sha256, channel)
     VALUES ($1,'sms') ON CONFLICT DO NOTHING`,
    [phoneHash(msg.phoneE164)],
  );

  // 5. Every live drip ride for this number, ended (§11.3: STOP is "global
  //    across sequences"). The suppression row already blocks the sends at
  //    the gate; this makes the enrollment SAY why it stopped, instead of
  //    ticking forever against a wall.
  await c.query(
    `UPDATE drip_enrollments e
     SET status = 'opted_out', opted_out_at = now()
     FROM leads l
     WHERE l.organization_id = e.organization_id AND l.id = e.lead_id
       AND e.organization_id = $1 AND e.status = 'active' AND l.phone = $2`,
    [msg.organizationId, msg.phoneE164],
  );

  // 6. The trail. actor_user_id is NULL because a customer did this, not a
  //    member of staff — pretending otherwise would put a name against
  //    somebody else's decision.
  await c.query(
    `UPDATE leads SET status = 'lost', updated_at = now()
     WHERE organization_id = $1 AND phone = $2 AND status NOT IN ('lost','won')`,
    [msg.organizationId, msg.phoneE164],
  );

  await recordEvent(c, {
    organizationId: msg.organizationId,
    storeId: msg.storeId,
    actorUserId: null,
    entityType: 'suppression',
    entityId: suppression.rows[0]!.id,
    action: 'created',
    changes: {
      matched_keyword: keyword,
      language,
      channel: 'sms',
      consents_revoked: revoked.rowCount ?? 0,
      source_message_ref: msg.messageRef,
    },
  });

  return {
    kind: 'opted_out',
    keyword,
    language,
    consentsRevoked: revoked.rowCount ?? 0,
  };
}

/**
 * Apply a re-subscribe, in the caller's transaction.
 *
 * Deliberately asymmetric with the opt-out: coming back clears the tenant's
 * suppression and records a fresh express consent, and does NOT touch the
 * internal do-not-call list. §5 is explicit — calling them again "requires
 * explicit call consent again". Somebody texting START has said they want texts,
 * not that they want to be phoned by a machine.
 */
async function applyReOptIn(
  c: PoolClient,
  msg: InboundSms,
  keyword: string,
  language: 'en' | 'fr',
): Promise<InboundOutcome> {
  await c.query(
    `UPDATE suppression_list
     SET cleared_at = now(), cleared_reason = 're_opt_in', cleared_by_message_ref = $3
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms' AND cleared_at IS NULL`,
    [msg.organizationId, msg.phoneE164, msg.messageRef],
  );

  // A NEW row. The revoked ones stay revoked — history is never rewritten, and
  // the evidence for this consent is the customer's own message.
  const fresh = await c.query<{ id: string }>(
    `INSERT INTO consent_ledger
       (organization_id, store_id, lead_id, phone_e164, channel, scope, consent_type,
        source, evidence, granted_at, expires_at)
     VALUES ($1,$2,NULL,$3,'sms','conversational','express','re_opt_in',$4, now(), NULL)
     RETURNING id`,
    [
      msg.organizationId,
      msg.storeId,
      msg.phoneE164,
      JSON.stringify({
        // The verbatim reply IS the evidence — not a model's summary of it.
        reply_verbatim: msg.body,
        matched_keyword: keyword,
        source_message_ref: msg.messageRef,
      }),
    ],
  );

  await recordEvent(c, {
    organizationId: msg.organizationId,
    storeId: msg.storeId,
    actorUserId: null,
    entityType: 'consent',
    entityId: fresh.rows[0]!.id,
    action: 'created',
    changes: { basis: 're_opt_in', matched_keyword: keyword, language },
  });

  return { kind: 'resubscribed', keyword, language };
}

/**
 * Handle one inbound message.
 *
 * Keyword matching runs BEFORE any other routing (§5): an opt-out buried in an
 * otherwise ordinary message is still an opt-out, and letting the conversation
 * engine see it first would mean a reply going out to somebody who just asked us
 * to stop.
 *
 * The confirmation message §5 asks for is NOT sent here. §1 says "nothing skips
 * suppression or consent", and the suppression row exists by the time any
 * confirmation could be composed — the two rules contradict, and resolving that
 * by inventing an exemption is how exemptions multiply. Filed as D-042 #3.
 */
export async function handleInboundSms(c: PoolClient, msg: InboundSms): Promise<InboundOutcome> {
  const optOut = matchOptOutKeyword(msg.body);
  if (optOut) return applyOptOut(c, msg, optOut.keyword, optOut.language);

  const reOptIn = matchReOptInKeyword(msg.body, msg.awaitingReOptInPrompt ?? false);
  if (reOptIn) return applyReOptIn(c, msg, reOptIn.keyword, reOptIn.language);

  return { kind: 'ordinary_message' };
}

/** Is this number on the cross-organisation stop list? */
export async function onPlatformSuppression(
  c: PoolClient,
  phoneE164: string,
  channel: 'sms' | 'mms' | 'voice' | 'email',
): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM platform_suppression WHERE phone_sha256 = $1 AND channel = $2`,
    [phoneHash(phoneE164), channel],
  );
  return r.rows.length > 0;
}
