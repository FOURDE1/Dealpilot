import { expect, test, type Page } from '@playwright/test';

/**
 * F-82 — the vehicle expenses ledger, and the cost the worksheet copies
 * (D-084; manifest e2e rows 1–6, amendments A10/A21/A23/A24/A32/A39).
 *
 * The claim worth an e2e: what a car cost AFTER purchase is logged on its
 * page under « Dépenses du véhicule », approved and paid by a manager, and
 * shown beside the derived « Coût total » as ONE captioned row — « Coût avec
 * dépenses » — that the desking worksheet never copies. Test 5 is the money
 * fence on the product surface: a new desk on the car prefills « Coût du
 * véhicule » with the triplet's 27 650,00 $, never the ledger's 28 040,92 $.
 * Test 6 is the zero-request law: an « Agent BDC » reads the rows with no
 * amount, no receipt, no control, and fires no write.
 *
 * Serial by design: test 1's car is the one every later test reopens, and
 * the ladder walked in tests 2–4 feeds the sums tests 5–6 read — the ORDER is
 * binding, so the mode is set explicitly (A10). Fresh `f82-${stamp}`
 * organization, own owner; retries and the 90 s ceiling are
 * playwright.config.ts's (never re-set here). Every French string is the
 * fr-CA reference value, grepped in fr-CA.ts before use; the key is named
 * beside each. One vendor pair everywhere (A32): « Lave-Auto Express » /
 * LAE-1042 / 340 + 50,92 → 390,92 $ and « Pièces Kia Laval » / 120.
 *
 * Strict-mode discipline (A23): the same Intl string sits in two elements on
 * one page (« Coût total » and « Coût avec dépenses » both read 27 650,00 $
 * in test 1; 390,92 $ sits in the card AND the strip in test 3), and the
 * shipped caption contains « Coût total », so every money assertion goes
 * through the row-scoped `costValue` or the card-scoped `cardOf`, every chip
 * is read inside its card, and « Coût total » is never asserted by bare
 * getByText. The `<dt>` is found by role + exact text: measured on
 * playwright 1.61.1, `getByRole('term', { name })` computes NO name for a
 * `<dt>` (`term` allows name-from-content only as a descendant role), so the
 * literal `{ name, exact }` form matches nothing — and a count-0 on it would
 * pass vacuously. Edit mode is not walked here (A39): vitest T-X3 and the
 * panel's case 9 prove it.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f82';
const owner = { name: 'Patron Stock', email: `f82-${stamp}@1dealer.test` };
/** The read-only persona (R4): « Agent BDC » with « Vendeur » UNTICKED — no vehicle:update, no expense:approve, no vehicle:read_costs. */
const agent = { name: 'Bianca Bédard', email: `f82-bianca-${stamp}@1dealer.test`, password: 'MotDePasse!2026-bianca82' };
const org = { name: `Groupe F82 ${stamp}`, slug: `f82-${stamp}` };
const STORE = 'Succursale F82';
/** The car (f07-inventory.e2e.ts's recipe): 25 000 + 650 + 2 000 = 27 650,00 $ total cost, listed at 32 900 $. */
const STOCK = `K${stamp % 100000}`;
const CAR = '2023 Kia Sportage';
const LEAD = { first: 'Ali', last: 'Acheteur', phone: '+15145550182' };
/** E1 — « Esthétique » (inventory:cat_detail): 340 + 50,92 = 390,92 $, invoice LAE-1042. */
const E1 = { vendor: 'Lave-Auto Express', invoice: 'LAE-1042' };
/** E2 — « Pièces » (inventory:cat_parts): 120, no invoice. */
const E2 = { vendor: 'Pièces Kia Laval' };

