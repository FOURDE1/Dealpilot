import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AdminTenantSnapshot,
  SnapshotIntakeKey,
  SnapshotStoreHealth,
  type AdminTenantSnapshotT,
} from '@dealpilot/schemas';
import { INTAKE_KEY_COLUMNS, SNAPSHOT_TOP_LEVEL, STORE_HEALTH_COLUMNS } from './snapshot-fields.js';

/**
 * F-77 (D-078) — the snapshot page cannot show a credential, by construction.
 *
 * The wire already refuses to carry an intake key's token or secret
 * (f73-snapshot.test.ts:423-430). A page can re-break that rule in three ways
 * the API test cannot see: a generic renderer (`Object.entries(row)`), a hand
 * typed shape that drifts from the schema, or a future schema key nobody
 * classified. Each barrier below is independent and each has a mutation that
 * turns it red (D-078 lists them):
 *
 *   (a) the SHAPE — a recursive walk over `AdminTenantSnapshot` finds no key
 *       whose name looks like a credential, and the intake-key shape is pinned
 *       to the same seven names the API test pins on the wire;
 *   (b) the SCHEMA strip — `AdminTenantSnapshot.parse`, which the hook
 *       calls, strips a leaked credential; and the body of
 *       `useAdminTenantSnapshot` in api.ts is pinned, comments stripped, to
 *       `return AdminTenantSnapshot.parse(res.body)` with no `res.body as`
 *       cast, so swapping the parse for a cast is red here;
 *   (c) the PAGE — with comments stripped, tenant-snapshot-page.tsx and
 *       snapshot-fields.ts contain no generic-render construct, no bracket
 *       access on a data binding, and no identifier shaped like a credential;
 *       the column tables are inside the schema at runtime, not only at
 *       compile time;
 *   (d) the CLASSIFICATION — every top-level key is rendered here XOR left to
 *       the tenant detail page, and the page really reads each rendered key
 *       through its `d.` binding and none of the detail-page keys;
 *   (e) the classifier itself is not vacuous.
 *
 * The render-time half (the poison body and the Proxy access recorder) lives
 * in tenant-snapshot-page.test.tsx; this file needs no DOM and no database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');
const PAGE_PATH = join(here, 'tenant-snapshot-page.tsx');
const FIELDS_PATH = join(here, 'snapshot-fields.ts');
const API_PATH = join(here, 'api.ts');
const TOKEN_ROLES_PATH = join(repoRoot, 'packages', 'ui', 'src', 'theme', 'token-roles.ts');

/**
 * No word boundaries on purpose: `_` is a word character, so `\bsecret\b`
 * would not see `webhook_secret`. `key` alone is deliberately absent — the
 * page's own identifiers (keyRevoked, keysCaption, INTAKE_KEY_COLUMNS) must
 * stay legal.
 */
const SECRET_NAME = /token|secret|password|passphrase|hmac|signing|api[_-]?key|credential|private/i;

/**
 * Copied from packages/ui/src/theme/token-roles.ts:121-125 (`stripComments`),
 * which @dealpilot/ui does not export. Block comments keep their newlines so
 * line numbers in a failure still point at the source; the test below reads
 * the original and fails if the two bodies ever differ.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '');
}

/** Zod 4 keeps the node kind on `.def.type`; there is no stable class to test (queue-catalogue.test.ts:38-70). */
interface ZodNode {
  readonly def: {
    readonly type: string;
    readonly innerType?: ZodNode;
    readonly element?: ZodNode;
    readonly shape?: Record<string, ZodNode>;
  };
}

const WRAPPERS = new Set(['optional', 'default', 'nullable']);

/**
 * Every dotted path the schema can produce, through objects, arrays and the
 * three wrappers. Arrays contribute `[]`, so a key inside a row reads as
 * `intake_keys[].label`. Bounded like the catalogue's `leafOf`: a cyclic
 * schema fails the suite instead of hanging it.
 */
