import { expect, test } from '@playwright/test';

/**
 * F-09 owner journey: set a pay plan (25% + $1,500 pad) → desk a deal sold
 * by that member ($7,000 total gross) → fund it on the pipeline → the
 * commission line appears: $5,500 commissionable × 25% = $1,375.
 * Mirrors the backend golden (apps/api/src/f09-commissions.test.ts).
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f09';

test('full F-09 journey: pay plan → sold-by deal → funded → $1,375 line', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Payeur');
  await page.getByLabel('Courriel').fill(`f09-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F09 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f09-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F09');
  await page.getByLabel('Code').fill(`F09-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // A salesperson with a pay plan: 25% rate, $1,500 pad.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByLabel('Nom', { exact: true }).fill('Vicky Vendeuse');
  await page.getByLabel('Courriel').fill(`vicky-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Vicky Vendeuse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Plan de rémunération — Vicky Vendeuse' }).click();
  await page.getByLabel('Taux de commission (%)').fill('25');
  await page.getByLabel('Pad (montant déduit du profit)').fill('1500');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The deal: $30,000 sale on $23,000 cost = $7,000 FRONT gross — the
  // salesperson's commission base (F&I product profit is not the seller's).
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F09' });
  await page.getByLabel('Téléphone').fill('+15145551100');
  await page.getByLabel('Prénom').fill('Carl');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Vendu par').selectOption({ label: 'Vicky Vendeuse' });
  await page.getByLabel('Prix de vente').fill('30000');
  await page.getByLabel('Coût du véhicule').fill('23000');
  await page.getByLabel('Produits F&I (prix)').fill('2000');
  await page.getByLabel('Produits F&I (coût)').fill('500');
  const results = page.getByRole('complementary');
  await expect(results.getByText(/7\s?000,00/).first()).toBeVisible(); // front gross
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Fund it on the pipeline — the moment that writes the commission.
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const colNew = page.getByRole('region', { name: 'Nouvelle' });
  await colNew.getByLabel('Financement').selectOption({ label: 'Financé' });
  await expect(colNew.getByLabel('Financement')).toHaveValue('funded');

  // The line: $5,500 × 25% = $1,375, dated today.
  await page.getByRole('link', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('link', { name: 'Voir les commissions' }).click();
  await expect(page.getByRole('heading', { name: 'Commissions' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vente', exact: true })).toBeVisible();
  await expect(page.getByText(/5\s?500,00/)).toBeVisible(); // commissionable gross
  await expect(page.getByText(/1\s?375,00/).first()).toBeVisible(); // the line amount
  await expect(page.getByText('25 %')).toBeVisible();
});
