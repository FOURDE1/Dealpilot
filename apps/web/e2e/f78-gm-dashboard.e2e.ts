import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * F-78 — the GM Command Center's journey (reports-analytics.md §14.1,
 * FR-REP-003, D-079): the dashboard's numbers become true, proven in the
 * browser BOTH directions — every figure asserted here appears when its
 * producer fires and drains when the state moves on (R8's stale-predicate
 * guard: a figure that only ever grows is a figure nobody has proven).
 *
 * Serial test() blocks (the f01/f68/f74 precedent): Playwright's 90 s
 * timeout is PER TEST, and the seven blocks share one fresh owner/org/store
 * built through the real UI. retries 0 — a flaky spec is worse than no spec.
 * Every French string below is a fr-CA value (packages/i18n/src/locales/
 * fr-CA.ts); the key is named beside the first use of each. Money and
 * percent strings carry NBSP, so assertions use the repo's \s-tolerant
 * regex idiom (f09-commissions.e2e.ts:83), never ASCII-space literals (A18).
 *
 * The pinned amounts are the API suite's ENGINE goldens, never hand-computed
 * (R8's correction): sale 30 000 $ / cost 23 000 $, QC finance, no extras →
 * amount financed 34 492,50 $ (3_449_250¢: TPS 1 500,00 + TVQ 2 992,50) and
 * front = total gross 7 000,00 $ — both asserted at deal creation in
 * apps/api/src/f78-gm-dashboard.test.ts before being pinned here.
 *
 * Dashboard revisits are FULL loads (page.goto('/')), never link clicks:
 * the app's react-query staleTime is 30 s (shared/api/queryClient.ts:12), so
 * a client-side return within it re-renders the mounted report from cache
 * and the assertion would poll a figure no request will ever refresh
 * (f74-console-door.e2e.ts:263-265 records the same full-load-not-click rule).
 *
 * Rotting (« En souffrance ») stays API-proven: this suite cannot time-travel
 * 7 days (raw SQL is banned outside time travel, and the runner's world has
 * none) — B1 asserts its empty state and f78-gm-dashboard.test.ts owns the
 * positive case (the Q8 golden and the P1 producer/consumer cross-proof).
 */

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f78';
const owner = { name: 'Gina Gérante', email: `f78-${stamp}@1dealer.test` };
/** B6's persona: signed up in B1, added as salesperson — never a report:view holder. */
const seller = { name: 'Sofia Vendeuse', email: `f78-sofia-${stamp}@1dealer.test` };
const org = { name: `Groupe F78 ${stamp}`, slug: `groupe-f78-${stamp}` };
const STORE = { name: 'Succursale F78', code: `F78-${String(stamp % 10000).padStart(4, '0')}` };

/**
 * A stat tile is its label's parent (gm-report.tsx StatTile renders label,
 * value and caption as sibling <p> in one div) — scoping keeps a '0' or '1'
 * assertion from matching another tile's value.
 */
const tile = (page: Page, label: string): Locator =>
  page.getByText(label, { exact: true }).locator('..');

/** Password login (no TOTP in this journey) — the f74 helper's shape. */
async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(email); // auth:email
  await page.getByLabel('Mot de passe').fill(password); // auth:password
  await page.getByRole('button', { name: 'Se connecter' }).click(); // auth:logIn
  await expect(page).toHaveURL('/');
}

