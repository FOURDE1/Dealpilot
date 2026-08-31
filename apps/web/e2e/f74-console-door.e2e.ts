import { expect, test, type Page } from '@playwright/test';
import { bootstrapSuperAdmin } from './support/platform-staff.js';
import { totp } from './support/totp.js';

/**
 * F-74 — the platform console's door (F-69), through the real screens.
 *
 * THIS ONE FILE OWNS THE BOOTSTRAP ONE-SHOT. bootstrapSuperAdmin() spends the
 * database-wide no-actor platform_staff_grant, which is legal exactly once
 * per reset, and `pnpm e2e` resets the e2e database once per run — so this
 * is the only spec that may call it, and bootstrap-guard.test.ts fails
 * `checks` if a second one appears (or if this one disappears). Everything
 * else here goes through the product's own producers: signup, /security
 * enrolment, and the console's own /admin/staff grant form for the SECOND
 * staffer — the one console write this slice affords, and the reason the
 * capability-gated nav assertion in T5 can fail under mutation at all.
 *
 * Serial by necessity — one bootstrap, one account chain — so every test
 * shares the worker and the module-level stamp, and each gets its own 90 s.
 * Every French string below is a fr-CA value (packages/i18n/src/locales/
 * fr-CA.ts); the key is named beside the first use of each.
 *
 * Gate verdicts covered (adminAccess in features/admin/access.ts has seven):
 * `denied` (T1), `mfa` (T2, T5), `ok` (T3, T5) — plus one capability
 * variant of `ok`, billing against super admin. Deferred, each with its
 * reason, so widening the scope is a visible deletion here rather than a
 * memory:
 *   - `reauth`: needs a console session older than ADMIN_SESSION_MAX_AGE_HOURS
 *     (default 12 h, apps/api/src/env.ts) — unreachable in a 90 s test
 *     without clock control.
 *   - `impersonating`: F-71's ImpersonationWall, its own journey.
 *   - `error`: the probeError panel with its retry needs a forced 5xx or a
 *     network failure mid-session, which the suite has no clean producer
 *     for; the adminAccess mapping itself is unit-covered.
 *   - Every console WRITE except the one /admin/staff grant in T4: kill
 *     switches are global singleton rows behind a process-wide cache shared
 *     by every parallel worker; announcements carry no organization_id, so
 *     one published here reaches every user on the database; the DLQ needs
 *     a failed job and nothing in the suite produces one; the fan-out worker
 *     is SIGTERM'd by an earlier CI step, so a bell assertion could only
 *     time out.
 *   - The other /admin routes: tenant detail, tenant new (F-70), tenant
 *     usage (F-73), support sessions and one session (F-71), announcements,
 *     compose and one announcement (F-72), platform settings, queues and one
 *     queue's failed set (F-73). This file opens /admin, /admin/tenants and
 *     /admin/staff.
 */

/**
 * Pinned, and the pin's whole value is making three breakpoint facts
 * explicit — Playwright's default is already 1280×720, so this is not about
 * escaping a framework default:
 *   - ≥1024 px: app/admin-layout.tsx renders the console nav TWICE, both
 *     with aria-label « Console plateforme » — the sidebar (`hidden … lg:flex`)
 *     and the bottom bar (`lg:hidden`). At lg exactly one is in the
 *     accessibility tree, so the role locator is unique WITHOUT `.first()`
 *     (which would mask both becoming visible). The six-link count is a
 *     breakpoint fact too: the bottom bar's <nav> CONTAINS the
 *     « Retour à l’application » link where the sidebar's has it as a
 *     sibling — below lg the count would be seven.
 *   - ≥640 px: the tenant topbar's Console link (app/layout.tsx,
 *     `hidden … sm:inline`) and the console's role chip (`hidden … sm:flex`)
 *     are display:none below sm; T3 and T5 assert both.
 */
