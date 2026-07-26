import { expect, test } from '@playwright/test';

/**
 * F-10 owner journey: every state change leaves a line — the lead's history
 * shows who did what and when; the deal's history records stage and funding.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f10';

test('full F-10 journey: lead + deal histories record the acts', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Trace');
  await page.getByLabel('Courriel').fill(`f10-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F10 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f10-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F10');
  await page.getByLabel('Code').fill(`F10-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F10' });
  await page.getByLabel('Téléphone').fill('+15145551300');
  await page.getByLabel('Prénom').fill('Trace');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Trace Client' })).toBeVisible();

  // A status change lands in the lead's history with the actor's name.
  await page.getByLabel('Changer le statut').selectOption({ label: 'Contacté' });
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
  const history = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Historique' }) }).last();
  await expect(history.getByText('Création', { exact: true }).first()).toBeVisible();
  await expect(history.getByText(/Modification — Patron Trace/).first()).toBeVisible();
  await expect(history.getByText(/Statut: Nouveau → Contacté/).first()).toBeVisible();

  // The deal's history records stage and funding moves.
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('25000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const colNew = page.getByRole('region', { name: 'Nouvelle' });
  await colNew.getByLabel('Étape').selectOption({ label: 'Soumise' });
  const colSub = page.getByRole('region', { name: 'Soumise' });
  await colSub.getByLabel('Financement').selectOption({ label: 'Soumis' });
  await colSub.getByRole('button', { name: /Historique/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Étape changée').first()).toBeVisible();
  await expect(dialog.getByText('Financement changé').first()).toBeVisible();
  await expect(dialog.getByText(/Étape: Nouvelle → Soumise/).first()).toBeVisible();
  await expect(dialog.getByText('Création', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();

  // Checklist acts reach the deal's history too (waiver reason included).
  await colSub.getByRole('button', { name: /Liste de livraison/ }).click();
  const chk = page.getByRole('dialog');
  await chk.getByRole('listitem').filter({ hasText: 'Chèque annulé' }).getByRole('button', { name: 'Exempter' }).click();
  await chk.getByLabel('Raison de l’exemption').fill('Déjà au dossier');
  await chk.getByRole('button', { name: 'Exempter avec cette raison' }).click();
  await expect(chk.getByText(/Exempté par/)).toBeVisible();
  await chk.getByRole('button', { name: 'Fermer' }).click();
  await colSub.getByRole('button', { name: /Historique/ }).click();
  const dialog2 = page.getByRole('dialog');
  await expect(dialog2.getByText('Élément exempté').first()).toBeVisible();
  await expect(dialog2.getByText(/Déjà au dossier/).first()).toBeVisible();
});
