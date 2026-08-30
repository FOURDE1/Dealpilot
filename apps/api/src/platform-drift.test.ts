import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import {
  ANNOUNCEMENT_SEVERITY_RANK,
  ANNOUNCEMENT_TEXT_FIELDS,
  missingTranslations,
  type AnnouncementTextField,
} from '@dealpilot/core';
import {
  ActivityActorType,
  ANNOUNCEMENT_SEVERITIES,
  PublishAnnouncementInput,
  PLATFORM_AUDIT_EVENTS,
  PLATFORM_CAPABILITY_NAMES,
  PLATFORM_ROLES,
  PLATFORM_SETTING_KEYS,
  PlanTier,
  ROLES,
} from '@dealpilot/schemas';
import { apiV1 as contract } from '@dealpilot/contracts';

/**
 * F-69 — the platform console's lockstep guards (the dead-vocabulary rule,
 * applied to the platform side):
 *  - every admin endpoint starts with a capability check, never a role;
 *  - every declared capability is enforced somewhere;
 *  - the route file never opens tenant context;
 *  - the SQL vocabularies (platform roles, actor types, plan codes) equal
 *    the Zod ones.
 *
 * F-72 extends the last two: the announcement and kill-switch vocabularies
 * join the lockstep, and the app role's reach over the new tables and the two
 * internal audience helpers is pinned the same way `platform_assert_actor`
 * already was. It also adds two locksteps of a new shape: an ORDERING one, a
 * severity's rank being vocabulary too when it decides which rows survive a
 * `LIMIT`; and a core-vs-schemas one, which has to live here because neither
 * package may import the other and §8's both-languages rule is written out in
 * both.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const ADMIN_URL = testAdminUrl();
/** Every route file that serves /api/v1/admin/ — this guard owns the list (F-70). */
const ADMIN_ROUTE_FILES = [
  'f69-admin-routes.ts',
  'f70-provisioning-routes.ts',
  'f71-impersonation-routes.ts',
  'f72-announcement-routes.ts',
  'f72-killswitch-routes.ts',
];
/**
 * F-72's third route file serves the TENANT banner feed, so it is deliberately
 * absent above. The escape check below conscripts any `f<NN>…routes.ts` that
 * names an admin path, and the handler count is an equality — a stray
 * `/api/v1/admin/` in that file, in a comment as readily as in a route, would
 * fail both with messages that point somewhere else. Asserted, not assumed.
 */
const TENANT_ROUTE_FILES = ['f72-banner-routes.ts'];
const source = ADMIN_ROUTE_FILES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n');

let admin: Pool;
let dbUp = false;

function adminPaths(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record['path'] === 'string' && typeof record['method'] === 'string') {
    found.add(`${String(record['method'])} ${String(record['path'])}`);
    return found;
  }
  for (const value of Object.values(record)) adminPaths(value, found);
  return found;
}

/**
 * The values a column's vocabulary CHECK admits.
 *
 * This used to take the first definition that merely MENTIONED the column and
 * contained `ANY`, with no ORDER BY — and `pg_constraint` promises no row
 * order, so it was picking by heap layout. Two live collisions exist today:
 * `activity_events` renders `CHECK ((impersonation_id IS NULL) OR (actor_type =
 * ANY (…)))` beside the real actor-type vocabulary, and F-72's derived
 * `dismissible` column renders as `CHECK ((dismissible = (severity = ANY
 * (ARRAY['info','marketing']))))` beside the real severity vocabulary. Either
 * could be returned, and the wrong one is a two-value list that looks like a
 * migration bug.
 *
 * So anchor on the column at the head of the expression, and refuse to guess:
 * exactly one definition must survive, and a table that grows a second one
 * fails here by name rather than reporting the wrong vocabulary.
 */
async function checkValues(table: string, column: string): Promise<string[]> {
  const r = await admin.query<{ def: string }>(
    `SELECT pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
     WHERE c.relname = $1 AND con.contype = 'c'`,
    [table],
  );
  const anchored = new RegExp(`^CHECK \\(\\(${column}(::text)? = ANY`);
  const defs = r.rows.map((x) => x.def).filter((d) => anchored.test(d));
  expect(defs, `expected exactly one vocabulary CHECK on ${table}.${column}`).toHaveLength(1);
  return [...defs[0]!.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!).sort();
}

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
});

afterAll(async () => {
  await admin?.end();
});