function walk(node: ZodNode, path: string, out: string[], depth = 0): void {
  expect(depth, `schema walk deeper than 16 at ${path}`).toBeLessThan(16);
  let cursor = node;
  for (let peeled = 0; peeled < 8 && WRAPPERS.has(cursor.def.type) && cursor.def.innerType; peeled += 1) {
    cursor = cursor.def.innerType;
  }
  if (cursor.def.type === 'array' && cursor.def.element) {
    walk(cursor.def.element, `${path}[]`, out, depth + 1);
    return;
  }
  if (cursor.def.type === 'object' && cursor.def.shape) {
    for (const [key, child] of Object.entries(cursor.def.shape)) {
      const next = path === '' ? key : `${path}.${key}`;
      out.push(next);
      walk(child, next, out, depth + 1);
    }
  }
}

const segmentsOf = (path: string): string[] => path.split(/[.[\]]+/).filter((s) => s.length > 0);

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const PLAN = '44444444-4444-4444-8444-444444444444';
const AT = '2026-08-01T04:00:00.000Z';

/** A valid body — small, and only for the strip proof; the render tests own the full fixture. */
function validBody(): AdminTenantSnapshotT {
  return {
    id: ORG,
    name: 'Groupe Beauport',
    slug: 'groupe-beauport',
    legal_name: null,
    status: 'active',
    plan_id: PLAN,
    plan_code: 'core',
    province: 'QC',
    default_locale: 'fr-CA',
    store_count: 1,
    member_count: 1,
    created_at: AT,
    activated_at: AT,
    suspended_at: null,
    deleted_at: null,
    trial_ends_at: null,
    privacy_officer_name: null,
    privacy_officer_email: null,
    stripe_customer_id: null,
    stores: [{ id: STORE, name: 'Beauport Centre', code: 'BC-01', province: 'QC', status: 'active' }],
    owner_emails: ['owner@example.com'],
    last_activity_at: null,
    allowed_transitions: [],
    owner_invitation: null,
    seats_provisioned: 1,
    store_health: [
      {
        id: STORE,
        name: 'Beauport Centre',
        code: 'BC-01',
        status: 'active',
        timezone: 'America/Montreal',
        sms_number: null,
        business_hours_set: false,
        traffic_30d: { inbound: 0, outbound: 0, delivered: 0, last_message_at: null },
      },
    ],
    intake_keys: [
      {
        id: KEY,
        store_id: STORE,
        label: 'Formulaire site web',
        provider: 'generic_json',
        active: true,
        revoked_at: null,
        last_lead_accepted_at: null,
      },
    ],
    comms_config: {
      org_row_present: false,
      store_overrides: 0,
      sms_quiet_start: null,
      sms_quiet_end: null,
      first_touch_quiet_exempt: null,
      ai_daily_contact_cap: null,
    },
    branding: { state: 'none', version: null, published_at: null },
    connectors_active: 0,
    platform: { sms_transport: 'log', email_transport: 'log', ai_transport: 'off' },
  };
}

const pageSource = readFileSync(PAGE_PATH, 'utf8');
const fieldsSource = readFileSync(FIELDS_PATH, 'utf8');
const page = stripComments(pageSource);
const fields = stripComments(fieldsSource);
const scanned = `${page}\n${fields}`;

describe('the stripComments copy matches its source', () => {
  it('token-roles.ts still carries the two replace lines this file copied', () => {
    // A guard that strips comments differently from the token-roles guard
    // would let a construct hide in a comment for one file and not the other.
    const original = readFileSync(TOKEN_ROLES_PATH, 'utf8');
    expect(original).toContain(".replace(/\\/\\*[\\s\\S]*?\\*\\//g, (m) => m.replace(/[^\\n]/g, ''))");
    expect(original).toContain(".replace(/\\/\\/[^\\n]*/g, '')");
    // And the copy behaves: a block comment keeps its newlines, a line comment goes.
    expect(stripComments('a /* x\ny */ b // c\nd')).toBe('a \n b \nd');
  });
});

