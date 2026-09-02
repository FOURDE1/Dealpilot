import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, frCA, type Locale } from '@dealpilot/i18n';
import type { GmDashboardReportT } from '@dealpilot/schemas';

/**
 * F-78 §8.4 — the claims the GM report makes that no schema can hold it to
 * (the usage-card.test.tsx method: render for real, read the markup back).
 *
 * The compiler proves every figure has a render site; it cannot see whether
 * a tile ships WITHOUT its caption (the bug this slice exists to kill),
 * whether a null rate quietly becomes « 0 % », whether the month caption is
 * formatted on the WIRE's clock or the viewer's, or whether the rate on
 * screen is the server's quotient or a client recompute. Each is asserted
 * against the rendered markup.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222221';
const U2 = '22222222-2222-4222-8222-222222222222';
const D = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
const L1 = '44444444-4444-4444-8444-444444444441';

function reportBody(over: Partial<GmDashboardReportT> = {}): GmDashboardReportT {
  return {
    month: { timezone: 'America/Montreal', start: '2026-09-01T04:00:00.000Z' },
    pipeline: {
      total: 7,
      by_stage: [
        { stage: 'new', count: 3 },
        { stage: 'submitted', count: 2 },
        { stage: 'approved', count: 1 },
        { stage: 'signed', count: 0 },
        { stage: 'sourcing', count: 1 },
        { stage: 'pending_delivery', count: 0 },
        { stage: 'scheduled', count: 0 },
      ],
    },
    funding_by_status: [
      { status: 'not_submitted', count: 4 },
      { status: 'submitted', count: 2 },
      { status: 'stips_required', count: 0 },
      { status: 'funded', count: 1 },
    ],
    month_sales: {
      units: 3,
      gross_cents: 2_000_000,
      avg_front_gross_cents: 633_333,
      avg_back_gross_cents: 33_333,
    },
    funding: { count: 2, amount_financed_cents: 5_748_750 },
    inventory: { in_stock: 3, over_30_days: 2, aging_0_30: 1, aging_31_60: 1, aging_over_60: 1 },
    // conversion_rate is deliberately NOT 100×converted/created (62.5): the
    // page must render the server's figure as sent, so a client recompute
    // is visible as a different string.
    leads: { created: 8, converted: 5, conversion_rate: 33.3 },
    lead_sources: [
      { source: 'walk_in', count: 4 },
      { source: 'website', count: 2 },
    ],
    salespeople: {
      rows: [
        { user_id: U1, name: 'Vicky Vendeuse', units: 2, gross_cents: 1_600_000 },
        { user_id: U2, name: null, units: 1, gross_cents: 600_000 },
      ],
      unattributed_units: 0,
    },
    attention: {
      rotting: {
        count: 2,
        rows: [
          { deal_id: D(1), lead_id: L1, customer: 'Carla Cliente', stage: 'submitted', days_in_stage: 8 },
          { deal_id: D(2), lead_id: null, customer: null, stage: 'new', days_in_stage: 9 },
        ],
      },
      delivered_unfunded: {
        count: 1,
        rows: [
          {
            deal_id: D(3),
            lead_id: L1,
            customer: 'Carl Client',
            funding_status: 'submitted',
            days_since_delivery: 3,
          },
        ],
      },
    },
    ...over,
  };
}

/** What the hook holds when the page renders — set per test, read by the mock. */
const state: { report: GmDashboardReportT } = { report: reportBody() };

vi.mock('./api.js', () => ({
  useGmDashboard: () => ({ data: state.report, isPending: false, isError: false }),
}));

const { GmReport } = await import('./gm-report.js');

function markup(locale: Locale = 'fr-CA'): string {
  // strictIcu: a caption whose ICU arguments disagree with the call site
  // throws here rather than printing a raw "{start}" onto the page.
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(MemoryRouter, null, createElement(GmReport, { orgId: ORG })),
    ),
  );
}

const bundle = ((frCA as Record<string, unknown>)['dashboard'] ?? {}) as Record<string, string>;

/** The bundle's own text for a key — asserting a key name would pass on a missing label. */
function copy(key: string): string {
  const value = bundle[key];
  expect(value?.trim(), `fr-CA dashboard:${key}`).toBeTruthy();
  return value as string;
}

/** The month-block interpolation the captions promise ({start}, {tz}). */
function clockCaption(key: string, report: GmDashboardReportT): string {
  const start = new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeZone: report.month.timezone,
  }).format(new Date(report.month.start));
  return copy(key).replace('{start}', start).replace('{tz}', report.month.timezone);
}