/** fr-CA strings the assertions read verbatim (key → value, both locales parity-guarded). */
const MSG = {
  /** inventory:expSection — the region's accessible name. */
  section: 'Dépenses du véhicule',
  /** inventory:expEmptyCta — a writer's empty ledger. */
  emptyCta: 'Aucune dépense — consignez la première facture.',
  /** inventory:expReadOnly — the sentence a member without vehicle:update / expense:approve reads. */
  readOnly: 'Vous pouvez consulter les dépenses ; votre rôle ne permet pas de les consigner.',
  /** inventory:expLogTitle — the add form's heading AND the closed-state button. */
  logTitle: 'Consigner une dépense',
  /** inventory:expSave — the add form's submit. */
  save: 'Enregistrer la dépense',
  /** inventory:totalCost — the derived triplet's row, byte-identical to tip. */
  totalCost: 'Coût total',
  /** inventory:expAdded — Σ approved + paid. */
  added: 'Dépenses ajoutées',
  /** inventory:expWithCost — total cost + the approved sum, computed on the web. */
  withCost: 'Coût avec dépenses',
  /** inventory:expWithCostCaption — the SHIPPED claim under the row (fence S5). */
  caption:
    'Coût total plus les dépenses approuvées et payées du registre. La feuille de calcul copie le coût total, jamais ce montant.',
  /** inventory:type — a row every member sees (the cost block is what masks). */
  type: 'Type',
  /** deals:vehicleCost — the worksheet's cost input the fence is about. */
  vehicleCost: 'Coût du véhicule',
  /** team:emailNotSent (prefix) — the dev mailer hands the owner the link. */
  emailNotSent: 'Le courriel n’est pas parti',
} as const;

/** Intl money, fr-CA: a narrow no-break space inside « 27 650 » and before « $ » — matched by regex, never by literal. */
const MONEY = {
  total: /^27\s?650,00\s?\$$/,
  zero: /^0,00\s?\$$/,
  e1: /^390,92\s?\$$/,
  withE1: /^28\s?040,92\s?\$$/,
  /** E1's card line — inventory:expMoney « {amount} + taxes {tax} = {sum} ». */
  e1Line: /^340,00\s?\$ \+ taxes 50,92\s?\$ = 390,92\s?\$$/,
  e2Line: /^120,00\s?\$ \+ taxes 0,00\s?\$ = 120,00\s?\$$/,
  /** inventory:expPending « En attente d’approbation : {amount} » — the panel-header line, only while pending_cents > 0. */
  pendingBoth: /^En attente d’approbation : 510,92\s?\$$/,
  pendingE2: /^En attente d’approbation : 120,00\s?\$$/,
  pendingAny: /^En attente d’approbation/,
} as const;

/** A 1×1 PNG (f13-documents.e2e.ts:231-240's in-memory file). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Filled by test 1: the car's page (/inventory/:vehicleId), reopened by tests 2–6. */
let vehicleUrl = '';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s: string): RegExp => new RegExp(`^${escapeRe(s)}$`);

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

/** Reopen the car's page and wait for the ledger's region (the list GET and permissions/mine both answered). */
async function openCar(page: Page): Promise<void> {
  await page.goto(vehicleUrl);
  await expect(page.getByRole('heading', { level: 1, name: CAR })).toBeVisible();
  await expect(region(page)).toBeVisible();
}

/** The ledger's region (A23): `<section aria-labelledby="exp-heading">` named inventory:expSection. */
const region = (page: Page) => page.getByRole('region', { name: MSG.section });

/** A row card: the `<li>` whose `<h3>` reads « {catégorie} — {vendor} » (f81's rowOf shape). */
const cardOf = (page: Page, vendor: string) =>
  region(page)
    .locator('li')
    .filter({ has: page.getByRole('heading', { name: new RegExp(` — ${escapeRe(vendor)}$`) }) });

/** A `<dt>` by role + exact text (see the header: `{ name }` computes nothing for a dt on 1.61.1). */
const termOf = (page: Page, label: string) => page.getByRole('term').filter({ hasText: exact(label) });

/** The cost `<dl>`'s group whose `<dt>` is exactly `label` — the only way to read « Coût total » beside the caption that quotes it. */
const costRow = (page: Page, label: string) => page.locator('dl > div').filter({ has: termOf(page, label) });