describe('platform drift (F-69)', () => {
  it('every admin endpoint except /me asks for a capability, and every capability is asked for', () => {
    const handlers = source.match(/app\.(get|post|patch|delete)\('\/api\/v1\/admin\//g) ?? [];
    const checks = [...source.matchAll(/requirePlatform\(request, '([a-z_]+:[a-z_]+)'\)/g)].map((m) => m[1]!);
    // /me reads what the gate already established; every other handler checks.
    expect(checks.length).toBeGreaterThanOrEqual(handlers.length - 1);
    for (const cap of PLATFORM_CAPABILITY_NAMES) {
      expect(checks, `capability nothing enforces: ${cap}`).toContain(cap);
    }
    for (const cap of new Set(checks)) {
      expect(PLATFORM_CAPABILITY_NAMES as readonly string[], `asked for but undeclared: ${cap}`).toContain(cap);
    }
    // The contract and the file agree on the surface.
    const declared = [...adminPaths(contract.admin)].length;
    expect(handlers.length).toBe(declared);
  });

  it('every route file that serves an admin path is on this guard’s list', () => {
    // A new admin route file that silently escaped the guard would be the
    // worse blind spot: the list is asserted, not trusted.
    const escaped = readdirSync(here)
      .filter((f) => /^f\d+.*routes\.ts$/.test(f) && readFileSync(join(here, f), 'utf8').includes("'/api/v1/admin/"))
      .filter((f) => !ADMIN_ROUTE_FILES.includes(f));
    expect(escaped, 'admin route files the drift guard does not scan').toEqual([]);
    for (const f of ADMIN_ROUTE_FILES) expect(readFileSync(join(here, f), 'utf8')).toContain("'/api/v1/admin/");
    for (const f of TENANT_ROUTE_FILES) {
      expect(
        readFileSync(join(here, f), 'utf8'),
        `${f} serves tenants, so the admin path prefix must not appear in it — not in a route, not in a comment`,
      ).not.toContain("'/api/v1/admin/");
    }
  });

  it('the route file never opens tenant context and never names a tenant role', () => {
    expect(source).not.toMatch(/withTenant|withUser|withContext|requirePermission\(|hasPermission\(/);
    for (const role of ROLES) expect(source, `tenant role literal '${role}' in the admin routes`).not.toContain(`'${role}'`);
  });

  it('SQL and Zod agree on the platform vocabularies', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect(await checkValues('platform_staff', 'role')).toEqual([...PLATFORM_ROLES].sort());
    expect(await checkValues('activity_events', 'actor_type')).toEqual([...ActivityActorType.options].sort());
    // F-72. `enum-vocabulary.test.ts` cannot see any of these three: its parser
    // needs a literal array inside `z.enum(...)`, and all three are the
    // `const X = [...] as const` form. This is their only lockstep.
    expect(await checkValues('platform_settings', 'setting_key')).toEqual([...PLATFORM_SETTING_KEYS].sort());
    expect(await checkValues('platform_announcements', 'severity')).toEqual([...ANNOUNCEMENT_SEVERITIES].sort());
    expect(await checkValues('platform_audit_events', 'event')).toEqual([...PLATFORM_AUDIT_EVENTS].sort());
    const seeded = await admin.query<{ code: string }>('SELECT code FROM plans ORDER BY code');
    expect(seeded.rows.map((r) => r.code)).toEqual([...PlanTier.options].sort());
  });

  it('the publish 422 asks for exactly the fields missingTranslations() marks', () => {
    // §8's both-languages rule is asked twice — once live by the compose form
    // through `missingTranslations()`, once at publish by
    // `PublishAnnouncementInput` — and the two cannot share code: schemas
    // carries no dependency on core. So the four names and the trim rule are
    // written out in both places, and this is what keeps them one. Added to
    // one side only, a fifth bilingual field is either refused by a server the
    // form never warned about, or marked by a form the server then accepts.
    const blank = Object.fromEntries(ANNOUNCEMENT_TEXT_FIELDS.map((f) => [f, ' \n '])) as Record<
      AnnouncementTextField,
      string
    >;
    const parsed = PublishAnnouncementInput.safeParse({ severity: 'info', audience: { type: 'all' }, ...blank });
    expect(parsed.success, 'four whitespace translations must not publish').toBe(false);
    expect(
      parsed.error!.issues.map((i) => i.path.join('.')).sort(),
      'the publish schema refuses a different set of fields than the compose form marks as missing.',
    ).toEqual([...ANNOUNCEMENT_TEXT_FIELDS].sort());
    // The other half of the same pin: whitespace is not a translation on the
    // client either, and the helper answers for every field in the list.
    expect(missingTranslations(blank)).toEqual([...ANNOUNCEMENT_TEXT_FIELDS]);
  });

  it('announcements_for_user() ranks severity exactly as ANNOUNCEMENT_SEVERITY_RANK does', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The feed's ORDER BY is not cosmetic: it runs ahead of `LIMIT 20`, so it
    // chooses WHICH announcements a tenant is ever shown, while the shell sorts
    // what arrives by the core object. Disagree and the row dropped at position
    // 21 is picked by one rule and the banner ordered by another.
    const def = (
      await admin.query<{ d: string }>(
        `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'announcements_for_user'`,
      )
    ).rows[0]!.d;
    const arm = /CASE a\.severity((?:\s+WHEN\s+'[a-z_]+'\s+THEN\s+\d+)+)\s+ELSE\s+(\d+)\s+END/.exec(def);
    expect(arm, 'announcements_for_user() no longer orders by a severity CASE — the rank moved and this guard now watches nothing').not.toBeNull();
    const sql: Record<string, number> = {};
    for (const m of arm![1]!.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+(\d+)/g)) sql[m[1]!] = Number(m[2]);
    // The `ELSE` arm names no severity, so it is read as "whichever one the
    // CASE does not enumerate". Exactly one may be left over: a fifth severity
    // would fall into ELSE and share a rank with marketing in SQL while the
    // core object gave it its own — which is the drift, not an exemption.
    const unranked = ANNOUNCEMENT_SEVERITIES.filter((s) => !(s in sql));
    expect(
      unranked,
      `the ELSE arm of the feed's ORDER BY stands for exactly one severity; it now stands for ${unranked.length} (${unranked.join(', ')}). Give each its own WHEN.`,
    ).toHaveLength(1);
    sql[unranked[0]!] = Number(arm![2]);
    expect(
      sql,
      'the feed truncates by the SQL rank and apps/web sorts by ANNOUNCEMENT_SEVERITY_RANK; when they differ the announcements a dealer sees are chosen by one rule and ordered by the other.',
    ).toEqual({ ...ANNOUNCEMENT_SEVERITY_RANK });
  });

  it('refuses to guess when a column carries two vocabulary CHECKs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The failure this replaced was silent: the wrong list came back and read
    // as a migration that had dropped values. Proven on a throwaway table so
    // the guard's own legibility is asserted, not hoped for.
    await admin.query(
      `CREATE TABLE drift_probe (
         kind text NOT NULL
           CHECK (kind = ANY (ARRAY['a'::text, 'b'::text]))
           CHECK (kind = ANY (ARRAY['a'::text, 'b'::text, 'c'::text])))`,
    );
    try {
      await expect(checkValues('drift_probe', 'kind')).rejects.toThrow(
        /expected exactly one vocabulary CHECK on drift_probe\.kind/,
      );
    } finally {
      await admin.query('DROP TABLE drift_probe');
    }
  });

  it('the app role holds no grant on the privilege tables and cannot reprice a plan', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const grants = await admin.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app'
         AND table_name IN ('platform_staff','platform_audit_events','plans',
                            'platform_settings','platform_announcements','announcement_dismissals')`,
    );
    const held = (t: string) =>
      grants.rows.filter((g) => g.table_name === t).map((g) => g.privilege_type).sort();
    // Two read-only reference tables: the app renders the catalogue and reads
    // the switches, and can change neither.
    expect(held('plans'), 'plans').toEqual(['SELECT']);
    expect(held('platform_settings'), 'platform_settings').toEqual(['SELECT']);
    // Everything else on the platform side is reached only through a definer.
    for (const t of [
      'platform_staff',
      'platform_audit_events',
      'platform_announcements',
      'announcement_dismissals',
    ]) {
      expect(held(t), t).toEqual([]);
    }
    // The actor check is internal: the app role cannot even call it. F-72's two
    // audience helpers are the same kind of thing — REVOKEd from PUBLIC with no
    // GRANT — and 'internal' is a claim, so it is checked.
    const callable = async (signature: string) =>
      (
        await admin.query<{ ok: boolean }>(
          `SELECT has_function_privilege('dealpilot_app', $1, 'EXECUTE') AS ok`,
          [signature],
        )
      ).rows[0]!.ok;
    expect(await callable('platform_assert_actor(uuid, text[])')).toBe(false);
    expect(await callable('announcement_matches(jsonb, text, uuid, text, text)')).toBe(false);
    expect(await callable('announcement_visible(uuid)')).toBe(false);
  });
});