describe('every tile carries its caption — a figure without one is the old bug back', () => {
  it('renders all ten captions, the interpolated ones with the wire month block', () => {
    state.report = reportBody();
    const html = markup();
    for (const key of ['capPipeline', 'capGross', 'capFunding', 'capStock', 'capConversion']) {
      expect(html, key).toContain(copy(key));
    }
    // The shared per-unit caption serves BOTH avg tiles (A8) — twice in the markup.
    expect(html.split(copy('capAvgPerUnit')).length - 1).toBe(2);
    // Month captions interpolate the wire's {start} and {tz} (A5/A14/A16).
    expect(html).toContain(clockCaption('capUnits', state.report));
    expect(html).toContain(clockCaption('capLeads', state.report));
    expect(html).toContain(clockCaption('monthWindow', state.report));
    expect(html).toContain(
      copy('capOver30').replace('{tz}', state.report.month.timezone),
    );
    // And no raw ICU argument ever reaches the page.
    expect(html).not.toContain('{start}');
    expect(html).not.toContain('{tz}');
  });
});

describe('null figures render « — », never a fabricated zero', () => {
  it('dashes the averages and the rate on an empty month', () => {
    state.report = reportBody({
      month_sales: { units: 0, gross_cents: 0, avg_front_gross_cents: null, avg_back_gross_cents: null },
      leads: { created: 0, converted: 0, conversion_rate: null },
    });
    const html = markup();
    // Three value dashes: avg front, avg back, conversion.
    expect(html.match(/>—<\/p>/g)?.length).toBe(3);
    // A null rate never renders as « 0,0 % » (the fabricated-zero form) —
    // built through the SAME formatter, so the NBSP is compared exactly.
    const fmt = new Intl.NumberFormat('fr-CA', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    expect(html).not.toContain(fmt.format(0));
  });
});

describe('the conversion tile renders the server quotient AS SENT (1 dp)', () => {
  it('shows 33,3 % — never the client recompute of its own counts', () => {
    state.report = reportBody();
    const fmt = new Intl.NumberFormat('fr-CA', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const html = markup();
    expect(html).toContain(fmt.format(33.3 / 100)); // « 33,3 % » — the wire figure
    expect(html).not.toContain(fmt.format(5 / 8)); // « 62,5 % » — the banned recompute
  });
});

describe('attention lists tell the true total past the 10-row cap', () => {
  it('renders « 12 en tout » when the wire count exceeds the rows, and no line otherwise', () => {
    const base = reportBody();
    state.report = reportBody({
      attention: {
        ...base.attention,
        rotting: { ...base.attention.rotting, count: 12 },
      },
    });
    const html = markup();
    expect(html).toContain(copy('rowsTotal').replace('{count}', '12'));
    // delivered_unfunded count 1 ≤ 10 — exactly ONE total line on the page.
    expect(html.match(/ en tout/g)?.length).toBe(1);
  });
});

describe('the salespeople table stays structurally honest', () => {
  it('names a membership-less seller by the placeholder and hides a zero unattributed line', () => {
    state.report = reportBody();
    const html = markup();
    expect(html).toContain(copy('formerSeller'));
    expect(html).not.toContain('sans vendeur');
  });

  it('renders the plural unattributed line when the wire counts one', () => {
    state.report = reportBody({
      salespeople: { rows: [], unattributed_units: 3 },
    });
    const html = markup();
    expect(html).toContain('3 unités livrées sans vendeur attitré');
    expect(html).toContain(copy('emptySalespeople'));
  });
});

describe('the month caption is formatted on the WIRE clock, not the viewer environment', () => {
  it('renders the store-zone date for a zone whose local date differs from the test environment', () => {
    // 2026-08-31T12:00:00Z IS 1 September in Auckland; any environment west
    // of +12 formats it as 31 August without timeZone — the A14 red-line.
    state.report = reportBody({
      month: { timezone: 'Pacific/Auckland', start: '2026-08-31T12:00:00.000Z' },
    });
    const withZone = new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeZone: 'Pacific/Auckland',
    }).format(new Date('2026-08-31T12:00:00.000Z'));
    const environmentLocal = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' }).format(
      new Date('2026-08-31T12:00:00.000Z'),
    );
    const html = markup();
    expect(html).toContain(copy('monthWindow').replace('{start}', withZone).replace('{tz}', 'Pacific/Auckland'));
    if (environmentLocal !== withZone) expect(html).not.toContain(environmentLocal);
  });
});

describe('the hook parses, never casts (the D-078 (2b) pin)', () => {
  it('useGmDashboard returns GmDashboardReport.parse(res.body) with no `res.body as`', () => {
    const src = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/GmDashboardReport\.parse\(res\.body\)/);
    expect(src).not.toMatch(/res\.body as\b/);
  });
});