/** The group's `<dd>` — the money for « Coût total » and « Dépenses ajoutées » (a bare number). */
const costValue = (page: Page, label: string) => costRow(page, label).getByRole('definition');

/**
 * « Coût avec dépenses »'s number alone: the FIRST span of its `<dd>` — the
 * caption is the second (A22's markup), so run 1 measured the bare `<dd>`
 * reading « 27 650,00 $Coût total plus… » and an anchored regex must scope
 * to the number span.
 */
const costMoney = (page: Page, label: string) => costValue(page, label).locator('span').first();

/** Wait for one write on the ledger's routes and assert its status (f81-submissions.e2e.ts:153's shape). */
function expectWrite(page: Page, method: 'POST' | 'PATCH', urlPart: string, status: number) {
  const done = page.waitForResponse(
    (res) => res.request().method() === method && res.url().includes(urlPart),
  );
  return async () => expect((await done).status()).toBe(status);
}

/** The three strip rows at once — the triplet row never moves, the two ledger rows follow the approved sum. */
async function expectStrip(page: Page, added: RegExp, withCost: RegExp): Promise<void> {
  await expect(costValue(page, MSG.totalCost)).toHaveText(MONEY.total);
  await expect(costValue(page, MSG.added)).toHaveText(added);
  await expect(costMoney(page, MSG.withCost)).toHaveText(withCost);
}

test('1 — born empty: the car at 27 650,00 $, the region with its open form, « Dépenses ajoutées » 0,00 $, « Coût avec dépenses » = « Coût total », and the caption', async ({ page }) => {
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
  await page.getByLabel('Code').fill(`F82-${stamp % 10000}`); // orgs:storeCode
  await page.getByRole('button', { name: 'Créer la succursale' }).click(); // orgs:createStore
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  // Stock the car (f07-inventory.e2e.ts:41-55): 25 000 + 650 + 2 000 = 27 650.
  await page.getByRole('link', { name: 'Inventaire' }).first().click(); // inventory:title
  await expect(page.getByRole('heading', { name: 'Inventaire' })).toBeVisible();
  await page.getByLabel('N° de stock').fill(STOCK); // inventory:stockNo
  await page.getByLabel('Année').fill('2023'); // inventory:year
  await page.getByLabel('Marque').fill('Kia'); // inventory:make
  await page.getByLabel('Modèle').fill('Sportage'); // inventory:model
  await page.getByLabel(/^NIV/).fill('KNDPMCAC5P7000082'); // inventory:vin
  await page.getByLabel(/^Coût d’acquisition/).fill('25000'); // inventory:acquisitionCost
  await page.getByLabel(/^Transport \(/).fill('650'); // inventory:transportCost
  await page.getByLabel(/^Reconditionnement/).fill('2000'); // inventory:reconCost
  await page.getByLabel(/^Prix affiché/).fill('32900'); // inventory:listPrice
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); // inventory:add
  await expect(page.getByRole('cell', { name: CAR })).toBeVisible();

  // The car's page: the derived total, then the ledger born empty.
  await page.getByRole('link', { name: STOCK }).click();
  await expect(page.getByRole('heading', { level: 1, name: CAR })).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/[0-9a-f-]{36}$/);
  vehicleUrl = new URL(page.url()).pathname;

  const ledger = region(page);
  await expect(ledger).toBeVisible();
  // A writer's empty ledger: the CTA with the add form already OPEN (R13).
  await expect(ledger.getByText(MSG.emptyCta)).toBeVisible();
  await expect(ledger.getByRole('heading', { name: MSG.logTitle })).toBeVisible();
  await expect(ledger.locator('#exp-vendor')).toBeVisible();
  await expect(ledger.locator('li')).toHaveCount(0);
  await expect(ledger.getByText(MONEY.pendingAny)).toHaveCount(0);

  // The strip: a REAL 0,00 $ for a granted viewer of a zero-expense car (never
  // a masked absence), « Coût avec dépenses » = « Coût total », and the
  // shipped caption inside the same group as its term (A22).
  await expectStrip(page, MONEY.zero, MONEY.total);
  await expect(costRow(page, MSG.withCost).getByText(MSG.caption, { exact: true })).toBeVisible();
  // « Coût total » is ONE term on the page — the caption quotes it in prose, not as a label.
  await expect(termOf(page, MSG.totalCost)).toHaveCount(1);
  // Layout pin (review u4): the term sits on ONE line box — before the fix the captioned
  // <dd> claimed the row and squeezed « Coût avec dépenses » onto three lines at every width.
  // A Range line-box count, never a boundingBox height: the flex stretch inflates the box.
  expect(await termOf(page, MSG.withCost).evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size;
  })).toBe(1);
});

