import { expect, test, type Page } from '@playwright/test';

/**
 * F-81 — the lender submissions ledger, and « Choisir cette approbation »
 * (D-082; manifest tests 1–6, amendments A9/A12/A13/A24).
 *
 * The claim worth an e2e: on the desking worksheet of a saved deal, what each
 * lender ANSWERED is logged by hand under « Soumissions aux prêteurs »; an
 * approval, once chosen, rewrites the worksheet's rate / term / « Prêteur »
 * fields on screen — and the very next « Enregistrer les modifications »
 * re-sends THOSE values, so a reopen still shows them (the stale-form proof:
 * a clobber would show 4,99 / 48 again). Exactly one approval carries the
 * star at a time; a conditional answer cannot be chosen until its conditions
 * are ticked and it is approved; the pipeline card names the chosen lender;
 * and a member without deal:update (« Agent BDC ») reads the ledger with no
 * control and fires no write.
 *
 * Serial by design: test 1's deal is the one every later test reopens, and
 * test 4's flip feeds tests 5–6 — the ORDER is binding, so the mode is set
 * explicitly. Fresh `f81-${stamp}` organization, own owner, retries and the
 * 90 s ceiling are playwright.config.ts's (never re-set here). Every French
 * string is the fr-CA reference value, grepped in fr-CA.ts before use; the
 * key is named beside each. Lender names are the seeded registry's, matched
 * EXACTLY (A12): the seeds carry both 'Scotiabank' and 'Scotia Dealer
 * Advantage', both 'TD Auto Finance' and 'TD Non-Prime (TD Auto Finance
 * Special)'.
 *
 * Input assertions read the DOT form ('6.99', the prefill idiom) — the comma
 * form (« 6,99 % ») is only the rendered percent, asserted by regex because
 * Intl emits a narrow no-break space before « % » and inside « 28 000 ».
 * Every badge / chip / control assertion is scoped to the panel's region
 * (A13): « Soumise » / « Approuvée » are ALSO the deal's stage labels
 * elsewhere in the app.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f81';
const owner = { name: 'Olivier Financier', email: `f81-${stamp}@1dealer.test` };
/** The read-only persona (A9): « Agent BDC » with « Vendeur » UNTICKED — no deal:update. */
const agent = { name: 'Bianca Bédard', email: `f81-bianca-${stamp}@1dealer.test`, password: 'MotDePasse!2026-bianca81' };
const org = { name: `Groupe F81 ${stamp}`, slug: `f81-${stamp}` };
const STORE = 'Succursale F81';
const LEAD = { first: 'Chantal', last: 'Approuvée', phone: '+15145550181' };

/** The three seeded lenders the journey names (A24) — full names, exact. */
const TD = 'TD Auto Finance';
const SCOTIA = 'Scotia Dealer Advantage';
const IA = 'iA Financial Group (Industrial Alliance)';

/** fr-CA strings the assertions read verbatim (key → value, both locales parity-guarded). */
const MSG = {
  /** deals:submSection — the region's accessible name. */
  section: 'Soumissions aux prêteurs',
  /** deals:submCreateModeHint — the only thing the panel says before the first save. */
  createMode: 'Enregistrez la transaction pour consigner les réponses des prêteurs.',
  /** deals:submEmptyCta — a writer's empty ledger. */
  emptyCta: 'Aucune soumission — consignez la première réponse d’un prêteur.',
  /** deals:submReadOnly — the sentence a member without deal:update reads. */
  readOnly: 'Vous pouvez consulter les soumissions ; votre rôle ne permet pas de les consigner.',
  /** deals:submSelected — the ★ chip on the chosen row. */
  selected: 'Approbation choisie',
  /** deals:submSelectErr_submission_not_approved — the disabled button's reason on a « Soumise » row. */
  notApproved: 'Seule une approbation peut être choisie.',
  /** deals:submConditionalHint — the disabled button's reason on a « Conditionnelle » row. */
  conditionalHint: 'Approuvez la soumission — conditions remplies — avant de la choisir.',
  /** deals:submAppliedLine (prefix) — the aria-live line a select writes and a hand edit retires. */
  appliedPrefix: 'Modalités du prêteur appliquées à la feuille de calcul',
  /** deals:submDeskDiffers — must NOT render after a same-tab select (A7). */
  deskDiffers: 'La feuille de calcul ne correspond plus à l’approbation choisie — choisissez-la de nouveau pour la réappliquer.',
  /** team:emailNotSent (prefix) — the dev mailer hands the owner the link. */
  emailNotSent: 'Le courriel n’est pas parti',
} as const;

