import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, enCA, frCA, type Locale } from '@dealpilot/i18n';
import { USAGE_GAUGES, USAGE_WINDOW_METRICS, type AdminTenantUsageT, type UsagePeriodT } from '@dealpilot/schemas';
import { USAGE_METRIC_KEYS } from './labels.js';

/**
 * F-73 §6 — the claims this page makes that no schema can hold it to.
 *
 * The compiler already proves every metric has a label key and a caption key.
 * What it cannot see is whether the page RENDERS both, whether a bar appears
 * where the server sent no denominator, and whether the copy beside a full bar
 * says "included" or "limit". Those are the difference between a reporting
 * screen and a screen that tells a dealer they have been cut off — so each is
 * rendered for real and read back out of the markup.
 *
 * Rendered with react-dom/server for the same reason bell.test.tsx is: the
 * claim is about what reaches a person, and a helper called in isolation
 * proves only that the helper works.
 */

const ORG = '11111111-1111-4111-8111-111111111111';

function usageBody(over: Partial<AdminTenantUsageT> = {}): AdminTenantUsageT {
  return {
    organization_id: ORG,
    plan_code: 'core',
    period: 'mtd',
    window_start: '2026-08-01T04:00:00.000Z',
    window_end: '2026-08-30T16:00:00.000Z',
    gauges: { seats_provisioned: 3, member_count: 7, store_count: 2, document_bytes: 5_400_000 },
    window_metrics: {
      members_who_acted: 2,
      leads_created: 41,
      deals_created: 9,
      deals_delivered: 4,
      ai_conversations_engaged: 12,
      sms_segments: 1_240,
      sms_messages_unsegmented: 3,
      ai_first_touch_p95_seconds: 47,
      ai_first_touch_sample_count: 18,
    },
    allowances: { included_seats: 5, included_sms_segments: 2_000, included_ai_conversations: 200 },
    ...over,
  };
}

/** What the hooks are holding when the page renders — set per test, read by the mock. */
const state: { usage: AdminTenantUsageT; period: UsagePeriodT } = { usage: usageBody(), period: 'mtd' };

vi.mock('./api.js', () => ({
  useAdminTenant: () => ({ data: { id: ORG, name: 'Groupe Beauport', plan_code: 'core' } }),
  useAdminTenantUsage: () => ({ data: state.usage, isPending: false, isError: false, isSuccess: true }),
}));

const { TenantUsagePage } = await import('./tenant-usage-page.js');

function markup(locale: Locale): string {
  // strictIcu: a caption whose ICU arguments disagree with the call site
  // throws here rather than printing a raw "{start}" onto a page about money.
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        { initialEntries: [`/admin/tenants/${ORG}/usage?period=${state.period}`] },
        createElement(TenantUsagePage),
      ),
    ),
  );
}

const bundles: Record<Locale, Record<string, string>> = {
  'fr-CA': ((frCA as Record<string, unknown>)['usage'] ?? {}) as Record<string, string>,
  'en-CA': ((enCA as Record<string, unknown>)['usage'] ?? {}) as Record<string, string>,
};

/** The bundle's own text for a key — asserting against the key would pass on a missing label. */
function copy(locale: Locale, key: string): string {
  const value = bundles[locale][key];
  expect(value?.trim(), `${locale} usage:${key}`).toBeTruthy();
  return value as string;
}