test.describe('f78 gm-dashboard', () => {
  test('B1 — empty state: zero tiles, « — » conversion, four empty strings, statTotal gone', async ({
    page,
    request,
  }) => {
    await page.goto('/signup');
    await page.getByLabel('Nom complet').fill(owner.name); // auth:name
    await page.getByLabel('Courriel').fill(owner.email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Créer le compte' }).click(); // auth:signUp
    await expect(page).toHaveURL('/');

    await page.goto('/organizations/new');
    await page.getByLabel("Nom de l'organisation").fill(org.name); // orgs:orgName
    await page.getByLabel('Identifiant (slug)').fill(org.slug); // orgs:orgSlug
    await page.getByRole('button', { name: "Créer l'organisation" }).click(); // orgs:createOrg
    // The create mutation navigates (replace) after its POST resolves; a click
    // during that remount is silently lost (the f04/f11 race).
    await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
    await page.getByRole('link', { name: 'Nouvelle succursale' }).click(); // orgs:newStore
    await page.getByLabel('Nom de la succursale').fill(STORE.name); // orgs:storeName
    await page.getByLabel('Code', { exact: true }).fill(STORE.code); // orgs:storeCode
    await page.getByRole('button', { name: 'Créer la succursale' }).click(); // orgs:createStore
    // Wait for the store to exist before moving on — the next navigation
    // races the create on a loaded machine (f07's lesson).
    await expect(page.getByRole('link', { name: STORE.name })).toBeVisible();

    // The empty dashboard is itself a claims check: zeros and dashes, never a
    // fabricated figure. Full load (see header).
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chiffres du mois' })).toBeVisible(); // dashboard:gmTitle
    // The old floor tile is GONE — the brief's own assertion (statTotal was
    // deleted from both locales; « Prospects (total) » exists nowhere).
    await expect(page.getByText('Prospects (total)')).toHaveCount(0);
    await expect(tile(page, 'Transactions en cours').getByText('0', { exact: true })).toBeVisible(); // dashboard:statPipeline
    await expect(tile(page, 'Unités livrées ce mois-ci').getByText('0', { exact: true })).toBeVisible(); // dashboard:statUnits
    await expect(tile(page, 'Financements en attente').getByText(/0\s·\s0,00\s?\$/)).toBeVisible(); // dashboard:statFunding + fundingValue
    await expect(tile(page, 'Véhicules en stock').getByText('0', { exact: true })).toBeVisible(); // dashboard:statStock
    // A rate over zero leads is NULL on the wire and « — » on the page —
    // never a fabricated « 0 % » (dashboard:noCustomer is the shared dash).
    await expect(tile(page, 'Taux de conversion').getByText('—', { exact: true })).toBeVisible(); // dashboard:statConversion
    // The four empty states, verbatim. Rotting's POSITIVE case is API-owned:
    // e2e cannot time-travel 7 days — apps/api/src/f78-gm-dashboard.test.ts
    // (the Q8 golden and the P1 cross-proof) owns « En souffrance » with rows.
    await expect(page.getByText('Rien en souffrance.', { exact: true })).toBeVisible(); // dashboard:emptyRotting
    await expect(
      page.getByText('Aucune livraison en attente de financement.', { exact: true }),
    ).toBeVisible(); // dashboard:emptyUnfunded
    await expect(page.getByText('Aucun prospect ce mois-ci.', { exact: true })).toBeVisible(); // dashboard:emptySources
    await expect(page.getByText('Aucune vente attribuée ce mois-ci.', { exact: true })).toBeVisible(); // dashboard:emptySalespeople

    // B6's persona, minted while the owner's session is at hand. She has to
    // EXIST first (F-12: POST /api/v1/members answers 422 needs_invitation
    // for an unknown email). The `request` fixture carries its own cookie
    // jar — page.request would swap the owner's session for hers (f09's note).
    const signUp = await request.post('/api/auth/sign-up/email', {
      data: { email: seller.email, password, name: seller.name },
    });
    if (signUp.status() >= 400) throw new Error(`seller sign-up failed: ${signUp.status()}`);
    const orgsResp = await page.request.get('/api/v1/organizations?limit=10');
    const orgId = ((await orgsResp.json()) as { items: { id: string }[] }).items[0]!.id;
    const addResp = await page.request.post('/api/v1/members', {
      data: { organization_id: orgId, email: seller.email, name: seller.name, roles: ['salesperson'] },
    });
    if (addResp.status() !== 201) {
      throw new Error(`member add failed: ${addResp.status()} ${await addResp.text()}`);
    }
  });

  test('B2 — lead → deal → funding Soumis: the queue counts the engine amount', async ({ page }) => {
    await logIn(page, owner.email);

    await page.goto('/leads/new');
    await page.getByLabel('Succursale').selectOption({ label: STORE.name }); // leads:storeLabel
    await page.getByLabel('Téléphone').fill('+15145551400'); // leads:phone
    await page.getByLabel('Prénom').fill('Carl'); // leads:firstName
    await page.getByLabel('Nom de famille').fill('Client'); // leads:lastName
    await page.getByRole('button', { name: 'Créer le prospect' }).click(); // leads:create
    await page.getByRole('link', { name: 'Créer une transaction' }).click(); // deals:deskAction
    // QC finance (the desking form's default deal type), no extras — the
    // worksheet whose engine outputs are the API suite's creation goldens.
    await page.getByLabel('Prix de vente').fill('30000'); // deals:salePrice
    await page.getByLabel('Coût du véhicule').fill('23000'); // deals:vehicleCost
    const results = page.getByRole('complementary');
    await expect(results.getByText(/7\s?000,00/).first()).toBeVisible(); // front gross
    await page.getByRole('button', { name: 'Enregistrer la transaction' }).click(); // deals:saveDeal
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

    // Funding → Soumis on the pipeline card.
    await page.getByRole('link', { name: 'Pipeline' }).first().click(); // nav:pipeline
    const colNew = page.getByRole('region', { name: 'Nouvelle' }); // deals:stage_new
    await colNew.getByLabel('Financement').selectOption({ label: 'Soumis' }); // deals:fundingLabel / funding_submitted
    await expect(colNew.getByLabel('Financement')).toHaveValue('submitted');

    // The queue figure: 1 dossier at the ENGINE's amount financed — the queue
    // is month-free and its caption says so; lost deals never count (A20).
    await page.goto('/');
    const funding = tile(page, 'Financements en attente');
    await expect(funding.getByText(/1\s·\s34\s?492,50\s?\$/)).toBeVisible(); // fundingValue — engine golden 3_449_250¢
    await expect(funding.getByText(/Dossiers soumis au prêteur/)).toBeVisible(); // dashboard:capFunding
  });

  // Accepted flake window, named (the header's rotting note is the spec's
  // precedent for naming its own limits): B2 creates the lead and this block
  // asserts month-scoped figures on the real wall clock, retries 0. If the
  // store clock's (America/Montreal) month rolls over in between — under a
  // minute of exposure per month, the elapsed time from B2's lead creation
  // to the assertions below — the lead lands in the OLD month while the
  // delivery lands in the new one: leads.created reads 0, and the conversion
  // tile renders « — » where this block expects « 100,0 % »; a rollover
  // between this block's own stage change and its dashboard load zeroes
  // units/gross the same way. A red straddling midnight ET on the 1st is
  // this window, not a product bug — rerun it. (A16 closed the analogous
  // ~1 h/month window in the API suite's SQL month predicates; this
  // cross-block wall-clock gap has no SQL fix, and the suite bans the
  // waits and retries that would paper over it.)
  test('B3 — the f08 delivery walk: units, gross, conversion, « Livrées, non financées »', async ({
    page,
  }) => {
    await logIn(page, owner.email);
    await page.getByRole('link', { name: 'Pipeline' }).first().click();
    const colNew = page.getByRole('region', { name: 'Nouvelle' });

    // f08's proven walk: waive the cancelled cheque WITH a reason, tick the
    // safety inspection (never waivable), print the papers (F-13's wet-ink
    // gate), settle the rest, deliver.
    await colNew.getByRole('button', { name: /Liste de livraison/ }).click(); // deals:checklistFor
    const checklist = page.getByRole('dialog');
    await checklist
      .getByRole('listitem')
      .filter({ hasText: 'Chèque annulé' }) // checklist:item_void_cheque
      .getByRole('button', { name: 'Exempter' })
      .click(); // checklist:waive
    await checklist.getByLabel('Raison de l’exemption').fill('Prélèvement automatique déjà au dossier'); // checklist:waiveReason
    await checklist.getByRole('button', { name: 'Exempter avec cette raison' }).click(); // checklist:waiveConfirm
    await expect(checklist.getByText(/Exempté par/)).toBeVisible(); // checklist:waivedBy
    await checklist.getByLabel('Inspection de sécurité').click(); // checklist:item_safety_inspection
    await expect(checklist.getByLabel('Inspection de sécurité')).toBeChecked();
    await checklist.getByRole('button', { name: 'Fermer' }).click(); // common:close

    // The five papers this financed deal derives (F-13).
    await colNew.getByRole('button', { name: /Documents — / }).click(); // documents:documentsFor
    const docs = page.getByRole('dialog');
    for (const name of [
      'Contrat bancaire',
      'Contrat de vente',
      'Consentement à la confidentialité',
      'Divulgation de l’état du véhicule',
      'Déclaration d’odomètre',
    ]) {
      await docs.getByRole('button', { name: `Marquer produit — ${name}` }).click();
      await docs.getByRole('button', { name: `Marquer imprimé — ${name}` }).click();
    }
    await docs.getByRole('button', { name: 'Fermer' }).click();

    // Settle everything else.
    await colNew.getByRole('button', { name: /Liste de livraison/ }).click();
    const checklist2 = page.getByRole('dialog');
    for (const label of [
      'Assurance du client',
      'Financement approuvé',
      "Vérification d'identité",
      'Véhicule prêt',
      'Dossier signé (original)',
      'Date de livraison',
      'Chauffeurs réservés',
      'Immatriculation',
    ]) {
      await checklist2.getByLabel(label).click();
      await expect(checklist2.getByLabel(label)).toBeChecked();
    }
    await expect(checklist2.getByText('Prête pour la livraison.')).toBeVisible(); // checklist:ready
    await checklist2.getByRole('button', { name: 'Fermer' }).click();

    await colNew.getByLabel('Étape').selectOption({ label: 'Livrée' }); // deals:stageLabel / stage_delivered
    const colDelivered = page.getByRole('region', { name: 'Livrée', exact: true });
    await expect(colDelivered.getByRole('link', { name: 'Carl Client' })).toBeVisible();

    // The figures move — and the deal shows up only where its state truly is.
    await page.goto('/');
    await expect(tile(page, 'Unités livrées ce mois-ci').getByText('1', { exact: true })).toBeVisible();
    await expect(tile(page, 'Profit brut du mois').getByText(/7\s?000,00\s?\$/)).toBeVisible(); // dashboard:statGross — engine golden 700_000¢
    // Server 1 dp quotient rendered as sent: 1 converti / 1 créé → 100,0 %.
    await expect(tile(page, 'Taux de conversion').getByText(/100,0\s?%/)).toBeVisible();
    // Delivered left the OPEN pipeline (stage-based predicate, R2).
    await expect(tile(page, 'Transactions en cours').getByText('0', { exact: true })).toBeVisible();
    // « Livrées, non financées »: delivering never funded it — Carl sits at
    // funding Soumis until the money lands. Scoped to the table row: the
    // funding-status BARS also say « Soumis », and the recent-leads list also
    // says « Carl Client » (as <li>, invisible to a row locator).
    await expect(page.getByRole('heading', { name: 'Livrées, non financées' })).toBeVisible(); // dashboard:unfundedTitle
    const unfundedRow = page.getByRole('row').filter({ hasText: 'Carl Client' });
    await expect(unfundedRow).toHaveCount(1);
    await expect(unfundedRow).toContainText('Soumis'); // deals:funding_submitted
  });

  test('B4 — fund it: the unfunded table and the queue both drain', async ({ page }) => {
    await logIn(page, owner.email);
    await page.getByRole('link', { name: 'Pipeline' }).first().click();
    const colDelivered = page.getByRole('region', { name: 'Livrée', exact: true });
    await colDelivered.getByLabel('Financement').selectOption({ label: 'Financé' }); // deals:funding_funded
    await expect(colDelivered.getByLabel('Financement')).toHaveValue('funded');

    // Both directions proven: the figures that counted the deal let it go.
    await page.goto('/');
    await expect(
      page.getByText('Aucune livraison en attente de financement.', { exact: true }),
    ).toBeVisible(); // emptyUnfunded returns
    await expect(tile(page, 'Financements en attente').getByText(/0\s·\s0,00\s?\$/)).toBeVisible(); // queue back to zero
    await expect(page.getByRole('row').filter({ hasText: 'Carl Client' })).toHaveCount(0);
  });

  test('B5 — one vehicle in stock: the inventory figures and the aging bar', async ({ page }) => {
    await logIn(page, owner.email);
    await page.getByRole('link', { name: 'Inventaire' }).first().click(); // nav:inventory
    await expect(page.getByRole('heading', { name: 'Inventaire' })).toBeVisible(); // vehicles:title
    await page.getByLabel('N° de stock').fill(`F${stamp % 100000}`); // vehicles:stockNo
    await page.getByLabel('Année').fill('2024'); // vehicles:year
    await page.getByLabel('Marque').fill('Kia'); // vehicles:make
    await page.getByLabel('Modèle').fill('Sportage'); // vehicles:model
    await page.getByLabel(/^NIV/).fill('KNDPMCAC5P7000078'); // vehicles:vin
    await page.getByLabel(/^Coût d’acquisition/).fill('25000'); // vehicles:acquisitionCost
    await page.getByLabel(/^Prix affiché/).fill('32900'); // vehicles:listPrice
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); // vehicles:add
    await expect(page.getByRole('cell', { name: '2024 Kia Sportage' })).toBeVisible();

    await page.goto('/');
    await expect(tile(page, 'Véhicules en stock').getByText('1', { exact: true })).toBeVisible();
    // Acquired today: over-30 stays an honest 0 on the store clock (capOver30),
    // and the 0–30 bucket carries the unit — the O-42 chartless bar keeps its
    // count in TEXT, the fill is aria-hidden decoration.
    await expect(
      tile(page, 'En stock depuis plus de 30 jours').getByText('0', { exact: true }),
    ).toBeVisible(); // dashboard:statOver30
    await expect(
      page.getByText('0–30 jours', { exact: true }).locator('..').getByText('1', { exact: true }),
    ).toBeVisible(); // dashboard:aging0_30 row
  });

  test('B6 — salesperson persona: her day, zero figures, ZERO report requests', async ({ browser }) => {
    // A second browser context (R4/R8's graft): the strongest form of the
    // no-403 claim is that no /reports/gm-dashboard request ever EXISTED —
    // recorded from before login to the settled page. (@playwright/test's
    // browser fixture applies the config's context options — baseURL, locale —
    // to newContext(); f74's T1 is the precedent.)
    const ctx = await browser.newContext();
    const spage = await ctx.newPage();
    const gmHits: string[] = [];
    spage.on('response', (r) => {
      if (r.url().includes('/reports/gm-dashboard')) gmHits.push(r.url());
    });

    await logIn(spage, seller.email);
    await expect(spage).toHaveTitle(/Ma journée/); // dashboard:myDayTitle
    await expect(spage.getByRole('heading', { name: /Bonjour/ })).toBeVisible(); // dashboard:greetingName
    await expect(spage.getByText('Rapidité de réponse')).toBeVisible(); // dashboard:speedTitle (activity:read holds)
    await expect(spage.getByRole('heading', { name: 'Prospects récents' })).toBeVisible(); // dashboard:recentTitle
    // Real data over a real round trip: by the time Carl's row is on screen,
    // any report request would long since have fired and been recorded.
    await expect(spage.getByRole('link', { name: 'Carl Client' })).toBeVisible();
    // Zero figures: the report heading never mounts for a non-holder, and the
    // old floor tile stays dead on this final render too.
    await expect(spage.getByText('Chiffres du mois')).toHaveCount(0); // gmTitle absent
    await expect(spage.getByText('Prospects (total)')).toHaveCount(0); // statTotal still gone
    expect(gmHits).toEqual([]);
    await ctx.close();
  });

  test('B7 — R7 at 360 px: re-queue the widest golden, the body never scrolls sideways', async ({
    page,
    browser,
  }) => {
    // R7 rules « body never scrolls sideways; 360/1280 both themes », and
    // this suite is the only place that can measure it on the dashboard. B4
    // drained the funding queue — and with it the only journey value string
    // wide enough to reach a 360 px viewport's edge from a right-hand tile —
    // so this block first re-queues one dossier (B2's exact walk), putting
    // the journey's widest unbreakable string back on the page: fundingValue
    // wraps at its « · », but the NBSP-bound engine amount « 34 492,50 $ »
    // never can.
    await logIn(page, owner.email);
    await page.goto('/leads/new');
    await page.getByLabel('Succursale').selectOption({ label: STORE.name });
    await page.getByLabel('Téléphone').fill('+15145551401');
    await page.getByLabel('Prénom').fill('Diane');
    await page.getByLabel('Nom de famille').fill('Cliente');
    await page.getByRole('button', { name: 'Créer le prospect' }).click();
    await page.getByRole('link', { name: 'Créer une transaction' }).click();
    await page.getByLabel('Prix de vente').fill('30000');
    await page.getByLabel('Coût du véhicule').fill('23000');
    await expect(page.getByRole('complementary').getByText(/7\s?000,00/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
    await page.getByRole('link', { name: 'Pipeline' }).first().click();
    const colNew = page.getByRole('region', { name: 'Nouvelle' });
    await colNew.getByLabel('Financement').selectOption({ label: 'Soumis' });
    await expect(colNew.getByLabel('Financement')).toHaveValue('submitted');

    // The probe: a 360×640 context (the config's baseURL/locale apply to
    // newContext() — B6's precedent), a full dashboard load, then
    // a11y-shell.e2e.ts's overflow measurement on BOTH the document element
    // and the body.
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const p360 = await ctx.newPage();
    await logIn(p360, owner.email);
    await p360.goto('/');
    await expect(p360.getByRole('heading', { name: 'Chiffres du mois' })).toBeVisible();
    await expect(
      tile(p360, 'Financements en attente').getByText(/1\s·\s34\s?492,50\s?\$/),
    ).toBeVisible();
    const overflow = await p360.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.doc, 'the dashboard pans horizontally at 360 px').toBeLessThanOrEqual(1);
    expect(overflow.body, 'the dashboard body pans horizontally at 360 px').toBeLessThanOrEqual(1);
    await ctx.close();
  });
});
