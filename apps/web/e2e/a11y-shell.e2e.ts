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

  // The URL changes the moment the router commits, which is BEFORE the shell
  // has rendered. Tabbing into a half-built page moves focus to whatever
  // happens to exist, so wait for the skip link itself to be there — the very
  // thing the next line asserts is focused.
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeAttached();

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

/**
 * WCAG 2.2 reflow (1.4.10) at the 360px floor PROJECT.md commits to.
 *
 * The version of this test that shipped first checked four routes on a brand
 * new account, which meant four empty states. An empty table cannot pan
 * sideways, so it could not have failed — it read as coverage while asserting
 * nothing. The inventory table alone is six columns wide, and the thing most
 * likely to push a narrow layout out is a string that cannot wrap: a stock
 * number, a phone number, a hyphenated Québécois surname.
 *
 * So each route is now seeded with a real row, and the row is asserted VISIBLE
 * before the overflow is measured — otherwise a listing that quietly broke
 * would hand back a comfortable zero.
 */
test('no horizontal page scroll at 360px, with real rows in every table', async ({ page }) => {
  // Signs up its own account rather than logging into the one above. Sharing it
  // made this test fail whenever the FIRST test failed, for reasons that had
  // nothing to do with reflow — two reds for one bug, and the second one
  // pointed at the wrong file.
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patronne Mobile');
  await page.getByLabel('Courriel').fill(`a11y-mobile-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Seed at desktop width and shrink afterwards. Filling forms at 360px would
  // mix "can you operate this narrow" into a test about whether the page pans,
  // and a failure would not say which.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe A11Y ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-a11y-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale A11Y');
  await page.getByLabel('Code').fill(`A11-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: 'Succursale A11Y' })).toBeVisible();

  // A long hyphenated surname next to a phone number: the widest unbreakable
  // pair the leads table routinely carries.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale A11Y' });
  await page.getByLabel('Téléphone').fill('+15145550911');
  await page.getByLabel('Prénom').fill('Marie-Ève');
  await page.getByLabel('Nom de famille').fill('Beauchemin-Lafontaine');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: /Beauchemin-Lafontaine/ })).toBeVisible();

  // Six columns, two of them monospace currency.
  await page.getByRole('link', { name: 'Inventaire' }).first().click();
  await expect(page.getByRole('heading', { name: 'Inventaire' })).toBeVisible();
  await page.getByLabel('N° de stock').fill(`A11Y${stamp % 100000}`);
  await page.getByLabel('Année').fill('2024');
  await page.getByLabel('Marque').fill('Hyundai');
  await page.getByLabel('Modèle').fill('Santa Fe');
  await page.getByLabel(/^NIV/).fill('5NMS5DAJ2RH000911');
  await page.getByLabel(/^Coût d’acquisition/).fill('31000');
  await page.getByLabel(/^Prix affiché/).fill('38900');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('cell', { name: '2024 Hyundai Santa Fe' })).toBeVisible();

  // Each route paired with something that must be on screen for the
  // measurement below to mean anything.
  const seeded: [string, RegExp][] = [
    ['/leads', /Beauchemin-Lafontaine/],
    ['/team', /Patronne Mobile/],
    ['/organizations', new RegExp(`Groupe A11Y ${stamp}`)],
    ['/inventory', /2024 Hyundai Santa Fe/],
  ];

  await page.setViewportSize({ width: 360, height: 740 });
  for (const [path, marker] of seeded) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // Scoped to main: the topbar also prints the signed-in user's name, and it
    // is deliberately hidden below the sm breakpoint. An unscoped match found
    // that span, called the roster present, and would have gone on to measure a
    // /team page whose table might not have rendered at all.
    await expect(
      page.locator('main#main').getByText(marker).first(),
      `${path} rendered no seeded row, so its overflow measurement proves nothing`,
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} pans horizontally`).toBeLessThanOrEqual(1);
  }
});
