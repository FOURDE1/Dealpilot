import { expect, test } from '@playwright/test';

/**
 * F-06 owner journey: a saved deal appears in the "New" kanban column;
 * stage moves relocate the card; the funding track flips independently.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f06';

test('full F-06 journey: deal → kanban New → stage moves → funding track', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Pipeline');
  await page.getByLabel('Courriel').fill(`f06-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F06 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f06-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F06');
  await page.getByLabel('Code').fill(`F06-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F06' });
  await page.getByLabel('Téléphone').fill('+15145550999');
  await page.getByLabel('Prénom').fill('Chantal');
  await page.getByLabel('Nom de famille').fill('Pipeline');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('30000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // The lead's deal row shows both tracks.
  await expect(page.getByText(/Nouvelle · Non soumis/)).toBeVisible();

  // Kanban: the card is in the "Nouvelle" column with the lead's name.
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pipeline des transactions' })).toBeVisible();
  const colNew = page.getByRole('region', { name: 'Nouvelle' });
  await expect(colNew.getByRole('link', { name: 'Chantal Pipeline' })).toBeVisible();

  // CR-11: only the column with work is open — the other nine fold into
  // slim rails so "Complétée" is not a ten-column scroll away.
  await expect(page.getByRole('button', { name: 'Afficher l’étape Complétée (vide)' })).toBeVisible();
  await page.getByRole('button', { name: 'Afficher l’étape Perdue (vide)' }).click();
  const colLost = page.getByRole('region', { name: 'Perdue' });
  await expect(colLost.getByRole('button', { name: 'Réduire l’étape Perdue' })).toBeVisible();
  await colLost.getByRole('button', { name: 'Réduire l’étape Perdue' }).click();
  await expect(page.getByRole('button', { name: 'Afficher l’étape Perdue (vide)' })).toBeVisible();

  // Move the stage: card leaves "Nouvelle", lands in "Approuvée" — the
  // emptied column folds, the receiving one opens by itself.
  await colNew.getByLabel('Étape').selectOption({ label: 'Approuvée' });
  const colApproved = page.getByRole('region', { name: 'Approuvée' });
  await expect(colApproved.getByRole('link', { name: 'Chantal Pipeline' })).toBeVisible();
  await expect(colNew.getByRole('link', { name: 'Chantal Pipeline' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Afficher l’étape Nouvelle (vide)' })).toBeVisible();

  // Funding moves independently of the stage.
  await colApproved.getByLabel('Financement').selectOption({ label: 'Financé' });
  await expect(colApproved.getByLabel('Financement')).toHaveValue('funded');
  await expect(colApproved.getByRole('link', { name: 'Chantal Pipeline' })).toBeVisible();

  // The lead page reflects both new tracks.
  await colApproved.getByRole('link', { name: 'Chantal Pipeline' }).click();
  await expect(page.getByText(/Approuvée · Financé/)).toBeVisible();
});