test('2 — log two: « Esthétique » / Lave-Auto Express 340 + 50,92 → « En attente » 390,92 $, then « Pièces » / Pièces Kia Laval 120; the pending line reads 510,92 $ and the strip does not move', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openCar(page);
  const ledger = region(page);

  // E1 — the form is already open on an empty ledger; the date defaults to today.
  await ledger.getByLabel('Catégorie').selectOption({ label: 'Esthétique' }); // inventory:expCategory / cat_detail
  await ledger.getByLabel('Fournisseur').fill(E1.vendor); // inventory:expVendor
  await ledger.getByLabel('Montant ($)').fill('340'); // inventory:expAmount
  await ledger.getByLabel('Taxes ($)').fill('50,92'); // inventory:expTax
  await ledger.getByLabel('N° de facture').fill(E1.invoice); // inventory:expInvoice
  const e1Created = expectWrite(page, 'POST', '/expenses', 201);
  await ledger.getByRole('button', { name: MSG.save }).click(); // inventory:expSave
  await e1Created();
  const e1 = cardOf(page, E1.vendor);
  await expect(e1.getByRole('heading', { name: `Esthétique — ${E1.vendor}`, exact: true })).toBeVisible();
  await expect(e1.getByText('En attente', { exact: true })).toBeVisible(); // inventory:status_pending
  await expect(e1.getByText(MONEY.e1Line)).toBeVisible(); // inventory:expMoney
  await expect(e1.getByText(new RegExp(`· Facture ${E1.invoice}$`))).toBeVisible(); // inventory:expInvoiceLine
  // The form closed on success; the empty CTA is gone with the first row.
  await expect(ledger.getByText(MSG.emptyCta)).toHaveCount(0);
  await expect(ledger.locator('#exp-vendor')).toHaveCount(0);

  // E2 — reopen the form from its button (the same string as the heading).
  await ledger.getByRole('button', { name: MSG.logTitle }).click(); // inventory:expLogTitle
  await expect(ledger.getByRole('heading', { name: MSG.logTitle })).toBeVisible();
  await ledger.getByLabel('Catégorie').selectOption({ label: 'Pièces' }); // inventory:cat_parts
  await ledger.getByLabel('Fournisseur').fill(E2.vendor);
  await ledger.getByLabel('Montant ($)').fill('120');
  const e2Created = expectWrite(page, 'POST', '/expenses', 201);
  await ledger.getByRole('button', { name: MSG.save }).click();
  await e2Created();
  const e2 = cardOf(page, E2.vendor);
  await expect(e2.getByRole('heading', { name: `Pièces — ${E2.vendor}`, exact: true })).toBeVisible();
  await expect(e2.getByText('En attente', { exact: true })).toBeVisible();
  await expect(e2.getByText(MONEY.e2Line)).toBeVisible();
  await expect(e2.getByText(/Facture/)).toHaveCount(0);
  await expect(ledger.locator('li')).toHaveCount(2);

  // Pending money is the panel-header line, never a strip row (R9): 390,92 + 120,00.
  await expect(ledger.getByText(MONEY.pendingBoth)).toBeVisible(); // inventory:expPending
  // The strip does not move for pending lines.
  await expectStrip(page, MONEY.zero, MONEY.total);
});

