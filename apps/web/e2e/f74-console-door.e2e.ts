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
 * Serial by necessity — one bootstrap, one account chain — so every test of
 * T1–T7 shares the worker and the module-level stamp, and each gets its own
 * 90 s. Every French string below is a fr-CA value (packages/i18n/src/
 * locales/fr-CA.ts); the key is named beside the first use of each.
 *
 * Gate verdicts covered (adminAccess in features/admin/access.ts has seven):
 * `denied` (T1), `mfa` (T2, T5), `ok` (T3, T5, T6, T7) — plus one capability
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
 *     one published here reaches every user on the database; the DLQ RETRY
 *     needs a failed job and nothing in the suite produces one (the empty
 *     failed set IS visited); the fan-out worker is SIGTERM'd by an earlier
 *     CI step, so a bell assertion could only time out. T1's store and
 *     intake key are TENANT-side producers, not console writes; the one
 *     console write is still T4's grant.
 *   - Routes. Opened by this file: /admin, /admin/tenants and /admin/staff
 *     (T1–T4); one tenant's detail, usage and snapshot (T6, F-77);
 *     /admin/support-sessions, /admin/announcements, /admin/platform-settings,
 *     /admin/queues, /admin/queues/deferred-send and the `*` catch-all (T7).
 *     Still deferred, each a write or a page only a write can populate:
 *     tenant new (F-70), one support session (F-71), announcement compose
 *     and one announcement (F-72). Counted against router.tsx's /admin
 *     children rather than remembered (D-075's « twelve other /admin/* routes »
 *     — docs/DECISIONS.md — is eleven named children plus `*`; this header's
 *     old bullet listed the eleven names and no count): after F-74, eleven
 *     named children plus `*` remained unopened; F-77 opens seven of the
 *     eleven, plus `*`, plus the new snapshot route, and leaves four.
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
/**
 * T1 also gives the org one store and one intake key, through the tenant's
 * own screens (F-77): an org alone has no rooftop and no key, and every
 * rooftop and key assertion in T6 would be vacuous without them. The code is
 * `F74-` plus four decimal digits — nothing hex-shaped for T6's scan to trip on.
 */
const STORE = { name: 'Succursale F74', code: `F74-${String(stamp % 10000).padStart(4, '0')}` };
const KEY_LABEL = 'Formulaire F74';
/** admin:navTenants … navStaff, in adminNavItems() render order. */
const NAV_ALL = ['Locataires', 'Sessions de soutien', 'Annonces', 'Interrupteurs', 'Files de travaux', 'Équipe'];
const NAV_GATED = NAV_ALL.slice(1);

/** A's TOTP secret once T3 has enrolled it — T4's and T7's logins need the challenge. */
let secretA = '';
/** B's TOTP secret once T5 has enrolled it — T6 logs in as B. */
let secretB = '';
/**
 * The credential pair T1 copies from the one-time reveal: the token is the
 * webhook URL's last path segment, the secret its own field. T6 proves the
 * snapshot shows neither — by exact value, and by shape.
 */
