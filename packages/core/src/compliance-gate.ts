import {
  dnclExemption,
  resolveConsent,
  type Channel,
  type ConsentRow,
  type Scope,
} from './compliance-consent.js';
import {
  quietHoursDecision,
  resolveRecipientTimezone,
  type CommChannel,
  type MessageClass,
  type QuietHoursConfig,
  type TzSource,
} from './compliance-quiet-hours.js';

/**
 * THE gate (compliance-and-quality.md §1).
 *
 * The send layer calls this and nothing else. It never re-derives a rule, never
 * adds a condition of its own, and never sends on anything but `allowed`. If it
 * needs a decision this function does not return, this function is extended —
 * because the moment two places decide whether a message is lawful, one of them
 * is wrong and nobody knows which.
 *
 * The spec's doctrine, verbatim: "a jailbroken model must still be structurally
 * unable to send an unconsented message or place an unconsented call." A model
 * cannot reach this code path; it can only ask for a send, and the answer is
 * computed from rows it cannot write.
 *
 * Every ambiguity resolves to `blocked`. A compliance engine that guesses in the
 * permissive direction is not a compliance engine.
 */

export const GATE_VERSION = 'f15.1';

export type Originator = 'ai' | 'human' | 'system';

export interface SendRequest {
  readonly organizationId: string;
  readonly storeId: string | null;
  readonly leadId: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly channel: CommChannel;
  /**
   * REQUIRED, with no default anywhere in the chain. A default is precisely how
   * a marketing blast ships as "conversational" and nobody notices until a
   * regulator does.
   */
  readonly scope: Scope;
  readonly messageClass: MessageClass;
  readonly originator: Originator;
  /** Whether this contact promotes anything. Drives the national-scrub rules. */
  readonly isSolicitation: boolean;
  /** Read at EXECUTION time, never at enqueue time — a job queued at 20:00 and
   *  run at 21:40 must be judged against 21:40. */
  readonly nowUtc: Date;
  readonly jitterMs: number;
}

export interface ComplianceFacts {
  readonly suppressed: { channel: string; createdAt: Date } | null;
  readonly consentRows: readonly ConsentRow[];
  readonly postalCode: string | null;
  readonly storeTimezone: string;
  readonly quietHours: QuietHoursConfig;
  readonly onInternalDnc: boolean;
  /** Null means no national list has ever been loaded for this organisation. */
  readonly newestDnclDownloadedAt: Date | null;
  readonly phoneOnDnclList: boolean;
  readonly aiInitiatedSoFarToday: number;
  readonly aiDailyContactCap: number;
  /** A human has taken over, or the tenant switched the AI off. */
  readonly aiSendsSuspended: boolean;
}

/**
 * An array, not a bare union, so the vocabulary can be ENUMERATED.
 *
 * Every one of these is shown to a person — the console prints the reason and
 * the remedy when a send is refused. A union type cannot be iterated, so
 * nothing could check that each reason has a label in both locales, and the
 * agent would read `reason_dncl_list_stale` at the moment they most need a
 * sentence they can act on.
 */
export const BLOCKED_REASONS = [
  'ai_suspended',
  'suppressed',
  'consent_absent',
  'consent_expired',
  'consent_revoked',
  'internal_dnc',
  'dncl_list_stale',
  'dncl_listed',
  'adad_no_express_consent',
  'frequency_cap',
] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export interface DecisionContext {
  readonly tz: string;
  readonly tzSource: TzSource;
  readonly recipientLocalTime: Date;
  readonly gateVersion: string;
}

export type SendDecision =
  | ({
      status: 'allowed';
      consentLedgerId: string;
      exemptionConsentId: string | null;
      windowApplied: string;
    } & DecisionContext)
  | ({
      status: 'deferred';
      reason: 'quiet_hours';
      runAt: Date;
      windowStartUtc: Date;
      jitterMs: number;
      windowApplied: string;
      remedy: string;
    } & DecisionContext)
  | ({
      status: 'blocked';
      reason: BlockedReason;
      remedy: string;
      detail: string;
      alert: 'HIGH' | null;
    } & DecisionContext);

/**
 * How long a national do-not-call list may be relied on.
 *
 * The CRTC rule is 31 days. Past it the list is not "probably still fine" — it
 * is not a defence, so the platform stops making solicitation calls for that
 * organisation entirely rather than calling numbers it can no longer prove were
 * clear.
 */
export const DNCL_MAX_AGE_DAYS = 31;

/** Consent bases that satisfy the ADAD rule for an automated outbound call (§4). */
function hasExpressCallConsent(rows: readonly ConsentRow[], at: Date): ConsentRow | null {
  const verdict = resolveConsent(rows, 'voice', 'ai_outbound_call', at);
  if (verdict.state !== 'live') return null;
  // §4: an ADAD is lawful for solicitation "only with prior EXPRESS consent".
  // An implied basis is not enough, however recent.
  return verdict.row.consentType === 'express' ? verdict.row : null;
}

/**
 * Decide whether this one contact attempt is lawful right now.
 *
 * Order matters and follows §1's chain: suppression, then consent, then quiet
 * hours, then the calling lists, then frequency. The FIRST failure is the one
 * reported, because that is the one the operator has to fix; reporting the last
 * would send them chasing a consequence.
 */
