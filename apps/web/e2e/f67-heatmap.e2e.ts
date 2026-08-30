import { expect, test } from '@playwright/test';

/**
 * F-67 — the activity heatmap (/analytics/activity-heatmap), through the real
 * screens. Reached from the reports sub-nav, because that is the only way in:
 * the sidebar's "Rapports" entry points at win/loss, and the heatmap is one
 * click further.
 *
 * A fresh tenant has no messages, and this asserts that the page says so
 * rather than drawing a 7x24 grid of zeros and calling it a report. The
 * timezone line is the part with teeth: the report names the clock it bucketed
 * in, and for a store created through the UI that is America/Montreal — the
 * same store clock F-68's buckets use.
 *
 * GAP, deliberately not faked: the POPULATED grid is untested here. Cells come
 * from `messages`, and the only way a message row exists is an inbound SMS
 * webhook or a carrier send — there is no UI that originates a conversation,
 * so seeding one from a browser is impossible without reaching past the app.
 * Everything below is the empty cut. The axes, the intensity scale, the
 * best-contact-times ranking and the per-cell text are covered by nothing that
 * opens a browser.
 */

const stamp = Date.now();
const password = 'MotDePasse!2026-f67';
const owner = { name: 'Hugo Carte', email: `f67-${stamp}@1dealer.test` };
const org = { name: `Groupe F67 ${stamp}`, slug: `groupe-f67-${stamp}` };
const STORE = 'Succursale F67';

/** The tile's number sits in the paragraph after its label. */
const tileValue = (label: string, page: import('@playwright/test').Page) =>
  page.locator('p', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::p[1]');

test('a tenant with no conversations gets an honest empty heatmap, not a grid of zeros', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(owner.name);
  await page.getByLabel('Courriel').fill(owner.email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // The report is bucketed in a store's timezone, so it needs a store to name.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name);
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill(STORE);
  await page.getByLabel('Code').fill(`F67-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  // In through the front door: sidebar -> Rapports -> the heatmap.
  await page.getByRole('link', { name: 'Rapports' }).first().click();
  await expect(page).toHaveURL('/analytics/win-loss');
  await page.getByRole('link', { name: 'Carte d’activité' }).click();
  await expect(page).toHaveURL('/analytics/activity-heatmap');
  await expect(page).toHaveTitle(/^Carte d’activité — /);
  await expect(page.getByRole('heading', { name: 'Carte d’activité', level: 1 })).toBeVisible();
  // The sub-nav stops being a link once you are on it and says so out loud.
  await expect(page.locator('[aria-current="page"]')).toHaveText('Carte d’activité');

  // The cut the page opens on, and the controls that change it.
  await expect(page.getByLabel('Période')).toHaveValue('90d');
  await expect(page.getByLabel('Sens')).toHaveValue('');
  await expect(page.getByText('Chargement…')).toHaveCount(0);

  // The report names the clock it counted in — the store's, not the viewer's.
  await expect(page.getByText('Fuseau : America/Montreal')).toBeVisible();
  await expect(tileValue('Reçus', page)).toHaveText('0');
  await expect(tileValue('Envoyés', page)).toHaveText('0');
  await expect(page.getByText('Aucune activité sur la période.')).toBeVisible();

  // No activity means NO grid: the page withholds the 7x24 table and the
  // best-times ranking rather than drawing empty axes that imply a measurement.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Meilleurs créneaux de contact' })).toHaveCount(0);

  // Narrowing the cut re-asks the server and stays honest instead of falling
  // back to a stale or fabricated grid.
  await page.getByLabel('Sens').selectOption({ label: 'Reçus' });
  await expect(page.getByText('Aucune activité sur la période.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  // The longest window a tenant one minute old can ask for is still empty —
  // an "all time" report that invented rows would show up right here.
  await page.getByLabel('Période').selectOption({ label: 'Tout' });
  await expect(page.getByText('Aucune activité sur la période.')).toBeVisible();
  await expect(tileValue('Reçus', page)).toHaveText('0');
  await expect(tileValue('Envoyés', page)).toHaveText('0');
});
