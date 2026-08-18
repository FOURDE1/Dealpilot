import { expect, test } from '@playwright/test';

/**
 * F-37 — the customer master's screens (FR-CON-003/004/006).
 *
 * One journey: create two records for the same household, see the duplicate
 * REPORTED rather than refused, edit one on the three-column detail page, then
 * fold the duplicate in and watch the survivor carry on. The merge is the part
 * that must be right — it is the only irreversible act on these screens.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f37';

test('customer master: create → duplicate reported → detail edit → merge', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patronne Clientèle');
  await page.getByLabel('Courriel').fill(`f37-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F37 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f37-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);

  // Create the first record from the list page's quick form.
  await page.getByRole('link', { name: 'Clients' }).first().click();
  await expect(page).toHaveTitle(/Clients — /);
  const phone = `514555${String(stamp % 10000).padStart(4, '0')}`;
  await page.getByLabel('Prénom').fill('Chantal');
  await page.getByLabel('Nom de famille').fill('Bergeron');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByRole('link', { name: 'Chantal Bergeron' })).toBeVisible();

  // Second record, same phone: created AND reported, never blocked. Refusing
  // would push a salesperson to invent a fake number.
  await page.getByLabel('Prénom').fill('Réjean');
  await page.getByLabel('Nom de famille').fill('Bergeron');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByText(/Déjà au dossier/)).toBeVisible();
  await expect(page.getByText('même téléphone')).toBeVisible();

  // A record reachable by nothing is refused with a named reason.
  await page.getByLabel('Prénom').fill('Personne');
  await page.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByText('au moins un téléphone ou un courriel')).toBeVisible();

  // Search narrows by name.
  await page.getByLabel('Rechercher').fill('Chantal');
  await expect(page.getByRole('link', { name: 'Chantal Bergeron' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Réjean Bergeron' })).toHaveCount(0);
  await page.getByLabel('Rechercher').clear();

  // Detail: three columns, properties editable, save confirmed.
  await page.getByRole('link', { name: 'Chantal Bergeron' }).click();
  await expect(page.getByRole('heading', { name: 'Chantal Bergeron' })).toBeVisible();
  await expect(page.getByText('Activité', { exact: true })).toBeVisible();
  await expect(page.getByText('Transactions', { exact: true })).toBeVisible();
  await page.getByLabel('Ville').fill('Trois-Rivières');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();

  // The merge: Réjean's record folds into Chantal's. The page you are on is
  // the survivor — the direction is fixed so nobody merges the wrong way.
  await page.getByRole('button', { name: 'Fusionner un doublon' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Trouver la fiche à fusionner').fill('Réjean');
  await expect(dialog.getByText('Réjean Bergeron')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fusionner celle-ci' }).first().click();
  await expect(dialog.getByText(/Fusion terminée/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();

  // The survivor still stands; the merged record is gone from the list.
  await page.getByRole('link', { name: 'Retour aux clients' }).click();
  await expect(page.getByRole('link', { name: 'Chantal Bergeron' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Réjean Bergeron' })).toHaveCount(0);
});
