import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createI18n, enCA, frCA, type Locale } from '@dealpilot/i18n';
import { AdminTenantSnapshot, SnapshotTraffic, type AdminTenantSnapshotT } from '@dealpilot/schemas';
import { INTAKE_KEY_COLUMNS, STORE_HEALTH_COLUMNS } from './snapshot-fields.js';
import { STATUS_KEYS, TIER_KEYS, USAGE_METRIC_KEYS } from './labels.js';

/**
 * F-77 (D-078) — the claims the snapshot page makes that no schema holds it to.
 *
 * The honest states in words (no organization row, no message in thirty
 * days, a store with no number, a key whose store was deleted, a key with no
 * store at all — an organization-level key, 0050:61), the order of
 * the key-state partition, the branding words, the platform card last and
 * dashed — each is rendered for real and read back out of the markup, as
 * usage-card.test.tsx does, because a helper called in isolation proves only
 * that the helper works.
 *
 * Two cases are the render-time half of the secret guard: a POISONED body
 * (the hook is mocked, so the schema strip is bypassed on purpose) must not
 * put a credential's value on the page, and a Proxy over the body records
 * every property the page reads so that reads ⊆ the column tables — the one
 * measure no syntax evades, since Object.entries, a spread and a destructure
 * all invoke [[Get]] per key.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const PLAN = '44444444-4444-4444-8444-444444444444';
const STORE_A = '22222222-2222-4222-8222-222222222222';
const STORE_B = '55555555-5555-4555-8555-555555555555';
/**
 * A valid UUID that names no rooftop: the key's store was soft-deleted —
 * store_health keeps `s.deleted_at IS NULL` rows only (0069:472) while the
 * keys are projected unfiltered (0069:489). Distinct from `store_id: null`,
 * which is a LIVE organization-level key (0050:61; case 2e).
 */
const STORE_GONE = '66666666-6666-4666-8666-666666666666';
const KEY_LIVE = '77777777-7777-4777-8777-777777777777';
const KEY_REVOKED = '88888888-8888-4888-8888-888888888888';
const KEY_ORPHAN = '99999999-9999-4999-8999-999999999999';
const KEY_ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LAST_MESSAGE_AT = '2026-08-28T14:05:00.000Z';
const REVOKED_AT = '2026-07-15T13:30:00.000Z';
const PUBLISHED_AT = '2026-08-20T15:00:00.000Z';
const SMS_NUMBER = '+15145550123';

type Body = AdminTenantSnapshotT;
type StoreHealth = Body['store_health'][number];
type IntakeKey = Body['intake_keys'][number];

const fullRooftop: StoreHealth = {
  id: STORE_A,
  name: 'Beauport Centre',
  code: 'BC-01',
  status: 'active',
  timezone: 'America/Toronto',
  sms_number: SMS_NUMBER,
  business_hours_set: true,
  traffic_30d: { inbound: 12, outbound: 9, delivered: 8, last_message_at: LAST_MESSAGE_AT },
};

const bareRooftop: StoreHealth = {
  id: STORE_B,
  name: 'Beauport Nord',
  code: 'BN-02',
  status: 'paused',
  timezone: 'America/Montreal',
  sms_number: null,
  business_hours_set: false,
  traffic_30d: { inbound: 0, outbound: 0, delivered: 0, last_message_at: null },
};

const liveKey: IntakeKey = {
  id: KEY_LIVE,
  store_id: STORE_A,
  label: 'Formulaire site web',
  provider: 'generic_json',
  active: true,
  revoked_at: null,
  last_lead_accepted_at: '2026-08-29T12:00:00.000Z',
};

/** Synthetic: revoked with active still true — the ORDER of the partition is the definer's stated concern (0069:477-479). */
const revokedKey: IntakeKey = {
  id: KEY_REVOKED,
  store_id: STORE_B,
  label: 'Ancien widget',
  provider: 'chat_widget',
  active: true,
  revoked_at: REVOKED_AT,
  last_lead_accepted_at: null,
};

const orphanKey: IntakeKey = {
  id: KEY_ORPHAN,
  store_id: STORE_GONE,
  label: 'Formulaire succursale fermée',
  provider: 'meta',
  active: true,
  revoked_at: null,
  last_lead_accepted_at: null,
};

