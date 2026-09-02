import { expect, test } from '@playwright/test';

/**
 * F-09 owner journey: set a pay plan (25% + $1,500 pad) → desk a deal sold
 * by that member ($7,000 total gross) → fund it on the pipeline → the
 * commission line appears: $5,500 commissionable × 25% = $1,375.
 * Mirrors the backend golden (apps/api/src/f09-commissions.test.ts).
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f09';

test('full F-09 journey: pay plan → sold-by deal → funded → $1,375 line', async ({ page, request }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Payeur');
  await page.getByLabel('Courriel').fill(`f09-${stamp}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F09 ${stamp}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f09-${stamp}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // The create mutation navigates (replace) after its POST resolves; clicking
  // during that remount silently loses the click (the f04/f11 race).
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F09');
  await page.getByLabel('Code').fill(`F09-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // A salesperson with a pay plan: 25% rate, $1,500 pad. Added via the direct
  // roster API — the invite→accept journey is f04's subject, not ours.
  //
  // She has to EXIST first. Since F-12, `POST /api/v1/members` answers 422
  // `needs_invitation` for an email with no account: a membership is a link to
  // a person, and the old behaviour conjured one from a string somebody typed.
  // Signed up through the `request` fixture, which carries its own cookie jar —
  // doing it through `page.request` would swap the browser's session for
  // Vicky's and log the owner out mid-test.
  const vickyEmail = `vicky-${stamp}@1dealer.test`;
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { email: vickyEmail, password, name: 'Vicky Vendeuse' },
  });
  if (signUp.status() >= 400) throw new Error(`vicky sign-up failed: ${signUp.status()}`);

  const orgsResp = await page.request.get('/api/v1/organizations?limit=10');
  const orgId = ((await orgsResp.json()) as { items: { id: string }[] }).items[0]!.id;
  const addResp = await page.request.post('/api/v1/members', {
    data: {
      organization_id: orgId,
      email: vickyEmail,
      name: 'Vicky Vendeuse',
      roles: ['salesperson'],
    },
  });
  if (addResp.status() !== 201) {
    throw new Error(`member add failed: ${addResp.status()} ${await addResp.text()}`);
  }
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('cell', { name: 'Vicky Vendeuse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Plan de rémunération — Vicky Vendeuse' }).click();
  await page.getByLabel('Taux de commission (%)').fill('25');
  await page.getByLabel('Pad (montant déduit du profit)').fill('1500');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The deal: $30,000 sale on $23,000 cost = $7,000 FRONT gross — the
  // salesperson's commission base (F&I product profit is not the seller's).
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F09' });
  await page.getByLabel('Téléphone').fill('+15145551100');
  await page.getByLabel('Prénom').fill('Carl');
  await page.getByLabel('Nom de famille').fill('Client');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Vendu par').selectOption({ label: 'Vicky Vendeuse' });
  await page.getByLabel('Prix de vente').fill('30000');
  await page.getByLabel('Coût du véhicule').fill('23000');
  await page.getByLabel('Produits F&I (prix)').fill('2000');
  await page.getByLabel('Produits F&I (coût)').fill('500');
  const results = page.getByRole('complementary');
  await expect(results.getByText(/7\s?000,00/).first()).toBeVisible(); // front gross
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  // Fund it on the pipeline — the moment that writes the commission.
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const colNew = page.getByRole('region', { name: 'Nouvelle' });
  await colNew.getByLabel('Financement').selectOption({ label: 'Financé' });
  await expect(colNew.getByLabel('Financement')).toHaveValue('funded');

  // The line: $5,500 × 25% = $1,375, dated today.
  await page.getByRole('link', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('link', { name: 'Voir les commissions' }).click();
  await expect(page.getByRole('heading', { name: 'Commissions' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vente', exact: true })).toBeVisible();
  await expect(page.getByText(/5\s?500,00/)).toBeVisible(); // commissionable gross
  await expect(page.getByText(/1\s?375,00/).first()).toBeVisible(); // the line amount
  await expect(page.getByText('25 %')).toBeVisible();

  // CR-10: a LOSING deal pays nothing — and the table says why instead of
  // showing a bare $0.00 (the owner's $26,900-on-$70,000 test read as broken).
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F09' });
  await page.getByLabel('Téléphone').fill('+15145551101');
  await page.getByLabel('Prénom').fill('Perte');
  await page.getByLabel('Nom de famille').fill('Sèche');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Vendu par').selectOption({ label: 'Vicky Vendeuse' });
  await page.getByLabel('Prix de vente').fill('26900');
  await page.getByLabel('Coût du véhicule').fill('70000');
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const lossCard = page
    .getByRole('region', { name: 'Nouvelle' })
    .getByRole('article')
    .filter({ hasText: 'Perte Sèche' });
  await lossCard.getByLabel('Financement').selectOption({ label: 'Financé' });
  await expect(lossCard.getByLabel('Financement')).toHaveValue('funded');
  await page.getByRole('link', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('link', { name: 'Voir les commissions' }).click();
  await expect(
    page.getByText(/Transaction à perte \(-43\s?100,00\s?\$\) — aucune commission\./),
  ).toBeVisible();
});

/**
 * F-79 clawback journey — self-contained on purpose (R8/A2): its own stamp,
 * its own org/store/Vicky/plan/deal, so a clawback failure never reads as
 * whatever line of the funding proof above the clock ran out on (retries 0).
 * Same-file tests run serially in one worker; each keeps its own 90 s budget.
 *
 * ONE funded $30,000/$23,000 deal with NO F&I products (fi_reserve 0):
 * front gross $7,000, commissionable $5,500 × 25% = the 1 375,00 line — the
 * engine-derived golden (packages/core/src/money-math.test.ts). Flag $500 →
 * confirm → the negative line lands in the OPEN pay period, the month total
 * drops to 875,00, and VICKY's bell (never the owner's — the confirming
 * actor is excluded, T-A10b) carries params.amount === 500.
 */