test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f74';
/** A: the bootstrapped super admin. B: granted platform_billing from the console. */
const A = { name: 'Ada Plateforme', email: `f74-${stamp}@1dealer.test` };
const B = { name: 'Bao Facturation', email: `f74b-${stamp}@1dealer.test` };
/** T1 creates it; T3 finds it in the directory by this unique slug. */
const org = { name: `Groupe F74 ${stamp}`, slug: `groupe-f74-${stamp}` };
/** admin:navTenants … navStaff, in adminNavItems() render order. */
const NAV_ALL = ['Locataires', 'Sessions de soutien', 'Annonces', 'Interrupteurs', 'Files de travaux', 'Équipe'];
const NAV_GATED = NAV_ALL.slice(1);

/** A's TOTP secret once T3 has enrolled it — T4's login needs the challenge. */
let secretA = '';

async function signUp(page: Page, who: { name: string; email: string }): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(who.name);
  await page.getByLabel('Courriel').fill(who.email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');
}

/** Password login; with a secret, also answers the TOTP challenge (F-41's screens). */
async function logIn(page: Page, email: string, secret?: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  if (secret) {
    await expect(page.getByText('Vérification en deux étapes')).toBeVisible();
    await page.getByLabel('Code de vérification').fill(totp(secret));
    await page.getByRole('button', { name: 'Vérifier', exact: true }).click();
  }
  await expect(page).toHaveURL('/');
}

/** Enrol TOTP on /security exactly as f41-two-factor does; returns the secret. */
async function enrolTotp(page: Page): Promise<string> {
  await page.goto('/security');
  await expect(page).toHaveTitle(/Sécurité du compte — /);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Générer la clé' }).click();
  const secret = (await page.getByLabel('Clé secrète').innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);
  await page.getByLabel('Premier code').fill(totp(secret));
  await page.getByRole('button', { name: 'Vérifier et activer' }).click();
  await expect(page.getByText('La double authentification est active.')).toBeVisible();
  return secret;
}

/** The console nav — admin:consoleName; unique at the pinned viewport (see above). */
const consoleNav = (page: Page) => page.getByRole('navigation', { name: 'Console plateforme' });
/**
 * The tenant topbar's link to the console — nav:console. `exact: true` is
 * load-bearing: admin:consoleName is « Console plateforme », and a non-exact
 * match would hit both.
 */
const topbarConsoleLink = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Console', exact: true });
/** admin:mfaWallTitle — the wall's h1. */
const mfaWall = (page: Page) => page.getByRole('heading', { level: 1, name: 'Double authentification requise' });

test('T1 — the console does not exist for someone who is not staff', async ({ page, browser }) => {
  await signUp(page, A);
  // A's organization: the known directory row T3 searches for.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name);
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page.getByRole('heading', { name: org.name })).toBeVisible();

  // Not staff: the index AND a child route both send you home — the gate
  // wraps the whole /admin subtree, not just its index.
  await page.goto('/admin');
  await expect(page).toHaveURL('/');
  await page.goto('/admin/tenants');
  await expect(page).toHaveURL('/');
  // The topbar has rendered (a sibling link is visible) before the absence
  // is asserted — a count of zero on an unrendered banner proves nothing.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sécurité du compte' })).toBeVisible();
  await expect(topbarConsoleLink(page)).toHaveCount(0);

  // B exists from here on, so T4's console grant has an account to name
  // (the grant refuses an unknown email — PA008 → admin:needsAccount). B does
  // nothing else until T5.
  const ctx = await browser.newContext();
  await signUp(await ctx.newPage(), B);
  await ctx.close();
});

