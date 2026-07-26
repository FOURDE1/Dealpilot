import { expect, test } from '@playwright/test';

/**
 * A-13 owner journey: the matrix answers "what can each role do", edits
 * apply org-wide, the lock-out guard refuses by name, and a per-person
 * DENY wins over the role — proven through a second real session.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-a13';

test('full A-13 journey: matrix → guard → grant to role → deny to person', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Acces');
  await page.getByLabel('Courriel').fill(`a13-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe A13 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-a13-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale A13');
  await page.getByLabel('Code').fill(`A13-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // A deal whose checklist Marc will look at later.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale A13' });
  await page.getByLabel('Téléphone').fill('+15145551500');
  await page.getByLabel('Prénom').fill('Perm');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Prix de vente').fill('21000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  const leadUrl = page.url();

  // The matrix, grouped and readable.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByRole('link', { name: 'Rôles et permissions' }).click();
  await expect(page.getByRole('heading', { name: 'Rôles et permissions' })).toBeVisible();
  await expect(page.getByText('Transactions et livraison')).toBeVisible();
  const waiveSalesperson = page.getByLabel('Exempter un élément de la liste — Vendeur');
  await expect(waiveSalesperson).not.toBeChecked(); // conservative default
  await expect(page.getByLabel('Exempter un élément de la liste — Directeur des ventes')).toBeChecked();

  // The lock-out guard speaks as protection.
  await page.getByLabel('Gérer les rôles — Propriétaire').uncheck({ force: true }).catch(() => undefined);
  await page.getByLabel('Gérer les rôles — Propriétaire').click();
  await expect(page.getByText(/Refusé pour votre protection/)).toBeVisible();
  await expect(page.getByLabel('Gérer les rôles — Propriétaire')).toBeChecked();

  // Grant the salespeople the waive right; it persists.
  await waiveSalesperson.click();
  await expect(page.getByText('Enregistré.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Exempter un élément de la liste — Vendeur')).toBeChecked();

  // Marc joins as a salesperson through a real invitation.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByLabel('Nom', { exact: true }).fill('Marc Acces');
  await page.getByLabel('Courriel').fill(`marc-a13-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible();
  const token = (await page.getByLabel('Lien d’invitation').inputValue()).split('/').pop() ?? '';
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto(`/invitations/${token}`);
  await page.getByLabel('Nom complet').fill('Marc Acces');
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-marc13');
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click();
  await expect(page).toHaveURL('/');

  // As Marc: the granted waive right is there; inviting is not.
  await page.goto(leadUrl);
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Exempter' }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('button', { name: 'Inviter', exact: true })).toHaveCount(0);

  // Owner denies Marc alone; the role keeps the right, Marc loses it.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(`a13-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/team/permissions');
  await page.getByLabel('Personne', { exact: true }).selectOption({ label: 'Marc Acces' });
  await page.getByLabel('Permission', { exact: true }).selectOption({ label: 'Exempter un élément de la liste' });
  await page.getByLabel('Action', { exact: true }).selectOption({ label: 'Refuser' });
  await page.getByLabel('Raison', { exact: true }).fill('En période de revue');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('Exception appliquée.')).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(`marc-a13-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-marc13');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  await page.goto(leadUrl);
  await page.getByRole('button', { name: /Liste de livraison/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Exempter' })).toHaveCount(0);
});
