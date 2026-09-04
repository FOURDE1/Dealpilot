import { describe, expect, it } from 'vitest';
import {
  applyPromotedTerms,
  bpsToRateInput,
  ceilingExceeded,
  deskDiffers,
  selectability,
} from './submissions-model.js';

/**
 * F-81 — goldens for the panel's pure decisions (D-082). The prefill idiom is
 * pinned against the desking page's own expression so a promoted rate lands
 * in the field as the exact string a reopen shows.
 */

/** desking-page.tsx's edit-mode prefill expression, copied verbatim as the oracle. */
const pageIdiom = (bps: number) => (bps === 0 ? '' : (bps / 100).toFixed(2).replace(/\.?0+$/, ''));

describe('bpsToRateInput — the hoisted prefill idiom', () => {
  it.each([599, 500, 0, 1250, 649, 1])('equals the page expression on %d', (bps) => {
    expect(bpsToRateInput(bps)).toBe(pageIdiom(bps));
  });
  it('goldens: 599→5.99, 500→5, 0→empty, 1250→12.5', () => {
    expect(bpsToRateInput(599)).toBe('5.99');
    expect(bpsToRateInput(500)).toBe('5');
    expect(bpsToRateInput(0)).toBe('');
    expect(bpsToRateInput(1250)).toBe('12.5');
  });
});

describe('applyPromotedTerms — rewrites rate and term, nothing else', () => {
  const draft = {
    province: 'QC',
    deal_type: 'finance',
    sale_price: '30000.00',
    cash_down: '1500',
    rate: '4.99',
    term: '48',
    tax_exempt: false,
  };

  it.each([
    [599, 72, '5.99', '72'],
    [500, 60, '5', '60'],
    [0, 84, '', '84'],
  ])('bps %d / %d months → rate %s, term %s', (bps, months, rate, term) => {
    const next = applyPromotedTerms(draft, { interest_rate_bps: bps, term_months: months });
    expect(next.rate).toBe(rate);
    expect(next.term).toBe(term);
    // Every other field is untouched — deep-equal minus the two promoted keys.
    const { rate: _r1, term: _t1, ...restBefore } = draft;
    const { rate: _r2, term: _t2, ...restAfter } = next;
    void _r1;
    void _t1;
    void _r2;
    void _t2;
    expect(restAfter).toEqual(restBefore);
  });

  it('returns a new object and leaves the input draft as it was', () => {
    const next = applyPromotedTerms(draft, { interest_rate_bps: 699, term_months: 72 });
    expect(next).not.toBe(draft);
    expect(draft.rate).toBe('4.99');
    expect(draft.term).toBe('48');
  });
});

describe('selectability — the server gate order, on the API booleans', () => {
  const approved = { status: 'approved', sell_rate_bps: 699, term_months: 72, expired: false } as const;

  it('is not rendered at all without deal:update', () => {
    expect(selectability(approved, false)).toEqual({ rendered: false, enabled: false, reasonKey: null });
  });
  it('submitted → disabled, not_approved', () => {
    expect(selectability({ ...approved, status: 'submitted' }, true)).toEqual({
      rendered: true,
      enabled: false,
      reasonKey: 'submSelectErr_submission_not_approved',
    });
  });
  it('conditional → disabled, not_approved (the selected⇒approved invariant)', () => {
    expect(selectability({ ...approved, status: 'conditional' }, true).reasonKey).toBe(
      'submSelectErr_submission_not_approved',
    );
  });
  it('declined → disabled, not_approved', () => {
    expect(selectability({ ...approved, status: 'declined' }, true).enabled).toBe(false);
  });
  it('approved with the sell rate missing → submIncompleteHint', () => {
    expect(selectability({ ...approved, sell_rate_bps: null }, true)).toEqual({
      rendered: true,
      enabled: false,
      reasonKey: 'submIncompleteHint',
    });
  });
  it('approved with the term missing → submIncompleteHint', () => {
    expect(selectability({ ...approved, term_months: null }, true).reasonKey).toBe('submIncompleteHint');
  });
  it('approved, complete, expired on the STORE clock (API boolean) → submission_expired', () => {
    expect(selectability({ ...approved, expired: true }, true)).toEqual({
      rendered: true,
      enabled: false,
      reasonKey: 'submSelectErr_submission_expired',
    });
  });
  it('approved, complete, not expired → enabled', () => {
    expect(selectability(approved, true)).toEqual({ rendered: true, enabled: true, reasonKey: null });
  });
});

describe('deskDiffers — the selected row against the LIVE worksheet', () => {
  const row = { selected: true, sell_rate_bps: 699, term_months: 72, lender_id: 'X' };
  it('differs when rate and term moved', () => {
    expect(deskDiffers(row, { interest_rate_bps: 499, term_months: 48, lender_id: 'X' })).toBe(true);
  });
  it('agrees when all three match', () => {
    expect(deskDiffers(row, { interest_rate_bps: 699, term_months: 72, lender_id: 'X' })).toBe(false);
  });
  it('differs when only the lender moved (a re-save carrying the old lender is visible)', () => {
    expect(deskDiffers(row, { interest_rate_bps: 699, term_months: 72, lender_id: 'Y' })).toBe(true);
  });
  it('never fires on an unselected row', () => {
    expect(deskDiffers({ ...row, selected: false }, { interest_rate_bps: 0, term_months: 1, lender_id: null })).toBe(false);
  });
});

describe('ceilingExceeded — finance only, selected row only, warn never refuse', () => {
  const row = { selected: true, approval_amount_cents: 2_800_000 };
  it('finance 30 000,00 $ financed vs 28 000,00 $ ceiling → exceeded', () => {
    expect(ceilingExceeded(row, 3_000_000, 'finance')).toBe(true);
  });
  it('cash: the column is the total due, never compared', () => {
    expect(ceilingExceeded(row, 3_000_000, 'cash')).toBe(false);
  });
  it('lease: the worksheet hides the amount financed, never compared', () => {
    expect(ceilingExceeded(row, 3_000_000, 'lease')).toBe(false);
  });
  it('no ceiling on file → nothing to exceed', () => {
    expect(ceilingExceeded({ ...row, approval_amount_cents: null }, 3_000_000, 'finance')).toBe(false);
  });
  it('within the ceiling → silent; equal → silent', () => {
    expect(ceilingExceeded(row, 2_700_000, 'finance')).toBe(false);
    expect(ceilingExceeded(row, 2_800_000, 'finance')).toBe(false);
  });
  it('unselected row → silent even when over', () => {
    expect(ceilingExceeded({ ...row, selected: false }, 3_000_000, 'finance')).toBe(false);
  });
});