/**
 * The ★ chip's DOM text is « ★Approbation choisie » (the aria-hidden star sits
 * inside the same span), so an exact match on MSG.selected never fires; the
 * regex is case-SENSITIVE so « l’approbation choisie » inside
 * deals:submDeskDiffers cannot match either.
 */
const STAR = /^★?\s*Approbation choisie$/;

/** Filled by test 1: the saved deal's desking URL (/leads/:id/desk/:dealId), reopened by tests 2–5. */
let deskUrl = '';

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

/** Reopen the saved deal's worksheet and wait for the prefill (the term field is never empty once loaded). */
async function openDesk(page: Page): Promise<void> {
  await page.goto(deskUrl);
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible(); // deals:title
  await expect(deskTerm(page)).not.toHaveValue('');
}

/** The panel's region (A13): `<section aria-labelledby="subm-heading">` named deals:submSection. */
const panel = (page: Page) => page.getByRole('region', { name: MSG.section });

/** A row card: the `<li>` whose `<h3>` is the lender's full name — exact (A12). */
const rowOf = (page: Page, lender: string) =>
  panel(page)
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: lender, exact: true }) });

/** « Choisir cette approbation — {lender} » (deals:submSelectActionFor aria-label). */
const selectButton = (page: Page, lender: string) =>
  panel(page).getByRole('button', { name: `Choisir cette approbation — ${lender}`, exact: true });

/** « Modifier — {lender} » (deals:submEditFor aria-label). */
const editButton = (page: Page, lender: string) =>
  panel(page).getByRole('button', { name: `Modifier — ${lender}`, exact: true });

/** The desking worksheet's own inputs — exact labels, because the panel's are « Taux de vente (%) », « Terme approuvé (mois) », « Prêteur sollicité ». */
const deskRate = (page: Page) => page.getByLabel('Taux (%)', { exact: true }); // deals:rate
const deskTerm = (page: Page) => page.getByLabel('Terme (mois)', { exact: true }); // deals:term
const deskLender = (page: Page) => page.getByLabel('Prêteur', { exact: true }); // deals:lenderLabel

/** The reason paragraph a disabled select button points at through aria-describedby (A22). */
async function reasonOf(page: Page, lender: string) {
  const button = selectButton(page, lender);
  await expect(button).toBeDisabled();
  const reasonId = await button.getAttribute('aria-describedby');
  expect(reasonId, `the disabled « Choisir » on ${lender} carries no aria-describedby`).toBeTruthy();
  return panel(page).locator(`[id="${reasonId}"]`);
}

/** Wait for one write on the ledger's routes and assert its status. */
function expectWrite(page: Page, method: 'POST' | 'PATCH', urlPart: string, status: number) {
  const done = page.waitForResponse(
    (res) => res.request().method() === method && res.url().includes(urlPart),
  );
  return async () => expect((await done).status()).toBe(status);
}

