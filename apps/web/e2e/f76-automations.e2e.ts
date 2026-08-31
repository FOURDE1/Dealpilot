import { expect, test, type Page } from '@playwright/test';

/**
 * F-76 — /settings/automations, through the real screens (R8, R10, A5, A15,
 * A16, A17).
 *
 * The claim worth an e2e: the texting window the owner saves on this form is
 * the window the compliance check applies — the SAME function the send layer
 * runs — and a lead's « Messages texte » card shows the deferral at the exact
 * minute the form named. Everything else here is a round trip: defaults said
 * out loud, persistence across a reload, refusals under their field, a fresh
 * organization reading the database's own defaults back, and read-only for a
 * role without organization:update.
 *
 * What the card CANNOT prove (A17): the first-touch toggle. The panel asks
 * `originator: 'human'` with the default `follow_up` class
 * (compliance/api.ts), and `first_touch_quiet_exempt` short-circuits only
 * `first_touch` — so the checkbox is proven by persistence (reload) and the
 * card proves the WINDOW alone. The two caps are likewise persistence-only:
 * the daily cap governs every automated send the system starts — the
 * assistant's first touch AND the drips (apps/api/src/f19-send.ts maps both
 * the `bot` and the `drip` sender to originator 'ai'; the assistant's replies
 * to an incoming message are exempt) — and the turn cap is read by the
 * assistant worker (assistant-turn.test.ts); neither is visible here.
 *
 * Serial by design — one owner, a lead whose card is read after the window
 * is saved, then a second organization — so the ORDER is binding (A15):
 * everything org-scoped that assumes a single organization (lead creation,
 * the first save) happens BEFORE the second organization exists; after it,
 * every org-scoped page shows the « Organisation » select, newest first, and
 * each step picks its organization explicitly. Retries 0, own owner, no
 * bootstrap one-shot, no database literal. Every French string is a fr-CA
 * value; the key is named beside the first use of each.
 *
 * Deferred, each with its reason:
 *   - The server's `window_too_wide` / `invalid_window` 422s: the form's own
 *     mirror disables save before a request leaves (comms-window.ts), so the
 *     server paths are API cases (f15-compliance.test.ts).
 *   - The cross-organization 409 on a texting number: f30-carrier.test.ts.
 *   - « Autorisé maintenant » after widening back is asserted only while
 *     Toronto time sits ≥ 5 min inside 09:00–21:00; outside that band the
 *     card is a deferral to tomorrow 09:00 whichever window is saved, and
 *     the test annotates the branch instead of asserting a coincidence.
 */

/**
 * REQUIRED (MUST ADD): consent-panel.tsx formats `deferred_until` in the
 * BROWSER's zone (`toLocaleString(lang, { dateStyle: 'medium', timeStyle:
 * 'short' })`), and the check computes the deferral in the RECIPIENT's zone
 * (514 → America/Toronto by area code, compliance-quiet-hours.ts). Pinning
 * the browser to Toronto is what makes « Envoi prévu à … 20 h 00 » read the
 * minute this test wrote; on this UTC+3 desktop or on UTC CI the rendered
 * time would otherwise be the same instant in another clock and never match.
 */
test.use({ timezoneId: 'America/Toronto' });
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f76a';
const owner = { name: 'Aline Fenêtre', email: `f76a-${stamp}@1dealer.test` };
/** A16: a sales manager holds neither organization:update nor store:update. */
const sam = { name: 'Sam Ventes', email: `f76a-sam-${stamp}@1dealer.test`, password: 'MotDePasse!2026-sam76a' };
const orgA = { name: `Groupe F76A ${stamp}`, slug: `groupe-f76a-${stamp}` };
const orgB = { name: `Groupe F76B ${stamp}`, slug: `groupe-f76b-${stamp}` };
const STORE = 'Succursale F76 A';
/** 514 → America/Toronto by area code — independent of the store's zone. */
const LEAD = { first: 'Marie', last: 'Fenêtre', phone: '+15145550199' };

/** fr-CA settings:* strings the assertions read verbatim. */
const MSG = {
  defaultsNotice:
    'Aucune configuration enregistrée : les valeurs par défaut de la plateforme s’appliquent (09:00–21:00, première réponse immédiate, 3 contacts par jour, 15 messages).',
  saved: 'Modifications enregistrées.',
  windowTooWide: 'La fenêtre doit rester entre 09:00 et 21:00 — le plafond de la plateforme. Une fenêtre plus étroite est permise.',
  windowInverted: 'La fin doit suivre le début.',
  readOnly: 'Vous pouvez consulter ces réglages ; votre rôle ne permet pas de les modifier.',
} as const;

