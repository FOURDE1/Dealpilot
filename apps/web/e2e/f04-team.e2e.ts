import { expect, test } from '@playwright/test';

/**
 * Team journey (F-04 + F-12): invite a colleague → they accept and become a
 * real member → assignment and "my leads" → roles → revoke releases their
 * leads → reinstate; invitations are first-class roster rows until accepted.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f04';

test('full team journey: invite → accept → assign → revoke → reinstate', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Test');
  await page.getByLabel('Courriel').fill(`f04-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Zero-org state: Team explains itself instead of erroring.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByText('Créez d’abord une organisation')).toBeVisible();
  await page.getByRole('link', { name: 'Créer une organisation' }).click();
  await expect(page).toHaveURL('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F04 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f04-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F04');
  await page.getByLabel('Code').fill(`F04-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  // Same race F-07 hit: `/leads/new` builds its branch list from a request that
  // can be in flight while the store is still being written. Prove the store
  // exists before navigating, or the selectOption below picks from an empty list
  // on a loaded machine and passes on an idle one.
  await expect(page.getByRole('link', { name: 'Succursale F04' })).toBeVisible();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F04' });
  await page.getByLabel('Téléphone').fill('+15145550777');
  await page.getByLabel('Prénom').fill('Paul');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Paul Client' })).toBeVisible();

  // Invite Marc. In dev the email cannot go out, so the app hands us the link.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible();
  await page.getByLabel('Nom', { exact: true }).fill('Marc Vendeur');
  await page.getByLabel('Courriel').fill('marc@groupehassan'); // no TLD → named error
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Courriel invalide.')).toBeVisible();
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  // CR-05: the dev mailer is honest — the app hands the owner the link.
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible();
  const acceptUrl = await page.getByLabel('Lien d’invitation').inputValue();
  const token = acceptUrl.split('/').pop() ?? '';
  expect(token).not.toBe('');
  await expect(page.getByRole('cell', { name: 'Invité', exact: true })).toBeVisible();

  // An invited person is not assignable yet.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await page.getByRole('link', { name: 'Paul Client' }).click();
  await expect(page.getByLabel('Assigner').getByRole('option', { name: 'Marc Vendeur' })).toHaveCount(0);

  // Marc accepts: prefilled locked email, new account, straight into the app.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto(`/invitations/${token}`);
  await expect(page.getByText(new RegExp(`Groupe F04 ${stamp}`))).toBeVisible();
  await expect(page.getByText(/Vendeur/).first()).toBeVisible();
  await expect(page.getByLabel('Courriel')).toHaveValue(`marc-${stamp}@1dealer.test`);
  await page.getByLabel('Nom complet').fill('Marc Vendeur');
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-marc');
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click();
  await expect(page).toHaveURL('/');

  // Back as the owner: Marc is Active; assign him the lead.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(`f04-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Actif', exact: true })).toHaveCount(2);

  // Re-inviting an active member is refused by name.
  await page.getByLabel('Nom', { exact: true }).fill('Marc Encore');
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('fait déjà partie de l’équipe')).toBeVisible();

  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await page.getByRole('link', { name: 'Paul Client' }).click();
  await page.getByLabel('Assigner').selectOption({ label: 'Marc Vendeur' });
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();
  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
  await page.getByLabel('Mes prospects').check();
  await expect(page.getByText('Aucun prospect', { exact: false })).toBeVisible();
  await page.getByLabel('Mes prospects').uncheck();

  // Edit roles; then revoke — his leads return to the pool.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByRole('button', { name: 'Modifier les rôles — Marc Vendeur' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Modifier les rôles — Marc Vendeur' });
  await editDialog.getByLabel('Agent BDC').check();
  await editDialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Vendeur, Agent BDC', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer — Marc Vendeur' }).click();
  await page.getByRole('button', { name: 'Oui, retirer' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await expect(page.getByRole('cell', { name: 'Non assigné' })).toBeVisible();

  // Reinstate from the removed view.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByLabel('Afficher les membres retirés').check();
  await expect(page.getByText(`marc-${stamp}@1dealer.test`)).toBeVisible();
  await page.getByRole('button', { name: 'Réintégrer — Marc Vendeur' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();

  // Multi-org: each organization has its own roster; an invitation belongs to one.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F04B ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f04b-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // Wait for the create to land before leaving. "Équipe" is a sidebar link
  // present on every page, so Playwright has nothing to auto-wait on and clicks
  // it instantly — unlike "Nouvelle succursale" above, which only exists on the
  // org page and therefore waits by accident. Leaving early loses two ways: the
  // scope selector needs a SECOND org to render at all, and the mutation's
  // `navigate(..., { replace: true })` fires afterwards and drags the browser
  // back off /team.
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  const orgScope = page.getByLabel('Organisation', { exact: true });
  await orgScope.selectOption({ label: `Groupe F04B ${stamp}` });
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await orgScope.selectOption({ label: `Groupe F04 ${stamp}` });
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();

  // CR-08 (owner-found): someone who left and comes back. Revoke, re-invite —
  // the accept screen must flip to sign-in for the existing account.
  await page.getByRole('button', { name: 'Retirer — Marc Vendeur' }).click();
  await page.getByRole('button', { name: 'Oui, retirer' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await page.getByLabel('Nom', { exact: true }).fill('Marc Vendeur');
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible();
  const rejoinUrl = await page.getByLabel('Lien d’invitation').inputValue();
  const rejoinToken = rejoinUrl.split('/').pop() ?? '';
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await page.goto(`/invitations/${rejoinToken}`);
  await page.getByLabel('Nom complet').fill('Marc Vendeur');
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-marc');
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click();
  await expect(page.getByText(/Un compte existe déjà pour/)).toBeVisible();
  await page.getByLabel('Mot de passe').fill('MotDePasse!2026-marc');
  await page.getByRole('button', { name: 'Se connecter et accepter' }).click();
  await expect(page).toHaveURL('/');
});