test('T2 — staff without TOTP meet the wall, and only the wall', async ({ page }) => {
  // The one-shot, spent here and nowhere else in the suite.
  bootstrapSuperAdmin(A.email);

  // Password alone: A is not enrolled, so there is no challenge to answer.
  await logIn(page, A.email);
  await page.goto('/admin');
  await expect(mfaWall(page)).toBeVisible();
  // admin:mfaWallLink
  await expect(page.getByRole('link', { name: 'Activer sur la page Sécurité' })).toBeVisible();
  // Only the wall: no console nav, no directory heading (admin:tenantsTitle).
  await expect(consoleNav(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Locataires' })).toHaveCount(0);
});

test("T3 — TOTP opens the door, and the nav is the super admin's", async ({ page }) => {
  await logIn(page, A.email);
  secretA = await enrolTotp(page);

  // router.tsx: /admin's index redirects to the directory.
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/tenants');
  await expect(page.getByRole('heading', { level: 1, name: 'Locataires' })).toBeVisible();
  // toHaveText(array) asserts count AND order — the sequence adminNavItems()
  // renders for a role holding every gated capability.
  await expect(consoleNav(page).getByRole('link')).toHaveText(NAV_ALL);
  // admin:role_platform_super_admin — the role chip in the console header.
  await expect(page.getByRole('banner').getByText('Super administrateur', { exact: true })).toBeVisible();

  // The directory shows a real tenant, found DETERMINISTICALLY: every other
  // spec creates organizations against this same fresh database in
  // parallel, so "the newest row" is not ours. The page's own search
  // (admin:searchLabel / admin:searchButton) by the unique slug is the
  // directory's own claim about this tenant, immune to other workers.
  await page.getByLabel('Rechercher (nom, identifiant, raison sociale)').fill(org.slug);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect(page).toHaveURL(/\?q=groupe-f74-/);
  const rows = page.getByRole('row').filter({ hasText: org.slug });
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole('link', { name: org.name })).toBeVisible();

  // A FULL load, not a click: the topbar link is driven by /me's
  // platform_role, which react-query caches — a client-side navigation
  // could serve a probe from before the grant.
  await page.goto('/');
  await expect(topbarConsoleLink(page)).toBeVisible();
  await expect(topbarConsoleLink(page)).toHaveAttribute('href', '/admin');
});

test('T4 — the console mints the second staffer', async ({ page }) => {
  // A is enrolled now: the login answers the challenge with T3's secret.
  await logIn(page, A.email, secretA);
  await page.goto('/admin/staff');
  // admin:staffTitle
  await expect(page.getByRole('heading', { level: 1, name: 'Équipe plateforme' })).toBeVisible();

  // The grant form, driven through its <Label htmlFor> pairs (staff-email /
  // staff-role). `exact` guards against a future label that merely CONTAINS
  // « Courriel » or « Rôle » (admin:ownerEmail « Courriel du propriétaire »
  // and admin:rolesLabel « Rôles » exist on sibling console pages). The
  // table's column headers are <th>, not labels — getByLabel never sees them.
  await page.getByLabel('Courriel', { exact: true }).fill(B.email);
  // admin:role_platform_billing — chosen over support because it holds none
  // of the five gated capabilities: one nav item against six.
  await page.getByLabel('Rôle', { exact: true }).selectOption({ label: 'Facturation' });
  await page.getByRole('button', { name: 'Accorder' }).click();
  // admin:granted, verbatim. Its siblings — « Accès rétabli. » (reinstated),
  // « Rôle modifié. » (role_changed), « Aucun changement. » (unchanged) —
  // each mean B already held a grant, i.e. the database was NOT fresh, and
  // must fail this line loudly rather than pass a looser match.
  // (The page keeps an EMPTY role=status node until a message lands — the
  // non-empty filter keeps the locator strict rather than ambiguous.)
  await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveText('Accès accordé.');
  // The register reflects the write: B's row, with the billing role.
  await expect(page.getByRole('row').filter({ hasText: B.email })).toContainText('Facturation');
});

test('T5 — a billing staffer gets the tenants nav and nothing else', async ({ page }) => {
  await logIn(page, B.email);
  // The wall is per ACCOUNT, not a global flag: B is staff now and still
  // unenrolled, so B meets it exactly as A did.
  await page.goto('/admin');
  await expect(mfaWall(page)).toBeVisible();
  await enrolTotp(page);

  await page.goto('/admin');
  // A billing staffer DOES hold tenants:read — the directory opens.
  await expect(page).toHaveURL('/admin/tenants');
  await expect(page.getByRole('heading', { level: 1, name: 'Locataires' })).toBeVisible();
  // The half that can fail under mutation: delete one capability guard in
  // adminNavItems() and this list grows. Count and order, then each gated
  // name absent by name — so the failure says WHICH item leaked.
  await expect(consoleNav(page).getByRole('link')).toHaveText(['Locataires']);
  for (const name of NAV_GATED) {
    await expect(consoleNav(page).getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  // admin:role_platform_billing
  await expect(page.getByRole('banner').getByText('Facturation', { exact: true })).toBeVisible();
});
