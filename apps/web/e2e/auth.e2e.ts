import { expect, test } from '@playwright/test';

/**
 * The critical auth journey (H-03 DoD): sign-up → protected dashboard →
 * sign-out → sign-in → dashboard; unauthenticated access redirects to login.
 * Each run registers a fresh user (timestamped email) against the real API.
 */
const password = 'MotDePasse!2026-e2e';
const email = `e2e-${Date.now()}@1dealer.test`;
const name = 'Test E2E';

test.describe.configure({ mode: 'serial' });

test('unauthenticated access redirects to /login with returnTo', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fpipeline/);
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});

test('sign-up lands on the protected dashboard', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(name);
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
});

test('wrong password rejected; sign-in reaches dashboard; sign-out returns to login', async ({ page }) => {
  // Fresh browser context (Playwright isolates tests) — uses the account
  // registered by the previous test, starting from /login.
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toContainText('invalide');

  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);
});
