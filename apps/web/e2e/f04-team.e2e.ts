import { expect, test } from '@playwright/test';

/**
 * F-04 owner journey: add a colleague to the team → assign a lead to them →
 * "My leads" filters by assignee → roles editable → revoke removes access.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f04';

test('full F-04 journey: team member → assignment → my-leads filter → revoke', async ({ page }) => {
  // Fresh owner + org + store + one lead.
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

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F04' });
  await page.getByLabel('Téléphone').fill('+15145550777');
  await page.getByLabel('Prénom').fill('Paul');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: 'Paul Client' })).toBeVisible();

  // Team: add a salesperson colleague.
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('heading', { name: 'Équipe' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible(); // bootstrap member
  await page.getByLabel('Nom', { exact: true }).fill('Marc Vendeur');
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vendeur', exact: true })).toBeVisible();

  // Wrong email shape gets a named error, never "operation failed" (owner-reported).
  await page.getByLabel('Nom', { exact: true }).fill('Marc Bis');
  await page.getByLabel('Courriel').fill('marc@groupehassan'); // no TLD — browser passes it, server 422s
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Courriel invalide.')).toBeVisible();
  // Re-adding an ACTIVE member is refused with a pointer to the roles editor
  // (HO-09 — the add form must never rewrite an active membership).
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('fait déjà partie de l’équipe')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toHaveCount(1);

  // Assign the lead to Marc.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await page.getByRole('link', { name: 'Paul Client' }).click();
  await page.getByLabel('Assigner').selectOption({ label: 'Marc Vendeur' });
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible();

  // List shows the assignee; "My leads" (owner) hides it.
  await page.getByRole('link', { name: 'Retour aux prospects' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
  await page.getByLabel('Mes prospects').check();
  await expect(page.getByText('Aucun prospect', { exact: false })).toBeVisible();
  await page.getByLabel('Mes prospects').uncheck();
  await expect(page.getByRole('link', { name: 'Paul Client' })).toBeVisible();

  // Edit Marc's roles (add BDC agent).
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await page.getByRole('button', { name: 'Modifier les rôles — Marc Vendeur' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Modifier les rôles — Marc Vendeur' });
  await editDialog.getByLabel('Agent BDC').check();
  await editDialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Vendeur, Agent BDC', exact: true })).toBeVisible();

  // Revoke Marc — the API list excludes revoked members, so his row disappears.
  await page.getByRole('button', { name: 'Retirer — Marc Vendeur' }).click();
  await page.getByRole('button', { name: 'Oui, retirer' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible();

  // Revoking releases the member's leads back to the pool (same transaction).
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await expect(page.getByRole('cell', { name: 'Non assigné' })).toBeVisible();

  // Multi-org scoping: a second organization gets its own, separate roster.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F04B ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f04b-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  const orgScope = page.getByLabel('Organisation', { exact: true });
  await orgScope.selectOption({ label: `Groupe F04B ${stamp}` });
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible();
  // Cross-org email conflict is the one case that still 409s (invite flow later).
  await page.getByLabel('Nom', { exact: true }).fill('Marc Ailleurs');
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Un compte existe déjà avec ce courriel.')).toBeVisible();
  await orgScope.selectOption({ label: `Groupe F04 ${stamp}` });
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Patron Test', exact: true })).toBeVisible();

  // Reinstate: removed members are listable again and one click restores access.
  await page.getByLabel('Afficher les membres retirés').check();
  await expect(page.getByText(`marc-${stamp}@1dealer.test`)).toBeVisible();
  await page.getByRole('button', { name: 'Réintégrer — Marc Vendeur' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
  await expect(page.getByText('Aucun membre retiré.')).toBeVisible();

  // Adding a REVOKED colleague's email still revives them (the explicit
  // notice returns with CR-01 — the API's `reinstated` flag was dropped).
  await page.getByRole('button', { name: 'Retirer — Marc Vendeur' }).click();
  await page.getByRole('button', { name: 'Oui, retirer' }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeHidden();
  await page.getByLabel('Nom', { exact: true }).fill('Marc Vendeur');
  await page.getByLabel('Courriel').fill(`marc-${stamp}@1dealer.test`);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Marc Vendeur', exact: true })).toBeVisible();
});