describe('(a) the shape carries no credential-shaped key', () => {
  const paths: string[] = [];
  walk(AdminTenantSnapshot as unknown as ZodNode, '', paths);

  it('walks the whole schema, arrays included', () => {
    // A broken walk must not pass empty: the top level alone is 31 keys and
    // the rows beneath add more than that.
    expect(paths.length).toBeGreaterThanOrEqual(40);
    expect(paths).toContain('intake_keys[].label');
    expect(paths).toContain('store_health[].traffic_30d.inbound');
    expect(paths).toContain('owner_invitation.email');
    expect(paths).toContain('stores[].code');
  });

  it('no path segment matches SECRET_NAME', () => {
    const offending = paths.filter((p) => segmentsOf(p).some((seg) => SECRET_NAME.test(seg)));
    expect(offending).toEqual([]);
  });

  it('SnapshotIntakeKey has exactly the seven names the API test pins on the wire', () => {
    // The same literal as f73-snapshot.test.ts:423-425, so the schema cannot
    // grow a key the wire test would still accept.
    expect(Object.keys(SnapshotIntakeKey.shape).sort()).toEqual([
      'active',
      'id',
      'label',
      'last_lead_accepted_at',
      'provider',
      'revoked_at',
      'store_id',
    ]);
  });
});

describe('(b) the SCHEMA strip — AdminTenantSnapshot.parse, which the hook calls, strips a leaked credential', () => {
  it('useAdminTenantSnapshot returns AdminTenantSnapshot.parse(res.body) and never casts res.body', () => {
    // The parse case below proves the schema; this pins that the hook is its
    // caller. Comments are stripped first — the hook's own doc comment says
    // "PARSED, never cast", and a comment must not be what satisfies the pin.
    // The body is sliced from the function's export to its closing brace at
    // column 0, so a cast anywhere inside the hook is inside the slice.
    const api = stripComments(readFileSync(API_PATH, 'utf8'));
    const start = api.indexOf('export function useAdminTenantSnapshot');
    expect(start).toBeGreaterThan(-1);
    const end = api.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    const hook = api.slice(start, end);
    expect(hook).toMatch(/\bqueryFn\b/);
    expect(hook).toMatch(/return AdminTenantSnapshot\.parse\(res\.body\)/);
    expect(hook).not.toMatch(/res\.body as\b/);
  });

  it('drops token, secret and a top-level webhook_secret, values included', () => {
    const token = 'k'.repeat(22);
    const secret = 'a'.repeat(64);
    const webhookSecret = 'whsec_' + 'c'.repeat(40);
    const body = validBody();
    const leaked = {
      ...body,
      webhook_secret: webhookSecret,
      intake_keys: [{ ...body.intake_keys[0], token, secret }],
    };
    const parsed = AdminTenantSnapshot.parse(leaked);
    expect(Object.keys(parsed.intake_keys[0] ?? {})).not.toContain('token');
    expect(Object.keys(parsed.intake_keys[0] ?? {})).not.toContain('secret');
    expect('webhook_secret' in parsed).toBe(false);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(webhookSecret);
    // And the strip is what removed them — the label on the same row survived.
    expect(serialized).toContain('Formulaire site web');
  });
});

