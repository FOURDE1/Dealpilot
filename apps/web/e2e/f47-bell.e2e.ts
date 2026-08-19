import { expect, test } from '@playwright/test';

/**
 * F-47 — the bell, through the real screens (D-050).
 *
 * One workday's moment: the owner hands Marc a lead by name, Marc signs in to
 * a red badge, opens the bell, reads the alert IN HIS OWN LANGUAGE, follows
 * the deep link to the lead — and the badge is gone, because reading it and
 * following it are one gesture.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f47';

test('assigned by a person → the bell rings for the recipient, deep-links, and clears', async ({ page }) => {
  // The owner and their shop.
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Cloche');
  await page.getByLabel('Courriel').fill(`f47-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe Cloche ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-cloche-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Cloche Kia');
  await page.getByLabel('Code').fill(`F47-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Cloche Kia' })).toBeVisible();

  // Marc joins through the front door (invite → accept).
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByLabel('Nom', { exact: true }).fill('Marc Sonneur');
  await page.getByLabel('Courriel').fill(`marc-f47-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible();
  const acceptUrl = await page.getByLabel('Lien d’invitation').inputValue();
  const token = acceptUrl.split('/').pop() ?? '';
  expect(token).not.toBe('');

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto(`/invitations/${token}`);
  await page.getByLabel('Nom complet').fill('Marc Sonneur');
  await page.getByLabel('Mot de passe').fill(`${password}-marc`);
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click();
  await expect(page).toHaveURL('/');
  // Marc's bell starts silent.
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);

  // The owner hands Marc a lead, by name, from the lead's own page.
  await page.getByLabel('Courriel').fill(`f47-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Cloche Kia' });
  await page.getByLabel('Téléphone').fill('+15145550747');
  await page.getByLabel('Prénom').fill('Nadia');
  await page.getByLabel('Nom de famille').fill('Cliente');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Nadia Cliente' })).toBeVisible();
  await page.getByLabel('Assigner').selectOption({ label: 'Marc Sonneur' });
  const leadUrl = page.url();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);

  // Marc signs in to a red badge.
  await page.getByLabel('Courriel').fill(`marc-f47-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(`${password}-marc`);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  const bell = page.getByRole('button', { name: /Notifications — 1 non lue/ })
    .or(page.locator('summary').filter({ hasText: '1' }));
  await expect(bell.first()).toBeVisible();

  // Open, read in French, follow the deep link.
  await bell.first().click();
  await expect(page.getByText('Le prospect Nadia Cliente vous a été assigné.')).toBeVisible();
  await page.getByText('Le prospect Nadia Cliente vous a été assigné.').click();
  await expect(page).toHaveURL(new URL(leadUrl).pathname);
  await expect(page.getByRole('heading', { name: 'Nadia Cliente' })).toBeVisible();

  // Reading and following were one gesture: the badge is gone.
  await expect(page.locator('summary').filter({ hasText: '1' })).toHaveCount(0);
});
