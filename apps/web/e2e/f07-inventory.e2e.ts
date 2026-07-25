import { expect, test } from '@playwright/test';

/**
 * F-07 owner journey: stock a car (cost build-up) → it lists with the derived
 * total cost → desk a deal from a lead picking that car (cost/price prefill,
 * golden front gross) → mark it sold on the vehicle page.
 * Golden mirrors apps/api/src/f07-vehicles.test.ts: $32,900 sale on $27,650
 * total cost → $5,250 front gross.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f07';

test('full F-07 journey: stock a car → desk it → golden gross → sold', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Stock');
  await page.getByLabel('Courriel').fill(`f07-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F07 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f07-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F07');
  await page.getByLabel('Code').fill(`F07-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // Stock the car: 25 000 + 650 + 2 000 = 27 650 total cost.
  await page.getByRole('link', { name: 'Inventaire' }).first().click();
  await expect(page.getByRole('heading', { name: 'Inventaire' })).toBeVisible();
  await page.getByLabel('N° de stock').fill(`K${stamp % 100000}`);
  await page.getByLabel('Année').fill('2023');
  await page.getByLabel('Marque').fill('Kia');
  await page.getByLabel('Modèle').fill('Sportage');
  await page.getByLabel('NIV').fill('KNDPMCAC5P7000001');
  await page.getByLabel('Coût d’acquisition').fill('25000');
  await page.getByLabel('Transport', { exact: true }).fill('650');
  await page.getByLabel('Reconditionnement').fill('2000');
  await page.getByLabel('Prix affiché').fill('32900');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('cell', { name: '2023 Kia Sportage' })).toBeVisible();
  await expect(page.getByText(/27\s?650,00/)).toBeVisible(); // derived total cost

  // Desk it from a lead: picking the car prefills price (32 900) and cost (27 650).
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F07' });
  await page.getByLabel('Téléphone').fill('+15145551000');
  await page.getByLabel('Prénom').fill('Ali');
  await page.getByLabel('Nom de famille').fill('Acheteur');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Véhicule', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByLabel('Prix de vente')).toHaveValue('32900.00');
  await expect(page.getByLabel('Coût du véhicule')).toHaveValue('27650.00');
  const results = page.getByRole('complementary');
  // Golden gross: no F&I on this deal, so front AND total gross are both $5,250.
  await expect(results.getByText(/5\s?250,00/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Mark the car sold (pending delivery) on its page; the list reflects it.
  await page.getByRole('link', { name: 'Inventaire' }).first().click();
  await page.getByRole('link', { name: `K${stamp % 100000}` }).click();
  await expect(page.getByRole('heading', { name: '2023 Kia Sportage' })).toBeVisible();
  await page.getByLabel('Statut de vente').selectOption({ label: 'Vendu (en attente)' });
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
  await page.getByRole('link', { name: 'Retour à l’inventaire' }).click();
  await expect(page.getByRole('cell', { name: 'Vendu (en attente)' })).toBeVisible();
});