/** Filled by T1; later tests navigate by these. */
let leadUrl = '';
/** The window T1 saved; T2 reads the lead card against it. */
let saved: PickedWindow = { start: '', end: '', branch: 'fixed', nowMin: -1 };

interface PickedWindow {
  readonly start: string;
  readonly end: string;
  readonly branch: 'daytime' | 'fixed';
  readonly nowMin: number;
}

/** Minutes since midnight on the Toronto clock — the recipient's clock. */
function torontoMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const part = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  return part('hour') * 60 + part('minute');
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A5 — the formula, pinned. The window must EXCLUDE now (so the card defers)
 * with a margin the journey survives, and stay inside the platform ceiling
 * so the save is accepted:
 *   - daytime: `start = ceil15(nowMin + 31)`, end 21:00 — taken ONLY while
 *     `540 <= nowMin && start <= 1245` (start ≤ 20:45). Past that, start
 *     would reach 21:00 == end and the client's own order rule would disable
 *     save: a red 15 minutes every evening under retries 0.
 *   - fixed: 09:30–20:00 otherwise (before 09:00 or from 20:15 on), which
 *     excludes now by construction.
 * In the daytime branch `end` equals the default and is NOT sent (commsDiff
 * sends changed keys only), so the row is inserted with end 21:00:00 — the
 * f15 `.slice(0, 5)` normalisation (A1) is what lets the later partial PUTs
 * (untick first touch, widen back) succeed against that stored `time`.
 */
function pickWindow(now: Date = new Date()): PickedWindow {
  const nowMin = torontoMinutes(now);
  const start = Math.ceil((nowMin + 31) / 15) * 15;
  if (nowMin >= 540 && start <= 1245) return { start: hhmm(start), end: '21:00', branch: 'daytime', nowMin };
  return { start: '09:30', end: '20:00', branch: 'fixed', nowMin };
}

async function signUp(page: Page, who: { name: string; email: string }, pass: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(who.name);
  await page.getByLabel('Courriel').fill(who.email);
  await page.getByLabel('Mot de passe').fill(pass);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');
}

async function logIn(page: Page, email: string, pass: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(pass);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');
}

async function createOrganization(page: Page, org: { name: string; slug: string }): Promise<void> {
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name);
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
}

/** A14: the desktop sidebar — first of the two « Navigation principale » landmarks. */
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' }).first();

/** The form's controls, by their visible labels (settings:windowStart …). */
const start = (page: Page) => page.getByLabel('Début de la fenêtre d’envoi');
const end = (page: Page) => page.getByLabel('Fin de la fenêtre d’envoi');
const firstTouch = (page: Page) => page.getByLabel('Première réponse à une nouvelle demande envoyée immédiatement, même hors fenêtre');
const dailyCap = (page: Page) => page.getByLabel('Contacts automatisés (assistant et relances) par prospect et par jour');
const turnCap = (page: Page) => page.getByLabel('Messages de l’assistant avant remise à une personne');
const save = (page: Page) => page.getByRole('button', { name: 'Enregistrer', exact: true });
/** settings:defaultsNotice — the status line shown while no row exists. */
const defaultsNotice = (page: Page) => page.getByRole('status').filter({ hasText: 'Aucune configuration enregistrée' });
/** The lead page's « Messages texte » card (compliance:channel_sms): its h3's parent. */
const smsCard = (page: Page) => page.getByRole('heading', { level: 3, name: 'Messages texte' }).locator('..');

async function openAutomations(page: Page): Promise<void> {
  await page.goto('/settings/automations');
  await expect(page.getByRole('heading', { level: 1, name: 'Automatisations' })).toBeVisible();
}

async function expectForm(page: Page, values: { start: string; end: string; firstTouch: boolean; daily: string; turn: string }): Promise<void> {
  await expect(start(page)).toHaveValue(values.start);
  await expect(end(page)).toHaveValue(values.end);
  if (values.firstTouch) await expect(firstTouch(page)).toBeChecked();
  else await expect(firstTouch(page)).not.toBeChecked();
  await expect(dailyCap(page)).toHaveValue(values.daily);
  await expect(turnCap(page)).toHaveValue(values.turn);
}

