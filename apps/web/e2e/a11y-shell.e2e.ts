import { expect, test } from '@playwright/test';

/** Shell-level a11y guards from the app-wide audit. */
const stamp = Date.now();
const password = 'MotDePasse!2026-a11y';

test('skip link, per-route titles, theme toggle, no reflow overflow', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Accessible');
  await page.getByLabel('Courriel').fill(`a11y-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Skip link is the first Tab stop and moves focus into main.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  // Every route names itself.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await expect(page).toHaveTitle(/Prospects — 1Dealer/);
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page).toHaveTitle(/Équipe — 1Dealer/);

  // Theme toggle flips data-theme and survives a reload.
  await page.getByRole('button', { name: 'Mode sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Mode clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Commissions reachable from the sidebar.
  await page.getByRole('link', { name: 'Commissions' }).first().click();
  await expect(page.getByRole('heading', { name: 'Commissions' })).toBeVisible();
});

test('no horizontal page scroll at 360px on team and leads', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(`a11y-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  for (const path of ['/leads', '/team', '/organizations', '/inventory']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} pans horizontally`).toBeLessThanOrEqual(1);
  }
});