test('3 — approve + pay Lave-Auto Express: « Approuvée », « Dépenses ajoutées » 390,92 $, « Coût avec dépenses » 28 040,92 $, « Coût total » STILL 27 650,00 $; « Payée » leaves the sums; only void + receipt remain; a reload holds', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openCar(page);
  const ledger = region(page);
  const e1 = cardOf(page, E1.vendor);

  const approved = expectWrite(page, 'PATCH', '/api/v1/expenses/', 200);
  await ledger.getByRole('button', { name: `Approuver — ${E1.vendor}`, exact: true }).click(); // inventory:expApprove aria-label
  await approved();
  await expect(e1.getByText('Approuvée', { exact: true })).toBeVisible(); // inventory:status_approved
  // The approved sum lands in BOTH ledger rows; the triplet row does not move.
  await expectStrip(page, MONEY.e1, MONEY.withE1);
  // Only E2 is pending now — the header line follows.
  await expect(ledger.getByText(MONEY.pendingE2)).toBeVisible();
  await expect(ledger.getByText(MONEY.pendingBoth)).toHaveCount(0);

  const paid = expectWrite(page, 'PATCH', '/api/v1/expenses/', 200);
  await ledger.getByRole('button', { name: `Marquer payée — ${E1.vendor}`, exact: true }).click(); // inventory:expPay aria-label
  await paid();
  await expect(e1.getByText('Payée', { exact: true })).toBeVisible(); // inventory:status_paid
  await expect(e1.getByText('Approuvée', { exact: true })).toHaveCount(0);
  // Paid counts exactly like approved: the sums are unchanged.
  await expectStrip(page, MONEY.e1, MONEY.withE1);

  // A paid line offers exactly one <button> — the void — and the receipt input
  // (invoices arrive late, R7); « Modifier — » left with the pending state.
  // Counted by TAG: Chromium exposes an <input type=file> with role "button"
  // too (run 2 measured 2 by role on this card), so the role count would
  // read the receipt input as a second control.
  await expect(e1.locator('button')).toHaveCount(1);
  await expect(e1.getByRole('button', { name: `Annuler la dépense — ${E1.vendor}`, exact: true })).toBeVisible(); // inventory:expVoid aria-label
  await expect(e1.getByLabel(`Joindre un reçu — ${E1.vendor}`)).toHaveCount(1); // inventory:expReceiptUpload aria-label
  await expect(e1.getByRole('button', { name: `Modifier — ${E1.vendor}`, exact: true })).toHaveCount(0); // inventory:expEdit aria-label

  // Reload holds: the server, not the cache, says « Payée » and 28 040,92 $.
  await page.reload();
  await expect(region(page)).toBeVisible();
  await expect(cardOf(page, E1.vendor).getByText('Payée', { exact: true })).toBeVisible();
  await expectStrip(page, MONEY.e1, MONEY.withE1);
});

