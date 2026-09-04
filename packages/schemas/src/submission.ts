import { z } from 'zod';
import { IsoDateTime, NonNegativeCents, Uuid } from './common.js';
import { Deal } from './deal.js';

/**
 * F-81 — the lender submissions ledger (lenders-billofsale.md §2.1–§2.3;
 * FR-FIN-007's remaining half + FR-FIN-008; D-082).
 *
 * One deal, many submissions, exactly ONE selected. A submission records what
 * a lender ANSWERED; it never feeds desk math. « Choisir cette approbation »
 * promotes the chosen row's lender / sell rate / term onto the deal and the
 * engine recomputes — the deal stays the single truth every screen reads.
 *
 * Stored status is the trimmed four (D-082): 'pending' adds nothing over
 * 'submitted'; 'expired' is derived at read from expiry_date on the deal's
 * store clock (the `expired` boolean below); 'funded' is deals.funding_status's
 * fact and is never copied here. Transitions are free among the four; three
 * path-independent invariants (DB CHECKs, mirrored in the route) hold instead
 * of a ladder: selected ⇒ approved; approved ⇒ conditions empty or met;
 * decline_reason ⇒ declined.
 */

/** All four offered, unfiltered — no per-store platform list exists at this tip. */
export const SubmissionPlatform = z.enum(['dealertrack', 'creditapp', 'routeone', 'manual']);
export const SUBMISSION_PLATFORMS = SubmissionPlatform.options;
export type SubmissionPlatformT = z.infer<typeof SubmissionPlatform>;

export const SubmissionStatus = z.enum(['submitted', 'approved', 'conditional', 'declined']);
export const SUBMISSION_STATUSES = SubmissionStatus.options;
export type SubmissionStatusT = z.infer<typeof SubmissionStatus>;

/** Basis points, integers only, like every rate on the deal (deal.ts). */
const Bps = z.number().int().min(0).max(10_000);
/** The deal's own term bounds (deal.ts term_months) — one name everywhere. */
const TermMonths = z.number().int().min(1).max(120);

export const DealSubmission = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  deal_id: Uuid,
  lender_id: Uuid,
  platform: SubmissionPlatform,
  status: SubmissionStatus,
  /** The lender's approved ceiling — informational; the deal's amount financed stays engine-computed. */
  approval_amount_cents: NonNegativeCents.nullable(),
  buy_rate_bps: Bps.nullable(),
  sell_rate_bps: Bps.nullable(),
  term_months: TermMonths.nullable(),
  /** The LENDER'S quoted payment, captioned as such on screen; never the deal's. */
  monthly_payment_cents: NonNegativeCents.nullable(),
  conditions: z.string().nullable(),
  conditions_met: z.boolean(),
  decline_reason: z.string().nullable(),
  /** A calendar day, serialized 'YYYY-MM-DD' by the API (pg has no DATE parser). */
  expiry_date: z.iso.date().nullable(),
  /**
   * Derived on EVERY read from expiry_date against the deal's store clock
   * (F-78's clock law): the chip and the select gate read one boolean, so
   * they cannot disagree across midnight.
   */
  expired: z.boolean(),
  selected: z.boolean(),
  submitted_at: IsoDateTime,
  /** Stamped once, on the first entry into approved/conditional/declined. */
  responded_at: IsoDateTime.nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * Create = the "sent" fact plus whatever numbers the desk already knows.
 * Response facts (status, conditions_met, decline_reason) arrive by PATCH.
 * No organization_id (the deal-addressed route resolves the org — the
 * fi-products shape); no status (born 'submitted'); no .default() anywhere.
 */
export const CreateSubmissionInput = z.strictObject({
  lender_id: Uuid,
  platform: SubmissionPlatform,
  buy_rate_bps: Bps.optional(),
  sell_rate_bps: Bps.optional(),
  term_months: TermMonths.optional(),
  approval_amount_cents: NonNegativeCents.optional(),
  monthly_payment_cents: NonNegativeCents.optional(),
  expiry_date: z.iso.date().optional(),
  conditions: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Update: every recordable field, lender_id and platform included (the
 * no-DELETE correction door for a wrong-bank mis-log, D-082). NEVER `selected`
 * (only the select route writes it) and never a stamp (server-owned). No
 * .default() anywhere (the defaults-leak law); .refine non-empty (the
 * UpdateLenderInput shape).
 */
export const UpdateSubmissionInput = z
  .strictObject({
    status: SubmissionStatus.optional(),
    lender_id: Uuid.optional(),
    platform: SubmissionPlatform.optional(),
    buy_rate_bps: Bps.nullable().optional(),
    sell_rate_bps: Bps.nullable().optional(),
    term_months: TermMonths.nullable().optional(),
    approval_amount_cents: NonNegativeCents.nullable().optional(),
    monthly_payment_cents: NonNegativeCents.nullable().optional(),
    conditions: z.string().trim().max(1000).nullable().optional(),
    conditions_met: z.boolean().optional(),
    decline_reason: z.string().trim().max(500).nullable().optional(),
    expiry_date: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

/** The two truths that moved in one transaction: the chosen row and the re-desked deal. */
export const SelectSubmissionResult = z.object({
  submission: DealSubmission,
  deal: Deal,
});

export type DealSubmissionT = z.infer<typeof DealSubmission>;
export type CreateSubmissionInputT = z.infer<typeof CreateSubmissionInput>;
export type UpdateSubmissionInputT = z.infer<typeof UpdateSubmissionInput>;
export type SelectSubmissionResultT = z.infer<typeof SelectSubmissionResult>;
