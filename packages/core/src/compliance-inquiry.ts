import { consentExpiryFor, type Channel, type NewConsentRow, type Scope } from './compliance-consent.js';

/**
 * When making contact with a dealership IS the permission (D-042 #1, owner
 * decision 2026-07-27).
 *
 * CASL treats an enquiry about a product as implied consent to reply about it,
 * for six months. The plan only described capturing this from web forms, which
 * left every walk-in and every phone enquiry permanently unmessageable — the
 * customer stands at the desk, gives you their number, and the system refuses to
 * text them.
 *
 * Two boundaries this is careful about, because both are the difference between
 * a lawful reply and a fine:
 *
 *  - the person must have made contact THEMSELVES. A referral is somebody else
 *    handing over a third party's number, which is not that person enquiring
 *    about anything, and treating it as consent is precisely the abuse CASL
 *    exists to stop.
 *  - it is CONVERSATIONAL only. They asked about a car; they did not ask to be
 *    added to a promotions list, and the six-month reply window is not a
 *    marketing licence.
 */

/**
 * Lead sources where the customer initiated contact in person or by phone.
 *
 * Deliberately not every source: the digital ones arrive through the intake
 * connectors and carry their own evidence (the form, the wording, the IP), which
 * is better than anything inferable here.
 */
export const SELF_INITIATED_SOURCES = ['walk_in', 'phone'] as const;

export type SelfInitiatedSource = (typeof SELF_INITIATED_SOURCES)[number];

export function isSelfInitiated(source: string): source is SelfInitiatedSource {
  return (SELF_INITIATED_SOURCES as readonly string[]).includes(source);
}

export interface InquiryConsentInput {
  readonly source: string;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly at: Date;
  /** Who wrote the lead down, for the evidence record. */
  readonly recordedByUserId: string;
}

/**
 * The consent rows a self-initiated enquiry creates, or none.
 *
 * Returns rows rather than writing them: the caller inserts these inside the
 * same transaction that creates the lead, so a lead can never exist without the
 * basis it was created with — and the basis can never exist without the lead.
 */
export function inquiryConsentRows(input: InquiryConsentInput): readonly NewConsentRow[] {
  if (!isSelfInitiated(input.source)) return [];

  const channels: Channel[] = [];
  // They handed over a phone number, so a text or a call back about their
  // enquiry is what they were asking for.
  if (input.phoneE164) channels.push('sms', 'voice');
  if (input.email) channels.push('email');
  if (channels.length === 0) return [];

  const scope: Scope = 'conversational';
  const grantedAt = input.at;
  const expiresAt = consentExpiryFor('implied_inquiry', grantedAt);

  return channels.map((channel) => ({
    channel,
    scope,
    consentType: 'implied_inquiry' as const,
    grantedAt,
    expiresAt,
    source: 'staff_manual' as const,
    // The evidence is thin by nature — there is no form to screenshot — so it
    // says exactly what happened and who wrote it down, rather than dressing it
    // up as something stronger.
    evidence: {
      basis: 'self_initiated_inquiry',
      lead_source: input.source,
      recorded_by_user_id: input.recordedByUserId,
      recorded_at: grantedAt.toISOString(),
      note:
        input.source === 'walk_in'
          ? 'Customer visited the dealership and provided their contact details'
          : 'Customer telephoned the dealership and provided their contact details',
    },
  }));
}