test('4 — void Pièces Kia Laval through the relabelled button (focus stays), then attach a PNG to Lave-Auto Express: « Annulée » with no control, the pending line gone, « Voir le reçu — » on the paid card', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openCar(page);
  const ledger = region(page);
  const e1 = cardOf(page, E1.vendor);
  const e2 = cardOf(page, E2.vendor);

  // The house's inline two-step (A21): the SAME button relabels from
  // « Annuler la dépense — » to « Confirmer l’annulation — » and keeps focus;
  // the second click sends the void.
  await ledger.getByRole('button', { name: `Annuler la dépense — ${E2.vendor}`, exact: true }).click(); // inventory:expVoid aria-label
  const confirm = e2.getByRole('button', { name: `Confirmer l’annulation — ${E2.vendor}`, exact: true }); // inventory:expVoidConfirm aria-label
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();
  await expect(ledger.getByRole('button', { name: `Annuler la dépense — ${E2.vendor}`, exact: true })).toHaveCount(0);
  const voided = expectWrite(page, 'PATCH', '/api/v1/expenses/', 200);
  await confirm.click();
  await voided();
  await expect(e2.getByText('Annulée', { exact: true })).toBeVisible(); // inventory:status_void
  // A terminal line: no button, no receipt input, and nothing pending any more.
  await expect(e2.getByRole('button')).toHaveCount(0);
  await expect(e2.locator('input[type=file]')).toHaveCount(0);
  await expect(ledger.getByText(MONEY.pendingAny)).toHaveCount(0);
  // Void moves neither sum.
  await expectStrip(page, MONEY.e1, MONEY.withE1);

  // The receipt on the PAID line: the label-wrapped file input carries the
  // vendor in its name; the upload is raw bytes → 201 → « Voir le reçu — ».
  const uploaded = expectWrite(page, 'POST', '/receipt', 201);
  await ledger
    .getByLabel(`Joindre un reçu — ${E1.vendor}`) // inventory:expReceiptUpload aria-label
    .setInputFiles({ name: 'recu.png', mimeType: 'image/png', buffer: PNG });
  await uploaded();
  await expect(e1.getByRole('button', { name: `Voir le reçu — ${E1.vendor}`, exact: true })).toBeVisible(); // inventory:expReceiptView aria-label
  await expect(e1.getByText('Payée', { exact: true })).toBeVisible();
  // The void card still has no file input — a receipt is refused on a closed line.
  await expect(e2.locator('input[type=file]')).toHaveCount(0);
  await expect(ledger.locator('input[type=file]')).toHaveCount(1);
});

test('5 — THE DESK COPIES THE TRIPLET: a new worksheet on the car prefills « Coût du véhicule » 27650.00 — never 28040.92 — and the car page still reads « Coût total » 27 650,00 $ beside « Coût avec dépenses » 28 040,92 $', async ({ page }) => {
  await logIn(page, owner.email, password);
  await createLead(page, LEAD);
  await page.getByRole('link', { name: 'Créer une transaction' }).click(); // deals:deskAction
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible(); // deals:title

  // The picker lists the store's available cars « {stock} — {year make model} ».
  const picker = page.locator('#desk-vehicle'); // deals:vehicleLabel
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: `${STOCK} — ${CAR}` });
  await expect(picker.locator('option:checked')).toHaveText(`${STOCK} — ${CAR}`);
  // The prefill is the vehicle's derived total_cost_cents (desking-page.tsx:626),
  // never the ledger's cost-with-expenses — the money fence on the product surface.
  const cost = page.getByLabel(MSG.vehicleCost);
  await expect(cost).toHaveValue('27650.00');
  await expect(cost).not.toHaveValue('28040.92');
  await expect(page.getByLabel('Prix de vente')).toHaveValue('32900.00'); // deals:salePrice
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click(); // deals:save
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // The saved deal carries the car and its cost input is the triplet, to the cent.
  const leadId = page.url().split('/').pop()!;
  const dealsResp = await page.request.get(`/api/v1/deals?lead_id=${leadId}&limit=10`);
  const deals = (await dealsResp.json()) as { items: { vehicle_id: string | null; vehicle_cost_cents: number }[] };
  expect(deals.items[0]?.vehicle_id).toBe(vehicleUrl.split('/').pop());
  expect(deals.items[0]?.vehicle_cost_cents).toBe(2_765_000);

  // Back on the car: the desk changed nothing on this page.
  await openCar(page);
  await expectStrip(page, MONEY.e1, MONEY.withE1);
});