test('1 — born empty: the create-mode sentence, the empty ledger after save, then TD (DealerTrack) and Scotia (Manuelle) logged as « Soumise »', async ({ page }) => {
  await signUp(page, owner, password);
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name); // orgs:name
  await page.getByLabel('Identifiant (slug)').fill(org.slug); // orgs:slug
  await page.getByRole('button', { name: "Créer l'organisation" }).click(); // orgs:create
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click(); // orgs:newStore
  await page.getByLabel('Nom de la succursale').fill(STORE); // orgs:storeName
  await page.getByLabel('Code').fill(`F81-${stamp % 10000}`); // orgs:storeCode
  await page.getByRole('button', { name: 'Créer la succursale' }).click(); // orgs:createStore
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  await createLead(page, LEAD);
  const leadUrl = new URL(page.url()).pathname;

  // Desk a finance / QC deal: 30 000 $, 4,99 %, 48 months (province QC and
  // type « Financement » are the worksheet's defaults). Before the first
  // save the panel says only where to log — a true claim, no form.
  await page.getByRole('link', { name: 'Créer une transaction' }).click(); // deals:deskAction
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible(); // deals:title
  await expect(panel(page).getByText(MSG.createMode)).toBeVisible();
  await expect(panel(page).locator('#subm-lender')).toHaveCount(0);
  await page.getByLabel('Prix de vente').fill('30000'); // deals:salePrice
  await deskRate(page).fill('4,99');
  await deskTerm(page).fill('48');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click(); // deals:save
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Reopen /leads/:id/desk/:dealId — the ledger is born empty, with the
  // writer's CTA and the add form already open.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click(); // deals:editDealFor aria-label
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}\/desk\/[0-9a-f-]{36}$/);
  deskUrl = new URL(page.url()).pathname;
  expect(deskUrl.startsWith(leadUrl)).toBe(true);
  await expect(deskRate(page)).toHaveValue('4.99');
  await expect(deskTerm(page)).toHaveValue('48');
  const region = panel(page);
  await expect(region.getByText(MSG.emptyCta)).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Ajouter une soumission' })).toBeVisible(); // deals:submAdd

  // TD Auto Finance / DealerTrack — achat 5,99 / vente 6,99 / terme 72 /
  // plafond 28 000 $ / paiement cité 650,00 $ (A24). DealerTrack is the
  // platform Select's first option; picked explicitly all the same.
  await region.getByLabel('Prêteur sollicité').selectOption({ label: TD }); // deals:submLenderLabel
  await region.getByLabel('Plateforme').selectOption({ label: 'DealerTrack' }); // deals:submPlatformLabel / submPlatform_dealertrack
  await region.getByLabel('Taux d’achat (%)').fill('5,99'); // deals:submBuyRate
  await region.getByLabel('Taux de vente (%)').fill('6,99'); // deals:submSellRate
  await region.getByLabel('Terme approuvé (mois)').fill('72'); // deals:submTerm
  await region.getByLabel('Plafond approuvé').fill('28000'); // deals:submCeiling
  await region.getByLabel('Paiement cité').fill('650'); // deals:submPayment
  const tdCreated = expectWrite(page, 'POST', '/submissions', 201);
  await region.getByRole('button', { name: 'Enregistrer la soumission' }).click(); // deals:submAddAction
  await tdCreated();
  const td = rowOf(page, TD);
  await expect(td).toBeVisible();
  await expect(td.getByText('Soumise', { exact: true })).toBeVisible(); // deals:submStatus_submitted
  await expect(td.getByText('DealerTrack')).toBeVisible();
  // Achat | Vente | Écart — the spread is render-derived: 6,99 − 5,99 = 1,00 %.
  await expect(td.getByText(/Achat 5,99\s?% \| Vente 6,99\s?% \| Écart 1,00\s?%/)).toBeVisible(); // deals:submRates
  // The terms line « {ceiling} @ {sell} × {term} mois » — never « = payment ».
  await expect(td.getByText(/28\s?000,00\s?\$ @ 6,99\s?% × 72 mois/)).toBeVisible(); // deals:submTermsLine

  // Scotia Dealer Advantage / Manuelle — vente 8,49 only: an untyped side
  // renders « — », and so does the spread (never « 0,00 % »).
  await region.getByRole('button', { name: 'Ajouter une soumission' }).click(); // deals:submAdd
  await region.getByLabel('Prêteur sollicité').selectOption({ label: SCOTIA });
  await region.getByLabel('Plateforme').selectOption({ label: 'Manuelle' }); // deals:submPlatform_manual
  await region.getByLabel('Taux de vente (%)').fill('8,49');
  const scotiaCreated = expectWrite(page, 'POST', '/submissions', 201);
  await region.getByRole('button', { name: 'Enregistrer la soumission' }).click();
  await scotiaCreated();
  const scotia = rowOf(page, SCOTIA);
  await expect(scotia.getByText('Soumise', { exact: true })).toBeVisible();
  await expect(scotia.getByText('Manuelle')).toBeVisible();
  await expect(scotia.getByText(/^Achat — \| Vente 8,49\s?% \| Écart —$/)).toBeVisible();
  await expect(region.locator('li')).toHaveCount(2);
  // Nothing is chosen yet — no star anywhere in the region.
  await expect(region.getByText(STAR)).toHaveCount(0);
});

