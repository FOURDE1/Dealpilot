import { expect, test } from '@playwright/test';

/**
 * F-01 owner journey: sign in → create organization → edit it → create a
 * store → see it listed → edit the store. Mirrors the owner-test steps on
 * the F-01 board row. Fresh user per run; slug/code unique per run.
 */
const stamp = Date.now();
const user = {
  email: `f01-${stamp}@1dealer.test`,
  password: 'MotDePasse!2026-f01',
  name: 'Proprio Test',
};
const org = { name: `Groupe Essai ${stamp}`, slug: `groupe-essai-${stamp}` };

test.describe.configure({ mode: 'serial' });

test('full F-01 journey: org create/edit + store create/edit', async ({ page }) => {
  // Sign up.
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(user.name);
  await page.getByLabel('Courriel').fill(user.email);
  await page.getByLabel('Mot de passe').fill(user.password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Organizations: empty state → create.
  await page.getByRole('link', { name: 'Organisations' }).click();
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
  await expect(page.getByText('Aucune organisation')).toBeVisible();
  await page.getByRole('link', { name: 'Nouvelle organisation' }).click();

  await page.getByLabel("Nom de l'organisation").fill(org.name);
  // Slug is auto-suggested from the name; override to the unique value.
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();

  // Detail page: name + slug visible, stores empty.
  await expect(page.getByRole('heading', { name: org.name })).toBeVisible();
  await expect(page.getByText(org.slug)).toBeVisible();
  await expect(page.getByText('Aucune succursale pour cette organisation.')).toBeVisible();

  // Edit the organization name.
  const renamed = `${org.name} inc.`;
  await page.getByLabel("Nom de l'organisation").fill(renamed);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();

  // Create a store (province defaults to QC).
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Kia Mont-Laurier');
  await page.getByLabel('Code').fill(`KML-${stamp % 10000}`);
  await page.getByLabel('Ville').fill('Mont-Laurier');
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // Back on detail: store listed.
  await expect(page.getByRole('heading', { name: 'Succursales' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kia Mont-Laurier' })).toBeVisible();

  // Edit the store, and set its store settings (Ahmad's F-13b/c contract):
  // a multi-brand group needs to point a store at Merlin, set its e-sign
  // provider, and tune the dispatch conflict window.
  await page.getByRole('link', { name: 'Kia Mont-Laurier' }).click();
  await expect(page.getByRole('heading', { name: 'Modifier la succursale' })).toBeVisible();
  await page.getByLabel('Nom de la succursale').fill('Kia Mont-Laurier Centre');
  await page.getByLabel('Système du contrat de vente').selectOption({ label: 'Merlin' });
  await page.getByLabel('Plateforme de signature électronique').selectOption({ label: 'OneSpan' });
  // Out-of-range window blocks the save until corrected — the message says so.
  await page.getByLabel('Fenêtre de conflit (heures)').fill('30');
  await expect(page.getByText('Entrez un nombre entier de 1 à 24.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await page.getByLabel('Fenêtre de conflit (heures)').fill('6');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('link', { name: 'Kia Mont-Laurier Centre' })).toBeVisible();

  // The settings persisted: reopen and they are prefilled from the store.
  await page.getByRole('link', { name: 'Kia Mont-Laurier Centre' }).click();
  await expect(page.getByLabel('Système du contrat de vente')).toHaveValue('Merlin');
  await expect(page.getByLabel('Plateforme de signature électronique')).toHaveValue('onespan');
  await expect(page.getByLabel('Fenêtre de conflit (heures)')).toHaveValue('6');

  // Clearing e-sign back to None must persist as null — the '' → null write and
  // the null → '' prefill are the reverse of the path just exercised.
  await page.getByLabel('Plateforme de signature électronique').selectOption({ label: 'Aucune' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('link', { name: 'Kia Mont-Laurier Centre' })).toBeVisible();
  await page.getByRole('link', { name: 'Kia Mont-Laurier Centre' }).click();
  await expect(page.getByLabel('Plateforme de signature électronique')).toHaveValue('');
  await page.getByRole('link', { name: 'Retour aux organisations' }).first().click();

  // List page shows the renamed organization.
  await page.getByRole('link', { name: 'Retour aux organisations' }).click();
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();
});

test('duplicate store code shows the localized field error', async ({ page }) => {
  // Same user, same org: a second store reusing the code must 409 on 'code'.
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(user.email);
  await page.getByLabel('Mot de passe').fill(user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');

  await page.getByRole('link', { name: 'Organisations' }).click();
  await page.getByRole('link', { name: `${org.name} inc.` }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Doublon');
  await page.getByLabel('Code').fill(`KML-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('alert')).toContainText('déjà utilisé');
});

test('duplicate slug shows the localized field error', async ({ page }) => {
  // Second user tries the SAME slug — server 409 → localized message.
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Deuxième Test');
  await page.getByLabel('Courriel').fill(`f01b-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(user.password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill('Autre Groupe');
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page.getByRole('alert')).toContainText('déjà utilisé');
});