let intakeToken = '';
let intakeSecret = '';
/** The org's tenant id, read from the detail page's URL in T6. */
let tenantId = '';

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

  // The create mutation navigates (replace) after its POST resolves; a click
  // during that remount is silently lost (the f03/f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  // One store, through the tenant's own form. Nothing typed but name and
  // code: the timezone stays the create form's default (America/Montreal,
  // store-form-page.tsx:61), no texting number is recorded (→ null) and no
  // hours are set — each a fact T6 reads back off the snapshot.
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click(); // orgs:newStore
  await page.getByLabel('Nom de la succursale').fill(STORE.name); // orgs:storeName
  // orgs:storeCode is the bare word « Code »; `exact` keeps a future label
  // that merely contains it from making this line ambiguous.
  await page.getByLabel('Code', { exact: true }).fill(STORE.code);
  await page.getByRole('button', { name: 'Créer la succursale' }).click(); // orgs:createStore
  // One intake key on that store — the credential T6 proves the console
  // never shows. intake:title carries a STRAIGHT apostrophe in the bundle.
  await page.getByRole('link', { name: STORE.name }).click();
  await expect(page.getByRole('heading', { name: "Sources d'admission" })).toBeVisible();
  await page.getByLabel('Nom de la source').fill(KEY_LABEL); // intake:label
  await page.getByRole('button', { name: 'Créer la clé' }).click(); // intake:create
  // intake:createdTitle — the one-time reveal: the webhook URL first (the
  // token is its last path segment), the secret second — the two CopyFields
  // of intake-sources.tsx, the page's only <code> elements.
  await expect(page.getByText('copiez ces valeurs MAINTENANT', { exact: false })).toBeVisible();
  const codes = page.locator('code');
  const webhookUrl = ((await codes.nth(0).textContent()) ?? '').trim();
  intakeToken = webhookUrl.slice(webhookUrl.lastIndexOf('/') + 1);
  intakeSecret = ((await codes.nth(1).textContent()) ?? '').trim();
  // The shapes the API mints (f03-intake-routes.ts:50-55: 16 random bytes
  // as base64url, 32 as hex), pinned BEFORE any negative is asserted: T6's
  // « never shown » is a claim about a 64-hex secret, and a changed shape
  // must fail here loudly rather than turn that absence into a tautology.
  expect(intakeSecret).toMatch(/^[0-9a-f]{64}$/);
  expect(intakeToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await page.getByRole('button', { name: 'Terminé' }).click(); // intake:done

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
  secretB = await enrolTotp(page);

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

test('T6 — a billing staffer reads one tenant: detail, usage, and a snapshot that shows no credential', async ({ page }) => {
  // B, the floor role: tenants:read and nothing gated. The snapshot has no
  // nav slot (B's nav is « Locataires » only, T5) and no capability of its
  // own — it hangs off the tenant page, and the most restricted role reaches
  // it. A future gate on the link or the route reddens here.
  await logIn(page, B.email, secretB);

  // (1) The tenant DETAIL. The directory reads `q` from the URL
  // (tenant-directory-page.tsx:35), so the search is a goto — immune to the
  // form's remount, and still the directory's own claim about this tenant.
  await page.goto(`/admin/tenants?q=${org.slug}`);
  await page.getByRole('row').filter({ hasText: org.slug }).getByRole('link', { name: org.name }).click();
  await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: org.name })).toBeVisible();
  const detailUrl = page.url();
  tenantId = detailUrl.slice(detailUrl.lastIndexOf('/') + 1);

  // (2) USAGE, as billing — usage:title, usage:gaugesHeading.
  await page.getByRole('link', { name: 'Utilisation', exact: true }).click(); // admin:navUsage
  await expect(page).toHaveURL(/\/usage$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Utilisation' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Taille du locataire' })).toBeVisible();

  // (3) The SNAPSHOT, reached the only way it can be: the link beside
  // « Utilisation » on the tenant page. Link, h1 and tab share snapshot:title.
  await page.goto(`/admin/tenants/${tenantId}`);
  await expect(page.getByRole('link', { name: 'Utilisation', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Instantané', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Instantané', exact: true }).click();
  await expect(page).toHaveURL(`/admin/tenants/${tenantId}/snapshot`);
  await expect(page).toHaveTitle(/^Instantané — /);
  await expect(page.getByRole('heading', { level: 1, name: 'Instantané' })).toBeVisible();

  // (4) Rooftops — the « Succursales » region (admin:storesTitle), scoped
  // because the key table below also names the store. T1 typed no timezone,
  // no number and no hours, so every cell here is the create form's default
  // read back: the IANA name; the texting cell's bare « — », found by its
  // own text rather than by column index (a reordered column is a design
  // choice, not a regression); settings:hoursUnset; snapshot:trafficCell
  // with its zeros as words; snapshot:noMessage30d.
  const rooftops = page.getByRole('region', { name: 'Succursales', exact: true });
  const rooftop = rooftops.getByRole('row').filter({ hasText: STORE.name });
  await expect(rooftop).toHaveCount(1);
  await expect(rooftop).toContainText('America/Montreal');
  await expect(rooftop.getByRole('cell').filter({ hasText: /^—$/ })).toHaveCount(1);
  await expect(rooftop).toContainText('Non définies');
  await expect(rooftop).toContainText('0 entrants · 0 sortants · 0 livrés');
  await expect(rooftop).toContainText('Aucun message en 30 jours');

  // (5) The key T1 minted — the « Sources d'admission » region (intake:title,
  // straight apostrophe). The page LISTS the row whose credential exists:
  // intake:provider_generic_json, snapshot:keyActive, admin:never, and the
  // store's NAME (a join over the same body — never its id). The negatives
  // in (7) are about this row.
  const keys = page.getByRole('region', { name: "Sources d'admission", exact: true });
  const key = keys.getByRole('row').filter({ hasText: KEY_LABEL });
  await expect(key).toHaveCount(1);
  await expect(key).toContainText('Webhook JSON générique');
  await expect(key).toContainText('Active');
  await expect(key).toContainText('Jamais');
  await expect(key).toContainText(STORE.name);

  // (6) The honest empty states, each the whole text of its own element:
  // settings:defaultsNotice (no Automatisations row was ever saved),
  // snapshot:brandNone, snapshot:connectors in its =0 form, and the dashed
  // last card — snapshot:platformHeading with snapshot:transportSms inside.
  await expect(page.getByText('Aucune configuration enregistrée', { exact: false })).toBeVisible();
  await expect(page.getByText('Aucune image de marque', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucun connecteur actif', { exact: true })).toBeVisible();
  const platformHeading = 'Plateforme — identique pour tous les locataires';
  await expect(page.getByRole('heading', { level: 2, name: platformHeading, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: platformHeading, exact: true })).toContainText('Transport SMS');

  // (7) The credential block. `#main` (app/admin-layout.tsx:93) is the page
  // without the banner and the nav. The exact values first — the token is
  // not hex-shaped, so only its value can catch it, and the HTML pass catches
  // an attribute leak the text pass cannot see. The 32-hex regex runs over
  // the TEXT only (HTML carries hashes and data URIs) and adds what the
  // exact values cannot: another key's secret, a re-projected hash, a
  // definer that grew a credential column. No false positive can come from
  // the page itself: UUIDs are dashed (longest run 12), `stamp` is decimal,
  // the store code is `F74-nnnn`, dates are Intl text.
  const text = await page.locator('#main').innerText();
  const html = await page.content();
  expect(text).toContain(KEY_LABEL);
  expect(text).not.toContain(intakeSecret);
  expect(text).not.toContain(intakeToken);
  expect(html).not.toContain(intakeSecret);
  expect(html).not.toContain(intakeToken);
  expect(text).not.toMatch(/[0-9a-f]{32}/i);
});

test('T7 — the read-only console pages, and the catch-all', async ({ page }) => {
  // A holds every gated capability; one login for the five gated pages.
  await logIn(page, A.email, secretA);

  // Support sessions (F-71) — admin:impersonationTitle, admin:noSessions.
  // Empty deterministically: only platform staff can start one, and the
  // only staff in the run are A and B, in this serial file (no other spec
  // under apps/web/e2e names /admin).
  await page.goto('/admin/support-sessions');
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions de soutien' })).toBeVisible();
  await expect(page.getByText('Aucune session.', { exact: true })).toBeVisible();

  // Announcements (F-72) — announcements:title, announcements:empty. Same
  // reason: only staff can publish, and nothing here does.
  await page.goto('/admin/announcements');
  await expect(page.getByRole('heading', { level: 1, name: 'Annonces' })).toBeVisible();
  await expect(page.getByText('Aucune annonce.', { exact: true })).toBeVisible();

  // Platform settings — switches:title; each switch is its own section
  // headed by its name (switches:sms_send_killswitch / ai_outbound_killswitch).
  await page.goto('/admin/platform-settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Interrupteurs de la plateforme' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Arrêt des SMS sortants', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Arrêt des messages générés par l’IA', exact: true })).toBeVisible();
  // switches:off « Envoi normal » has two producers on this page: the
  // per-switch state chip (platform-settings-page.tsx:89, `t(setting.enabled
  // ? 'on' : 'off')`) and the post-flip notice (:75, `t(resuming ? 'off' :
  // 'on')`). Both switches are seeded off (0068:81) and no other spec names
  // /admin, platform_settings or a killswitch, so a count of exactly 2 also
  // proves no switch was flipped in this run.
  await expect(page.getByText('Envoi normal', { exact: true })).toHaveCount(2);

  // Queues (F-73) — jobs:title, jobs:subtitle; the state word is jobs:state_ok.
  await page.goto('/admin/queues');
  await expect(page.getByRole('heading', { level: 1, name: 'Files de travaux' })).toBeVisible();
  await expect(page.getByText('Vue plateforme — ces files servent tous les locataires.', { exact: true })).toBeVisible();
  // « Joignable » is deterministic by the runner's own contract: it refuses
  // to start without a Redis PING (scripts/e2e.mjs:299-306) and hands the
  // API the same REDIS_URL — this line is the suite's only browser proof
  // that the API under test holds the runner's Redis. Its premise is the
  // API's per-queue read budget, QUEUE_READ_TIMEOUT_MS = 1500 ms
  // (apps/api/src/queue-inspector.ts:40, :385-387): a red here means the
  // shared API process could not answer a getJobCounts inside 1.5 s under
  // 4 workers, and is investigated (the API log carries
  // `queue_inspector_read_timed_out`), never re-run as flakiness.
  const deferred = page.getByRole('row').filter({ hasText: 'Envois différés' }); // jobs:queue_deferred-send
  await expect(deferred).toContainText('Joignable');
  // One queue's failed set. Empty deterministically: within apps/api/src,
  // `new Worker(` appears only in f73-queue-inspector.test.ts (:88, :136);
  // the real processors live in apps/workers/src/index.ts (:270, :301,
  // :358), and scripts/e2e.mjs step 7 (:373-399) spawns apps/api/dist/
  // index.js alone — no workers process runs during a run, so no job can
  // reach the failed set during a run. And the runner's Redis (shared with
  // the dev stack and the vitest gate, never cleared — the runner resets the
  // database, not Redis) carries no failed `deferred-send` job from an
  // earlier process: no test in the tree fails one (the deferred-send test
  // Worker at apps/workers/src/queue-roundtrip.test.ts:130 only records the
  // job; the Workers that DO fail jobs, f73-queue-inspector.test.ts:88/:136,
  // do so on qa-review and lead-reassign and wipe them in afterAll), and the
  // local dev stack starts no processor — apps/workers has no dev script
  // (PROJECT.md), so a failed job there needs a hand-run workers process
  // pointed at :6381. A red here with a clean API log means Redis state
  // OLDER than this run — inspect with `docker exec dealpilot-redis
  // redis-cli --scan --pattern 'dealpilot:deferred-send:failed'` (BullMQ
  // key `<QUEUE_PREFIX>:<queue>:failed`, packages/contracts/src/queues.ts:40;
  // the set exists only while it is non-empty). Clearing Redis in the runner
  // is a follow-up for D-078 (9). The retry — the write — stays untested.
  await deferred.getByRole('link', { name: 'Envois différés' }).click();
  await expect(page).toHaveURL(/\/admin\/queues\/deferred-send$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Travaux en échec — Envois différés' })).toBeVisible(); // jobs:dlqTitle
  await expect(page.getByText('Aucun travail en échec dans cette file.', { exact: true })).toBeVisible(); // jobs:dlqEmpty

  // The `*` child (router.tsx): an unknown console path lands on the
  // directory, not on the tenant app's 404.
  await page.goto('/admin/nope');
  await expect(page).toHaveURL('/admin/tenants');
});