test('6 — « Agent BDC » reads the ledger and cannot write it: both rows with no money, the read-only sentence, zero controls, no cost row, zero write requests', async ({ page }) => {
  // Invite with « Vendeur » UNTICKED and « Agent BDC » ticked (R4, the f81
  // recipe): the add form pre-ticks Vendeur, and roles union their
  // permissions — a Vendeur + Agent BDC member would still hold nothing
  // here, but the exact-cell assertion rules the union out all the same.
  await logIn(page, owner.email, password);
  await page.goto('/team');
  await page.getByLabel('Nom', { exact: true }).fill(agent.name); // team:name
  await page.getByLabel('Courriel').fill(agent.email); // team:email
  await page.locator('#add-role-salesperson').uncheck(); // team:role_salesperson « Vendeur »
  await page.locator('#add-role-bdc_agent').check(); // team:role_bdc_agent « Agent BDC »
  await page.getByRole('button', { name: 'Inviter', exact: true }).click(); // team:invite
  await expect(page.getByText(MSG.emailNotSent)).toBeVisible();
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
  // (POST/PATCH — the ledger has no DELETE route or grant). No exemption:
  // the vehicle page desks nothing, so /calculate never fires here (R4).
  const writes: string[] = [];
  page.on('request', (request) => {
    const method = request.method();
    if ((method === 'POST' || method === 'PATCH') && request.url().includes('/api/')) {
      writes.push(`${method} ${request.url()}`);
    }
  });

  // The car's page has no route guard; the vehicle read is membership-scoped.
  await openCar(page);
  const ledger = region(page);
  await expect(ledger.getByText(MSG.readOnly)).toBeVisible(); // inventory:expReadOnly
  // Both rows are facts every member may read — heading and chip — but the
  // money line, the receipt link and every control are absent with `summary`.
  const e1 = cardOf(page, E1.vendor);
  const e2 = cardOf(page, E2.vendor);
  await expect(e1.getByRole('heading', { name: `Esthétique — ${E1.vendor}`, exact: true })).toBeVisible();
  await expect(e1.getByText('Payée', { exact: true })).toBeVisible();
  await expect(e2.getByRole('heading', { name: `Pièces — ${E2.vendor}`, exact: true })).toBeVisible();
  await expect(e2.getByText('Annulée', { exact: true })).toBeVisible();
  await expect(ledger.locator('li')).toHaveCount(2);
  await expect(e1.getByText(/\$/)).toHaveCount(0);
  await expect(e2.getByText(/\$/)).toHaveCount(0);
  await expect(ledger.getByText(MONEY.pendingAny)).toHaveCount(0);
  // The absences, every one a string the slice SHIPS (A24) — the receipt E1
  // really carries is the positive control for « Voir le reçu — » = 0.
  await expect(ledger.getByRole('heading', { name: MSG.logTitle })).toHaveCount(0);
  await expect(ledger.getByRole('button', { name: MSG.logTitle })).toHaveCount(0);
  await expect(ledger.getByRole('button', { name: MSG.save })).toHaveCount(0);
  await expect(ledger.locator('#exp-vendor')).toHaveCount(0);
  await expect(ledger.locator('input[type=file]')).toHaveCount(0);
  await expect(
    ledger.getByRole('button', { name: /^(Approuver|Refuser|Marquer payée|Annuler la dépense|Modifier|Joindre un reçu) — / }),
  ).toHaveCount(0);
  await expect(ledger.getByRole('button', { name: /^Voir le reçu — / })).toHaveCount(0);
  await expect(ledger.getByRole('button')).toHaveCount(0);
  await expect(ledger.getByText(MSG.emptyCta)).toHaveCount(0);

  // Page-level: the cost block is ABSENT for a masked viewer (FR-TEN-006) —
  // no « Coût total », no ledger row — while the `<dl>` itself still renders
  // « Type », so the zero is a masked block, not a missing page.
  await expect(termOf(page, MSG.type)).toHaveCount(1);
  await expect(termOf(page, MSG.totalCost)).toHaveCount(0);
  await expect(termOf(page, MSG.added)).toHaveCount(0);
  await expect(termOf(page, MSG.withCost)).toHaveCount(0);
  await expect(page.getByText(MSG.caption, { exact: true })).toHaveCount(0);

  // And the page FIRED no write — the zero-request law's e2e half, no exemption.
  expect(writes).toEqual([]);
});
