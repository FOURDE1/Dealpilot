import { expect, test } from '@playwright/test';

/**
 * F-38 — the appointments board.
 *
 * One journey: book from the console, take it, confirm it, then cancel it with
 * a reason and watch the board be honest about why the slot emptied. The
 * cancellation is the part that must be right — it is the only final act here.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f38';

test('appointments: book → assign → confirm → cancel with a reason', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Rachelle Horaire');
  await page.getByLabel('Courriel').fill(`f38-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F38 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f38-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F38');
  await page.getByLabel('Code').fill(`F38-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale F38' })).toBeVisible();

  // Book tomorrow at 10:00 — always in the future, so always on the board.
  await page.getByRole('link', { name: 'Rendez-vous' }).first().click();
  await expect(page).toHaveTitle(/Rendez-vous — /);
  const tomorrow = new Date(Date.now() + 24 * 3_600_000);
  const isoDate = tomorrow.toISOString().slice(0, 10);
  await page.getByLabel('Date').fill(isoDate);
  await page.getByLabel('Heure').fill('10:00');
  await page.getByLabel('N° de stock').fill('K4242');
  await page.getByRole('button', { name: 'Réserver', exact: true }).click();

  // Scoped to the board row: the booking form's <select> also contains the
  // text "Essai routier" as an option, which is hidden and matches first.
  const row = page.getByRole('listitem').filter({ hasText: '№ K4242' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Essai routier')).toBeVisible();

  // Take it: the select is labelled per-row by start time.
  await page.getByRole('combobox', { name: /Conseiller — / }).selectOption({ label: 'Rachelle Horaire' });
  await expect(page.getByRole('combobox', { name: /Conseiller — / })).toHaveValue(/./);

  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Confirmé', { exact: true })).toBeVisible();

  // Cancel: the reason gate holds until something explanatory is typed.
  await page.getByRole('button', { name: 'Annuler…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Annuler le rendez-vous' })).toBeDisabled();
  await dialog.getByLabel('Raison').fill('Client a reporté à la semaine prochaine');
  await dialog.getByRole('button', { name: 'Annuler le rendez-vous' }).click();
  await expect(dialog).toBeHidden();

  // Gone from the default board…
  await expect(page.getByText('№ K4242')).toHaveCount(0);
  await expect(page.getByText('Aucun rendez-vous à venir.')).toBeVisible();

  // …and in the history, with its reason on display.
  await page.getByLabel('Afficher l’historique').check();
  await expect(page.getByText('№ K4242')).toBeVisible();
  await expect(page.getByText('Annulé', { exact: true })).toBeVisible();
  await expect(page.getByText(/Annulé : Client a reporté/)).toBeVisible();
});
