import { expect, test } from '@playwright/test';

/**
 * F-40 — assignment rules, end to end: an owner writes a routing rule, and the
 * next lead is born with a name beside it. The chain is the assertion — rule
 * screen → engine at create → the list's Assigné à column — because a routing
 * engine whose leads still read "Non assigné" is exactly the kind of finished-
 * looking nothing this codebase keeps hunting.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f40';

test('assignment: rule created → new lead born assigned', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Rita Routage');
  await page.getByLabel('Courriel').fill(`f40-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F40 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f40-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F40');
  await page.getByLabel('Code').fill(`F40-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale F40' })).toBeVisible();

  // Write the rule: a catch-all round robin. The screen says priority is
  // ASCENDING — the opposite of scoring next door.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await page.getByRole('link', { name: 'Règles d’assignation' }).click();
  await expect(page).toHaveTitle(/Règles d’assignation — /);
  await expect(page.getByText('Aucune règle', { exact: false })).toBeVisible();
  await page.getByLabel('Nom de la règle').fill('Rotation F40');
  await page.getByRole('button', { name: 'Créer la règle' }).click();
  await expect(page.getByText('Rotation F40', { exact: true })).toBeVisible();

  // The next lead is born with a name beside it.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F40' });
  await page.getByLabel('Téléphone').fill('+15145550940');
  await page.getByLabel('Prénom').fill('Benoît');
  await page.getByLabel('Nom de famille').fill('Routé');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Benoît Routé' })).toBeVisible();

  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Benoît Routé' });
  await expect(row).toBeVisible();
  // Born ASSIGNED — the engine routed at create, and to the only member.
  await expect(row.getByText('Rita Routage')).toBeVisible();
  await expect(row.getByText('Non assigné')).toHaveCount(0);
});
