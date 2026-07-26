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
  const docs3 = page.getByRole('dialog');
  await expect(docs3.getByText('6 documents ne sont pas encore prêts à voyager.')).toBeVisible();
  await expect(docs3.getByText('Renonciation « tel quel »', { exact: true })).toHaveCount(0);

  // Lifecycle is forward-only: a fresh paper offers ONLY "produce" (no jump
  // to printed or filed), and each step leaves a stamped evidence line.
  await expect(docs3.getByRole('button', { name: 'Marquer imprimé — Contrat de vente' })).toHaveCount(0);
  await expect(docs3.getByRole('button', { name: 'Classer — Contrat de vente' })).toHaveCount(0);
  await docs3.getByRole('button', { name: 'Marquer produit — Contrat de vente' }).click();
  await docs3.getByRole('button', { name: 'Marquer imprimé — Contrat de vente' }).click();
  await expect(docs3.getByText(/Imprimé : Patron Papier, .*2026/)).toBeVisible();
  await expect(docs3.getByText('5 documents ne sont pas encore prêts à voyager.')).toBeVisible();

  // E-signing is a legal alternative to printing — it counts as prepared.
  await docs3.getByRole('button', { name: 'Marquer produit — Contrat bancaire' }).click();
  await docs3.getByRole('button', { name: 'Signé électroniquement — Contrat bancaire' }).click();
  await expect(docs3.getByText(/Signé électroniquement : /)).toBeVisible();
  await expect(docs3.getByText('4 documents ne sont pas encore prêts à voyager.')).toBeVisible();

  // Print the remaining four; the banner flips to "ready to travel".
  for (const name of [
    'Consentement à la confidentialité',
    'Divulgation de l’état du véhicule',
    'Déclaration d’odomètre',
    'Autorisation de remboursement du solde du prêt (échange)',
  ]) {
    await docs3.getByRole('button', { name: `Marquer produit — ${name}` }).click();
    await docs3.getByRole('button', { name: `Marquer imprimé — ${name}` }).click();
  }
  await expect(
    docs3.getByText('Dossier prêt à voyager — tous les documents à signer sont imprimés.'),
  ).toBeVisible();
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
  await docs4.getByRole('button', { name: 'Fermer' }).click();

  await page.goto('/team/permissions');
  await page.getByRole('button', { name: 'Effacer l’exception — Patron Papier' }).click();
  await expect(page.getByText('Exception effacée', { exact: false })).toBeVisible();
  await page.goto('/leads');
  await page.getByRole('link', { name: 'Paula Papier' }).click();
  await page.getByRole('button', { name: /Documents — / }).click();
  const docs5 = page.getByRole('dialog');
  await docs5.getByRole('button', { name: 'Signé à la livraison — Contrat de vente' }).click();
  await expect(docs5.getByText(/Signé à la livraison : /)).toBeVisible();
  await docs5.getByRole('button', { name: 'Fermer' }).click();

  // With the file prepared, the wet-ink tick goes through…
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  const checklist2 = page.getByRole('dialog');
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
