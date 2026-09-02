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
  'notifications.notifications_self_read':
    'INTENDED cross-org: a notification is addressed to a PERSON, and a person working at two dealer groups has one bell — every row they can see is already theirs by user_id. The list route (F-47) runs under withUser and never takes an org parameter at all.',
  'notifications.notifications_self_update':
    'Read-marking is the same addressed act: only the recipient can mark, and only their own rows are visible to mark (D-050 #3).',
};

/** Tables whose isolation is proven behaviourally in rls.test.ts or a route suite. */
const BEHAVIOURALLY_COVERED = new Set([
  'organizations', 'stores', 'users', 'memberships', 'leads', 'intake_keys',
  'deals', 'vehicles', 'commissions', 'pay_plans',
  'checklist_templates', 'deal_checklist_items',
  // F-10: cross-tenant case lives in apps/api/src/f10-activity.test.ts
  // ("another tenant sees none of it").
  'activity_events',
  // F-68: apps/api/src/f68-tasks.test.ts ("a rival organization sees none of it").
  'tasks',
  // F-12: cross-tenant case in apps/api/src/f12-invitations.test.ts
  // ("another organization cannot see or revoke these invitations").
  'invitations',
  // F-49: POLICY-level case in packages/db/src/rls.test.ts
  // ("tenant_connectors: tenant 2 sees nothing of tenant 1").
  'tenant_connectors',
  // F-47: POLICY-level case in packages/db/src/rls.test.ts ("notifications:
  // addressed to a person").
  'notifications',
  // F-71: POLICY-level case in packages/db/src/rls.test.ts
  // ("impersonation_sessions: tenant 2 sees nothing of tenant 1").
  'impersonation_sessions',
  // F-53: POLICY-level case in packages/db/src/rls.test.ts
  // ("lost_reasons: tenant 2 sees nothing of tenant 1").
  'lost_reasons',
  // F-54: POLICY-level case in packages/db/src/rls.test.ts
  // ("lead_duplicates: tenant 2 sees nothing of tenant 1").
  'lead_duplicates',
  // F-57: POLICY-level case in packages/db/src/rls.test.ts
  // ("lead_extractions: tenant 2 sees nothing of tenant 1").
  'lead_extractions',
  // F-61: POLICY-level case in packages/db/src/rls.test.ts
  // ("drip_sequences + drip_enrollments: tenant 2 sees nothing of tenant 1").
  'drip_sequences',
  'drip_enrollments',
  // F-64: POLICY-level case in packages/db/src/rls.test.ts
  // ("conversation_qa_reviews: tenant 2 sees nothing of tenant 1").
  'conversation_qa_reviews',
  // F-65: POLICY-level case in packages/db/src/rls.test.ts
  // ("source_costs: tenant 2 sees nothing of tenant 1").
  'source_costs',
  // F-45: POLICY-level case in packages/db/src/rls.test.ts
  // ("lead_distribution_config: tenant 2 sees nothing of tenant 1").
  'lead_distribution_config',
  // F-42: POLICY-level case in packages/db/src/rls.test.ts ("staff_schedules:
  // tenant 2 sees nothing of tenant 1") — the route-level 404 in
  // f42-cascade.test.ts alone would not catch a dropped policy (2026-08-19
  // review caught exactly that gap in the first citation).
  'staff_schedules',
  // F-11: cross-tenant case in apps/api/src/f11-dispatch.test.ts
  // ("another organization sees none of this fleet").
  'chaser_vehicles', 'dealer_plates', 'dispatch_assignments',
  // F-11b: same suite, 'another organization sees none of this fleet'.
  'driver_companies',
  // A-13: cross-tenant case in apps/api/src/a13-rbac.test.ts
  // ("another organization cannot read or change this matrix").
  'role_permissions', 'user_permissions',
  // F-36: cross-tenant case in apps/api/src/f36-deal-parties.test.ts
  // ("another dealership can neither read nor add a party on our deal") —
  // driven through the APP role under the rival's tenant context, because the
  // admin pool owns the tables and would pass whatever the policies said.
  'deal_parties',
  // F-39: cross-tenant cases in apps/api/src/f39-scoring.test.ts ("another
  // dealership cannot read, edit, delete or even find our rules" / "cannot
  // reach our lead scores through the recalc endpoint").
  'lead_scoring_rules', 'lead_scores',
  // F-40: cross-tenant case in apps/api/src/f40-assignment.test.ts ("cannot
  // see, edit, delete our rules, or assign our leads") — covers all three
  // tables plus the append-only grant on history.
  'lead_assignment_rules', 'lead_assignment_state', 'lead_assignment_history',
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
  // F-20: cross-tenant case in apps/api/src/f20-handoff.test.ts ("is invisible
  // to another organisation") — it holds the assistant's read on a named
  // customer, which is a rival's most useful page in the whole product.
  'conversation_analysis',
  // F-33: cross-tenant cases in apps/api/src/f33-tools.test.ts ("sees none of
  // these appointments", and a write into another org refused) — an
  // appointment names a customer, a time, and a place they will be.
  'appointments',
  // F-35: cross-tenant cases in apps/api/src/f35-contacts.test.ts ("sees none
  // of these customers", and a 404 rather than a 403 on GET and PATCH) — a
  // customer list is the single most valuable thing a rival could take.
  'contacts',
  // F-79: cross-tenant case in apps/api/src/f79-clawbacks.test.ts (T-A3/T-A8),
  // driven as the APP role — a rival's flag is a 404 on the commission SELECT,
  // a rival's confirm a 404 on the clawbackOrg walk.
  'commission_clawbacks',
  // F-80: cross-tenant case in apps/api/src/f80-lenders.test.ts (T-L6), driven
  // as the APP role — a rival's PATCH of our lender id is a 404 via the
  // lenderOrg walk, a rival's list never contains our rows, and a rival deal
  // naming our lender id is a 422. NO USER_KEYED_POLICIES entry: lenders has
  // no member_read policy — the list runs under withTenant + requireMember and
  // id-addressed writes resolve the org via the clawbackOrg iteration, so the
  // one org-keyed isolation policy is the only door (registering anything here
  // would trip the 'vanished' branch, which only classifies BARE user-keyed
  // policies).
  'lenders',
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
/**
 * F-71: `impersonation_scope_ok(organization_id)` narrows a user-keyed policy
 * to ONE organization only while a support session is live — it is not an
 * organization predicate. Classify the policy as if the call were TRUE, or
 * the scoped `membership_self_read` silently drops out of the registry.
 */
const stripScope = (e: string | null) => e?.replace(/impersonation_scope_ok\([^)]*\)/g, 'true') ?? e;
const isBareUserKeyed = (e: string | null) => {
  const s = stripScope(e);
  return !!s && /app\.user_id/.test(s) && !/organization_id/.test(s);
};

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
    // Both directions: a registered policy that no longer classifies as
    // user-keyed (dropped, or rewritten so the scan misfiles it) is loud too.
    const vanished = Object.keys(USER_KEYED_POLICIES).filter((k) => !found.includes(k));
    expect(vanished, `registered user-keyed policies the scan no longer finds: ${vanished.join(', ')}`).toEqual([]);
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
