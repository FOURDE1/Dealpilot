import { describe, expect, it } from 'vitest';
import { createI18n, type Locale } from '@dealpilot/i18n';

/**
 * F-79 T-W2 — the ICU `::currency/CAD` skeleton actually formats (the ruling
 * that params carry ONE locale-free number is conditional on this render
 * being pinned, per D-080). strictIcu makes a malformed skeleton or a
 * missing argument THROW instead of rendering the raw placeholder.
 *
 * narrowSymbol≡symbol equivalence (A15): the page's formatCents uses
 * currencyDisplay 'narrowSymbol' while the ICU skeleton defaults to
 * 'symbol' — measured identical in fr-CA and en-CA today ('500,00 $' /
 * '$500.00'); a locale change could split the bell's format from the page's.
 */
type LooseT = (key: string, options: Record<string, string | number>) => string;

function render(locale: Locale): string {
  const t = createI18n({ locale, strictIcu: true }).t as unknown as LooseT;
  return t('notif:notif_commission_clawback', { amount: 500 });
}

describe('notif_commission_clawback ICU render (T-W2)', () => {
  it('fr-CA renders the CAD amount', () => {
    expect(render('fr-CA')).toMatch(/500,00/);
  });
  it('en-CA renders the CAD amount', () => {
    expect(render('en-CA')).toMatch(/\$500\.00/);
  });
});
