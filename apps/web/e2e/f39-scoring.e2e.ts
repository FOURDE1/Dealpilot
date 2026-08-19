import { expect, test } from '@playwright/test';

/**
 * F-39 — the scoring rules screen, end to end: an owner writes a rule, and the
 * next lead is born wearing it. The part that must be right is the chain —
 * rule → engine at create → list chip — because each link passing alone is
 * exactly how a score that never moves ships looking finished.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f39';

test('scoring: rule created → new lead born scored → chip shows the band', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Sonia Pointage');
  await page.getByLabel('Courriel').fill(`f39-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F39 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f39-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F39');
  await page.getByLabel('Code').fill(`F39-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale F39' })).toBeVisible();

  // Write the rule: every lead with a phone is worth 45 — warm on its own.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await page.getByRole('link', { name: 'Règles de pointage' }).click();
  await expect(page).toHaveTitle(/Règles de pointage — /);
  await expect(page.getByText('Aucune règle', { exact: false })).toBeVisible();
  await page.getByLabel('Nom de la règle').fill('Joignable');
  // has_phone / exists are the form defaults; the value input is disabled and
  // says so, which is the schema's valueless-operator rule made visible.
  await expect(page.getByLabel('Valeur')).toBeDisabled();
  await page.getByLabel('Points').fill('45');
  await page.getByRole('button', { name: 'Créer la règle' }).click();
  await expect(page.getByText('Joignable', { exact: true })).toBeVisible();
  await expect(page.getByText('+45')).toBeVisible();

  // The next lead is born wearing it.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F39' });
  await page.getByLabel('Téléphone').fill('+15145550939');
  await page.getByLabel('Prénom').fill('Chantale');
  await page.getByLabel('Nom de famille').fill('Score');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Chantale Score' })).toBeVisible();

  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  await expect(page.getByRole('link', { name: 'Chantale Score' })).toBeVisible();
  await expect(page.getByText('45 · Tiède')).toBeVisible();

  // Deactivating the rule leaves the recorded score alone — the engine runs on
  // create and on demand, never retroactively behind your back.
  await page.getByRole('link', { name: 'Règles de pointage' }).click();
  await page.getByRole('button', { name: 'Désactiver' }).click();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  await expect(page.getByText('45 · Tiède')).toBeVisible();
});
