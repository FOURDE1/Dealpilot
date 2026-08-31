import { expect, test } from '@playwright/test';

/**
 * F-14 injection, extended by F-75 (D-076): a published brand shows the
 * tenant's own NAME in place of the platform name, applies its corner RADIUS
 * and its focus RING — and, since F-75's role split, its colours: the fill
 * units, the on-surface text tone, the sidebar accent, density, font, logo and
 * favicon, all proven in f75-brand-paint.e2e.ts. (The paragraph that used to
 * stand here — "colour injection is deferred (CR-15)" — is no longer true.)
 *
 * This file keeps the F-14 assertions and owns the UNBRANDED half: before a
 * brand exists the shell carries no brand stylesheet, no `data-density`, no
 * favicon <link>, no gated diagnostics, and the platform name in the tab. A
 * tenant with no brand keeps the platform look.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f14';

test('published branding shows the tenant name + radius; no brand keeps the platform look', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Marque');
  await page.getByLabel('Courriel').fill(`f14-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Before any brand exists: the platform name shows, and no brand stylesheet —
  // nor any other trace of a brand on the document (F-75): no density
  // attribute, no favicon link, no gated diagnostics, the platform tab title.
  await expect(page.getByTestId('brand-style')).toHaveCount(0);
  await expect(page.getByText('1Dealer').first()).toBeVisible();
  await expect(page.locator('html[data-density]')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(0);
  await expect(page.locator('[data-brand-gated]')).toHaveCount(0);
  await expect(page).toHaveTitle(/1Dealer/);
  const platformRadius = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
  );
  expect(platformRadius).toBe('0.5rem'); // platform default (md)

  // Create the org, then set + publish a brand through the API (the editor UI
  // is a later increment; this proves the boot-time injection).
  const orgResp = await page.request.post('/api/v1/organizations', {
    data: { name: `Groupe F14 ${stamp}`, slug: `groupe-f14-${stamp}` },
  });
  if (orgResp.status() !== 201) throw new Error(`org create failed: ${orgResp.status()}`);
  const orgId = ((await orgResp.json()) as { id: string }).id;

  const put = await page.request.put(`/api/v1/organizations/${orgId}/branding`, {
    data: { display_name: 'Marque Vive', primary_color: '#7C3AED', radius: 'lg' },
  });
  if (put.status() !== 200) throw new Error(`branding PUT failed: ${put.status()}`);
  const pub = await page.request.post(`/api/v1/organizations/${orgId}/branding/publish`, { data: {} });
  if (pub.status() !== 200) throw new Error(`publish failed: ${pub.status()}`);

  // Reload: the app boots on the published brand.
  await page.goto('/');
  await expect(page.getByTestId('brand-style')).toHaveAttribute('data-brand-version', /^\d+$/);

  // The tenant's name replaces the platform name; the platform name is gone.
  await expect(page.getByText('Marque Vive').first()).toBeVisible();
  await expect(page.getByText('1Dealer')).toHaveCount(0);

  // The corner radius is the brand's 'lg' (0.75rem), not the platform 0.5rem.
  const brandedRadius = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
  );
  expect(brandedRadius).toBe('0.75rem');

  // The focus ring is the brand's, guaranteed ≥3:1 by the server (CR-15) and
  // re-proven by the SPA against the worst-case surface (F-75) — a safe brand
  // colour in both themes.
  const ringLight = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ring').trim(),
  );
  expect(ringLight).toMatch(/^oklch\(/);
  const ringDark = await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    return getComputedStyle(document.documentElement).getPropertyValue('--ring').trim();
  });
  expect(ringDark).toMatch(/^oklch\(/);
  expect(ringDark).not.toBe(ringLight); // the dark ring is derived for the dark surface
});