/**
 * `status: 'active'` and `deleted_at: null` are pinned on purpose (A16):
 * STATUS_CLASSES paints suspended/offboarding/purged with
 * `bg-danger-bg text-danger-text` (labels.ts:82-90) and the « Supprimé » chip
 * uses the same pair, so the "no danger colour on a healthy snapshot" case
 * would flip on a careless fixture edit.
 */
function snapshotBody(over: Partial<Body> = {}): Body {
  return {
    id: ORG,
    name: 'Groupe Beauport',
    slug: 'groupe-beauport',
    legal_name: 'Groupe Beauport inc.',
    status: 'active',
    plan_id: PLAN,
    plan_code: 'core',
    province: 'QC',
    default_locale: 'fr-CA',
    store_count: 2,
    member_count: 7,
    created_at: '2026-06-01T04:00:00.000Z',
    activated_at: '2026-06-02T04:00:00.000Z',
    suspended_at: null,
    deleted_at: null,
    trial_ends_at: null,
    privacy_officer_name: 'Marie Tremblay',
    privacy_officer_email: 'marie.tremblay@example.com',
    stripe_customer_id: 'cus_TESTBEAUPORT',
    stores: [
      { id: STORE_A, name: 'Beauport Centre', code: 'BC-01', province: 'QC', status: 'active' },
      { id: STORE_B, name: 'Beauport Nord', code: 'BN-02', province: 'QC', status: 'paused' },
    ],
    owner_emails: ['owner@example.com'],
    last_activity_at: '2026-08-30T16:00:00.000Z',
    allowed_transitions: ['suspended'],
    owner_invitation: null,
    seats_provisioned: 3,
    store_health: [fullRooftop, bareRooftop],
    intake_keys: [liveKey, revokedKey, orphanKey],
    comms_config: {
      org_row_present: true,
      store_overrides: 2,
      sms_quiet_start: '10:00:00',
      sms_quiet_end: '20:00:00',
      first_touch_quiet_exempt: false,
      ai_daily_contact_cap: 2,
    },
    branding: { state: 'published', version: 3, published_at: PUBLISHED_AT },
    connectors_active: 1,
    platform: { sms_transport: 'log', email_transport: 'log', ai_transport: 'off' },
    ...over,
  };
}

/** What the hook is holding when the page renders — set per test, read by the mock. */
const state: { body: Body } = { body: snapshotBody() };

vi.mock('./api.js', () => ({
  useAdminTenantSnapshot: () => ({ data: state.body, isPending: false, isError: false, isSuccess: true }),
}));

const { TenantSnapshotPage } = await import('./tenant-snapshot-page.js');

function markup(locale: Locale): string {
  // strictIcu: a sentence whose ICU arguments disagree with the call site
  // throws here rather than printing a raw "{count}" onto a support screen.
  const i18n = createI18n({ locale, strictIcu: true });
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        { initialEntries: [`/admin/tenants/${ORG}/snapshot`] },
        createElement(TenantSnapshotPage),
      ),
    ),
  );
}

/** Render a body, then put the default back so no case leaks into the next. */
function render(locale: Locale, body: Body): string {
  state.body = body;
  try {
    return markup(locale);
  } finally {
    state.body = snapshotBody();
  }
}

const bundles: Record<Locale, Record<string, Record<string, string>>> = {
  'fr-CA': frCA as unknown as Record<string, Record<string, string>>,
  'en-CA': enCA as unknown as Record<string, Record<string, string>>,
};

/** The bundle's own text for a key — asserting against the key would pass on a missing label. */
function copy(locale: Locale, ns: string, key: string): string {
  const value = bundles[locale][ns]?.[key];
  expect(value?.trim(), `${locale} ${ns}:${key}`).toBeTruthy();
  return value as string;
}

/** i18next's `t`, narrowed to the one shape this file calls it with (a runtime-built key). */
type LooseT = (key: string, options: Record<string, string | number>) => string;

/** An ICU sentence formatted by the same bundle the page reads (plurals, dates). */
function icu(locale: Locale, ns: string, key: string, args: Record<string, string | number>): string {
  const t = createI18n({ locale, strictIcu: true }).t as unknown as LooseT;
  const text = t(`${ns}:${key}`, args);
  expect(text, `${locale} ${ns}:${key}`).not.toBe(`${ns}:${key}`);
  return text;
}