export function evaluateSend(req: SendRequest, facts: ComplianceFacts): SendDecision {
  const { tz, source: tzSource } = resolveRecipientTimezone({
    postalCode: facts.postalCode,
    phoneE164: req.phoneE164,
    storeTimezone: facts.storeTimezone,
  });

  const quiet = quietHoursDecision({
    nowUtc: req.nowUtc,
    tz,
    channel: req.channel,
    messageClass: req.messageClass,
    cfg: facts.quietHours,
    jitterMs: req.jitterMs,
  });
  const ctx: DecisionContext = {
    tz,
    tzSource,
    recipientLocalTime: quiet.recipientLocalTime,
    gateVersion: GATE_VERSION,
  };
  const block = (reason: BlockedReason, remedy: string, detail: string, alert: 'HIGH' | null = null) =>
    ({ status: 'blocked' as const, reason, remedy, detail, alert, ...ctx });

  // A silenced assistant must not even evaluate. If a human has taken the
  // conversation, the machine is done with it.
  if (req.originator === 'ai' && facts.aiSendsSuspended) {
    return block('ai_suspended', 'the assistant is off for this conversation', 'human takeover or AI disabled');
  }

  // §1: "nothing skips suppression or consent." Not a reply, not a first touch,
  // not an appointment reminder.
  if (facts.suppressed) {
    return block(
      'suppressed',
      'they asked us to stop; only they can undo it, by texting START',
      `suppressed on ${facts.suppressed.channel} since ${facts.suppressed.createdAt.toISOString()}`,
    );
  }

  const consent = resolveConsent(facts.consentRows, req.channel as Channel, req.scope, req.nowUtc);
  if (consent.state === 'revoked') {
    return block(
      'consent_revoked',
      'they withdrew consent; a fresh opt-in is the only way back',
      `revoked ${consent.revokedAt.toISOString()}`,
    );
  }
  if (consent.state === 'expired') {
    // Distinct from absent on purpose: the remedy differs. An expired basis is
    // renewed by a new inquiry or purchase, and never by extending the old row.
    return block(
      'consent_expired',
      'acquire a fresh basis — a new inquiry or a completed purchase',
      `last basis expired ${consent.lastExpiredAt.toISOString()}`,
    );
  }
  if (consent.state === 'absent') {
    return block(
      'consent_absent',
      'capture consent before contacting them',
      `no ${req.scope} basis on ${req.channel}`,
    );
  }

  // Calling lists, voice only. §4: internal DNC has no exemptions at all — not
  // even an express consent overrides somebody telling this dealership never to
  // call them again.
  let exemptionConsentId: string | null = null;
  if (req.channel === 'voice') {
    if (facts.onInternalDnc) {
      return block('internal_dnc', 'this organisation was told not to call them', 'on the internal do-not-call list');
    }
    if (req.isSolicitation) {
      const exemption = dnclExemption(facts.consentRows, req.nowUtc);
      exemptionConsentId = exemption?.id ?? null;
      // Staleness is checked BEFORE the per-number question, and a consent
      // exemption does not bypass it: if the list is too old the organisation
      // cannot prove ANY number was clear, so solicitation stops entirely.
      const ageMs = facts.newestDnclDownloadedAt
        ? req.nowUtc.getTime() - facts.newestDnclDownloadedAt.getTime()
        : Number.POSITIVE_INFINITY;
      if (ageMs > DNCL_MAX_AGE_DAYS * 86_400_000) {
        return block(
          'dncl_list_stale',
          'refresh the national do-not-call list',
          facts.newestDnclDownloadedAt
            ? `newest list is ${Math.floor(ageMs / 86_400_000)} days old`
            : 'no national list has ever been loaded',
          'HIGH',
        );
      }
      if (facts.phoneOnDnclList && !exemption) {
        return block('dncl_listed', 'they are on the national list and no exemption applies', 'on the national DNCL');
      }
    }
    // An automated outbound call needs express call consent, and only express.
    if (req.originator === 'ai') {
      const express = hasExpressCallConsent(facts.consentRows, req.nowUtc);
      if (!express) {
        return block(
          'adad_no_express_consent',
          'ask for call consent by text and verify the reply server-side',
          'no express ai_outbound_call consent on voice',
        );
      }
    }
  }

  if (quiet.status === 'deferred') {
    return {
      status: 'deferred',
      reason: 'quiet_hours',
      runAt: quiet.runAt,
      windowStartUtc: quiet.windowStartUtc,
      jitterMs: quiet.jitterMs,
      windowApplied: quiet.windowApplied,
      remedy: 're-enqueue and re-run the whole gate on wake',
      ...ctx,
    };
  }

  // §1: at most a few assistant-initiated contacts per lead per day. A reply the
  // customer asked for is not one of them.
  if (req.originator === 'ai' && req.messageClass !== 'inbound_reply') {
    if (facts.aiInitiatedSoFarToday >= facts.aiDailyContactCap) {
      return block(
        'frequency_cap',
        'wait until tomorrow, or have a person take over',
        `${facts.aiInitiatedSoFarToday} of ${facts.aiDailyContactCap} assistant contacts already sent today`,
      );
    }
  }

  return {
    status: 'allowed',
    consentLedgerId: consent.row.id,
    exemptionConsentId,
    windowApplied: quiet.windowApplied,
    ...ctx,
  };
}