test('2 — approve TD: « Approuvée », « Expire le … », the captioned quoted payment, TD choosable and Scotia refused with its reason', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openDesk(page);
  const region = panel(page);

  // « Modifier — TD Auto Finance » flips the single form into edit mode
  // (A13: one form at a time — the add form is gone while this one is open).
  await editButton(page, TD).click();
  await expect(region.getByRole('heading', { name: `Modification — ${TD}` })).toBeVisible(); // deals:submEditing
  await expect(region.getByRole('heading', { name: 'Ajouter une soumission' })).toHaveCount(0);
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10); // today + 30
  await region.getByLabel('Statut', { exact: true }).selectOption({ label: 'Approuvée' }); // deals:submStatusLabel / submStatus_approved
  await region.getByLabel('Expiration').fill(expiry); // deals:submExpiryLabel
  const approved = expectWrite(page, 'PATCH', '/api/v1/submissions/', 200);
  await region.getByRole('button', { name: 'Enregistrer', exact: true }).click(); // deals:submSave
  await approved();

  const td = rowOf(page, TD);
  await expect(td.getByText('Approuvée', { exact: true })).toBeVisible(); // deals:submStatus_approved
  // « Expire le {date} » — Intl medium date; the year is the stable part.
  await expect(td.getByText(new RegExp(`^Expire le .*${expiry.slice(0, 4)}$`))).toBeVisible(); // deals:submExpires
  await expect(td.getByText('Expirée', { exact: true })).toHaveCount(0); // deals:submExpired
  // The lender's quoted payment renders ONLY inside its captioned sentence
  // (the worksheet's own payment lives in the Résultats aside, not here).
  await expect(
    td.getByText(/Paiement cité par le prêteur : 650,00\s?\$ — la feuille de calcul calcule celui de la transaction\./),
  ).toBeVisible(); // deals:submLenderQuote
  await expect(selectButton(page, TD)).toBeEnabled();
  // Scotia is still « Soumise »: its button exists, disabled, and names why.
  await expect(await reasonOf(page, SCOTIA)).toHaveText(MSG.notApproved);
  await expect(region.getByText(STAR)).toHaveCount(0);
});

