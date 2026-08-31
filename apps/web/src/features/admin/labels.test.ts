import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { JOB_QUEUE_NAMES } from '@dealpilot/contracts';
import {
  BrandingStatus,
  IntakeProvider,
  PLATFORM_CAPABILITY_NAMES,
  PLATFORM_SETTING_KEYS,
  QueueState,
  RetryOutcome,
  USAGE_GAUGES,
  USAGE_WINDOW_METRICS,
} from '@dealpilot/schemas';
import {
  BRANDING_STATE_KEYS,
  CAPABILITY_KEYS,
  PROVIDER_KEYS,
  QUEUE_KEYS,
  QUEUE_STATE_KEYS,
  RETRY_OUTCOME_KEYS,
  SETTING_KEYS,
  USAGE_METRIC_KEYS,
} from './labels.js';

/**
 * The console prints a staffer's capabilities and the name of every kill
 * switch. Both maps are typed, so an unnamed capability or switch is a
 * compile error; this is the half the compiler cannot check — that the key
 * each one points at is a real, non-empty string in BOTH bundles.
 *
 * A missing label here does not crash: i18next renders the key. A French
 * operator would read `sms_send_killswitch` on the screen where they decide
 * whether to stop every dealer's texting.
 */

const admin = { en: enCA.admin as Record<string, string>, fr: frCA.admin as Record<string, string> };
const switches = { en: enCA.switches as Record<string, string>, fr: frCA.switches as Record<string, string> };
// F-73's two namespaces. Read defensively: until the bundles carry them, this
// file's job is to say so by name rather than to throw on a property access.
const usage = {
  en: ((enCA as Record<string, unknown>)['usage'] ?? {}) as Record<string, string>,
  fr: ((frCA as Record<string, unknown>)['usage'] ?? {}) as Record<string, string>,
};
const jobs = {
  en: ((enCA as Record<string, unknown>)['jobs'] ?? {}) as Record<string, string>,
  fr: ((frCA as Record<string, unknown>)['jobs'] ?? {}) as Record<string, string>,
};
// F-77's namespace, and the tenant-side one whose provider labels the console re-exports.
const snapshot = { en: enCA.snapshot as Record<string, string>, fr: frCA.snapshot as Record<string, string> };
const intake = { en: enCA.intake as Record<string, string>, fr: frCA.intake as Record<string, string> };

function missing(bundle: { en: Record<string, string>; fr: Record<string, string> }, keys: readonly string[]): string[] {
  const gaps: string[] = [];
  for (const key of keys) {
    if (!bundle.en[key]?.trim()) gaps.push(`en-CA: ${key}`);
    if (!bundle.fr[key]?.trim()) gaps.push(`fr-CA: ${key}`);
  }
  return gaps;
}

describe('the console can name what it grants and what it stops', () => {
  it('labels every platform capability, the five F-72 ones included', () => {
    expect(Object.keys(CAPABILITY_KEYS).sort()).toEqual([...PLATFORM_CAPABILITY_NAMES].sort());
    for (const name of ['announcements:read', 'announcements:publish', 'announcements:publish_elevated', 'settings:read', 'settings:write'] as const) {
      expect(PLATFORM_CAPABILITY_NAMES, name).toContain(name);
    }
    expect(missing(admin, Object.values(CAPABILITY_KEYS))).toEqual([]);
  });

  it('names each kill switch and says what it stops, in both languages', () => {
    expect(Object.keys(SETTING_KEYS).sort()).toEqual([...PLATFORM_SETTING_KEYS].sort());
    const keys = Object.values(SETTING_KEYS).flatMap((s) => [s.label, s.scope]);
    expect(missing(switches, keys)).toEqual([]);
  });
});

/**
 * F-73 — the usage card and the job inspector, same standard.
 *
 * The compiler already refuses a map that misses a metric, a queue or a queue
 * state; what it cannot see is the other direction (a map entry for a name the
 * vocabulary dropped) or an empty bundle string. Both are how a French
 * operator ends up reading `metric_sms_segments` on a page about what a dealer
 * owes — so both are asserted here, by name, in both locales.
 */
describe('the console can name every usage number and every queue', () => {
  it('labels and captions exactly the metrics that ship — no more, no fewer', () => {
    expect(Object.keys(USAGE_METRIC_KEYS).sort()).toEqual([...USAGE_WINDOW_METRICS, ...USAGE_GAUGES].sort());
  });

  it('gives every metric a label AND a caption in both languages', () => {
    // The caption is not decoration: `members_who_acted` is a floor and
    // `document_bytes` counts documents alone. A metric whose caption is
    // missing renders the raw key beside a number an operator will quote.
    const keys = Object.values(USAGE_METRIC_KEYS).flatMap((m) => [m.label, m.caption]);
    expect(missing(usage, keys)).toEqual([]);
  });

  it('names all ten queues, and only those ten', () => {
    expect(Object.keys(QUEUE_KEYS).sort()).toEqual([...JOB_QUEUE_NAMES].sort());
    expect(missing(jobs, Object.values(QUEUE_KEYS))).toEqual([]);
  });

  it('names each queue state, so "could not ask" never reads as "nothing failed"', () => {
    expect(Object.keys(QUEUE_STATE_KEYS).sort()).toEqual([...QueueState.options].sort());
    expect(missing(jobs, Object.values(QUEUE_STATE_KEYS))).toEqual([]);
  });

  it('names all five retry outcomes, and does not name a sixth', () => {
    expect(Object.keys(RETRY_OUTCOME_KEYS).sort()).toEqual([...RetryOutcome.options].sort());
    // The label map is where a `locked` outcome would first become visible to
    // an operator, so it is also where the absence is asserted: BullMQ's
    // reprocess script has no lock check and can never return -2.
    expect(Object.keys(RETRY_OUTCOME_KEYS)).toHaveLength(5);
    expect(Object.keys(RETRY_OUTCOME_KEYS)).not.toContain('locked');
    expect(missing(jobs, Object.values(RETRY_OUTCOME_KEYS))).toEqual([]);
  });
});

/**
 * F-77 — two more label maps, same standard.
 *
 * `BRANDING_STATE_KEYS` is locked to `'none' | BrandingStatus` by the
 * compiler and `PROVIDER_KEYS` to `IntakeProvider`; what the compiler cannot
 * see is a map entry for a word the vocabulary dropped, or a key that resolves
 * to nothing in one bundle — a French support person reading `brandDraft`
 * beside a dealer's name. Both directions, both locales, by name.
 */
describe('the console can name a branding state and an intake provider', () => {
  it('names exactly the three branding states the definer can emit, in both languages', () => {
    expect(Object.keys(BRANDING_STATE_KEYS).sort()).toEqual(['none', ...BrandingStatus.options].sort());
    expect(Object.keys(BRANDING_STATE_KEYS)).toHaveLength(3);
    expect(missing(snapshot, Object.values(BRANDING_STATE_KEYS))).toEqual([]);
  });

  it('labels the five intake providers through the tenant page’s own map, in both languages', () => {
    expect(Object.keys(PROVIDER_KEYS).sort()).toEqual([...IntakeProvider.options].sort());
    expect(Object.keys(PROVIDER_KEYS)).toHaveLength(5);
    expect(missing(intake, Object.values(PROVIDER_KEYS))).toEqual([]);
  });
});
