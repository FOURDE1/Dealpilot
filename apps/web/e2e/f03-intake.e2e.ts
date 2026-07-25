import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * F-03 owner journey: create an intake key on a store → copy the one-time
 * webhook URL + secret → an external system posts a signed lead → the lead
 * appears in the Leads list without anyone typing it.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f03';

test('full F-03 journey: intake key → signed webhook post → lead in the list', async ({
  page,
  request,
}) => {
  // Fresh user + org + store.
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Intake Test');
  await page.getByLabel('Courriel').fill(`f03-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F03 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f03-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F03');
  await page.getByLabel('Code').fill(`F03-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // Open the store → Intake sources → create a key.
  await page.getByRole('link', { name: 'Succursale F03' }).click();
  await expect(page.getByRole('heading', { name: "Sources d'admission" })).toBeVisible();
  await page.getByLabel('Nom de la source').fill('Formulaire principal');
  await page.getByRole('button', { name: 'Créer la clé' }).click();

  // One-time reveal: capture the webhook URL + secret.
  await expect(page.getByText('copiez ces valeurs MAINTENANT', { exact: false })).toBeVisible();
  const codes = page.locator('code');
  const webhookUrl = (await codes.nth(0).textContent())?.trim() ?? '';
  const secret = (await codes.nth(1).textContent())?.trim() ?? '';
  expect(webhookUrl).toContain('/in/v1/leads/');
  expect(secret.length).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Terminé' }).click();

  // The key is listed, never used yet.
  await expect(page.getByRole('table').getByText('Formulaire principal')).toBeVisible();
  await expect(page.getByText('Jamais')).toBeVisible();

  // External system: HMAC-signed lead post (ADR-005: sha256 of `${ts}.${body}`).
  const body = JSON.stringify({
    phone: '+15145550420',
    first_name: 'Webhook',
    last_name: 'Lead',
    vehicle_interest: 'Kia EV9 2026',
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const res = await request.post(webhookUrl, {
    headers: {
      'Content-Type': 'application/json',
      'X-Intake-Timestamp': ts,
      'X-Intake-Signature': `v1=${signature}`,
    },
    data: body,
  });
  expect(res.status()).toBe(202);

  // The lead arrived — visible in the Leads list with the key's source.
  await page.getByRole('link', { name: 'Prospects' }).first().click();
  await expect(page.getByRole('link', { name: 'Webhook Lead' })).toBeVisible();

  // Revoke the key (H-05 Dialog) → a second signed post is rejected.
  await page.goto(page.url().replace(/\/leads.*/, '')); // back home
  await page.getByRole('link', { name: 'Organisations' }).first().click();
  await page.getByRole('link', { name: `Groupe F03 ${stamp}` }).click();
  await page.getByRole('link', { name: 'Succursale F03' }).click();
  await page.getByRole('button', { name: 'Révoquer' }).click();
  await page.getByRole('button', { name: 'Oui, révoquer' }).click();
  await expect(page.getByText("Aucune source d'admission", { exact: false })).toBeVisible();

  const ts2 = Math.floor(Date.now() / 1000).toString();
  const sig2 = createHmac('sha256', secret).update(`${ts2}.${body}`).digest('hex');
  const res2 = await request.post(webhookUrl, {
    headers: { 'Content-Type': 'application/json', 'X-Intake-Timestamp': ts2, 'X-Intake-Signature': `v1=${sig2}` },
    data: body,
  });
  expect(res2.status()).toBe(401);
});