test('F-79 clawback: flag 500 → confirm → « Reprise » line, month total 875,00, Vicky’s bell', async ({
  page,
  request,
}) => {
  const stamp79 = Date.now();
  const password79 = 'MotDePasse!2026-f79';

  // Owner + org + store — fresh, never the module-level stamp (A2).
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill('Patron Reprise');
  await page.getByLabel('Courriel').fill(`f79-${stamp79}@1dealer.test`);
  await page.getByLabel('Mot de passe').fill(password79);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(`Groupe F79 ${stamp79}`);
  await page.getByLabel('Identifiant (slug)').fill(`groupe-f79-${stamp79}`);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  // Same f04/f11 remount race as above: wait for the navigation first.
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill('Succursale F79');
  await page.getByLabel('Code').fill(`F79-${stamp79 % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();

  // Vicky signs up through the `request` fixture — its cookie jar is HERS
  // from here on (the bell assertion below leans on that, A1); the owner
  // keeps the browser session.
  const vickyEmail = `f79-vicky-${stamp79}@1dealer.test`;
  const signUp = await request.post('/api/auth/sign-up/email', {
    data: { email: vickyEmail, password: password79, name: 'Vicky Vendeuse' },
  });
  if (signUp.status() >= 400) throw new Error(`vicky sign-up failed: ${signUp.status()}`);

  const orgsResp = await page.request.get('/api/v1/organizations?limit=10');
  const orgId = ((await orgsResp.json()) as { items: { id: string }[] }).items[0]!.id;
  const addResp = await page.request.post('/api/v1/members', {
    data: {
      organization_id: orgId,
      email: vickyEmail,
      name: 'Vicky Vendeuse',
      roles: ['salesperson'],
    },
  });
  if (addResp.status() !== 201) {
    throw new Error(`member add failed: ${addResp.status()} ${await addResp.text()}`);
  }
  await page.getByRole('link', { name: 'Équipe' }).first().click();
  await expect(page.getByRole('cell', { name: 'Vicky Vendeuse', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Plan de rémunération — Vicky Vendeuse' }).click();
  await page.getByLabel('Taux de commission (%)').fill('25');
  await page.getByLabel('Pad (montant déduit du profit)').fill('1500');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The one deal: $30,000 on $23,000, NO F&I products — fi_reserve stays 0,
  // so gross 7 000,00 / commissionable 5 500,00 / line 1 375,00 (A6 goldens).
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: 'Succursale F79' });
  await page.getByLabel('Téléphone').fill('+15145551102');
  await page.getByLabel('Prénom').fill('Rachel');
  await page.getByLabel('Nom de famille').fill('Reprise');
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await page.getByRole('link', { name: 'Créer une transaction' }).click();
  await page.getByLabel('Vendu par').selectOption({ label: 'Vicky Vendeuse' });
  await page.getByLabel('Prix de vente').fill('30000');
  await page.getByLabel('Coût du véhicule').fill('23000');
  await expect(page.getByRole('complementary').getByText(/7\s?000,00/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer la transaction' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: 'Pipeline' }).first().click();
  const col79 = page.getByRole('region', { name: 'Nouvelle' });
  await col79.getByLabel('Financement').selectOption({ label: 'Financé' });
  await expect(col79.getByLabel('Financement')).toHaveValue('funded');

  // The line, and the month total it feeds: both 1 375,00.
  await page.getByRole('link', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('link', { name: 'Voir les commissions' }).click();
  await expect(page.getByRole('heading', { name: 'Commissions' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vente', exact: true })).toBeVisible(); // kind_sale
  await expect(page.getByText(/1\s?375,00/).first()).toBeVisible();

  // Flag $500 through the dialog. The amount input arrives PREFILLED with the
  // full line via formatCents; fill() replaces it, exercising the
  // parseMoneyToCents path with a bare '500' (A3).
  await page.getByRole('button', { name: 'Reprise…' }).click(); // clawbackAction
  // The terminal copy is visible BEFORE the flag: // clawbackDesc
  await expect(page.getByText(/définitive une fois confirmée/)).toBeVisible();
  await page.getByLabel('Motif').fill('Financement annulé par la banque'); // clawbackReason
  await page.getByLabel('Montant à reprendre ($)').fill('500'); // clawbackAmount
  await page.getByRole('button', { name: 'Signaler la reprise' }).click(); // clawbackSubmit
  await expect(page.getByText('Reprise en attente')).toBeVisible(); // statusFlagged

  // Confirm through the dialog: the body restates the STORED amount and says
  // the reversal lands in the OPEN pay period, definitively (A7/A8).
  await page.getByRole('button', { name: 'Confirmer la reprise' }).click(); // clawbackConfirm
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByText(/500,00/)).toBeVisible(); // clawbackConfirmBody (stored amount)
  await expect(confirmDialog.getByText(/période de paie EN COURS/)).toBeVisible(); // clawbackConfirmBody
  await expect(confirmDialog.getByText(/Cette action est définitive\./)).toBeVisible(); // clawbackConfirmBody
  // Dialog-scoped submit — « Confirmer » exact, never the row's trigger (A7).
  await confirmDialog.getByRole('button', { name: 'Confirmer', exact: true }).click(); // clawbackConfirmSubmit

  // The negative line: kind « Reprise », −500,00, terminal badge — and the
  // month total drops 1 375,00 → 875,00 (open-period stamp, R13(b)).
  await expect(page.getByText('Reprise confirmée')).toBeVisible(); // statusReversed
  await expect(page.getByRole('cell', { name: 'Reprise', exact: true })).toBeVisible(); // kind_clawback
  await expect(page.getByText(/-\s?500,00/)).toBeVisible();
  await expect(page.getByText(/875,00/)).toBeVisible(); // monthTotal 1 375,00 − 500,00

  // VICKY's bell — through the `request` fixture, which has held HER cookie
  // jar since her sign-up above. Never the owner's: the owner is the
  // confirming actor and actors are excluded (A1, T-A10b).
  const notifResp = await request.get('/api/v1/notifications');
  expect(notifResp.status()).toBe(200);
  const notifItems = (
    (await notifResp.json()) as { items: { title_key: string; params: Record<string, unknown> }[] }
  ).items;
  const clawbackBells = notifItems.filter((n) => n.title_key === 'notif_commission_clawback');
  expect(clawbackBells).toHaveLength(1);
  expect(clawbackBells[0]!.params['amount']).toBe(500);

  // Terminal at the UI: the reversed row offers no « Reprise… » anywhere —
  // the fixture's only sale line is reversed and the clawback line shows —.
  await expect(page.getByRole('button', { name: 'Reprise…' })).toHaveCount(0); // clawbackAction
});