describe('the usage card never lets a number claim more than its row supports', () => {
  it('renders no allowance bar outside the month to date', () => {
    state.usage = usageBody({ period: '90d', allowances: null });
    state.period = '90d';
    const html = markup('fr-CA');
    expect(html).not.toContain('role="progressbar"');
    // And it says WHY there is none, rather than leaving a silent gap that
    // reads as "this plan includes nothing".
    expect(html).toContain(copy('fr-CA', 'allowancesOnlyMtd'));
    state.usage = usageBody();
    state.period = 'mtd';
  });

  it('says nothing is enforced wherever a bar is drawn, and never says limit or remaining', () => {
    const html = markup('fr-CA');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain(copy('fr-CA', 'allowanceNotEnforced'));
    // The two words the copy may never use: both describe a control this
    // product does not have — `overage = 'hard_stop'` is seeded and nothing stops.
    expect(html.toLowerCase()).not.toContain('limite');
    expect(html.toLowerCase()).not.toContain('restant');
  });

  it('draws a tenant past its allowance in the ordinary accent, with both numbers in words', () => {
    state.usage = usageBody({ allowances: { included_seats: 5, included_sms_segments: 400, included_ai_conversations: 200 } });
    const html = markup('fr-CA');
    // Past the allowance is a fact, not a fault: no danger colour anywhere on
    // the page, and the real figure is legible to someone who never sees the
    // bar — the fill clamps at 100%, the sentence does not clamp at all.
    expect(html).not.toContain('bg-danger');
    expect(html).not.toContain('text-danger-text');
    expect(html).toContain(new Intl.NumberFormat('fr-CA').format(1_240));
    expect(html).toContain('inline-size:100%');
    state.usage = usageBody();
  });

  it('marks no 80% or 100% threshold on any bar', () => {
    const html = markup('fr-CA');
    // A marker promises an action at that point, and nothing acts. The only
    // percentage in the markup is the fill's own width, one per bar.
    expect(html).not.toMatch(/>[^<]*\d+\s*%/);
    const bars = html.match(/role="progressbar"/g)?.length ?? 0;
    const widths = html.match(/inline-size:\s*\d+%/g)?.length ?? 0;
    expect(bars).toBe(3);
    expect(widths).toBe(bars);
  });

  it('gives an unlimited or a zero allowance its words instead of a fake ratio', () => {
    state.usage = usageBody({ allowances: { included_seats: null, included_sms_segments: 0, included_ai_conversations: 200 } });
    const html = markup('fr-CA');
    expect(html).toContain(copy('fr-CA', 'allowanceUnlimited'));
    expect(html).toContain(copy('fr-CA', 'allowanceNone'));
    // Two of the three have no denominator, so exactly one bar may be drawn:
    // `used / 0` is Infinity and NULL means unlimited, and neither is a ratio.
    expect(html.match(/role="progressbar"/g)?.length ?? 0).toBe(1);
    state.usage = usageBody();
  });

  it('prints seats and members apart, so two screens cannot disagree in public', () => {
    const html = markup('fr-CA');
    const seats = copy('fr-CA', USAGE_METRIC_KEYS.seats_provisioned.label);
    const members = copy('fr-CA', USAGE_METRIC_KEYS.member_count.label);
    expect(seats).not.toEqual(members);
    expect(html).toContain(seats);
    expect(html).toContain(members);
    // One person with a membership at three rooftops is one seat and three
    // memberships; the labels are the only thing that makes 3 beside 7 readable.
    expect(html).toContain('>3<');
    expect(html).toContain('>7<');
  });

  it('never renders a metric without its caption, in either language', () => {
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const html = markup(locale);
      for (const key of [...USAGE_WINDOW_METRICS, ...USAGE_GAUGES]) {
        const { label, caption } = USAGE_METRIC_KEYS[key];
        // The raw key must never reach a screen; both halves of the pair must.
        expect(html, `${locale} ${key}`).not.toContain(`>${label}<`);
        expect(html, `${locale} ${key}`).not.toContain(`>${caption}<`);
        expect(html, `${locale} ${key} label`).toContain(copy(locale, label));
        expect(html, `${locale} ${key} caption`).toContain(copy(locale, caption));
      }
    }
  });

  it('names members_who_acted a floor rather than a daily-active count, in both bundles', () => {
    // The substitute for dau/wau/mau. `activity_events` is a mutation log — a
    // manager who reads the board all day writes no row — so the caption has to
    // say the number is a floor, in the bundle a support rep actually reads.
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const caption = copy(locale, USAGE_METRIC_KEYS.members_who_acted.caption);
      expect(markup(locale)).toContain(caption);
    }
  });

  it('says what member_count really counts, in both bundles', () => {
    // memberships.store_id is NULLABLE and NULL means the roles apply across
    // the WHOLE organization; f01-routes.ts writes exactly such a row for the
    // founding owner of every self-serve tenant, admin_provision_tenant seeds
    // one for every provisioned tenant, and 0069 counts memberships with no
    // store predicate at all. So a caption promising "one membership per
    // store" is false for a row every tenant has, on the one number whose
    // entire job is to explain why it differs from seats_provisioned.
    const claims: Record<Locale, readonly string[]> = {
      'fr-CA': ['toute l’organisation', 'sans succursale'],
      'en-CA': ['the whole organization', 'no store'],
    };
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const caption = copy(locale, USAGE_METRIC_KEYS.member_count.caption);
      for (const claim of claims[locale]) expect(caption, `${locale} ${claim}`).toContain(claim);
      expect(markup(locale), locale).toContain(caption);
    }
  });

  it('names the store with the bundle’s own word on the French card', () => {
    // « point de vente » lived on this card and nowhere else in fr-CA, one
    // line above a figure labelled « Succursales ». The two numbers sit
    // adjacent precisely so a reader can reconcile them, and the caption whose
    // job is to explain the relationship must not rename one of the two.
    const html = markup('fr-CA');
    expect(html).not.toContain('point de vente');
    expect(html).toContain(copy('fr-CA', USAGE_METRIC_KEYS.store_count.label));
  });

  it('discloses that both SMS numbers count outbound messages only', () => {
    // 0069's sms CTE carries `m.direction = 'outbound'`. `segments` is written
    // only on a carrier accept, so recordInbound leaves it NULL: every inbound
    // SMS in the window literally satisfies the unsegmented caption's stated
    // condition and not one of them is counted. A tenant with 500 inbound
    // texts and one refused outbound would read "1" under a sentence claiming
    // 501, beside the very number it exists to qualify.
    const words: Record<Locale, { outbound: string; inbound: string }> = {
      'fr-CA': { outbound: 'sortants', inbound: 'entrants' },
      'en-CA': { outbound: 'outbound', inbound: 'inbound' },
    };
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const { outbound, inbound } = words[locale];
      expect(copy(locale, USAGE_METRIC_KEYS.sms_segments.caption).toLowerCase(), locale).toContain(outbound);
      const unsegmented = copy(locale, USAGE_METRIC_KEYS.sms_messages_unsegmented.caption);
      expect(unsegmented.toLowerCase(), locale).toContain(outbound);
      expect(unsegmented.toLowerCase(), locale).toContain(inbound);
      expect(markup(locale), locale).toContain(unsegmented);
    }
  });

  it('says the p95 sample excludes a greeting held for quiet hours', () => {
    // A first touch deferred by quiet hours IS delivered — deferred-send.ts
    // writes the message — but that worker never touches `leads`, so
    // chatbot_engaged_at stays NULL and the lead is absent from the sample for
    // ever. Those are the slowest greetings in the product, and dropping the
    // tail is how a latency number lies.
    const words: Record<Locale, string> = { 'fr-CA': 'heures de silence', 'en-CA': 'quiet hours' };
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const caption = copy(locale, USAGE_METRIC_KEYS.ai_first_touch_p95_seconds.caption);
      expect(caption, locale).toContain(words[locale]);
      expect(markup(locale), locale).toContain(caption);
    }
  });
});