test('3 — « Choisir cette approbation » rewrites the worksheet (6.99 / 72 / TD), the ceiling warns, and the re-save + reopen holds (the stale-form proof)', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openDesk(page);
  const region = panel(page);
  await expect(deskRate(page)).toHaveValue('4.99');
  await expect(deskTerm(page)).toHaveValue('48');
  await expect(deskLender(page).locator('option:checked')).toHaveText('Aucun prêteur'); // deals:lenderNone

  const chosen = expectWrite(page, 'POST', '/select', 200);
  await selectButton(page, TD).click();
  await chosen();

  // The response deal lands on the OPEN worksheet: the inputs hold the dot
  // form the prefill idiom would produce, the « Prêteur » Select names TD,
  // and the aria-live line says so (deals:submAppliedLine).
  await expect(deskRate(page)).toHaveValue('6.99');
  await expect(deskTerm(page)).toHaveValue('72');
  await expect(deskLender(page).locator('option:checked')).toHaveText(TD);
  await expect(
    page.getByRole('status').filter({ hasText: /Modalités du prêteur appliquées à la feuille de calcul : 6,99\s?% sur 72 mois\./ }),
  ).toBeVisible();
  const td = rowOf(page, TD);
  await expect(td.getByText(STAR)).toBeVisible();
  await expect(region.getByText(STAR)).toHaveCount(1);
  // The ceiling WARNS, never refuses: 30 000 $ QC finance with no down
  // finances 34 492,50 $ (taxes in), which exceeds the 28 000 $ ceiling. A
  // down payment ≥ 6 493 $ would silence this chip by design (A8).
  await expect(td.getByText(/Le montant financé dépasse le plafond approuvé \(28\s?000,00\s?\$\)\./)).toBeVisible(); // deals:submCeilingExceeded
  // A same-tab select is silent on the desk-differs chip: the draft was
  // rewritten before the row re-rendered (A7).
  await expect(region.getByText(MSG.deskDiffers)).toHaveCount(0);

  // A hand edit of a promoted field retires the applied line: the worksheet
  // no longer holds the lender's terms, so the caption may not keep saying
  // it does while the chip beneath says the opposite. Typing the promoted
  // value back silences the chip but does NOT resurrect the line — only a
  // select writes it.
  await deskRate(page).fill('5.50');
  await expect(page.getByRole('status').filter({ hasText: MSG.appliedPrefix })).toHaveCount(0);
  await expect(region.getByText(MSG.deskDiffers)).toBeVisible();
  await deskRate(page).fill('6.99');
  await expect(region.getByText(MSG.deskDiffers)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: MSG.appliedPrefix })).toHaveCount(0);

  // THE STALE-FORM PROOF (M15's red): the full-field PATCH re-sends the
  // promoted values; the reopen must still show them, not 4,99 / 48.
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && res.url().includes('/api/v1/deals/'),
  );
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click(); // deals:saveChanges
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  // The lead's deal line names the lender by FULL name (the f80 render).
  await expect(page.getByText(new RegExp(`· ${TD}$`))).toBeVisible();

  await openDesk(page);
  await expect(deskRate(page)).toHaveValue('6.99');
  await expect(deskTerm(page)).toHaveValue('72');
  await expect(deskLender(page).locator('option:checked')).toHaveText(TD);
  await expect(rowOf(page, TD).getByText(STAR)).toBeVisible();
  await expect(panel(page).getByText(MSG.deskDiffers)).toHaveCount(0);
});

