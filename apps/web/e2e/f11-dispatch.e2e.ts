import { expect, test } from '@playwright/test';

/**
 * F-11 owner journey: set up the store's logistics roster → book a run for a
 * deal → it appears on the board with the driver company and the cash to
 * carry → the status track moves → the request email can be resent.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f11';

test('full F-11 journey: fleet roster → book a run → board → status', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Transport');
  await page.getByLabel('Courriel').fill(`f11-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F11 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f11-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F11');
  await page.getByLabel('Code').fill(`F11-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // Logistics roster lives on the store's edit page.
  await page.getByRole('link', { name: 'Succursale F11' }).click();
  await expect(
    page.getByRole('heading', { name: 'Logistique (compagnies, autos-chasseur, plaques)' }),
  ).toBeVisible();
  await page.getByLabel('Nom de la compagnie').fill('Transport Supreme');
  await page.getByLabel('Courriel (reçoit les demandes)').fill(`supreme-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).first().click();
  await expect(page.getByText('Transport Supreme')).toBeVisible();
  await page.getByLabel('Auto-chasseur').fill('Chasseur 1');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).nth(1).click();
  await expect(page.getByText('Chasseur 1')).toBeVisible();
  await page.getByLabel('Plaque marchand').fill(`P${stamp % 10000}`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).nth(2).click();
  await expect(page.getByText(`P${stamp % 10000}`)).toBeVisible();

  // A deal to deliver.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F11' });
  await page.getByLabel('Téléphone').fill('+15145551400');
  await page.getByLabel('Prénom').fill('Livia');
  await page.getByLabel('Nom de famille').fill('Cliente');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('22000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // The signed-file gate refuses a run before the paperwork is ready.
  await page.getByRole('button', { name: /Réserver la livraison/ }).click();
  const gateDialog = page.getByRole('dialog');
  await gateDialog.getByLabel(/Moment prévu/).fill('2026-08-01T14:00');
  await gateDialog.getByRole('button', { name: 'Réserver', exact: true }).click();
  await expect(gateDialog.getByText(/dossier signé complet/)).toBeVisible();
  await gateDialog.getByRole('button', { name: 'Annuler' }).click();

  // Tick the signed file on the checklist, then book for real.
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  const chk = page.getByRole('dialog');
  await chk.getByLabel('Dossier signé (original)').click();
  await expect(chk.getByLabel('Dossier signé (original)')).toBeChecked();
  await chk.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: /Réserver la livraison/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Compagnie de chauffeurs/).selectOption({ label: 'Transport Supreme' });
  await dialog.getByLabel(/Moment prévu/).fill('2026-08-01T14:00');
  await dialog.getByLabel(/Adresse de livraison/).fill('123 Rue Principale, Mont-Laurier');
  await dialog.getByLabel(/Argent à percevoir/).fill('1500');
  await dialog.getByRole('button', { name: 'Réserver', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The board shows the run; the status track moves; resend is available.
  await page.getByRole('link', { name: 'Livraisons' }).first().click();
  await expect(page.getByRole('heading', { name: 'Livraisons et transport' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Livia Cliente', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Transport Supreme', exact: true })).toBeVisible();
  await expect(page.getByText(/1\s?500,00/)).toBeVisible();
  // Resend actually reports the truth (dev mailer logs → sent=false is honest).
  await page.getByRole('button', { name: /Renvoyer la demande/ }).click();
  await expect(page.getByText(/Demande renvoyée|courriel n’est pas parti/)).toBeVisible();

  // A second booking for the same deal is refused BY NAME.
  await page.goto('/leads');
  await page.getByRole('link', { name: 'Livia Cliente' }).click();
  await page.getByRole('button', { name: /Réserver la livraison/ }).click();
  const dupDialog = page.getByRole('dialog');
  await dupDialog.getByRole('button', { name: 'Réserver', exact: true }).click();
  await expect(dupDialog.getByText('Une course existe déjà pour cette transaction.')).toBeVisible();
  await dupDialog.getByRole('button', { name: 'Annuler' }).click();

  // The status track only offers legal moves, and ends stay ended.
  await page.getByRole('link', { name: 'Livraisons' }).first().click();
  const statusSelect = page.getByLabel('Statut').first();
  await expect(statusSelect.getByRole('option', { name: 'Complétée' })).toHaveCount(0);
  await statusSelect.selectOption({ label: 'Partie' });
  await expect(statusSelect).toHaveValue('departed');
  await statusSelect.selectOption({ label: 'Arrivée' });
  await expect(statusSelect).toHaveValue('arrived');
  await statusSelect.selectOption({ label: 'Complétée' });
  await expect(statusSelect).toHaveValue('completed');
  await expect(statusSelect).toBeDisabled();
  await expect(page.getByRole('button', { name: /Renvoyer la demande/ })).toHaveCount(0);
});
