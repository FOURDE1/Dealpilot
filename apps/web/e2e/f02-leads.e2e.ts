import { expect, test } from '@playwright/test';

/**
 * F-02 owner journey: create a lead → see it in the list → change its status.
 * Runs only once the AHMAD lead routes are on develop (this file is written
 * ahead of integration). Fresh user + org per run.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f02';

test('full F-02 journey: lead create → list → status change', async ({ page }) => {
  // Fresh user with an org + store (prerequisites for a lead).
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Vendeur Test');
  await page.getByLabel('Courriel').fill(`f02-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F02 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f02-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F02');
  await page.getByLabel('Code').fill(`F02-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale F02' })).toBeVisible();

  // Leads: empty → create (org preselected for single-org users).
  await page.getByRole('link', { name: 'Prospects' }).click();
  await expect(page.getByRole('heading', { name: 'Prospects' })).toBeVisible();
  await expect(page.getByText('Aucun prospect', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Nouveau prospect' }).click();

  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F02' });
  await page.getByLabel('Téléphone').fill('+15145550199');
  await page.getByLabel('Prénom').fill('Marie');
  await page.getByLabel('Nom de famille').fill('Tremblay');
  await page.getByLabel('Véhicule recherché').fill('Kia Sportage 2026');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();

  // Detail: born `new`, change status to contacted.
  await expect(page.getByRole('heading', { name: 'Marie Tremblay' })).toBeVisible();
  await expect(page.getByLabel('Changer le statut')).toHaveValue('new');
  await page.getByLabel('Changer le statut').selectOption('contacted');
  // This message is not transient — `feedback` stays 'saved' until the next
  // action, and nothing clears it on a timer. So a miss means the PATCH had not
  // come back yet, never that the confirmation flashed past. (The config's
  // 15s expect timeout is what buys the round trip enough room.)
  await expect(
    page.getByText('Modifications enregistrées.'),
    'the status change never confirmed — if an error is showing beside the selector, the PATCH failed rather than lagged',
  ).toBeVisible();

  // List shows the lead with the new status.
  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  await expect(page.getByRole('link', { name: 'Marie Tremblay' })).toBeVisible();
  await expect(page.getByText('Contacté')).toBeVisible();
  // F-39: born scored. This fresh org has no scoring rules, so the honest
  // number is 0 and the band is cold — a chip, never a blank, because "nobody
  // ever looked" stopped being a state a new lead can be in.
  await expect(page.getByText('0 · Froid')).toBeVisible();
});

test('client-side validation is localized and blocks a bad phone', async ({ page }) => {
  // Self-contained: fresh user + org + store so only the phone is invalid.
  const s2 = Date.now();
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Validation Test');
  await page.getByLabel('Courriel').fill(`f02v-${s2}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe V ${s2}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-v-${s2}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale V');
  await page.getByLabel('Code').fill(`V-${s2 % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale V' })).toBeVisible();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale V' });
  await page.getByLabel('Téléphone').fill('not-a-phone');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  // Localized zod message (FR — Bill 96), tied to the phone field.
  await expect(page.getByText('Valeur invalide.')).toBeVisible();
  await expect(page.getByLabel('Téléphone')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL('/leads/new'); // no navigation happened
});
