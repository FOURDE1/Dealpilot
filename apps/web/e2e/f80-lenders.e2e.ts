import { expect, test, type Page } from '@playwright/test';

/**
 * F-80 — the lender registry, and the deal that names its lender (R9, A6,
 * A17; manifest tests 1–5).
 *
 * The claim worth an e2e: a freshly-born organization already owns the full
 * 18-lender registry, the desking « Prêteur » pick lands on the pipeline card
 * and the lead line by NAME (short form on the card, full form on the line),
 * and deactivation is honest history — an existing deal keeps its lender and
 * re-saves (the f05 grandfather clause), while a NEW deal's Select no longer
 * offers it. Plus the two refusal shapes: the exact-name duplicate 409 under
 * the name field (A6 — uniqueness is case-SENSITIVE, so the probe re-submits
 * the IDENTICAL string), and the salesperson's read-only page that fires no
 * write request at all.
 *
 * Serial by design (A17): test 3's deal is the one test 4 reopens, and test
 * 2/4's registry edits feed test 5's read-only walk — the ORDER is binding,
 * so the mode is set explicitly (config alone guarantees nothing). Fresh
 * `f80-${stamp}` organization, own owner, retries 0, no database literal.
 * Every French string is the fr-CA reference value, grepped in fr-CA.ts
 * before use; the key is named beside each.
 *
 * Test 5's zero-request assertion counts WRITE requests only — POST/PATCH,
 * the only verbs the lender routes (and this page) can emit; the member list
 * GET is lawful (R6: the list answers 200 for every persona, so the
 * zero-request law is silent about reads).
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f80';
const owner = { name: 'Odile Bailleur', email: `f80-${stamp}@1dealer.test` };
const seller = { name: 'Vince Vendeur', email: `f80-vince-${stamp}@1dealer.test`, password: 'MotDePasse!2026-vince80' };
const org = { name: `Groupe F80 ${stamp}`, slug: `f80-${stamp}` };
const STORE = 'Succursale F80';
const LEAD1 = { first: 'Diane', last: 'Financée', phone: '+15145550180' };
const LEAD2 = { first: 'Rémi', last: 'Comptant', phone: '+15145550181' };
/** Test 2's own lender — added, duplicated EXACTLY (A6), edited, deactivated. */
const NEW_LENDER = 'Caisse Rivière-Rouge';
const REP_EMAIL = `rep-${stamp}@caisse.test`;

/** fr-CA strings the assertions read verbatim (key → value, both locales parity-guarded). */
const MSG = {
  /** lenders:nameTaken — the in-route 23505→409 rendered under the name field. */
  nameTaken: 'Ce nom de prêteur existe déjà pour votre organisation.',
  /** lenders:readOnly — the sentence a member without lender:manage reads. */
  readOnly: 'Vous pouvez consulter les prêteurs ; votre rôle ne permet pas de les modifier.',
} as const;

/** The four group headings, legacy-verbatim (lenders:category_PRIME..category_CAPTIVE, R12/A15). */
const CATEGORY_HEADINGS = ['Prime', 'Quasi-prime', 'Subprime', 'Captif (OEM)'] as const;

/** Filled by test 3; test 4 reopens this lead's deal. */
let lead1Url = '';

async function signUp(page: Page, who: { name: string; email: string }, pass: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(who.name); // auth:fullName
  await page.getByLabel('Courriel').fill(who.email); // auth:email
  await page.getByLabel('Mot de passe').fill(pass); // auth:password
  await page.getByRole('button', { name: 'Créer le compte' }).click(); // auth:signUpAction
  await expect(page).toHaveURL('/');
}

async function logIn(page: Page, email: string, pass: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(pass);
  await page.getByRole('button', { name: 'Se connecter' }).click(); // auth:signInAction
  await expect(page).toHaveURL('/');
}

