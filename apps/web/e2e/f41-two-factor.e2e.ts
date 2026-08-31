import { expect, test } from '@playwright/test';
import { totp } from './support/totp.js';

/**
 * F-41 — TOTP two-factor, through the real screens with REAL codes.
 *
 * The journey a locked-out owner would retell: enable on /security, type the
 * secret into "an authenticator" (RFC 6238 in support/totp.ts — the spec
 * file runs in Node; F-74 moved the oracle there so the console journey can
 * pass the same challenge), prove the first code, see the backup codes once,
 * sign out — and then the password alone stops being enough.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f41';

test('two-factor: enrol on /security → sign out → password alone is no longer enough', async ({ page }) => {
  const email = `f41-${stamp}@1dealer.test`;
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Olivia Otp');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // Enrol: password → secret → first code. Nothing is on before the proof.
  await page.getByRole('link', { name: 'Sécurité du compte' }).click();
  await expect(page).toHaveTitle(/Sécurité du compte — /);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Générer la clé' }).click();

  const secret = (await page.getByLabel('Clé secrète').innerText()).trim();
  expect(secret.length).toBeGreaterThan(15);

  await page.getByLabel('Premier code').fill(totp(secret));
  await page.getByRole('button', { name: 'Vérifier et activer' }).click();
  await expect(page.getByText('La double authentification est active.')).toBeVisible();
  // The backup codes appear exactly once, at enrolment.
  await expect(page.getByText('Codes de secours')).toBeVisible();

  // Sign out; the password alone now buys only a challenge.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByText('Vérification en deux étapes')).toBeVisible();
  // A wrong code is refused with one unrevealing message…
  await page.getByLabel('Code de vérification').fill('000000');
  await page.getByRole('button', { name: 'Vérifier', exact: true }).click();
  await expect(page.getByText('Code invalide.')).toBeVisible();
  // …and the real one opens the door.
  await page.getByLabel('Code de vérification').fill(totp(secret));
  await page.getByRole('button', { name: 'Vérifier', exact: true }).click();
  await expect(page).toHaveURL('/');
});