describe('(c) the page reads names only — source scan, comments stripped', () => {
  it.each([
    ['a generic walk over an object', /\bObject\.(entries|keys|values|assign)\s*\(/],
    ['JSON.stringify', /\bJSON\.stringify\s*\(/],
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['for…in over a value', /\bfor\s*\(\s*(const|let|var)\s+\w+\s+in\b/],
    ['a data binding spread into JSX or an object', /\{\s*\.\.\.\s*(?:d|row(?:\.original)?|snapshot(?:\.data)?|s|k)\b/],
    ['bracket access on a data binding', /\b(?:d|row\.original|snapshot\.data)\s*\[/],
  ])('forbids %s', (_name, re) => {
    expect(scanned).not.toMatch(re);
  });

  it('holds no identifier shaped like a credential', () => {
    const idents = scanned.match(/[A-Za-z_$][\w$]*/g) ?? [];
    expect(idents.length).toBeGreaterThan(100);
    const offending = idents.filter((i) => SECRET_NAME.test(i) || /^(webhook_url|api_key)$/.test(i));
    expect([...new Set(offending)]).toEqual([]);
  });

  it('reads through the bindings the ban is anchored to', () => {
    // The bracket ban above is only meaningful if these are the names the
    // page binds; a renamed binding would pass the ban vacuously.
    expect(page).toMatch(/const d = snapshot\.data\b/);
    expect(page).toMatch(/\brow\.original\./);
    expect(page).toMatch(/\.last_lead_accepted_at\b/);
  });

  it('keeps the three label-table lookups, each an allowed bracket', () => {
    expect(page).toMatch(/\bSTORE_STATUS_KEYS\[/);
    expect(page).toMatch(/\bPROVIDER_KEYS\[/);
    expect(page).toMatch(/\bBRANDING_STATE_KEYS\[/);
  });

  it('keeps the column tables inside the schema at runtime', () => {
    // `satisfies readonly (keyof …T)[]` proves this at compile time; the
    // runtime form is what the Proxy recorder chains onto (reads ⊆ tables ⊆ schema).
    const keyShape = Object.keys(SnapshotIntakeKey.shape);
    const storeShape = Object.keys(SnapshotStoreHealth.shape);
    for (const column of INTAKE_KEY_COLUMNS) expect(keyShape, column).toContain(column);
    for (const column of STORE_HEALTH_COLUMNS) expect(storeShape, column).toContain(column);
    expect(INTAKE_KEY_COLUMNS.length).toBeGreaterThan(0);
    expect(STORE_HEALTH_COLUMNS.length).toBeGreaterThan(0);
  });
});

describe('(d) every top-level key is classified exactly once', () => {
  const rendered = [...SNAPSHOT_TOP_LEVEL.rendered];
  const detailPage = [...SNAPSHOT_TOP_LEVEL.detailPage];
  const shapeKeys = Object.keys(AdminTenantSnapshot.shape);

  it('rendered ∪ detailPage is the schema, and the halves are disjoint', () => {
    expect(rendered.length).toBe(12);
    expect([...rendered, ...detailPage].sort()).toEqual([...shapeKeys].sort());
    expect(rendered.length + detailPage.length).toBe(shapeKeys.length);
    expect(rendered.filter((k) => (detailPage as string[]).includes(k))).toEqual([]);
  });

  it('the page reads every rendered key through its top-level binding', () => {
    for (const key of rendered) {
      expect(page, `d.${key}`).toMatch(new RegExp(`\\bd\\.${key}\\b`));
    }
  });

  it('the page reads none of the detail-page keys', () => {
    // Scanned in the page only: snapshot-fields.ts necessarily names every
    // detail key as a literal. None of the 19 collides with a nested name.
    for (const key of detailPage) {
      expect(page, key).not.toMatch(new RegExp(`[.?]${key}\\b`));
    }
  });
});

describe('(e) SECRET_NAME is not vacuous', () => {
  it.each(['token', 'secret', 'signing_key', 'api-key', 'webhook_secret', 'apiKey'])('flags %s', (name) => {
    expect(SECRET_NAME.test(name)).toBe(true);
  });

  it.each(['label', 'stripe_customer_id', 'privacy_officer_name', 'store_id', 'last_lead_accepted_at'])(
    'passes %s',
    (name) => {
      expect(SECRET_NAME.test(name)).toBe(false);
    },
  );
});
