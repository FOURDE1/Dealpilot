import { expect, test } from '@playwright/test';

/**
 * H-04 DoD: FR renders by default, EN switch works with zero missing keys,
 * the preference persists, and <html lang> tracks the locale (Bill 96 +
 * screen-reader correctness).
 */
test('login renders FR-first with fr-CA html lang', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});

test('EN switch translates, persists across reload, and switches back', async ({ page }) => {
  await page.goto('/login');
  // FR UI: the switcher's accessible name is in the current language.
  await page.getByRole('button', { name: "Passer à l'anglais" }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // lang must be re-applied by the boot code after reload, not by the click handler.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');

  await page.getByRole('button', { name: 'Switch to French' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});
