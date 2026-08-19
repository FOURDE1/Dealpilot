import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * F-41 — TOTP two-factor, through the real screens with REAL codes.
 *
 * The journey a locked-out owner would retell: enable on /security, type the
 * secret into "an authenticator" (RFC 6238 in twenty lines below — the spec
 * file runs in Node), prove the first code, see the backup codes once, sign
 * out — and then the password alone stops being enough.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f41';

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

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
