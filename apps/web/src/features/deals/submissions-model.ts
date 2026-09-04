import type { DealSubmissionT, SubmissionPlatformT, SubmissionStatusT } from '@dealpilot/schemas';

/**
 * F-81 — the submissions panel's pure logic (the lenders/options.ts pattern:
 * decisions out of the component, goldens beside them).
 *
 * Nothing here reads a clock or the browser: `expired` is the API's boolean
 * (derived on the deal's STORE clock, D-082), and the two chips compare the
 * row against values the page hands in.
 */

/** `deals:` namespace key per platform — a fifth platform fails to compile here. */
export const SUBMISSION_PLATFORM_KEYS = {
  dealertrack: 'submPlatform_dealertrack',
  creditapp: 'submPlatform_creditapp',
  routeone: 'submPlatform_routeone',
  manual: 'submPlatform_manual',
} as const satisfies Record<SubmissionPlatformT, string>;

/** Status badges are TEXT (never colour alone) — one key per stored status. */
export const SUBMISSION_STATUS_KEYS = {
  submitted: 'submStatus_submitted',
  approved: 'submStatus_approved',
  conditional: 'submStatus_conditional',
  declined: 'submStatus_declined',
} as const satisfies Record<SubmissionStatusT, string>;

/**
 * Basis points → the worksheet's rate INPUT string: the desking prefill idiom
 * (desking-page.tsx's edit-mode effect), hoisted so a promoted rate lands in
 * the field as the SAME string a reopen would show ('5.99', '5', '' for 0).
 */
export function bpsToRateInput(bps: number): string {
  return bps === 0 ? '' : (bps / 100).toFixed(2).replace(/\.?0+$/, '');
}

/**
 * The stale-form fix (D-082): after « Choisir cette approbation » the server's
 * deal carries the promoted rate/term; the page rewrites ONLY those two draft
 * fields so its next save re-sends what the select just wrote. Every other
 * field stays the user's; the `prefilled` latch is never touched.
 */
export function applyPromotedTerms<D extends { rate: string; term: string }>(
  draft: D,
  deal: { interest_rate_bps: number; term_months: number },
): D {
  return { ...draft, rate: bpsToRateInput(deal.interest_rate_bps), term: String(deal.term_months) };
}

export type SelectReasonKey =
  | 'submSelectErr_submission_not_approved'
  | 'submIncompleteHint'
  | 'submSelectErr_submission_expired';

export interface Selectability {
  /** false for a member without deal:update — the button does not exist for them. */
  readonly rendered: boolean;
  readonly enabled: boolean;
  /** The disabled button's reason (aria-describedby target); null when enabled or not rendered. */
  readonly reasonKey: SelectReasonKey | null;
}

/**
 * Whether « Choisir cette approbation » renders, and whether it is live — in
 * the server's own gate order (status → completeness → expiry). The lender
 * check (F-80's inactive rule with the deal's grandfather) is the server's
 * alone; its 422 lands under the row.
 */
export function selectability(
  row: Pick<DealSubmissionT, 'status' | 'sell_rate_bps' | 'term_months' | 'expired'>,
  canWrite: boolean,
): Selectability {
  if (!canWrite) return { rendered: false, enabled: false, reasonKey: null };
  if (row.status !== 'approved') {
    return { rendered: true, enabled: false, reasonKey: 'submSelectErr_submission_not_approved' };
  }
  if (row.sell_rate_bps === null || row.term_months === null) {
    return { rendered: true, enabled: false, reasonKey: 'submIncompleteHint' };
  }
  if (row.expired) {
    return { rendered: true, enabled: false, reasonKey: 'submSelectErr_submission_expired' };
  }
  return { rendered: true, enabled: true, reasonKey: null };
}

/** What the open worksheet holds right now — the page's live draft, not the saved deal (A7). */
export interface LiveTerms {
  readonly interest_rate_bps: number | null;
  readonly term_months: number | null;
  readonly lender_id: string | null;
}

/**
 * The desk-differs chip: the SELECTED row's promoted three no longer match
 * the live worksheet (a re-desk after selecting, or another tab's select).
 * Same-tab select is silent because the page rewrites the draft first.
 */
export function deskDiffers(
  row: Pick<DealSubmissionT, 'selected' | 'sell_rate_bps' | 'term_months' | 'lender_id'>,
  live: LiveTerms,
): boolean {
  if (!row.selected) return false;
  return (
    row.sell_rate_bps !== live.interest_rate_bps ||
    row.term_months !== live.term_months ||
    row.lender_id !== live.lender_id
  );
}

/**
 * The ceiling chip (warn, never refuse — D-082): finance deals only, on the
 * SELECTED row, when the engine's amount financed exceeds the lender's
 * approved ceiling. A cash deal's column is the total due and a lease hides
 * it (A8), so neither compares.
 */
export function ceilingExceeded(
  row: Pick<DealSubmissionT, 'selected' | 'approval_amount_cents'>,
  amountFinancedCents: number | null,
  dealType: 'finance' | 'lease' | 'cash',
): boolean {
  if (!row.selected || dealType !== 'finance') return false;
  if (row.approval_amount_cents === null || amountFinancedCents === null) return false;
  return amountFinancedCents > row.approval_amount_cents;
}