test('T1 — the defaults are shown and said out loud, and the saved window survives a reload', async ({ page }) => {
  await signUp(page, owner, password);
  await createOrganization(page, orgA);
  // A store, so a lead exists to read the card on. Its zone is irrelevant:
  // the lead's 514 number puts the recipient in America/Toronto.
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill(STORE);
  await page.getByLabel('Code').fill(`F76A-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: STORE });
  await page.getByLabel('Téléphone').fill(LEAD.phone);
  await page.getByLabel('Prénom').fill(LEAD.first);
  await page.getByLabel('Nom de famille').fill(LEAD.last);
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: `${LEAD.first} ${LEAD.last}` })).toBeVisible();
  leadUrl = new URL(page.url()).pathname;
  // compliance:record_verbal — express consent on sms. Until it is recorded
  // the card says « Non autorisé »; after it, the verdict is the window's.
  await page.getByRole('button', { name: 'A dit oui en personne' }).click();
  await expect(smsCard(page).getByText(/^(Autorisé maintenant|En attente de ses heures locales)$/)).toBeVisible();

  // R8: no row yet → the platform defaults, and the notice that says so.
  await openAutomations(page);
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: true, daily: '3', turn: '15' });
  await expect(defaultsNotice(page)).toHaveText(MSG.defaultsNotice);
  // settings:appliesToAll — one row per organization, no per-store control.
  await expect(page.getByText('S’applique à toutes les succursales de l’organisation.')).toBeVisible();

  saved = pickWindow();
  test.info().annotations.push({
    type: 'window',
    description: `${saved.branch} branch at Toronto ${hhmm(saved.nowMin)}: ${saved.start}–${saved.end}` +
      (saved.branch === 'daytime' ? ' (end equals the default and is not sent — the row takes 21:00:00 from the column)' : ''),
  });
  await start(page).fill(saved.start);
  await end(page).fill(saved.end);
  await firstTouch(page).uncheck();
  await dailyCap(page).fill('2');
  await turnCap(page).fill('10');
  await save(page).click();
  await expect(page.getByRole('status').filter({ hasText: MSG.saved })).toBeVisible();

  // A full reload: what the GET returns, sliced to HH:MM; the notice is gone.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Automatisations' })).toBeVisible();
  await expectForm(page, { start: saved.start, end: saved.end, firstTouch: false, daily: '2', turn: '10' });
  await expect(defaultsNotice(page)).toHaveCount(0);
});

test('T2 — the ceiling and the order are refused under their field; the lead card applies the saved window to the minute', async ({ page }) => {
  await logIn(page, owner.email, password);
  await openAutomations(page);
  await expectForm(page, { start: saved.start, end: saved.end, firstTouch: false, daily: '2', turn: '10' });

  // The ceiling, under « Début » (settings:windowTooWide) — the client
  // mirror of f15's window_too_wide, which the API always reports on
  // sms_quiet_start. Save is disabled: nothing leaves the browser.
  await start(page).fill('08:00');
  await expect(page.locator('#comms-start-error')).toHaveText(MSG.windowTooWide);
  await expect(save(page)).toBeDisabled();
  await start(page).fill(saved.start);
  await expect(page.locator('#comms-start-error')).toHaveCount(0);

  // The order, under « Fin » (settings:windowInverted) — where the server's
  // invalid_window also lands (sms_quiet_end).
  await start(page).fill('20:30');
  await end(page).fill('20:00');
  await expect(page.locator('#comms-end-error')).toHaveText(MSG.windowInverted);
  await expect(save(page)).toBeDisabled();
  await start(page).fill(saved.start);
  await end(page).fill(saved.end);
  await expect(page.locator('#comms-end-error')).toHaveCount(0);
  // Back to the saved values: no diff, nothing to save.
  await expect(save(page)).toBeDisabled();

  // The card. The check runs the send layer's gate on the same row this
  // form wrote; `now` is outside the saved window by construction (A5), so
  // the verdict is a deferral to the window's start — rendered in the
  // browser's zone, pinned to Toronto above, so the minute is the one saved.
  // Probed Node fr-CA `timeStyle: 'short'`: « 09 h 30 » (leading zero kept)
  // and « 20 h 00 » — hence `0?` and `\s*` around the « h ».
  await page.goto(leadUrl);
  await expect(smsCard(page).getByText('En attente de ses heures locales', { exact: true })).toBeVisible();
  const hh = saved.start.slice(0, 2);
  const mm = saved.start.slice(3, 5);
  await expect(smsCard(page).getByText(/Envoi prévu à/)).toHaveText(new RegExp(`0?${Number(hh)}\\s*h\\s*${mm}`));

  // Widen back to the platform window. In the daytime branch only `start`
  // changed, so this is a PARTIAL PUT against a row whose stored end is the
  // `time` '21:00:00' — the request the A1 normalisation exists for.
  await openAutomations(page);
  await start(page).fill('09:00');
  await end(page).fill('21:00');
  await save(page).click();
  await expect(page.getByRole('status').filter({ hasText: MSG.saved })).toBeVisible();
  await page.reload();
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: false, daily: '2', turn: '10' });
  test.info().annotations.push({
    type: 'widen-back',
    description:
      saved.branch === 'daytime'
        ? 'daytime branch: the widen-back PUT carried sms_quiet_start only (end already 21:00) — the partial-PUT normalisation proof'
        : 'fixed branch: the widen-back PUT carried both bounds',
  });

  // « Autorisé maintenant » is a fact only while Toronto time is inside the
  // platform window with margin; outside it the card defers to 09:00
  // tomorrow whatever was saved, and asserting that would prove nothing
  // about this form. Deterministic either way: the branch is annotated.
  const nowMin = torontoMinutes(new Date());
  if (nowMin >= 545 && nowMin <= 1255) {
    await page.goto(leadUrl);
    await expect(smsCard(page).getByText('Autorisé maintenant', { exact: true })).toBeVisible();
    test.info().annotations.push({ type: 'allowed-now', description: `asserted at Toronto ${hhmm(nowMin)}` });
  } else {
    test.info().annotations.push({
      type: 'allowed-now',
      description: `not asserted: Toronto ${hhmm(nowMin)} is outside 09:05–20:55, the card defers regardless of the saved window`,
    });
  }
});

test('T3 — a fresh organization: one field saved, the rest read back as the database defaults', async ({ page }) => {
  await logIn(page, owner.email, password);
  await createOrganization(page, orgB);

  // From here the owner is multi-org: every org-scoped page shows the
  // « Organisation » select (settings:orgScope), newest first — so B is the
  // default, and it is still selected explicitly (A15).
  await openAutomations(page);
  await page.getByLabel('Organisation', { exact: true }).selectOption({ label: orgB.name });
  await expect(defaultsNotice(page)).toBeVisible();
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: true, daily: '3', turn: '15' });
  await turnCap(page).fill('20');
  await save(page).click();
  await expect(page.getByRole('status').filter({ hasText: MSG.saved })).toBeVisible();

  // Reload, re-select B (the select is page state), read the row the PUT
  // inserted: the unsent columns hold migration 0028/0033's defaults — the
  // displayed defaults were the database's, not the form's invention.
  await page.reload();
  await page.getByLabel('Organisation', { exact: true }).selectOption({ label: orgB.name });
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: true, daily: '3', turn: '20' });
  await expect(defaultsNotice(page)).toHaveCount(0);
  // And A's row is A's: the select scopes the form.
  await page.getByLabel('Organisation', { exact: true }).selectOption({ label: orgA.name });
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: false, daily: '2', turn: '10' });
});

test('T4 — a sales manager can read the automations and cannot change them; /settings lists what is member-readable', async ({ page }) => {
  // A16: invite « Sam Ventes » into A as « Directeur des ventes » ALONE
  // (untick the default « Vendeur »); the a13 invite / accept flow.
  await logIn(page, owner.email, password);
  await sidebar(page).getByRole('link', { name: 'Équipe' }).click();
  await expect(page).toHaveURL('/team');
  await page.getByLabel('Organisation', { exact: true }).selectOption({ label: orgA.name });
  await page.getByLabel('Nom', { exact: true }).fill(sam.name);
  await page.getByLabel('Courriel').fill(sam.email);
  await page.getByLabel('Vendeur', { exact: true }).uncheck();
  await page.getByLabel('Directeur des ventes').check();
  await page.getByRole('button', { name: 'Inviter', exact: true }).click();
  await expect(page.getByText('Le courriel n’est pas parti')).toBeVisible();
  const token = (await page.getByLabel('Lien d’invitation').inputValue()).split('/').pop() ?? '';
  expect(token).not.toBe('');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`/invitations/${token}`);
  await page.getByLabel('Nom complet').fill(sam.name);
  await page.getByLabel('Mot de passe').fill(sam.password);
  await page.getByRole('button', { name: 'Créer le compte et accepter' }).click();
  await expect(page).toHaveURL('/');

  // As Sam (one organization: no select): A's row, every control disabled,
  // the sentence (settings:readOnly), and no save button at all.
  await openAutomations(page);
  await expect(page.getByLabel('Organisation', { exact: true })).toHaveCount(0);
  await expect(page.getByText(MSG.readOnly)).toBeVisible();
  await expectForm(page, { start: '09:00', end: '21:00', firstTouch: false, daily: '2', turn: '10' });
  for (const control of [start(page), end(page), firstTouch(page), dailyCap(page), turnCap(page)]) {
    await expect(control).toBeDisabled();
  }
  await expect(save(page)).toHaveCount(0);

  // /settings mirrors each target page (R9): Automations and Stores are
  // member-readable and listed; the branding editor hides itself without
  // organization:update, so its card is gone (orgs:brandingLink).
  await sidebar(page).getByRole('link', { name: 'Réglages' }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('link', { name: /^Automatisations/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Succursales/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Image de marque/ })).toHaveCount(0);
});