/** The page's own date format (tenant-snapshot-page.tsx `moment`). */
const moment = (locale: Locale, iso: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** The markup between two section anchors — the keys card, the branding card, … */
function section(html: string, id: string, nextId: string | null): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  const end = nextId === null ? html.length : html.indexOf(`aria-labelledby="${nextId}"`);
  expect(start, id).toBeGreaterThan(-1);
  expect(end, nextId ?? 'end').toBeGreaterThan(start);
  return html.slice(start, end);
}

const textOnly = (html: string) => html.replace(/<[^>]+>/g, ' ');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------
// The Proxy access recorder (A11)
// ---------------------------------------------------------------------------

/**
 * Props a framework reads on any object it is handed, never the page. Widened
 * only for framework props after reading a real failure — never to let the
 * poison through. 'subRows' is deliberately absent: getSubRows is not set.
 */
const FRAMEWORK_PROPS = new Set([
  'then',
  'toJSON',
  'constructor',
  'length',
  '$$typeof',
  '@@__IMMUTABLE_ITERABLE__@@',
  '@@__IMMUTABLE_RECORD__@@',
]);

/**
 * Wrap a value so every string-keyed [[Get]] beneath it lands in `reads` as a
 * dotted path; numeric indexes fold into `[*]` so rows of one array share a
 * path. Symbols and the framework list pass through unrecorded.
 */
function recorded<T extends object>(value: T, path: string, reads: Set<string>): T {
  return new Proxy(value, {
    get(target, prop, receiver) {
      const raw: unknown = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return raw;
      const isIndex = /^\d+$/.test(prop);
      const next = isIndex ? `${path}[*]` : `${path}.${prop}`;
      if (!isIndex && !FRAMEWORK_PROPS.has(prop)) reads.add(next);
      return typeof raw === 'object' && raw !== null ? recorded(raw, next, reads) : raw;
    },
  });
}