async function createLead(page: Page, lead: { first: string; last: string; phone: string }): Promise<void> {
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: STORE }); // leads:store
  await page.getByLabel('Téléphone').fill(lead.phone); // leads:phone
  await page.getByLabel('Prénom').fill(lead.first); // leads:firstName
  await page.getByLabel('Nom de famille').fill(lead.last); // leads:lastName
  await page.getByRole('button', { name: 'Créer le prospect' }).click(); // leads:create
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: `${lead.first} ${lead.last}` })).toBeVisible();
}

/** The desking « Prêteur » Select (deals:lenderLabel; exact — the pipeline renders « Prêteur : … » too). */
const lenderSelect = (page: Page) => page.getByLabel('Prêteur', { exact: true });

/** A registry row: the <li> naming the lender inside its category section. */
const lenderRow = (page: Page, name: string | RegExp) => page.locator('li').filter({ hasText: name });

test('1 — the registry is born full: the settings card, four legacy headings, Scotia with « SDA »', async ({ page }) => {
  await signUp(page, owner, password);
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name); // orgs:name
  await page.getByLabel('Identifiant (slug)').fill(org.slug); // orgs:slug
  await page.getByRole('button', { name: "Créer l'organisation" }).click(); // orgs:create
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  // A store now, so tests 3–4 can desk deals on this organization's leads.
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click(); // orgs:newStore
  await page.getByLabel('Nom de la succursale').fill(STORE); // orgs:storeName
  await page.getByLabel('Code').fill(`F80-${stamp % 10000}`); // orgs:storeCode
  await page.getByRole('button', { name: 'Créer la succursale' }).click(); // orgs:createStore
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  // /settings lists the card (sections.ts entry, unconditional — the page is
  // member-readable); its link name starts with lenders:title.
  await page.goto('/settings');
  await page.getByRole('link', { name: /^Prêteurs/ }).click(); // lenders:title + settings:desc_lenders
  await expect(page).toHaveURL('/settings/lenders');
  await expect(page.getByRole('heading', { level: 1, name: 'Prêteurs' })).toBeVisible(); // lenders:title

  // Born full: the four groups in spec order, no seed step ever taken.
  for (const heading of CATEGORY_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  // One seeded row spot-checked with its legacy-verbatim short name (R1):
  // the page renders short_name as « SDA » beside the full name.
  const scotia = lenderRow(page, 'Scotia Dealer Advantage');
  await expect(scotia).toBeVisible();
  await expect(scotia.getByText('« SDA »')).toBeVisible();
});

test('2 — CRUD: add under Quasi-prime, the EXACT re-add refused under the name field, rep e-mail, deactivate', async ({ page }) => {
  await logIn(page, owner.email, password);
  await page.goto('/settings/lenders');
  await expect(page.getByRole('heading', { level: 1, name: 'Prêteurs' })).toBeVisible();

  // Add « Caisse Rivière-Rouge » under Quasi-prime.
  await page.getByLabel('Nom', { exact: true }).fill(NEW_LENDER); // lenders:nameLabel
  await page.getByLabel('Catégorie').selectOption({ label: 'Quasi-prime' }); // lenders:categoryLabel / category_NEAR_PRIME
  await page.getByRole('button', { name: 'Ajouter un prêteur' }).click(); // lenders:add
  const nearPrime = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Quasi-prime', exact: true }) });
  await expect(nearPrime.getByText(NEW_LENDER)).toBeVisible();

  // Re-add the IDENTICAL string (A6 — uniqueness is exact-name; a case
  // variant would be a second row, not this refusal): the 409 renders
  // lenders:nameTaken under the name field, and the row count stays one.
  await page.getByLabel('Nom', { exact: true }).fill(NEW_LENDER);
  await page.getByLabel('Catégorie').selectOption({ label: 'Quasi-prime' });
  await page.getByRole('button', { name: 'Ajouter un prêteur' }).click();
  await expect(page.locator('#lender-name-error')).toHaveText(MSG.nameTaken);
  await expect(nearPrime.getByText(NEW_LENDER)).toHaveCount(1);

  // Edit the rep e-mail through the row's own button (aria-label
  // « Modifier — <name> », lenders:edit) — the form flips to edit mode.
  await page.getByRole('button', { name: `Modifier — ${NEW_LENDER}` }).click();
  await expect(page.getByRole('heading', { name: `Modification de ${NEW_LENDER}` })).toBeVisible(); // lenders:editing
  await page.getByLabel('Courriel du représentant').fill(REP_EMAIL); // lenders:contactEmailLabel
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click(); // lenders:save
  await expect(lenderRow(page, NEW_LENDER).getByText(REP_EMAIL)).toBeVisible();

  // Deactivate → the inline « Inactif » chip (lenders:deactivate / lenders:inactive).
  await page.getByRole('button', { name: `Désactiver — ${NEW_LENDER}` }).click();
  await expect(lenderRow(page, NEW_LENDER).getByText('Inactif', { exact: true })).toBeVisible();
});

