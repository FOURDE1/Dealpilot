import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, testAdminUrl, type Pool } from './index.js';
import { reset } from './migrate.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * RLS COVERAGE GUARD (ROADMAP Phase 1 exit criterion: "RLS policies verified by
 * an automated cross-tenant leak test").
 *
 * rls.test.ts proves tenant isolation BEHAVES correctly on the tables it seeds.
 * This suite is the other half: it reads the catalog, so it covers tables that
 * do not exist yet. Add a table with an `organization_id` next month and forget
 * its policy, and this goes red without anyone remembering to extend a list.
 *
 * It encodes the rules this codebase has already paid to learn:
 *  - a tenant table without FORCE RLS is protected only from people who are not
 *    the table owner, which in a migration is nobody;
 *  - `WITH CHECK (true)` accepts a row written into another tenant;
 *  - a permissive SELECT policy keyed on the USER alone ORs with tenant
 *    isolation, so under dual context it returns that user's rows from every
 *    organization they belong to (this is exactly the defect removed from F-08
 *    before merge). Those policies are legal but must be deliberate, so each one
 *    has to be registered below with a reason.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const adminUrl = testAdminUrl();

let admin: Pool;
let dbUp = false;

/**
 * Permissive SELECT policies keyed on `app.user_id` with NO organization
 * predicate. Each entry is a decision, not an oversight. If you add one, say
 * here why the OR with tenant isolation is safe.
 */
const USER_KEYED_POLICIES: Record<string, string> = {
  'memberships.membership_self_read':
    'Load-bearing: resolveOrg/callerOrgIds read the caller’s own memberships under withUser (no org GUC yet) to discover which organizations they belong to — the bootstrap that everything else scopes from. Every dual-context query over memberships carries an explicit m.organization_id predicate.',
  'users.user_self_read':
    'A caller must be able to read their own identity row before any org is resolved.',
};

/** Tables whose isolation is proven behaviourally in rls.test.ts or a route suite. */
const BEHAVIOURALLY_COVERED = new Set([
  'organizations', 'stores', 'users', 'memberships', 'leads', 'intake_keys',
  'deals', 'vehicles', 'commissions', 'pay_plans',
  'checklist_templates', 'deal_checklist_items',
  // F-10: cross-tenant case lives in apps/api/src/f10-activity.test.ts
  // ("another tenant sees none of it").
  'activity_events',
  // F-12: cross-tenant case in apps/api/src/f12-invitations.test.ts
  // ("another organization cannot see or revoke these invitations").
  'invitations',
  // F-11: cross-tenant case in apps/api/src/f11-dispatch.test.ts
  // ("another organization sees none of this fleet").
  'chaser_vehicles', 'dealer_plates', 'dispatch_assignments',
  // F-11b: same suite, 'another organization sees none of this fleet'.
  'driver_companies',
  // A-13: cross-tenant case in apps/api/src/a13-rbac.test.ts
  // ("another organization cannot read or change this matrix").
  'role_permissions', 'user_permissions',
  // F-13: cross-tenant case in apps/api/src/f13-documents.test.ts
  // ("another organization sees none of these documents").
  'deal_documents',
  // F-13b: cross-tenant case in apps/api/src/f13b-fi-products.test.ts
  // ("another organisation's product is a 404, not a 403") — PATCH, DELETE and
  // the deal's list, because each reaches the table by a different route.
  'deal_fi_products',
  // F-14: cross-tenant case in apps/api/src/f14-branding.test.ts
  // ("another organisation's branding is a 404, and its brand never leaks") —
  // GET, PUT and publish, because a leak on any one of them hands a rival
  // dealership's identity out.
  'tenant_branding',
  // F-15: cross-tenant cases in apps/api/src/f15-compliance.test.ts — every
  // compliance route refused to an outsider, plus a live probe as the
  // application role proving the tenant predicate is what hides the rows.
  'consent_ledger', 'suppression_list', 'internal_dnc', 'tenant_comms_config', 'send_decisions',
  // F-19: cross-tenant case in apps/api/src/f19-send.test.ts ("keeps another
  // organisation out of these conversations") — the conversation AND its
  // messages, because a rival reading either one reads the customer.
  'conversations', 'messages',
]);

interface PolicyRow {
  table_name: string;
  policy: string;
  cmd: string;
  using_expr: string | null;
  check_expr: string | null;
  permissive: boolean;
}

