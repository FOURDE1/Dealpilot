import { expect, test } from '@playwright/test';

/**
 * ui-design-system §7: below lg the sidebar hides and a bottom tab bar
 * carries the primary destinations — the app must stay navigable on phones.
 */
test.use({ viewport: { width: 390, height: 844 } });

test('phone viewport navigates via the bottom tab bar', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Mobile Test');
  await page.getByLabel('Courriel').fill(`mob-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-mob');
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Desktop sidebar is hidden (display:none removes it from the a11y tree);
  // exactly ONE navigation landmark remains — the bottom bar.
  const bottomNav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(bottomNav).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(1);

  await bottomNav.getByRole('link', { name: 'Groupes' }).click();
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();

  await bottomNav.getByRole('link', { name: 'Prospects' }).click();
  await expect(page.getByRole('heading', { name: 'Prospects' })).toBeVisible();

  await bottomNav.getByRole('link', { name: 'Accueil' }).click();
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();

  // 5 tabs must fit at phone width — no horizontal overflow in the tab bar.
  const bar = page.locator('nav.fixed');
  const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // No individual label may clip either (WCAG: the text must actually be readable).
  const clipped = await bar.evaluate((el) =>
    Array.from(el.querySelectorAll('a')).filter((a) => a.scrollWidth > a.clientWidth + 1).length,
  );
  expect(clipped).toBe(0);
});
