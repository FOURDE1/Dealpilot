import type { PoolClient } from '@dealpilot/db';
import { computeDeal, type DeskingInput } from '@dealpilot/core';
import type { DeskingInputsT, DeskingOutputsT } from '@dealpilot/schemas';

/**
 * The desking engine's glue: which deal columns are INPUTS, which are the
 * stored OUTPUTS, and how to get from one to the other.
 *
 * Its own module because two features need it and importing one route file from
 * the other made a cycle: F-05 asks F-13 to regenerate a deal's documents, and
 * F-13's F&I products have to re-quote the deal they belong to. A cycle between
 * two route files resolves at runtime by luck of hoisting; a shared module does
 * not need luck.
 */

export function toEngineInput(i: DeskingInputsT): DeskingInput {
  return {
    salePriceCents: i.sale_price_cents,
    ...(i.msrp_cents === undefined ? {} : { msrpCents: i.msrp_cents }),
    vehicleCostCents: i.vehicle_cost_cents,
    provinceCode: i.province,
    dealType: i.deal_type,
    interestRatePct: i.interest_rate_bps / 100,
    termMonths: i.term_months,
    // HO-05: a lease is priced from a money factor, a lease term and a
    // residual — not from the finance fields. Without this mapping the engine
    // silently used its defaults, so a saved lease stored a rate and term that
    // had nothing to do with its payment. MF = APR / 2400 (industry standard).
    moneyFactor: i.interest_rate_bps / 100 / 2400,
    leaseTermMonths: i.term_months,
    residualPercent: i.residual_percent,
    cashDownCents: i.cash_down_cents,
    taxExempt: i.tax_exempt,
    ...(i.trade_allowance_cents || i.trade_acv_cents || i.trade_lien_cents
      ? {
          trades: [
            {
              allowanceCents: i.trade_allowance_cents,
              acvCents: i.trade_acv_cents,
              lienCents: i.trade_lien_cents,
            },
          ],
        }
      : {}),
    ...(i.rebate_cents ? { rebatesCents: [i.rebate_cents] } : {}),
    ...(i.fees_cents ? { fees: [{ amountCents: i.fees_cents, taxable: i.fees_taxable }] } : {}),
    ...(i.fi_price_cents || i.fi_cost_cents
      ? { fiProducts: [{ priceCents: i.fi_price_cents, costCents: i.fi_cost_cents, taxable: true }] }
      : {}),
  };
}

export function computeOutputs(i: DeskingInputsT): DeskingOutputsT {
  const d = computeDeal(toEngineInput(i));
  const monthly = i.deal_type === 'lease' ? d.leaseMonthlyCents : d.financeMonthlyCents;
  return {
    gst_cents: d.taxes.gst_cents,
    pst_cents: d.taxes.pst_cents,
    hst_cents: d.taxes.hst_cents,
    tax_total_cents: d.taxes.total_cents,
    amount_financed_cents: i.deal_type === 'cash' ? d.cashTotalDueCents : d.amountFinancedCents,
    monthly_payment_cents: monthly,
    biweekly_payment_cents: Math.round((monthly * 12) / 26),
    weekly_payment_cents: Math.round((monthly * 12) / 52),
    front_gross_cents: d.frontGrossCents,
    total_gross_cents: d.totalGrossCents,
  };
}

export const INPUT_COLUMNS = [
  'province', 'deal_type', 'sale_price_cents', 'msrp_cents', 'vehicle_cost_cents',
  'cash_down_cents', 'trade_allowance_cents', 'trade_acv_cents', 'trade_lien_cents',
  'rebate_cents', 'fees_cents', 'fees_taxable', 'fi_price_cents', 'fi_cost_cents',
  'interest_rate_bps', 'term_months', 'residual_percent', 'tax_exempt',
] as const;

export const OUTPUT_COLUMNS = [
  'gst_cents', 'pst_cents', 'hst_cents', 'tax_total_cents',
  'amount_financed_cents', 'monthly_payment_cents', 'front_gross_cents', 'total_gross_cents',
] as const;

/**
 * Re-run the engine over a deal's STORED inputs and write the outputs back.
 *
 * The deal PATCH has always done this inline, because "stored outputs must
 * never drift from the inputs beside them" is the invariant the whole desking
 * model rests on: the pipeline card, the deal row and every report read the
 * stored quote, not a live calculation.
 *
 * F-13b then changed a deal's inputs from OUTSIDE that route. The trigger
 * re-summed `fi_price_cents` faithfully and nothing recomputed the payment, the
 * taxes or the gross beside it — so adding a $2,500 warranty moved the input and
 * left last week's quote on the screen until somebody happened to re-save the
 * worksheet (CR-13, live-probed by Hussein).
 *
 * Exported so any path that touches a deal's inputs can close the loop in its
 * own transaction. A path that changes inputs and does not call this is a bug.
 */
export async function recomputeDealOutputs(client: PoolClient, dealId: string): Promise<void> {
  const r = await client.query<Record<string, unknown>>(
    `SELECT ${INPUT_COLUMNS.join(', ')} FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId],
  );
  if (r.rows.length === 0) return;
  const outputs = computeOutputs(r.rows[0] as unknown as DeskingInputsT) as unknown as Record<string, number>;
  await client.query(
    `UPDATE deals SET ${OUTPUT_COLUMNS.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [dealId, ...OUTPUT_COLUMNS.map((k) => outputs[k])],
  );
}
