import { expect, test } from '@playwright/test';

/**
 * F-13 owner journey: which papers a deal needs is derived from the deal
 * itself (financed → bank contract, lien on the trade → payoff authorization,
 * edited to as-is → waiver appears); the booking gate and the wet-ink
 * checklist tick both read the DOCUMENTS and refuse with the actual names
 * until every signature paper is printed; recording a signature is a graded
 * right (document:sign) that the matrix can take away.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f13';

/** The deal row's stored monthly payment ("613,20 $/mois") as a number. */
async function readMonthly(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByText(/\/mois/).first().innerText();
  const digits = text.replace(/[^0-9,]/g, '').replace(',', '.');
  return Number(digits);
}

test('full F-13 journey: derived file → named refusals → print/e-sign → graded signing → gates open', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Papier');
  await page.getByLabel('Courriel').fill(`f13-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F13 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f13-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F13');
  await page.getByLabel('Code').fill(`F13-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F13' });
  await page.getByLabel('Téléphone').fill('+15145551300');
  await page.getByLabel('Prénom').fill('Paula');
  await page.getByLabel('Nom de famille').fill('Papier');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();

  // A financed AS-IS deal with a lien on the trade: bank contract, payoff
  // authorization AND the as-is waiver on top of the four core papers —
  // the flag survives the CREATE (CR-12 closed server-side).
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('20000');
  await page.getByLabel('Solde du prêt (lien)').fill('5000');
  await page.getByLabel('Vente « tel quel »').check();
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Booking warns up front and refuses by NAME — the gate reads the papers.
  await page.getByRole('button', { name: /Réserver la livraison/ }).click();
  const bookDialog = page.getByRole('dialog');
  await expect(
    bookDialog.getByText(/7 documents ne sont pas encore imprimés — la réservation sera refusée/),
  ).toBeVisible();
  await bookDialog.getByRole('button', { name: 'Réserver', exact: true }).click();
  await expect(bookDialog.getByText(/À imprimer : /)).toBeVisible();
  await expect(bookDialog.getByText(/Autorisation de remboursement du solde du prêt/)).toBeVisible();
  await bookDialog.getByRole('button', { name: 'Annuler' }).click();

  // The wet-ink tick is refused the same way, and the refusal NAMES a paper —
  // the bank contract leads the file, so it leads the sentence.
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  const checklist = page.getByRole('dialog');
  await checklist.getByLabel('Dossier signé (original)').click();
  await expect(
    checklist.getByText(/Le dossier papier n’est pas prêt — à imprimer d’abord : Contrat bancaire/),
  ).toBeVisible();
  await expect(checklist.getByLabel('Dossier signé (original)')).not.toBeChecked();
  await checklist.getByRole('button', { name: 'Fermer' }).click();

  // The document panel: seven derived papers, the as-is waiver among them —
  // the CREATE stored the flag directly.
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs = page.getByRole('dialog');
  await expect(docs.getByRole('heading', { name: 'Documents de la transaction' })).toBeVisible();
  await expect(docs.getByText('7 documents ne sont pas encore prêts à voyager.')).toBeVisible();
  for (const name of [
    'Contrat bancaire',
    'Contrat de vente',
    'Consentement à la confidentialité',
    'Divulgation de l’état du véhicule',
    'Déclaration d’odomètre',
    'Autorisation de remboursement du solde du prêt (échange)',
    'Renonciation « tel quel »',
  ]) {
    await expect(docs.getByText(name, { exact: true })).toBeVisible();
  }
  await docs.getByRole('button', { name: 'Fermer' }).click();

  // The edit worksheet tells the truth now: the box arrives CHECKED (the row
  // returns sold_as_is), and an edit that doesn't touch it changes nothing.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await expect(page.getByLabel('Vente « tel quel »')).toBeChecked();
  await page.getByLabel('Prix de vente').fill('21000');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs2 = page.getByRole('dialog');
  await expect(docs2.getByText('7 documents ne sont pas encore prêts à voyager.')).toBeVisible();
  await expect(docs2.getByText('Renonciation « tel quel »', { exact: true })).toBeVisible();
  await docs2.getByRole('button', { name: 'Fermer' }).click();

  // Unchecking it re-derives the file the other way: the untouched waiver is
  // retired — the paper list follows the deal's shape, not its history.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await page.getByLabel('Vente « tel quel »').uncheck();
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: /Documents — / }).click();
  const docsUnchecked = page.getByRole('dialog');
  await expect(docsUnchecked.getByText('6 documents ne sont pas encore prêts à voyager.')).toBeVisible();
  await expect(docsUnchecked.getByText('Renonciation « tel quel »', { exact: true })).toHaveCount(0);
  await docsUnchecked.getByRole('button', { name: 'Fermer' }).click();

  // F-13b: itemised F&I. A hand-typed aggregate first, so the replace guard
  // has something to protect.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await page.getByLabel('Produits F&I (prix)').fill('1000');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  // CR-13 mitigation baseline: the STORED monthly payment with $1,000 of F&I,
  // read off the deal row (monthly_payment_cents — a stored engine output).
  const paymentWith1k = await readMonthly(page);
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  // The armed button below is labelled from `existing.data.fi_price_cents`, so
  // it reads the wrong amount — and never matches — until the deal query lands.
  // Save is disabled while `isEdit && !prefilled`, which makes "Save is enabled"
  // the form's own statement that it has finished loading the deal. Asserting
  // that beats asserting a field value: it is the component's contract rather
  // than a guess about which field hydrates first.
  await expect(page.getByRole('button', { name: 'Enregistrer les modifications' })).toBeEnabled();

  // The FIRST product replaces the typed aggregate — one armed click, then it
  // goes through; the aggregate fields fold into a read-only maintained sum.
  await page.getByLabel('Nom du produit').fill('Or 3 ans');
  await page.getByLabel('Prix du produit').fill('2500');
  await page.getByLabel('Coût du produit').fill('1000');
  await page.getByLabel('Durée (mois)').fill('36');
  await page.getByRole('button', { name: 'Ajouter le produit' }).click();
  await page
    .getByRole('button', { name: /Remplacera le montant F&I saisi \(1\s?000,00\s?\$\)/ })
    .click();
  await expect(page.getByText('Or 3 ans', { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveJSProperty('readOnly', true);
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveValue('2500.00');

  // One warranty per deal — a second is refused BY NAME.
  await page.getByLabel('Nom du produit').fill('Argent 2 ans');
  await page.getByRole('button', { name: 'Ajouter le produit' }).click();
  await expect(page.getByText(/a déjà un produit « Garantie prolongée »/)).toBeVisible();

  // Two aftermarket products are fine — their names tell them apart.
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Produit après-vente' });
  await page.getByLabel('Nom du produit').fill('Antirouille');
  await page.getByLabel('Prix du produit').fill('500');
  await page.getByLabel('Coût du produit').fill('200');
  await page.getByLabel('Durée (mois)').fill('');
  await page.getByRole('button', { name: 'Ajouter le produit' }).click();
  await expect(page.getByRole('button', { name: 'Retirer — Antirouille' })).toBeVisible();
  await page.getByLabel('Nom du produit').fill('Marchepieds');
  await page.getByLabel('Prix du produit').fill('400');
  await page.getByLabel('Coût du produit').fill('100');
  await page.getByRole('button', { name: 'Ajouter le produit' }).click();
  await expect(page.getByRole('button', { name: 'Retirer — Marchepieds' })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer — Marchepieds' }).click();
  await expect(page.getByRole('button', { name: 'Retirer — Marchepieds' })).toHaveCount(0);

  // Save so the stored quote is recomputed from the new sums (CR-13).
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // CR-13 mitigation, proven: $3,000 of itemised F&I (2500 + 500, Marchepieds
  // removed) is a bigger amount financed than the $1,000 aggregate, so the
  // STORED payment on the deal row must have risen — the save recomputed the
  // engine outputs, they did not drift behind the trigger's new sum.
  // Polled, not read once. `toHaveURL` above resolves the moment the router
  // commits, which is before the lead page has refetched the recomputed deal —
  // so a single read gets the PREVIOUS payment and compares it to itself. That
  // passed on an idle laptop and failed in CI, where the refetch is slower than
  // the assertion.
  await expect
    .poll(() => readMonthly(page), {
      message: 'the stored monthly payment never rose after saving $3,000 of itemised F&I — either the save did not recompute the engine outputs (CR-13), or the page is still showing the pre-save quote',
    })
    .toBeGreaterThan(paymentWith1k);

  // The file followed the products: an agreement per product, named after it,
  // and the removed product's agreement is gone with it.
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs3 = page.getByRole('dialog');
  await expect(docs3.getByText('8 documents ne sont pas encore prêts à voyager.')).toBeVisible();
  await expect(docs3.getByText('Garantie prolongée — Or 3 ans', { exact: true })).toBeVisible();
  await expect(docs3.getByText('Produit après-vente — Antirouille', { exact: true })).toBeVisible();
  await expect(docs3.getByText(/Marchepieds/)).toHaveCount(0);

  // Lifecycle is forward-only: a fresh paper offers ONLY "produce" (no jump
  // to printed or filed), and each step leaves a stamped evidence line.
  await expect(docs3.getByRole('button', { name: 'Marquer imprimé — Contrat de vente' })).toHaveCount(0);
  await expect(docs3.getByRole('button', { name: 'Classer — Contrat de vente' })).toHaveCount(0);
  await docs3.getByRole('button', { name: 'Marquer produit — Contrat de vente' }).click();
  await docs3.getByRole('button', { name: 'Marquer imprimé — Contrat de vente' }).click();
  await expect(docs3.getByText(/Imprimé : Patron Papier, .*2026/)).toBeVisible();
  await expect(docs3.getByText('7 documents ne sont pas encore prêts à voyager.')).toBeVisible();

  // E-signing is a legal alternative to printing — it counts as prepared.
  await docs3.getByRole('button', { name: 'Marquer produit — Contrat bancaire' }).click();
  await docs3.getByRole('button', { name: 'Signé électroniquement — Contrat bancaire' }).click();
  await expect(docs3.getByText(/Signé électroniquement : /)).toBeVisible();
  await expect(docs3.getByText('6 documents ne sont pas encore prêts à voyager.')).toBeVisible();

  // F-13c: the rest of the stack moves as a STACK — produce the six untouched
  // papers in one transaction, then print all seven printable ones (the six
  // plus the e-signed bank contract) in another. Counts pin the eligibility.
  await docs3.getByRole('button', { name: 'Tout marquer produit (6)' }).click();
  await docs3.getByRole('button', { name: 'Tout marquer imprimé (7)' }).click();
  await expect(
    docs3.getByText('Dossier prêt à voyager — tous les documents à signer sont imprimés.'),
  ).toBeVisible();

  // F-13c: attach the actual page — the evidence line names who and when, and
  // the stored page opens back from its hash-checked copy.
  await docs3
    .getByLabel('Téléverser la page — Contrat de vente')
    .setInputFiles({
      name: 'page.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
  await expect(docs3.getByText(/Page au dossier : Patron Papier, .*2026/)).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await docs3.getByRole('button', { name: 'Voir la page — Contrat de vente' }).click();
  const popup = await popupPromise;
  await popup.close();

  // Take one signature paper all the way to "signed" while we still hold the
  // right — it becomes the graded-upload probe in the denied step below.
  await docs3.getByRole('button', { name: 'Mettre au dossier — Déclaration d’odomètre' }).click();
  await docs3.getByRole('button', { name: 'Signé à la livraison — Déclaration d’odomètre' }).click();
  await expect(docs3.getByText(/Signé à la livraison : /)).toBeVisible();

  // The wet-ink sheet is printable from here.
  await expect(docs3.getByRole('button', { name: 'Imprimer la feuille du dossier' })).toBeVisible();
  await docs3.getByRole('button', { name: 'Fermer' }).click();

  // Recording a signature is a GRADED right: deny document:sign to this very
  // user and the sign buttons disappear while preparation stays available.
  await page.goto('/team/permissions');
  await page.getByLabel('Personne', { exact: true }).selectOption({ label: 'Patron Papier' });
  await page
    .getByLabel('Permission', { exact: true })
    .selectOption({ label: 'Consigner une signature (signé à la livraison, classé)' });
  await page.getByLabel('Action', { exact: true }).selectOption({ label: 'Refuser' });
  await page.getByLabel('Raison', { exact: true }).fill('Test de la gradation F-13');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Exception appliquée.')).toBeVisible();

  await page.goto('/leads');
  await page.getByRole('link', { name: 'Paula Papier' }).click();
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs4 = page.getByRole('dialog');
  // Preparation is still offered…
  await docs4.getByRole('button', { name: 'Mettre au dossier — Contrat de vente' }).click();
  await expect(docs4.getByText('Dans le dossier', { exact: true })).toBeVisible();
  // …but the signature step is gone while denied.
  await expect(docs4.getByRole('button', { name: 'Signé à la livraison — Contrat de vente' })).toHaveCount(0);
  // Uploading the page is graded the same way: a PREPARE-status paper (Contrat
  // de vente, in the folder) still takes a page…
  await expect(docs4.getByLabel('Téléverser la page — Contrat de vente')).toBeVisible();
  // …but attaching the page that EVIDENCES a signature (Déclaration d’odomètre,
  // already signed) needs document:sign, so its upload is withheld too.
  await expect(docs4.getByLabel('Téléverser la page — Déclaration d’odomètre')).toHaveCount(0);
  await docs4.getByRole('button', { name: 'Fermer' }).click();

  await page.goto('/team/permissions');
  // The exceptions list arrives after the page does, so the clear button does
  // not exist yet — and its absence looks identical to "there is no exception",
  // which is why this failed as a 90s wait rather than anything informative.
  // a13-permissions already waits on this heading for the same screen.
  await expect(page.getByText('Exceptions en vigueur')).toBeVisible();
  await page.getByRole('button', { name: 'Effacer l’exception — Patron Papier' }).click();
  await expect(page.getByText('Exception effacée', { exact: false })).toBeVisible();
  await page.goto('/leads');
  await page.getByRole('link', { name: 'Paula Papier' }).click();
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs5 = page.getByRole('dialog');
  await docs5.getByRole('button', { name: 'Signé à la livraison — Contrat de vente' }).click();
  await expect(docs5.getByText(/Signé à la livraison : /)).toBeVisible();
  await docs5.getByRole('button', { name: 'Fermer' }).click();
  // Wait for it to actually leave. This is the one place in this journey where
  // a dialog opens immediately after another closes, so `getByRole('dialog')`
  // below can still resolve to THIS one on its way out — and then reports the
  // checkbox as "not found", which reads like the checklist is broken.
  await expect(docs5).toBeHidden();

  // With the file prepared, the wet-ink tick goes through…
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  const checklist2 = page.getByRole('dialog');
  await expect(checklist2.getByLabel('Dossier signé (original)')).toBeVisible();
  await checklist2.getByLabel('Dossier signé (original)').click();
  await expect(checklist2.getByLabel('Dossier signé (original)')).toBeChecked();
  await checklist2.getByRole('button', { name: 'Fermer' }).click();

  // …and the booking form no longer warns about the paper file.
  await page.getByRole('button', { name: /Réserver la livraison/ }).click();
  const bookDialog2 = page.getByRole('dialog');
  await expect(bookDialog2.getByRole('heading', { name: /Réserver/ })).toBeVisible();
  await expect(bookDialog2.getByText(/la réservation sera refusée/)).toHaveCount(0);
  await bookDialog2.getByRole('button', { name: 'Annuler' }).click();

  // The deal's history rolls the document moves up, dealer-readable.
  await page.getByRole('button', { name: /Historique/ }).click();
  const history = page.getByRole('dialog');
  await expect(history.getByText('Document: Contrat de vente').first()).toBeVisible();
  await expect(history.getByText(/Produit → Imprimé/).first()).toBeVisible();
});

test('F-13b: removing the last F&I product clears the aggregate — no stale sum resurrected on save', async ({ page }) => {
  const s = stamp + 1;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Zéro');
  await page.getByLabel('Courriel').fill(`f13z-${s}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F13Z ${s}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f13z-${s}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F13Z');
  await page.getByLabel('Code').fill(`F13Z-${s % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F13Z' });
  await page.getByLabel('Téléphone').fill('+15145551399');
  await page.getByLabel('Prénom').fill('Zoé');
  await page.getByLabel('Nom de famille').fill('Zéro');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('20000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Add one product: the aggregate becomes its trigger-maintained sum and the
  // field goes read-only.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Produit après-vente' });
  await page.getByLabel('Nom du produit').fill('Antirouille');
  await page.getByLabel('Prix du produit').fill('500');
  await page.getByLabel('Coût du produit').fill('200');
  await page.getByRole('button', { name: 'Ajouter le produit' }).click();
  await expect(page.getByRole('button', { name: 'Retirer — Antirouille' })).toBeVisible();
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveValue('500.00');
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveJSProperty('readOnly', true);

  // Remove the LAST product: the trigger zeroes the deal aggregate, and the
  // field must follow it to empty — not keep showing $500 (the bug the review
  // caught: a stale sum re-persisted on save).
  await page.getByRole('button', { name: 'Retirer — Antirouille' }).click();
  await expect(page.getByRole('button', { name: 'Retirer — Antirouille' })).toHaveCount(0);
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveValue('');
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveJSProperty('readOnly', false);

  // Save, reopen: the stored aggregate is 0, and nothing resurrected the $500.
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await expect(page.getByLabel('Produits F&I (prix)')).toHaveValue('');
});
