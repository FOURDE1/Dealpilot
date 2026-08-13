/**
 * The consent ledger's arithmetic (compliance-and-quality.md §2).
 *
 * One question matters here: at this instant, is there a live basis on which
 * this organisation may contact this person on this channel for this purpose —
 * and WHICH row is it? The row, not a boolean, because the id is stamped onto
 * the send decision. "We had consent" is not a defence; "we relied on this row,
 * acquired here, on this evidence" is.
 */

export type Channel = 'sms' | 'mms' | 'email' | 'voice' | 'all';
export type Scope = 'conversational' | 'marketing' | 'ai_outbound_call';
export type ConsentType = 'express' | 'implied_inquiry' | 'implied_ebr';

export interface ConsentRow {
  readonly id: string;
  readonly channel: Channel;
  readonly scope: Scope;
  readonly consentType: ConsentType;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export type ConsentVerdict =
  | { state: 'live'; row: ConsentRow }
  | { state: 'expired'; lastExpiredAt: Date; lastRow: ConsentRow }
  | { state: 'revoked'; revokedAt: Date; lastRow: ConsentRow }
  | { state: 'absent' };

/**
 * When this basis runs out (§2).
 *
 *   implied_inquiry → granted + 6 months
 *   implied_ebr     → the purchase + 24 months
 *   express         → never, but revocable → null
 *
 * CALENDAR months, not 30-day multiples. Six months from 31 August is 28
 * February, and a day-count would put it on 2 March — two days during which the
 * platform would be messaging somebody it no longer had a basis to message.
 */
export function consentExpiryFor(consentType: ConsentType, grantedAt: Date): Date | null {
  const months = consentType === 'implied_inquiry' ? 6 : consentType === 'implied_ebr' ? 24 : 0;
  if (months === 0) return null;

  const target = new Date(grantedAt.getTime());
  const day = target.getUTCDate();
  target.setUTCMonth(target.getUTCMonth() + months);
  // setUTCMonth rolls 31 Aug + 6 into 3 March; pull it back to the last day of
  // the intended month so the window can only ever be shorter, never longer.
  if (target.getUTCDate() !== day) target.setUTCDate(0);
  return target;
}

/** A row is live when it has not been revoked and has not run out. */
function isLive(row: ConsentRow, at: Date): boolean {
  if (row.revokedAt !== null && row.revokedAt.getTime() <= at.getTime()) return false;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= at.getTime()) return false;
  return true;
}

function matchesChannel(row: ConsentRow, channel: Channel): boolean {
  if (row.channel === 'all') return true;
  // An SMS basis covers MMS: it is the same conversation on the same number.
  if (channel === 'mms' && row.channel === 'sms') return true;
  return row.channel === channel;
}

/**
 * Is there a live basis for (channel, scope) at `at`, and which row is it?
 *
 * Reads `revokedAt` and `expiresAt` only — never a cached status column. Expiry
 * passes continuously while a nightly sweep runs once, and a gate keyed on the
 * cache would let a message out on the wrong side of a boundary for up to a day.
 *
 * When several rows qualify, the longest-lived wins: renewal APPENDS rows rather
 * than editing them (§2: "history is never mutated"), so the effective expiry is
 * the maximum across live rows and not the newest row's.
 */
export function resolveConsent(
  rows: readonly ConsentRow[],
  channel: Channel,
  scope: Scope,
  at: Date,
): ConsentVerdict {
  const relevant = rows.filter((r) => r.scope === scope && matchesChannel(r, channel));
  if (relevant.length === 0) return { state: 'absent' };

  const live = relevant.filter((r) => isLive(r, at));
  if (live.length > 0) {
    const best = live.reduce((a, b) => {
      // A never-expiring basis outranks a dated one; otherwise the later end wins.
      if (a.expiresAt === null) return a;
      if (b.expiresAt === null) return b;
      return a.expiresAt.getTime() >= b.expiresAt.getTime() ? a : b;
    });
    return { state: 'live', row: best };
  }

  // Nothing live. Revoked and expired are different states with different
  // remedies — a revoked person must never be messaged again without a fresh
  // opt-in, while an expired basis can be renewed by a new inquiry — so they are
  // reported separately rather than collapsed into "no".
  const revoked = relevant.filter((r) => r.revokedAt !== null && r.revokedAt.getTime() <= at.getTime());
  if (revoked.length > 0) {
    const latest = revoked.reduce((a, b) => (a.revokedAt!.getTime() >= b.revokedAt!.getTime() ? a : b));
    return { state: 'revoked', revokedAt: latest.revokedAt!, lastRow: latest };
  }

  const expired = relevant.filter((r) => r.expiresAt !== null && r.expiresAt.getTime() <= at.getTime());
  const latest = expired.reduce((a, b) => (a.expiresAt!.getTime() >= b.expiresAt!.getTime() ? a : b));
  return { state: 'expired', lastExpiredAt: latest.expiresAt!, lastRow: latest };
}

/**
 * The row that exempts this number from the national do-not-call scrub (§4).
 *
 * Restricted to voice bases. An SMS marketing consent must not exempt a number
 * from a CALLING list — they are different acts, and treating one as the other
 * is how a customer who agreed to texts starts receiving calls.
 */
export function dnclExemption(rows: readonly ConsentRow[], at: Date): ConsentRow | null {
  const eligible = rows.filter(
    (r) =>
      (r.consentType === 'express' || r.consentType === 'implied_ebr') &&
      (r.channel === 'voice' || r.channel === 'all') &&
      isLive(r, at),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => {
    if (a.expiresAt === null) return a;
    if (b.expiresAt === null) return b;
    return a.expiresAt.getTime() >= b.expiresAt.getTime() ? a : b;
  });
}

export interface ConsentAcquisition {
  readonly consentType: ConsentType;
  readonly scopes: readonly Scope[];
  readonly channels: readonly Channel[];
  readonly grantedAt: Date;
  readonly source: string;
  readonly evidence: Record<string, unknown>;
}

export interface NewConsentRow {
  readonly channel: Channel;
  readonly scope: Scope;
  readonly consentType: ConsentType;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly source: string;
  readonly evidence: Record<string, unknown>;
}

/**
 * One act by a person becomes the rows it actually authorises (§2).
 *
 * Expanded here rather than stored as a list so every row carries its own expiry
 * and can be revoked on its own. They share a `grant_id` at the database level,
 * which is what lets one tick of one box still be auditable as one act.
 */
export function fanOutGrant(act: ConsentAcquisition): readonly NewConsentRow[] {
  const out: NewConsentRow[] = [];
  for (const channel of act.channels) {
    for (const scope of act.scopes) {
      out.push({
        channel,
        scope,
        consentType: act.consentType,
        grantedAt: act.grantedAt,
        expiresAt: consentExpiryFor(act.consentType, act.grantedAt),
        source: act.source,
        evidence: act.evidence,
      });
    }
  }
  return out;
}