/** The leaf props read directly on `body.<prefix>` (one level, no deeper). */
function propsUnder(reads: Set<string>, prefix: string): string[] {
  const out = new Set<string>();
  for (const path of reads) {
    if (!path.startsWith(`${prefix}.`)) continue;
    const rest = path.slice(prefix.length + 1);
    if (!/[.[]/.test(rest)) out.add(rest);
  }
  return [...out].sort();
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf('.') + 1);

function assertReadsWithinTables(reads: Set<string>) {
  const keyReads = propsUnder(reads, 'body.intake_keys[*]');
  const storeReads = propsUnder(reads, 'body.store_health[*]');
  const trafficReads = propsUnder(reads, 'body.store_health[*].traffic_30d');
  // The recorder saw the tables in use, not an empty page.
  expect(keyReads).toContain('label');
  expect(storeReads).toContain('traffic_30d');
  expect(trafficReads).toContain('inbound');
  const keyAllowed = new Set<string>([...INTAKE_KEY_COLUMNS, 'id']);
  const storeAllowed = new Set<string>([...STORE_HEALTH_COLUMNS, 'id', 'traffic_30d']);
  const trafficAllowed = new Set(Object.keys(SnapshotTraffic.shape));
  expect(keyReads.filter((p) => !keyAllowed.has(p)), 'reads on intake_keys[*] outside INTAKE_KEY_COLUMNS ∪ {id}').toEqual([]);
  expect(
    storeReads.filter((p) => !storeAllowed.has(p)),
    'reads on store_health[*] outside STORE_HEALTH_COLUMNS ∪ {id, traffic_30d}',
  ).toEqual([]);
  expect(trafficReads.filter((p) => !trafficAllowed.has(p)), 'reads on traffic_30d outside SnapshotTraffic').toEqual([]);
}

// ---------------------------------------------------------------------------

const POISON = {
  token: 'AbCdEfGhIjKlMnOpQrStUv',
  secret: 'b'.repeat(64),
  webhook_url: 'https://evil.example/in/v1/leads/AbCdEfGhIjKlMnOpQrStUv',
  webhook_secret: 'whsec_' + 'c'.repeat(40),
};

/** The honest body with credentials planted where a leaking API would put them; the hook is mocked, so nothing strips them. */
function poisonedBody(base: Body): Body {
  const [first, ...rest] = base.intake_keys;
  const poisoned: unknown = {
    ...base,
    webhook_secret: POISON.webhook_secret,
    intake_keys: [
      { ...first, token: POISON.token, secret: POISON.secret, webhook_url: POISON.webhook_url },
      ...rest,
    ],
  };
  return poisoned as Body;
}

let parsed: Body;

beforeAll(() => {
  // The fixture is a legal wire body, proven by the same parse the hook runs.
  parsed = AdminTenantSnapshot.parse(snapshotBody());
  expect(POISON.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(POISON.secret).toMatch(/^[0-9a-f]{64}$/);
});

describe('the snapshot page says only what the body supports', () => {
  it('1. comms — without an organization row: the defaults sentence, no value label, and the override count in its =0 form', () => {
    const html = render(
      'fr-CA',
      snapshotBody({
        comms_config: {
          org_row_present: false,
          store_overrides: 0,
          sms_quiet_start: null,
          sms_quiet_end: null,
          first_touch_quiet_exempt: null,
          ai_daily_contact_cap: null,
        },
      }),
    );
    expect(html).toContain(copy('fr-CA', 'settings', 'defaultsNotice'));
    for (const label of ['windowStart', 'windowEnd', 'firstTouchExempt', 'dailyCap']) {
      expect(html, label).not.toContain(copy('fr-CA', 'settings', label));
    }
    expect(html).toContain(`>${icu('fr-CA', 'snapshot', 'storeOverrides', { count: 0 })}<`);
  });

  it('1b. comms — with a row: the window as HH:MM, the exemption as a word, the cap as a number, and no defaults sentence', () => {
    const html = render('fr-CA', parsed);
    expect(html).toContain('>10:00<');
    expect(html).toContain('>20:00<');
    expect(html).not.toContain('10:00:00');
    expect(html).toContain(`>${copy('fr-CA', 'admin', 'no')}<`);
    expect(html).toContain('>2<');
    expect(html).toContain(copy('fr-CA', 'settings', 'windowStart'));
    expect(html).not.toContain(copy('fr-CA', 'settings', 'defaultsNotice'));
    expect(html).toContain(`>${icu('fr-CA', 'snapshot', 'storeOverrides', { count: 2 })}<`);
  });

  it('2. keys — an empty list keeps the card and says so', () => {
    const html = render('fr-CA', snapshotBody({ intake_keys: [] }));
    expect(html).toContain(copy('fr-CA', 'snapshot', 'keysEmpty'));
    // React escapes the straight apostrophe of intake:title.
    expect(html).toContain(copy('fr-CA', 'intake', 'title').replace("'", '&#x27;'));
  });

  it('2b. synthetic: the ORDER of the partition is the definer’s stated concern', () => {
    // revoked_at set with active still true (0069:477-479): the row must read
    // as revoked, never as live. « Active » also labels every active rooftop
    // and the tenant's status chip, so the negative is scoped to the keys card.
    const html = render('fr-CA', snapshotBody({ intake_keys: [revokedKey] }));
    const keys = section(html, 'snap-keys', 'snap-comms');
    expect(keys).toContain(icu('fr-CA', 'snapshot', 'keyRevoked', { date: moment('fr-CA', REVOKED_AT) }));
    expect(keys).not.toContain(`>${copy('fr-CA', 'snapshot', 'keyActive')}<`);
    expect(keys).not.toContain(copy('fr-CA', 'snapshot', 'keyInactive'));
  });

  it('2c. the producer-less corner renders a word, not a blank (synthetic fixture)', () => {
    // active = false ∧ revoked_at = null has no writer today (the revoke UPDATE
    // sets both, f03-intake-routes.ts:158-159); the schema permits it, so it
    // has a word rather than a raw boolean or an empty cell.
    const html = render('fr-CA', snapshotBody({ intake_keys: [{ ...liveKey, active: false, revoked_at: null }] }));
    const keys = section(html, 'snap-keys', 'snap-comms');
    expect(keys).toContain(`>${copy('fr-CA', 'snapshot', 'keyInactive')}<`);
    expect(keys).not.toContain('>false<');
    expect(keys).not.toContain('>true<');
  });

  it('2d. the store column prints the store’s NAME for a live key and « — » for a key whose store_id names no rooftop (soft-deleted store)', () => {
    const html = render('fr-CA', snapshotBody({ store_health: [fullRooftop], intake_keys: [liveKey, orphanKey] }));
    const keys = section(html, 'snap-keys', 'snap-comms');
    expect(keys).toContain(`>${fullRooftop.name}<`);
    // Exactly one em-dash cell in this card: the soft-deleted store's row (a
    // store_id set, absent from store_health). The rooftop above carries a
    // number, so the dash cannot come from there.
    expect(keys.match(/>—<\/td>/g)?.length ?? 0).toBe(1);
    expect(keys).toContain(orphanKey.label);
    expect(keys).toContain(copy('fr-CA', 'admin', 'never'));
    expect(keys).toContain(copy('fr-CA', 'intake', 'provider_generic_json'));
    expect(keys).toContain(copy('fr-CA', 'intake', 'provider_meta'));
    expect(keys).not.toContain(`>${copy('fr-CA', 'settings', 'orgScope')}<`);
  });

  it('2e. a key with no store at all is an organization-level key: the settings pages’ « Organisation », never « — »', () => {
    // intake_keys.store_id is NULLABLE (0050:61, « an org-level key is the
    // dealer group's ad-platform front door »); intake_resolve serves such a
    // key as live without a store (0065:684), so its row must not read as a
    // deleted store. The word is settings:orgScope, the one the tenant's own
    // settings pages use for organization scope — no new vocabulary.
    const orgKey: IntakeKey = { ...liveKey, id: KEY_ORG, store_id: null, label: 'Meta Lead Ads (groupe)', provider: 'meta' };
    const html = render('fr-CA', snapshotBody({ store_health: [fullRooftop], intake_keys: [liveKey, orgKey] }));
    const keys = section(html, 'snap-keys', 'snap-comms');
    expect(keys).toContain(orgKey.label);
    expect(keys).toContain(`>${copy('fr-CA', 'settings', 'orgScope')}<`);
    expect(keys.match(/>—<\/td>/g)?.length ?? 0).toBe(0);
    // And the same key in English says "Organization".
    const en = section(render('en-CA', snapshotBody({ store_health: [fullRooftop], intake_keys: [orgKey] })), 'snap-keys', 'snap-comms');
    expect(en).toContain(`>${copy('en-CA', 'settings', 'orgScope')}<`);
  });

  it('3. rooftops — the bare store says its zeros and its missing number in words; the full store shows its values', () => {
    const html = render('fr-CA', parsed);
    const stores = section(html, 'snap-stores', 'snap-keys');
    const noMessage = copy('fr-CA', 'snapshot', 'noMessage30d');
    expect(stores.split(noMessage).length - 1).toBe(1);
    expect(stores).toContain(icu('fr-CA', 'snapshot', 'trafficCell', { inbound: 0, outbound: 0, delivered: 0 }));
    expect(stores).toContain(icu('fr-CA', 'snapshot', 'trafficCell', { inbound: 12, outbound: 9, delivered: 8 }));
    // The bare store's number cell is the plain literal, the card's only one.
    expect(stores.match(/>—<\/td>/g)?.length ?? 0).toBe(1);
    expect(stores).toContain(copy('fr-CA', 'settings', 'hoursUnset'));
    expect(stores).toContain(copy('fr-CA', 'settings', 'hoursSet'));
    expect(stores).toContain(SMS_NUMBER);
    expect(stores).toContain(moment('fr-CA', LAST_MESSAGE_AT));
    expect(stores).toContain('America/Toronto');
    expect(stores).toContain('America/Montreal');
    const trafficHeader = copy('fr-CA', 'snapshot', 'colTraffic');
    expect(trafficHeader).toContain('30');
    expect(stores).toContain(trafficHeader);
    expect(stores).toContain(copy('fr-CA', 'orgs', 'hoursHint'));
    expect(stores).toContain(copy('fr-CA', 'snapshot', 'hoursWhere'));
  });

  it('3b. rooftops — an empty list says so and keeps the hours sentences', () => {
    const html = render('fr-CA', snapshotBody({ store_health: [], intake_keys: [] }));
    expect(html).toContain(copy('fr-CA', 'snapshot', 'storesEmpty'));
    expect(html).toContain(copy('fr-CA', 'orgs', 'hoursHint'));
  });

  it('4. branding — none, draft, published and an unknown word', () => {
    const none = section(
      render('fr-CA', snapshotBody({ branding: { state: 'none', version: null, published_at: null } })),
      'snap-branding',
      'snap-access',
    );
    expect(none).toContain(`>${copy('fr-CA', 'snapshot', 'brandNone')}<`);
    expect(none).not.toMatch(/>Version \d/);
    expect(none).not.toContain(copy('fr-CA', 'snapshot', 'brandNeverPublished'));

    const draft = section(
      render('fr-CA', snapshotBody({ branding: { state: 'draft', version: 2, published_at: null } })),
      'snap-branding',
      'snap-access',
    );
    expect(draft).toContain(`>${copy('fr-CA', 'snapshot', 'brandDraft')}<`);
    expect(draft).toContain(`>${icu('fr-CA', 'snapshot', 'brandVersion', { version: 2 })}<`);
    expect(draft).toContain(`>${copy('fr-CA', 'snapshot', 'brandNeverPublished')}<`);

    const published = section(render('fr-CA', parsed), 'snap-branding', 'snap-access');
    expect(published).toContain(`>${copy('fr-CA', 'snapshot', 'brandPublished')}<`);
    expect(published).toContain(`>${icu('fr-CA', 'snapshot', 'brandVersion', { version: 3 })}<`);
    expect(published).toContain(
      `>${icu('fr-CA', 'snapshot', 'brandPublishedAt', { date: moment('fr-CA', PUBLISHED_AT) })}<`,
    );
    expect(published).not.toContain(copy('fr-CA', 'snapshot', 'brandNeverPublished'));
    expect(published).toContain(copy('fr-CA', 'snapshot', 'brandCaption'));

    // A word the label table does not know renders raw rather than blank.
    const unknown = section(
      render('fr-CA', snapshotBody({ branding: { state: 'archived', version: null, published_at: null } })),
      'snap-branding',
      'snap-access',
    );
    expect(unknown).toContain('>archived<');
    // Including an Object.prototype name: `labelled` is an own-property check,
    // so 'constructor' is not a key of the table — under `in` it would be, and
    // i18next would be handed Object.prototype.constructor (a blank cell).
    const proto = section(
      render('fr-CA', snapshotBody({ branding: { state: 'constructor', version: null, published_at: null } })),
      'snap-branding',
      'snap-access',
    );
    expect(proto).toContain('>constructor<');
  });

  it('5. platform — the last section, dashed, raw values, and no vendor name', () => {
    const html = render('fr-CA', parsed);
    expect(html).toContain(copy('fr-CA', 'snapshot', 'platformHeading'));
    expect(copy('fr-CA', 'snapshot', 'platformHeading')).toContain('identique pour tous les locataires');
    const sections = html.match(/<section\b[^>]*>/g) ?? [];
    expect(sections.length).toBe(6);
    const last = sections[sections.length - 1] ?? '';
    expect(last).toContain('aria-labelledby="snap-platform"');
    expect(last).toContain('border-dashed');
    for (const opening of sections.slice(0, -1)) expect(opening).not.toContain('border-dashed');
    const platform = section(html, 'snap-platform', null);
    expect(platform.match(/>log<\/dd>/g)?.length ?? 0).toBe(2);
    expect(platform.match(/>off<\/dd>/g)?.length ?? 0).toBe(1);
    expect(platform).toContain(copy('fr-CA', 'snapshot', 'platformCaption'));
    expect(html).not.toMatch(/twilio|anthropic/i);
  });

  it('6. access — seats carry their caption; connectors in words for 0, 1 and 2', () => {
    const html = render('fr-CA', parsed);
    const access = section(html, 'snap-access', 'snap-platform');
    expect(access).toContain(copy('fr-CA', 'usage', USAGE_METRIC_KEYS.seats_provisioned.label));
    expect(access).toContain(copy('fr-CA', 'usage', USAGE_METRIC_KEYS.seats_provisioned.caption));
    expect(access).toContain('>3<');
    expect(access).toContain(`>${icu('fr-CA', 'snapshot', 'connectors', { count: 1 })}<`);
    expect(access).toContain(copy('fr-CA', 'snapshot', 'connectorsCaption'));

    const zero = render('fr-CA', snapshotBody({ connectors_active: 0 }));
    // A whole text node, so T6's getByText(…, { exact: true }) is already a
    // claim this file holds (A17).
    expect(zero).toContain('>Aucun connecteur actif<');
    expect(zero).toContain(`>${icu('fr-CA', 'snapshot', 'connectors', { count: 0 })}<`);
    const two = render('fr-CA', snapshotBody({ connectors_active: 2 }));
    expect(two).toContain(`>${icu('fr-CA', 'snapshot', 'connectors', { count: 2 })}<`);
  });

  it('6b. the =0 branding word is its own text node too', () => {
    const html = render('fr-CA', snapshotBody({ branding: { state: 'none', version: null, published_at: null } }));
    expect(html).toContain('>Aucune image de marque<');
  });

  it('7. POISON — a body carrying a token, a secret and a webhook address puts none of them on the page', () => {
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const html = render(locale, poisonedBody(parsed));
      expect(html, locale).toContain(liveKey.label);
      expect(html, locale).not.toContain(POISON.token);
      expect(html, locale).not.toContain(POISON.secret);
      expect(html, locale).not.toContain(POISON.webhook_url);
      expect(html, locale).not.toContain(POISON.webhook_secret);
      expect(html, locale).not.toMatch(/[0-9a-f]{32}/i);
    }
  });

  it('8. both locales render under strictIcu, each with its own title and no raw key', () => {
    for (const locale of ['fr-CA', 'en-CA'] as const) {
      const html = render(locale, parsed);
      expect(html, locale).toContain(`>${copy(locale, 'snapshot', 'title')}<`);
      for (const prefix of ['>snapshot.', '>settings.', '>intake.', '>admin.', '>orgs.', '>usage.']) {
        expect(html, `${locale} ${prefix}`).not.toContain(prefix);
      }
    }
  });

  it('9. a healthy snapshot carries no danger tone and no bare text-primary', () => {
    const html = render('fr-CA', parsed);
    expect(html).not.toContain('text-danger-text');
    expect(html).not.toContain('bg-danger');
    // The bare class is the F-75 ban (token-roles rule 1); `text-primary-text`
    // is the role the BackLink legitimately paints.
    expect(html).not.toMatch(/\btext-primary\b(?!-)/);
  });

  it('10. the header identity comes from the snapshot body', () => {
    const html = render('fr-CA', parsed);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/tenants/${ORG}"[^>]*>${parsed.name}</a>`));
    expect(html).toContain(`>${copy('fr-CA', 'orgs', TIER_KEYS.core)}<`);
    expect(html).toContain(`>${copy('fr-CA', 'orgs', STATUS_KEYS.active)}<`);
    expect(html).not.toContain(copy('fr-CA', 'admin', 'deletedTenant'));
    // The back link's words name the directory, and so does its target (A20).
    expect(html).toContain('href="/admin/tenants"');
    expect(html).toContain(copy('fr-CA', 'admin', 'back'));
    // The detail half stays on the detail page: none of its values leak here.
    expect(html).not.toContain('Groupe Beauport inc.');
    expect(html).not.toContain('marie.tremblay@example.com');
    expect(html).not.toContain('cus_TESTBEAUPORT');
    expect(html).not.toContain('owner@example.com');

    const deleted = render('fr-CA', snapshotBody({ deleted_at: '2026-08-30T12:00:00.000Z' }));
    expect(deleted).toContain(`>${copy('fr-CA', 'admin', 'deletedTenant')}<`);
  });

  it('11. no UUID reaches a text node', () => {
    const html = render('fr-CA', parsed);
    // The tenant link carries the id in its href — tags are stripped first,
    // and that the raw markup does contain it proves the strip is the filter.
    expect(html).toContain(ORG);
    expect(textOnly(html)).not.toMatch(UUID_RE);
    expect(html).not.toContain(STORE_GONE);
  });

  it('12. Proxy recorder, honest body — every row read is inside the column tables', () => {
    const reads = new Set<string>();
    const html = render('fr-CA', recorded(parsed, 'body', reads));
    expect(html).toContain(liveKey.label);
    assertReadsWithinTables(reads);
    const flagged = [...reads].filter((p) => /^(token|secret|webhook_url|webhook_secret)$/.test(lastSegment(p)));
    expect(flagged).toEqual([]);
  });

  it('13. Proxy recorder, poisoned body — the planted keys are never read, whatever the syntax', () => {
    const reads = new Set<string>();
    const html = render('fr-CA', recorded(poisonedBody(parsed), 'body', reads));
    expect(html).toContain(liveKey.label);
    assertReadsWithinTables(reads);
    const flagged = [...reads].filter((p) => /^(token|secret|webhook_url|webhook_secret)$/.test(lastSegment(p)));
    expect(flagged).toEqual([]);
    expect(html).not.toContain(POISON.secret);
  });
});
