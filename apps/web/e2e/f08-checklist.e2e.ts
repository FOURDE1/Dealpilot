import { expect, test } from '@playwright/test';

/**
 * F-08 owner journey: a deal cannot be Delivered while required checklist
 * items are outstanding; waivers need a recorded reason; the safety
 * inspection can never be waived; a delivered deal's checklist freezes.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f08';

test('full F-08 journey: gate blocks → tick/waive → deliver → frozen', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Livraison');
  await page.getByLabel('Courriel').fill(`f08-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F08 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f08-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F08');
  await page.getByLabel('Code').fill(`F08-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F08' });
  await page.getByLabel('Téléphone').fill('+15145551200');
  await page.getByLabel('Prénom').fill('Diane');
  await page.getByLabel('Nom de famille').fill('Livrée');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('20000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // The gate: Delivered is refused, naming what is outstanding.
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const colNew = page.getByRole('region', { name: 'Nouvelle' });
  await colNew.getByLabel('Étape').selectOption({ label: 'Livrée' });
  await expect(page.getByText(/obligation légale que personne ne peut exempter/)).toBeVisible();
  await expect(page.getByText(/Inspection de sécurité/)).toBeVisible();

  // Open the checklist from the card.
  await colNew.getByRole('button', { name: /Liste de livraison/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Liste de livraison' })).toBeVisible();
  await expect(dialog.getByText('0 de 10 éléments réglés.')).toBeVisible();

  // Tick a few; waive one WITH a reason (a blank reason cannot submit).
  // Controlled checkboxes flip only after the server confirms — click, then wait.
  await dialog.getByLabel('Assurance du client').click();
  await expect(dialog.getByLabel('Assurance du client')).toBeChecked();
  await expect(dialog.getByText('1 de 10 éléments réglés.')).toBeVisible();
  // CR-09: the record says WHEN, next to WHO.
  await expect(dialog.getByText(/Fait — Patron Livraison, .*2026/)).toBeVisible();
  await dialog.getByRole('listitem').filter({ hasText: 'Chèque annulé' }).getByRole('button', { name: 'Exempter' }).click();
  await expect(dialog.getByRole('button', { name: 'Exempter avec cette raison' })).toBeDisabled();
  await dialog.getByLabel('Raison de l’exemption').fill('Prélèvement automatique déjà au dossier');
  await dialog.getByRole('button', { name: 'Exempter avec cette raison' }).click();
  await expect(dialog.getByText(/Exempté par/)).toBeVisible();
  await expect(dialog.getByText(/Prélèvement automatique déjà au dossier/)).toBeVisible();

  // Reinstating asks twice — one click only arms the confirmation.
  await dialog.getByRole('button', { name: 'Rétablir' }).click();
  await expect(dialog.getByRole('button', { name: /Confirmer\? \(la raison sera effacée\)/ })).toBeVisible();
  await expect(dialog.getByText(/Prélèvement automatique déjà au dossier/)).toBeVisible(); // still there
  await dialog.getByRole('button', { name: /Confirmer\? \(la raison sera effacée\)/ }).click();
  await expect(dialog.getByText(/Exempté par/)).toHaveCount(0);
  // Waive it again for the rest of the journey.
  await dialog.getByRole('listitem').filter({ hasText: 'Chèque annulé' }).getByRole('button', { name: 'Exempter' }).click();
  await dialog.getByLabel('Raison de l’exemption').fill('Prélèvement automatique déjà au dossier');
  await dialog.getByRole('button', { name: 'Exempter avec cette raison' }).click();
  await expect(dialog.getByText(/Exempté par/)).toBeVisible();

  // The safety inspection offers NO waive control.
  const safetyRow = dialog.getByRole('listitem').filter({ hasText: 'Inspection de sécurité' });
  await expect(safetyRow.getByRole('button', { name: 'Exempter' })).toHaveCount(0);

  // Tick safety first — the next refusal must use the ORDINARY wording.
  await dialog.getByLabel('Inspection de sécurité').click();
  await expect(dialog.getByLabel('Inspection de sécurité')).toBeChecked();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await colNew.getByLabel('Étape').selectOption({ label: 'Livrée' });
  await expect(page.getByText(/Livraison bloquée — éléments en attente/)).toBeVisible();
  await expect(page.getByText(/obligation légale/)).toHaveCount(0);

  // F-13: the wet-ink tick is refused until the paper file is printed — print
  // the five papers this financed deal derives, then settle everything else.
  await colNew.getByRole('button', { name: /Documents — / }).click();
  const f13docs = page.getByRole('dialog');
  for (const name of [
    'Contrat bancaire',
    'Contrat de vente',
    'Consentement à la confidentialité',
    'Divulgation de l’état du véhicule',
    'Déclaration d’odomètre',
  ]) {
    await f13docs.getByRole('button', { name: `Marquer produit — ${name}` }).click();
    await f13docs.getByRole('button', { name: `Marquer imprimé — ${name}` }).click();
  }
  await f13docs.getByRole('button', { name: 'Fermer' }).click();

  // Settle everything else.
  await colNew.getByRole('button', { name: /Liste de livraison/ }).click();
  const dialog2 = page.getByRole('dialog');
  for (const label of [
    'Financement approuvé',
    "Vérification d'identité",
    'Véhicule prêt',
    'Dossier signé (original)',
    'Date de livraison',
    'Chauffeurs réservés',
    'Immatriculation',
  ]) {
    await dialog2.getByLabel(label).click();
    await expect(dialog2.getByLabel(label)).toBeChecked();
  }
  await expect(dialog2.getByText('Prête pour la livraison.')).toBeVisible();
  await dialog2.getByRole('button', { name: 'Fermer' }).click();

  // Delivered now goes through; the checklist is frozen afterwards.
  await colNew.getByLabel('Étape').selectOption({ label: 'Livrée' });
  const colDelivered = page.getByRole('region', { name: 'Livrée', exact: true });
  await expect(colDelivered.getByRole('link', { name: 'Diane Livrée' })).toBeVisible();
  await colDelivered.getByRole('button', { name: /Liste de livraison/ }).click();
  await expect(page.getByText('Transaction livrée — la liste est figée : c’est la preuve.')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Assurance du client')).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();

  // Store policy: switching an item off applies to FUTURE deals only;
  // the safety inspection cannot be switched off at all.
  await page.getByRole('link', { name: 'Groupes' }).first().or(page.getByRole('link', { name: 'Organisations' }).first()).click();
  await page.getByRole('link', { name: `Groupe F08 ${stamp}` }).click();
  await page.getByRole('link', { name: 'Succursale F08' }).click();
  await expect(page.getByRole('heading', { name: 'Liste de livraison (politique de la succursale)' })).toBeVisible();
  await page.getByLabel('Chauffeurs réservés').click();
  await expect(page.getByLabel('Chauffeurs réservés')).not.toBeChecked();
  await expect(page.getByLabel('Inspection de sécurité')).toBeDisabled();
});
