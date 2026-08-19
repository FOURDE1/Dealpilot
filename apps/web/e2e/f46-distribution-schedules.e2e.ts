import { expect, test } from '@playwright/test';

/**
 * F-45/F-42 UI — the distribution dashboard and the schedule grid, driven.
 *
 * One owner's afternoon: split this month's Meta budget 60/40 between two
 * stores and see the targets confirm it; then give a colleague-less roster
 * its first working window and a bilingual profile, and watch the card agree.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f46';

test('distribution: spend in, targets out — 60/40 on the nose', async ({ page }) => {
  const email = `f46-a-${stamp}@dealer.test`;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Dita Distribution');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // An organization with two stores — the minimum a split needs.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F46 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f46-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  for (const [name, code] of [['F46 Nord', 'N'], ['F46 Sud', 'S']] as const) {
    await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
    await page.getByLabel('Nom de la succursale').fill(name);
    await page.getByLabel('Code').fill(`F46${code}-${stamp % 10000}`);
    await page.getByRole('button', { name: 'Créer la succursale' }).click();
    await expect(page.getByRole('link', { name })).toBeVisible();
  }

  await page.goto('/leads/distribution');
  await expect(page).toHaveTitle(/Répartition des prospects — /);
  await page.getByLabel('F46 Nord').fill('6000');
  await page.getByLabel('F46 Sud').fill('4000');
  await page.getByRole('button', { name: 'Enregistrer les dépenses' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible();
  // The ledger answers with the derived targets.
  await expect(page.getByRole('cell', { name: '60.00 %' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '40.00 %' })).toBeVisible();
});

test('schedules: first window and a bilingual profile, confirmed on the card', async ({ page }) => {
  const email = `f46-b-${stamp}@dealer.test`;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Sacha Cédule');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F46B ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f46b-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('F46B Kia');
  await page.getByLabel('Code').fill(`F46B-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'F46B Kia' })).toBeVisible();

  await page.goto('/team/schedules');
  await expect(page).toHaveTitle(/Horaires de travail — /);
  // No windows yet: the card says always-available, honestly.
  await expect(page.getByText('Aucun horaire — toujours disponible pour l’assignation.')).toBeVisible();

  // Bilingual: tick English beside the default French.
  // getByLabel would also catch the topbar's language-switcher button — the
  // checkbox ROLE is the unambiguous name. click(), not check(): the box is
  // SERVER-controlled and flips only after the save round-trip, which is
  // exactly what the retrying assertion then proves.
  await page.getByRole('checkbox', { name: 'Anglais' }).click();
  await expect(page.getByRole('checkbox', { name: 'Anglais' })).toBeChecked();

  // Cap from 10 to 5, saved.
  await page.getByLabel('Prospects max').fill('5');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();

  // A Monday day shift.
  await page.getByLabel('Jour').selectOption('1');
  await page.getByLabel('Début').fill('09:00');
  await page.getByLabel('Fin').fill('17:00');
  await page.getByRole('button', { name: 'Ajouter le quart' }).click();
  await expect(page.getByText('09:00–17:00')).toBeVisible();
  // The add-form's <option>Lundi</option> answers to the same text — assert
  // on the WINDOW ROW instead.
  await expect(page.locator('li').filter({ hasText: '09:00–17:00' }).last()).toContainText('Lundi');
});
