import { expect, test } from '@playwright/test';

/**
 * F-14 theme editor: an owner opens Branding, sets the group name and a
 * deliberately hard-to-read colour, saves a draft (nothing changes for anyone
 * yet), sees the contrast auto-fix the server applied, then publishes — and the
 * shell now shows the group's own name.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f14e';

test('branding editor: draft → contrast auto-fix shown → publish → the app is rebranded', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Éditeur');
  await page.getByLabel('Courriel').fill(`f14e-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F14E ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f14e-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();

  // Into the editor from the org page.
  await page.getByRole('link', { name: 'Image de marque' }).click();
  await expect(page.getByRole('heading', { name: 'Image de marque' })).toBeVisible();

  // Set the name and a pale-yellow primary that cannot be read as text on white.
  await page.getByLabel('Nom affiché').fill('Marque Éditée');
  await page.getByLabel('Couleur principale').fill('#FDE047');

  // An invalid colour blocks the save and says so.
  await page.getByLabel('Couleur d’accent').fill('not-a-colour');
  await expect(page.getByText('Entrez un hex (#RRGGBB) ou un oklch(L C H).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeDisabled();
  await page.getByLabel('Couleur d’accent').fill('');

  // Save the draft. Nothing is published yet, so publishing is what freezes the
  // palette and computes the contrast fixes.
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText(/Brouillon enregistré/)).toBeVisible();

  // A draft has not repainted anyone yet — the shell still shows the platform
  // name (no published brand).
  await page.goto('/');
  await expect(page.getByText('1Dealer').first()).toBeVisible();

  // Publish it: the app goes live with the brand, and the server reports the
  // contrast fix it made to the unreadable yellow (1.32:1 → 4.5:1).
  await page.goto(`/organizations`);
  await page.getByRole('link', { name: `Groupe F14E ${stamp}` }).click();
  await page.getByRole('link', { name: 'Image de marque' }).click();
  await page.getByRole('button', { name: 'Publier' }).click();
  await expect(page.getByText(/Publié \(version \d+\)/)).toBeVisible();
  await expect(page.getByText('Ajustements de contraste appliqués')).toBeVisible();
  await expect(page.getByText(/→ .*:1 pour atteindre le niveau AA/).first()).toBeVisible();

  // Now the app carries the group's own name, and the platform name is gone.
  await page.goto('/');
  await expect(page.getByText('Marque Éditée').first()).toBeVisible();
  await expect(page.getByText('1Dealer')).toHaveCount(0);
});

test('branding editor: publish is blocked while dirty, and clearing an optional colour persists as unset', async ({ page }) => {
  const s = stamp + 1;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Brouillon');
  await page.getByLabel('Courriel').fill(`f14e2-${s}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F14E2 ${s}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f14e2-${s}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Image de marque' }).click();

  // Create a draft so Publish has something to act on (a name change is a real
  // diff from the platform-default form the editor opens on).
  await page.getByLabel('Nom affiché').fill('Marque Brouillon');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText(/Brouillon enregistré/)).toBeVisible();

  // Edit again WITHOUT saving: Publish is blocked (it would ship the saved
  // draft and drop the edit), and the hint says to save first.
  await page.getByLabel('Couleur principale').fill('#DC2626');
  await expect(page.getByText(/modifications non enregistrées/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publier' })).toBeDisabled();
  // Saving clears the dirty state and re-enables Publish.
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText(/Brouillon enregistré/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publier' })).toBeEnabled();

  // Set an optional colour, save, then CLEAR it and save — the clear must
  // persist as unset ('' → null), not come back on reopen.
  await page.getByLabel('Couleur d’accent').fill('#10B981');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText(/Brouillon enregistré/)).toBeVisible();
  await expect(page.getByLabel('Couleur d’accent')).not.toHaveValue('');
  await page.getByLabel('Couleur d’accent').fill('');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText(/Brouillon enregistré/)).toBeVisible();
  // Reopen: the accent is unset — a cleared optional colour did not resurrect.
  await page.goto(`/organizations`);
  await page.getByRole('link', { name: `Groupe F14E2 ${s}` }).click();
  await page.getByRole('link', { name: 'Image de marque' }).click();
  await expect(page.getByLabel('Couleur d’accent')).toHaveValue('');
});

test('branding editor: a member without organization:update sees it read-only', async ({ page }) => {
  const s = stamp + 2;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Lecture');
  await page.getByLabel('Courriel').fill(`f14e3-${s}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F14E3 ${s}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f14e3-${s}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]+$/);
  const orgId = page.url().split('/organizations/')[1];

  // The Branding link is offered to editors — it is visible now.
  await expect(page.getByRole('link', { name: 'Image de marque' })).toBeVisible();

  // Deny myself organization:update via a personal override (the permissions
  // screen is gated by member:update_roles, so I keep access to undo it).
  await page.goto('/team/permissions');
  await page.getByLabel('Personne', { exact: true }).selectOption({ label: 'Patron Lecture' });
  await page.getByLabel('Permission', { exact: true }).selectOption({ label: 'Modifier l’organisation' });
  await page.getByLabel('Action', { exact: true }).selectOption({ label: 'Refuser' });
  await page.getByLabel('Raison', { exact: true }).fill('Test lecture seule F-14');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Exception appliquée.')).toBeVisible();

  // The Branding link is no longer offered on the org page…
  await page.goto(`/organizations/${orgId}`);
  await expect(page.getByRole('link', { name: 'Image de marque' })).toHaveCount(0);

  // …and navigating straight to the editor shows a clear refusal, no form.
  await page.goto(`/organizations/${orgId}/branding`);
  await expect(page.getByText(/votre rôle ne permet pas de la modifier/)).toBeVisible();
  await expect(page.getByLabel('Couleur principale')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publier' })).toHaveCount(0);
});