test('3 — the desking pick: « TD Auto Finance » saved, « Prêteur : TD » on the pipeline card, the full name on the lead line', async ({ page }) => {
  await logIn(page, owner.email, password);
  await createLead(page, LEAD1);
  lead1Url = new URL(page.url()).pathname;

  await page.getByRole('link', { name: 'Créer une transaction' }).click(); // deals:deskAction
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible(); // deals:title
  await page.getByLabel('Prix de vente').fill('30000'); // deals:salePrice

  // The « Prêteur » Select offers the registry grouped by category; the
  // empty option is deals:lenderNone.
  await expect(lenderSelect(page).getByRole('option', { name: 'Aucun prêteur' })).toHaveCount(1);
  await expect(lenderSelect(page).locator('optgroup[label="Prime"]')).toHaveCount(1);
  await lenderSelect(page).selectOption({ label: 'TD Auto Finance' });
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click(); // deals:save
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // The lead's deal line names the lender by FULL name (lead-detail render).
  await expect(page.getByText(/· TD Auto Finance$/)).toBeVisible();

  // The pipeline card: « Prêteur : TD » (deals:lenderOn with short_name)
  // inside the same card as the « Financement » control (deals:fundingLabel).
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pipeline des transactions' })).toBeVisible(); // deals:pipelineTitle
  const card = page
    .getByRole('region', { name: 'Nouvelle' }) // deals:stage_new column
    .locator('article')
    .filter({ has: page.getByRole('link', { name: `${LEAD1.first} ${LEAD1.last}` }) });
  await expect(card.getByLabel('Financement')).toBeVisible();
  await expect(card.getByText('Prêteur : TD', { exact: true })).toBeVisible();
});