test('4 — the conditional journey on iA (CreditApp): refused until « Conditions remplies » + « Approuvée », then the flip — one star, 9.99 / 60 / iA, and the reopen holds', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openDesk(page);
  const region = panel(page);

  // Log iA / CreditApp / vente 9,99 / terme 60 with the condition (A24).
  await region.getByRole('button', { name: 'Ajouter une soumission' }).click();
  await region.getByLabel('Prêteur sollicité').selectOption({ label: IA });
  await region.getByLabel('Plateforme').selectOption({ label: 'CreditApp' }); // deals:submPlatform_creditapp
  await region.getByLabel('Taux de vente (%)').fill('9,99');
  await region.getByLabel('Terme approuvé (mois)').fill('60');
  await region.getByLabel('Conditions').fill('Preuve de revenu'); // deals:submConditions
  const iaCreated = expectWrite(page, 'POST', '/submissions', 201);
  await region.getByRole('button', { name: 'Enregistrer la soumission' }).click();
  await iaCreated();
  const ia = rowOf(page, IA);
  await expect(ia.getByText('Soumise', { exact: true })).toBeVisible();
  await expect(ia.getByText('Preuve de revenu')).toBeVisible();
  // No ceiling yet — the card still shows the term the flip will promote
  // (deals:submTermsLineNoCeiling), never hidden behind a blank sibling.
  await expect(ia.getByText(/^9,99\s?% × 60 mois$/)).toBeVisible();

  // Statut « Conditionnelle » → the button is disabled and names the fix.
  await editButton(page, IA).click();
  await expect(region.getByRole('heading', { name: `Modification — ${IA}` })).toBeVisible();
  await region.getByLabel('Statut', { exact: true }).selectOption({ label: 'Conditionnelle' }); // deals:submStatus_conditional
  const conditional = expectWrite(page, 'PATCH', '/api/v1/submissions/', 200);
  await region.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await conditional();
  await expect(ia.getByText('Conditionnelle', { exact: true })).toBeVisible();
  await expect(await reasonOf(page, IA)).toHaveText(MSG.conditionalHint);

  // Tick « Conditions remplies » on the row (a PATCH of conditions_met; the
  // controlled checkbox flips once the list refetches — click, then wait).
  const met = ia.getByLabel('Conditions remplies'); // deals:submConditionsMet
  await expect(met).not.toBeChecked();
  const ticked = expectWrite(page, 'PATCH', '/api/v1/submissions/', 200);
  await met.click();
  await ticked();
  await expect(met).toBeChecked();
  // Still conditional → still refused; approve it through the editor.
  await expect(selectButton(page, IA)).toBeDisabled();
  await editButton(page, IA).click();
  await region.getByLabel('Statut', { exact: true }).selectOption({ label: 'Approuvée' });
  const iaApproved = expectWrite(page, 'PATCH', '/api/v1/submissions/', 200);
  await region.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await iaApproved();
  await expect(ia.getByText('Approuvée', { exact: true })).toBeVisible();
  await expect(selectButton(page, IA)).toBeEnabled();

  // THE FLIP: iA takes the star, TD loses it — exactly one in the region —
  // and the worksheet now holds iA's terms.
  const chosen = expectWrite(page, 'POST', '/select', 200);
  await selectButton(page, IA).click();
  await chosen();
  await expect(ia.getByText(STAR)).toBeVisible();
  await expect(rowOf(page, TD).getByText(STAR)).toHaveCount(0);
  await expect(region.getByText(STAR)).toHaveCount(1);
  await expect(deskRate(page)).toHaveValue('9.99');
  await expect(deskTerm(page)).toHaveValue('60');
  await expect(deskLender(page).locator('option:checked')).toHaveText(IA);
  // TD's own button is still there (re-select is lawful), enabled.
  await expect(selectButton(page, TD)).toBeEnabled();

  // Re-save + reopen holds (the stale-form proof, second lender).
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && res.url().includes('/api/v1/deals/'),
  );
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await openDesk(page);
  await expect(deskRate(page)).toHaveValue('9.99');
  await expect(deskTerm(page)).toHaveValue('60');
  await expect(deskLender(page).locator('option:checked')).toHaveText(IA);
  await expect(rowOf(page, IA).getByText(STAR)).toBeVisible();
  await expect(panel(page).getByText(STAR)).toHaveCount(1);
});