let tenantTables: string[] = [];
let policies: PolicyRow[] = [];

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: adminUrl, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED is set but no database is reachable');
    return;
  }
  await reset(admin, migrationsDir, adminUrl);

  const t = await admin.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_schema = 'public' AND col.table_name = c.relname
                     AND col.column_name = 'organization_id')
     ORDER BY 1`,
  );
  tenantTables = t.rows.map((r) => r.table_name);

  const p = await admin.query<PolicyRow>(
    `SELECT c.relname AS table_name, pol.polname AS policy, pol.polcmd AS cmd,
            pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
            pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
            pol.polpermissive AS permissive
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'`,
  );
  policies = p.rows;
});

afterAll(async () => {
  await admin?.end();
});

const isOrgKeyed = (e: string | null) => !!e && /app\.org_id/.test(e);

/**
 * The hazard is a policy that grants rows on the CALLER alone. A `member_read`
 * policy is not that: it correlates the membership to the row's own
 * organization (`m.organization_id = deals.organization_id`), so it can only
 * ever return rows of organizations the caller actually belongs to. What is
 * dangerous is `user_id = app.user_id` with no organization anywhere in the
 * expression — that ignores which tenant the request is scoped to.
 */
const isBareUserKeyed = (e: string | null) =>
  !!e && /app\.user_id/.test(e) && !/organization_id/.test(e);

describe('RLS coverage (catalog-driven — covers tables that do not exist yet)', () => {
  it('found the tenant tables to check', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A refactor that renamed the tenant column would otherwise make every
    // assertion below vacuously pass.
    expect(tenantTables.length).toBeGreaterThanOrEqual(10);
  });

  it('every tenant table has RLS ENABLED and FORCED', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ table_name: string; rls: boolean; forced: boolean }>(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relname = ANY($1)`,
      [tenantTables],
    );
    // FORCE matters because migrations and the owner role would otherwise
    // bypass every policy silently.
    const bad = r.rows.filter((x) => !x.rls || !x.forced).map((x) => x.table_name);
    expect(bad, `tenant tables missing RLS ENABLED+FORCED: ${bad.join(', ')}`).toEqual([]);
  });

  it('every tenant table is isolated by app.org_id on both read AND write', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const missing = tenantTables.filter((t) => {
      const own = policies.filter((p) => p.table_name === t);
      return !own.some((p) => isOrgKeyed(p.using_expr) && isOrgKeyed(p.check_expr));
    });
    // USING without WITH CHECK stops a tenant reading someone else's row but
    // still lets them WRITE one into another tenant.
    expect(missing, `no org-keyed USING+WITH CHECK policy: ${missing.join(', ')}`).toEqual([]);
  });

  it('no policy accepts any row it is handed (WITH CHECK true)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const permissive = policies
      .filter((p) => p.check_expr !== null && /^\s*true\s*$/i.test(p.check_expr))
      .map((p) => `${p.table_name}.${p.policy}`);
    expect(permissive, `WITH CHECK (true) defeats write isolation: ${permissive.join(', ')}`).toEqual([]);
  });

  it('every user-keyed policy is a registered decision, not an accident', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const found = policies
      .filter((p) => p.permissive && isBareUserKeyed(p.using_expr))
      .map((p) => `${p.table_name}.${p.policy}`);
    const unregistered = found.filter((k) => !(k in USER_KEYED_POLICIES));
    expect(
      unregistered,
      `These policies grant rows on app.user_id with no organization predicate, so they OR with tenant isolation and return the caller's rows from EVERY organization they belong to. Register each in USER_KEYED_POLICIES with why that is safe, or add an org predicate: ${unregistered.join(', ')}`,
    ).toEqual([]);
  });

  it('the application role cannot bypass RLS', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'dealpilot_app'`,
    );
    expect(r.rows).toHaveLength(1);
    // Either flag would make every policy in this file decorative.
    expect(r.rows[0]!.rolbypassrls).toBe(false);
    expect(r.rows[0]!.rolsuper).toBe(false);
  });

  it('a new tenant table cannot ship without behavioural coverage', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const uncovered = tenantTables.filter((t) => !BEHAVIOURALLY_COVERED.has(t));
    // Structure is necessary but not sufficient: a policy can be present and
    // still wrong. Adding a tenant table must force someone to prove isolation
    // with real rows, so this fails until the table is listed.
    expect(
      uncovered,
      `new tenant table(s) with no cross-tenant test: ${uncovered.join(', ')} — add a case to rls.test.ts or the route suite, then list it in BEHAVIOURALLY_COVERED`,
    ).toEqual([]);
  });

  it('the app role holds no DELETE grant on the immutable tables', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND privilege_type = 'DELETE'
         AND table_name IN ('commissions', 'deal_checklist_items', 'activity_events')`,
    );
    // Money lines are corrected with new rows; a delivered deal's checklist is
    // evidence; the activity trail is append-only by definition. None of the
    // three is ever removed by the application.
    expect(r.rows.map((x) => x.table_name)).toEqual([]);
  });
});