test('4 — deactivation is honest history: the card keeps the name, the deal re-saves, a second deal cannot pick TD', async ({ page }) => {
  await logIn(page, owner.email, password);

  // Deactivate « TD Auto Finance » in the registry.
  await page.goto('/settings/lenders');
  await page.getByRole('button', { name: 'Désactiver — TD Auto Finance' }).click();
  await expect(lenderRow(page, /^TD Auto Finance/).getByText('Inactif', { exact: true })).toBeVisible();

  // The pipeline card STILL says « Prêteur : TD » — history keeps its name.
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const card = page
    .getByRole('region', { name: 'Nouvelle' })
    .locator('article')
    .filter({ has: page.getByRole('link', { name: `${LEAD1.first} ${LEAD1.last}` }) });
  await expect(card.getByText('Prêteur : TD', { exact: true })).toBeVisible();

  // Reopen the deal: the Select holds the pick, suffixed (deals:lenderInactiveSuffix)…
  await page.goto(lead1Url);
  await page.getByRole('link', { name: /Modifier la transaction/ }).click(); // deals:editDealFor aria-label
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible();
  await expect(lenderSelect(page).locator('option:checked')).toHaveText('TD Auto Finance (inactif)');

  // …and the unchanged re-save is LAWFUL (the f05 grandfather clause): the
  // PATCH answers 200, not 422 lender_inactive.
  const patched = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && res.url().includes('/api/v1/deals/'),
  );
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click(); // deals:saveChanges
  expect((await patched).status()).toBe(200);
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByText(/· TD Auto Finance$/)).toBeVisible();

  // A SECOND deal is a NEW pick: its Select no longer offers TD — under
  // either label. exact:true matters: « TD Non-Prime (TD Auto Finance
  // Special) » must keep matching as the positive control that the
  // Quasi-prime group really loaded (absence is only proof beside presence).
  await createLead(page, LEAD2);
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible();
  await expect(lenderSelect(page).getByRole('option', { name: 'RBC Royal Bank', exact: true })).toHaveCount(1);
  await expect(
    lenderSelect(page).getByRole('option', { name: 'TD Non-Prime (TD Auto Finance Special)', exact: true }),
  ).toHaveCount(1);
  await expect(lenderSelect(page).getByRole('option', { name: 'TD Auto Finance', exact: true })).toHaveCount(0);
  await expect(
    lenderSelect(page).getByRole('option', { name: 'TD Auto Finance (inactif)', exact: true }),
  ).toHaveCount(0);
});

test('5 — the salesperson reads the registry and cannot write it: no controls, and zero write requests', async ({ page }) => {
  // Invite « Vince Vendeur » with the default « Vendeur » role — the f76 T4
  // pattern: the dev mailer hands the owner the link (team:inviteLink).
  await logIn(page, owner.email, password);
  await page.goto('/team');
  await page.getByLabel('Nom', { exact: true }).fill(seller.name); // team:name
  await page.getByLabel('Courriel').fill(seller.email); // team:email
  await page.getByRole('button', { name: 'Inviter', exact: true }).click(); // team:invite
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible(); // team:emailNotSent (prefix)
  const token = (await page.getByLabel('Lien d’invitation').inputValue()).split('/').pop() ?? ''; // team:inviteLink
  expect(token).not.toBe('');
  await page.getByRole('button', { name: 'Se déconnecter' }).click(); // common:signOut
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`/invitations/${token}`);
  await page.getByLabel('Nom complet').fill(seller.name); // invitations:fullName
  await page.getByLabel('Mot de passe').fill(seller.password); // invitations:password
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click(); // invitations:createAndAccept
  await expect(page).toHaveURL('/');

  // From here, count every WRITE the browser attempts against the API.
  // POST/PATCH only (the manifest's ruling): they are the only verbs the
  // lender surface has — no DELETE route or grant exists (R15) — and the
  // member list GET is lawful (R6).
  const writes: string[] = [];
  page.on('request', (request) => {
    const method = request.method();
    if ((method === 'POST' || method === 'PATCH') && request.url().includes('/api/')) {
      writes.push(`${method} ${request.url()}`);
    }
  });

  // The card is listed for a salesperson too (member-readable page)…
  await page.goto('/settings');
  await page.getByRole('link', { name: /^Prêteurs/ }).click();
  await expect(page).toHaveURL('/settings/lenders');
  // …with the read-only sentence and the full list, tests 2/4's edits included.
  await expect(page.getByText(MSG.readOnly)).toBeVisible();
  for (const heading of CATEGORY_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  const scotia = lenderRow(page, 'Scotia Dealer Advantage');
  await expect(scotia.getByText('« SDA »')).toBeVisible();
  await expect(lenderRow(page, /^TD Auto Finance/).getByText('Inactif', { exact: true })).toBeVisible();

  // No write control anywhere: no form, no add/edit/deactivate/reactivate.
  await expect(page.locator('#lender-name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ajouter un prêteur' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Modifier — / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Désactiver — / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Réactiver — / })).toHaveCount(0);

  // And the page FIRED no write — the zero-request law's e2e half.
  expect(writes).toEqual([]);
});