test('5 — « Agent BDC » reads the ledger and cannot write it: the read-only sentence, the list, zero controls, zero write requests', async ({ page }) => {
  // Invite with « Vendeur » UNTICKED and « Agent BDC » ticked (A9): the add
  // form pre-ticks Vendeur, and roles union their permissions — a Vendeur +
  // Agent BDC member would hold deal:update and be a writer.
  await logIn(page, owner.email, password);
  await page.goto('/team');
  await page.getByLabel('Nom', { exact: true }).fill(agent.name); // team:name
  await page.getByLabel('Courriel').fill(agent.email); // team:email
  await page.locator('#add-role-salesperson').uncheck(); // team:role_salesperson « Vendeur »
  await page.locator('#add-role-bdc_agent').check(); // team:role_bdc_agent « Agent BDC »
  await page.getByRole('button', { name: 'Inviter', exact: true }).click(); // team:invite
  await expect(page.getByText(MSG.emailNotSent)).toBeVisible();
  // The roster row shows roles EXACTLY ['bdc_agent']: the cell is the joined
  // labels, so an exact « Agent BDC » cell rules out « Vendeur, Agent BDC ».
  const invitedRow = page.getByRole('row').filter({ hasText: agent.email });
  await expect(invitedRow.getByRole('cell', { name: 'Agent BDC', exact: true })).toBeVisible();
  await expect(invitedRow).not.toContainText('Vendeur');
  const token = (await page.getByLabel('Lien d’invitation').inputValue()).split('/').pop() ?? ''; // team:inviteLink
  expect(token).not.toBe('');
  await page.getByRole('button', { name: 'Se déconnecter' }).click(); // common:signOut
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`/invitations/${token}`);
  await page.getByLabel('Nom complet').fill(agent.name); // invitations:fullName
  await page.getByLabel('Mot de passe').fill(agent.password); // invitations:password
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click(); // invitations:createAndAccept
  await expect(page).toHaveURL('/');

  // From here, count every WRITE the browser attempts against the API
  // (POST/PATCH — the ledger has no DELETE route or grant). The desking
  // page in edit mode always POSTs /api/v1/deals/calculate: calculate is
  // pure math with no permission and no write (f05-deals-routes.ts:148-151);
  // it fires whenever the worksheet has inputs (deals/api.ts:29-33) — so it
  // is named out of the count below, and nothing else is.
  const writes: string[] = [];
  page.on('request', (request) => {
    const method = request.method();
    if ((method === 'POST' || method === 'PATCH') && request.url().includes('/api/')) {
      writes.push(`${method} ${request.url()}`);
    }
  });

  // The desking URL has no route guard; the deal loads for any member.
  await openDesk(page);
  const region = panel(page);
  await expect(region.getByText(MSG.readOnly)).toBeVisible();
  // The whole ledger, tests 1–4 included, with iA still the chosen one…
  for (const lender of [TD, SCOTIA, IA]) {
    await expect(region.getByRole('heading', { name: lender, exact: true })).toBeVisible();
  }
  await expect(rowOf(page, IA).getByText(STAR)).toBeVisible();
  await expect(rowOf(page, IA).getByText('Preuve de revenu')).toBeVisible();
  // …and NO control in the region: no select / edit / add, no form, no checkbox.
  await expect(region.getByRole('button', { name: /^Choisir cette approbation — / })).toHaveCount(0);
  await expect(region.getByRole('button', { name: /^Modifier — / })).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'Ajouter une soumission' })).toHaveCount(0);
  await expect(region.locator('#subm-lender')).toHaveCount(0);
  await expect(region.getByRole('checkbox')).toHaveCount(0);
  await expect(region.getByText(MSG.emptyCta)).toHaveCount(0);

  // And the page FIRED no write — the zero-request law's e2e half.
  expect(writes.filter((w) => !w.endsWith('/api/v1/deals/calculate'))).toEqual([]);
});

test('6 — the pipeline card names the chosen lender: « Prêteur : iA » after the flip', async ({ page }) => {
  await logIn(page, owner.email, password);
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pipeline des transactions' })).toBeVisible(); // deals:pipelineTitle
  // The stage is untouched by a select — still « Nouvelle » — and the card
  // carries short_name (deals:lenderOn), the registry's « iA ».
  const card = page
    .getByRole('region', { name: 'Nouvelle' }) // deals:stage_new column
    .locator('article')
    .filter({ has: page.getByRole('link', { name: `${LEAD.first} ${LEAD.last}` }) });
  await expect(card.getByText('Prêteur : iA', { exact: true })).toBeVisible();
  await expect(card.getByText('Prêteur : TD', { exact: true })).toHaveCount(0);
});
