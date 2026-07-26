import { expect, test } from '@playwright/test';

/**
 * F-05 owner journey: from a lead, price a deal on the worksheet (live
 * recalculation, golden engine numbers), save it, see it under the lead.
 * Golden inputs/outputs mirror apps/api/src/f05-deals.test.ts WORKSHEET.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f05';

test('full F-05 journey: desk a QC deal → golden numbers → ON HST → save', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Desk');
  await page.getByLabel('Courriel').fill(`f05-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F05 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f05-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F05');
  await page.getByLabel('Code').fill(`F05-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F05' });
  await page.getByLabel('Téléphone').fill('+15145550888');
  await page.getByLabel('Prénom').fill('Danielle');
  await page.getByLabel('Nom de famille').fill('Acheteuse');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Danielle Acheteuse' })).toBeVisible();

  // Open the desking worksheet from the lead.
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Feuille de calcul' })).toBeVisible();

  // Golden worksheet (QC finance — money in dollars, parser handles formats).
  await page.getByLabel('Prix de vente').fill('35 000');
  await page.getByLabel('Coût du véhicule').fill('31000');
  await page.getByLabel('Valeur d’échange').fill('10,000.00');
  await page.getByLabel('Valeur réelle (ACV)').fill('9500');
  await page.getByLabel('Solde du prêt (lien)').fill('3000');
  await page.getByLabel('Rabais (après taxes)').fill('2000');
  await page.getByLabel('Frais', { exact: true }).fill('499');
  await page.getByLabel('Produits F&I (prix)').fill('2500');
  await page.getByLabel('Produits F&I (coût)').fill('1500');
  await page.getByLabel('Taux (%)').fill('5,99');
  await page.getByLabel('Terme (mois)').fill('60');

  // Live results — the engine's golden numbers, FR-formatted (any space kind).
  const results = page.getByRole('complementary');
  await expect(results.getByText(/1\s?375,00/)).toBeVisible(); // TPS
  await expect(results.getByText(/2\s?743,13/)).toBeVisible(); // TVQ
  await expect(results.getByText(/4\s?118,13/)).toBeVisible(); // taxes totales
  await expect(results.getByText(/33\s?117,13/)).toBeVisible(); // montant financé
  await expect(results.getByText(/640,09/)).toBeVisible(); // paiement mensuel
  await expect(results.getByText(/4\s?500,00/)).toBeVisible(); // profit total

  // Live recalculation: Ontario switches to a single HST line.
  await page.getByLabel('Province').selectOption('ON');
  await expect(results.getByText('TVH')).toBeVisible();
  await expect(results.getByText('TPS', { exact: true })).toBeHidden();
  await page.getByLabel('Province').selectOption('QC');
  await expect(results.getByText('TPS', { exact: true })).toBeVisible();

  // Lease pricing now uses the typed rate/term + residual (HO-05 golden:
  // QC 35k, MSRP 38k, 5.99%, 48 mo, residual 55% → 444,50 $/mo).
  await page.getByLabel('Type de transaction').selectOption('lease');
  await page.getByLabel('PDSF', { exact: true }).fill('38000');
  await page.getByLabel('Terme (mois)').fill('48');
  await expect(page.getByLabel('Valeur résiduelle (%)')).toHaveValue('55');
  // Full-worksheet lease figure (engine-derived); residual must move it.
  await expect(results.getByText(/337,19/)).toBeVisible();
  await page.getByLabel('Valeur résiduelle (%)').fill('30');
  await expect(results.getByText(/337,19/)).toBeHidden();
  await page.getByLabel('Valeur résiduelle (%)').fill('55');
  await page.getByLabel('Type de transaction').selectOption('finance');
  await page.getByLabel('PDSF', { exact: true }).fill('');
  await page.getByLabel('Terme (mois)').fill('60');

  // Save → back on the lead record (URL, not just heading), the deal listed.
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Danielle Acheteuse', exact: true })).toBeVisible();
  await expect(page.getByText(/640,09\s?\$\/mois/)).toBeVisible();

  // CR-07: re-desking. The worksheet opens on the deal's own numbers and PATCHes.
  await page.getByRole('link', { name: /Modifier la transaction/ }).click();
  await expect(page.getByLabel('Prix de vente')).toHaveValue('35000.00');
  await page.getByLabel('Prix de vente').fill('36000');
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.getByText(/640,09\s?\$\/mois/)).toHaveCount(0); // recomputed
});
