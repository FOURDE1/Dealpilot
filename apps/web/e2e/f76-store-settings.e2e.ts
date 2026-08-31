import { expect, test, type Page } from '@playwright/test';

/**
 * F-76 — the store's « Exploitation » fieldset and the /settings pages,
 * through the real screens (R10, A14, A16).
 *
 * The claim worth an e2e: every operating field the assistant, the drips and
 * the quiet-hours gate read — timezone, phone, texting number, opening hours,
 * holidays — is produced from ONE form, reads back byte-for-byte after a
 * reload, and every refusal lands under the field it is about with the fix
 * in the sentence. The consumer side (what the assistant does with the hours)
 * is proven at the worker level (assistant-turn.test.ts); nothing on these
 * screens claims to show it.
 *
 * Serial by design — one owner, one organization, two stores whose texting
 * number moves between them — so every test shares the module-level ids and
 * each gets its own 90 s. No bootstrap one-shot, no database literal: the
 * suite runs only through scripts/e2e.mjs against dealpilot_e2e_test.
 * Every French string below is a fr-CA value (packages/i18n/src/locales/
 * fr-CA.ts); the key is named beside the first use of each.
 *
 * Deferred, each with its reason, so widening the scope is a visible
 * deletion here rather than a memory:
 *   - The cross-organization 409 on the texting number: an API case
 *     (f30-carrier.test.ts) — a second owner in a second organization adds a
 *     minute of journey to prove a row the same constraint already proves.
 *   - The 61st holiday and 2026-02-30: the native date input cannot type a
 *     non-calendar date, and the ceiling is a unit lockstep
 *     (holiday-dates.test.ts against UpdateStoreInput).
 *   - The activity trail after an hours edit: activity.ts compares plain
 *     objects as `[object Object]`, so a business_hours-only PATCH records no
 *     event today (A7) — nothing here may claim it does.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const password = 'MotDePasse!2026-f76s';
const owner = { name: 'Odette Réglages', email: `f76s-${stamp}@1dealer.test` };
/** A16: a sales manager holds neither store:update nor organization:update. */
const sam = { name: 'Sam Ventes', email: `f76s-sam-${stamp}@1dealer.test`, password: 'MotDePasse!2026-sam76s' };
const org = { name: `Groupe F76S ${stamp}`, slug: `groupe-f76s-${stamp}` };
const STORE_A = { name: 'Kia Mont-Laurier', code: `F76A-${stamp % 10000}` };
const STORE_B = { name: 'Succursale F76 B', code: `F76B-${stamp % 10000}` };
/** Typed as a person types it; stored as the API normalises it (E.164). */
const NUMBER = { typed: '514 555 0142', stored: '+15145550142' };
const PHONE = { typed: '819 555 0100', stored: '+18195550100' };
const HOLIDAYS = ['2026-12-25', '2027-01-01'] as const;

/** fr-CA orgs:timezoneUnknown / smsNumberInvalid / smsNumberTaken / hoursOrderError / hoursHint / readOnlyStore. */
const MSG = {
  timezoneUnknown:
    'Fuseau horaire inconnu — utilisez un nom région/ville IANA, ex. America/Montreal. EST ou UTC-5 n’ont pas de règle d’heure avancée et sont refusés.',
  smsNumberInvalid: 'Numéro invalide — 10 chiffres nord-américains, ex. 514 555 0199.',
  smsNumberTaken: 'Ce numéro est déjà attribué à une autre succursale. Un numéro n’appartient qu’à une seule succursale.',
  hoursOrderError: 'L’heure de fermeture doit suivre l’heure d’ouverture.',
  hoursHint:
    'Lues par l’assistant : hors de ces heures, il annonce un suivi à la prochaine ouverture. Sans heures, il se comporte comme si la succursale était toujours ouverte, sauf les jours fériés.',
  readOnlyStore: 'Lecture seule : votre rôle ne permet pas de modifier cette succursale.',
} as const;

/** Filled by T1; every later test navigates by these. */
let orgId = '';
let storeAUrl = '';
let storeBUrl = '';

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

/**
 * A14: never `getByRole('link', { name: 'Réglages' })` unscoped. At the
 * default 1280×720 the desktop sidebar renders, and on /organizations/:orgId
 * the header carries a second « Réglages » link (phone reach) — two links
 * with one accessible name is a strict-mode violation. The sidebar and the
 * bottom bar are both `<nav aria-label="Navigation principale">`
 * (nav:mainNav); the sidebar is first in the DOM, so `.first()` is the
 * desktop one — the a13-permissions.e2e.ts precedent for « Équipe ».
 */
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' }).first();

/** Sidebar « Réglages » (nav:settings) → index heading → « Succursales » card (settings:sec_stores). */
async function openSettingsStores(page: Page): Promise<void> {
  await sidebar(page).getByRole('link', { name: 'Réglages' }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
  // The card's accessible name is its label followed by its description, so
  // the match is anchored to the label — a bare substring would also hit
  // « …de chaque succursale » in the description of another card.
  await page.getByRole('link', { name: /^Succursales/ }).click();
  await expect(page).toHaveURL('/settings/stores');
  await expect(page.getByRole('heading', { level: 1, name: 'Succursales' })).toBeVisible();
}

const storeRow = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
/** One exact cell — « Définies » must not be satisfied by « Non définies ». */
const cell = (page: Page, name: string, text: string) => storeRow(page, name).getByRole('cell', { name: text, exact: true });

/** The store form — the one carrying the « Exploitation » legend (orgs:operations). */
const storeForm = (page: Page) => page.locator('form').filter({ has: page.getByText('Exploitation', { exact: true }) });
const saveButton = (page: Page) => storeForm(page).getByRole('button', { name: 'Enregistrer', exact: true });
/** One day's row in the hours grid: `role="group"` named by the day (orgs:day_*). */
const dayRow = (page: Page, day: string) => page.getByRole('group', { name: day, exact: true });
/** The holidays fieldset (orgs:holidays), named by its legend. */
const holidays = (page: Page) => page.getByRole('group', { name: 'Jours fériés' });

test('T1 — two stores: one chooses Vancouver, one keeps the Montreal default, and the list says nothing is configured yet', async ({ page }) => {
  await signUp(page, owner, password);
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name);
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  orgId = page.url().split('/').pop() ?? '';

  // The CREATE form now carries the timezone select (MUST ADD), defaulting
  // to the server's own America/Montreal. Store A chooses Vancouver.
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('America/Montreal');
  await page.getByLabel('Fuseau horaire').selectOption('America/Vancouver');
  await page.getByLabel('Nom de la succursale').fill(STORE_A.name);
  await page.getByLabel('Code').fill(STORE_A.code);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: STORE_A.name })).toBeVisible();

  // Store B never touches the select: the default is what f68-tasks.e2e.ts
  // relies on, and this is where that reliance is proven.
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('America/Montreal');
  await page.getByLabel('Nom de la succursale').fill(STORE_B.name);
  await page.getByLabel('Code').fill(STORE_B.code);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: STORE_B.name })).toBeVisible();
  storeAUrl = (await page.getByRole('link', { name: STORE_A.name }).getAttribute('href')) ?? '';
  storeBUrl = (await page.getByRole('link', { name: STORE_B.name }).getAttribute('href')) ?? '';
  expect(storeAUrl).toMatch(new RegExp(`^/organizations/${orgId}/stores/[0-9a-f-]{36}$`));
  expect(storeBUrl).toMatch(new RegExp(`^/organizations/${orgId}/stores/[0-9a-f-]{36}$`));

  // Phone reach (MUST ADD): the organization page's own « Réglages » link,
  // scoped to the main landmark so the sidebar's twin is not in the match.
  await page.getByRole('main').getByRole('link', { name: 'Réglages' }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page).toHaveTitle(/^Réglages — /);

  // /settings/stores: the facts the organization page's table does not show.
  // settings:hoursUnset « Non définies »; no texting number renders « — ».
  await openSettingsStores(page);
  await expect(storeRow(page, STORE_A.name)).toContainText('America/Vancouver');
  await expect(cell(page, STORE_A.name, 'Non définies')).toHaveCount(1);
  await expect(cell(page, STORE_A.name, '—')).toHaveCount(1);
  await expect(cell(page, STORE_A.name, '0')).toHaveCount(1);
  await expect(storeRow(page, STORE_B.name)).toContainText('America/Montreal');
  await expect(cell(page, STORE_B.name, 'Non définies')).toHaveCount(1);
});

test('T2 — every Exploitation field reads back after a reload, and every refusal names its fix under its field', async ({ page }) => {
  await logIn(page, owner.email, password);
  await page.goto(storeAUrl);
  // orgs:editStore / orgs:operations
  await expect(page.getByRole('heading', { level: 1, name: 'Modifier la succursale' })).toBeVisible();
  await expect(page.getByText('Exploitation', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('America/Vancouver');

  // R6: « Autre (nom IANA) » (orgs:timezoneOther) reveals the free-text input;
  // `EST` is a zone with no daylight rule, refused by the SERVER
  // (unknown_timezone) and mapped under the field — the sentence says why.
  await page.getByLabel('Fuseau horaire').selectOption({ label: 'Autre (nom IANA)' });
  await page.getByLabel('Autre (nom IANA)').fill('EST');
  await saveButton(page).click();
  await expect(page.locator('#store-timezone-other-error')).toHaveText(MSG.timezoneUnknown);
  await expect(page.getByLabel('Autre (nom IANA)')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(storeAUrl);
  await page.getByLabel('Fuseau horaire').selectOption('America/Toronto');
  await expect(page.getByLabel('Autre (nom IANA)')).toHaveCount(0);

  // R7: a three-digit texting number is refused by the server (phone_nanp)
  // under its field (orgs:smsNumber → orgs:smsNumberInvalid).
  await page.getByLabel('Numéro d’expédition des textos').fill('514');
  await saveButton(page).click();
  await expect(page.locator('#store-sms-error')).toHaveText(MSG.smsNumberInvalid);
  await expect(page.getByLabel('Numéro d’expédition des textos')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(storeAUrl);
  await page.getByLabel('Numéro d’expédition des textos').fill(NUMBER.typed);
  // orgs:storePhone — the number the drips hand the customer to call back.
  await page.getByLabel('Téléphone de la succursale').fill(PHONE.typed);

  // R5: the grid. Ticking « Ouvert — lundi » (orgs:dayOpen) seeds 09:00–18:00
  // (hours-grid.ts DEFAULT_WINDOW); an inverted pair is refused by the
  // CLIENT mirror of the server rule — the row error appears and save is
  // disabled before any request is made.
  await page.getByLabel('Ouvert — lundi').check();
  await expect(page.getByLabel('Ouverture — lundi')).toHaveValue('09:00');
  await expect(page.getByLabel('Fermeture — lundi')).toHaveValue('18:00');
  await page.getByLabel('Ouverture — lundi').fill('18:00');
  await page.getByLabel('Fermeture — lundi').fill('09:00');
  await expect(dayRow(page, 'lundi').getByRole('alert')).toHaveText(MSG.hoursOrderError);
  await expect(saveButton(page)).toBeDisabled();
  await page.getByLabel('Ouverture — lundi').fill('09:00');
  await page.getByLabel('Fermeture — lundi').fill('18:00');
  await expect(dayRow(page, 'lundi').getByRole('alert')).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
  // orgs:copyMonday — Tuesday to Friday take Monday's window.
  await page.getByRole('button', { name: 'Appliquer le lundi à mardi–vendredi' }).click();
  for (const day of ['mardi', 'mercredi', 'jeudi', 'vendredi']) {
    await expect(page.getByLabel(`Ouvert — ${day}`)).toBeChecked();
    await expect(page.getByLabel(`Ouverture — ${day}`)).toHaveValue('09:00');
    await expect(page.getByLabel(`Fermeture — ${day}`)).toHaveValue('18:00');
  }
  await page.getByLabel('Ouvert — samedi').check();
  await page.getByLabel('Ouverture — samedi').fill('10:00');
  await page.getByLabel('Fermeture — samedi').fill('16:00');
  // Sunday stays closed: unchecked, its time inputs greyed.
  await expect(page.getByLabel('Ouvert — dimanche')).not.toBeChecked();
  await expect(page.getByLabel('Ouverture — dimanche')).toBeDisabled();

  // Holidays (orgs:holidayDate « Date à ajouter », orgs:holidayAdd): a repeat
  // is a no-op, so three adds leave two rows — each a <time> whose text IS
  // the literal the server stores.
  for (const date of [HOLIDAYS[0], HOLIDAYS[1], HOLIDAYS[0]]) {
    await page.getByLabel('Date à ajouter').fill(date);
    // Scoped: the fleet section below the form carries three more « Ajouter »
    // (company, chaser, plate — dispatch:addCompany/addChaser/addPlate); the
    // intake-sources section has none (its button is « Créer la clé »). The
    // holidays one is the fieldset's own.
    await holidays(page).getByRole('button', { name: 'Ajouter', exact: true }).click();
  }
  await expect(holidays(page).getByRole('listitem')).toHaveCount(2);
  await expect(holidays(page).locator('time')).toHaveText([...HOLIDAYS]);

  await saveButton(page).click();
  await expect(page).toHaveURL(`/organizations/${orgId}`);

  // A FULL load, then every value as the server sent it back: the timezone,
  // both numbers in E.164, the grid day by day (R2's serialiser is what keeps
  // the holiday literals from slipping a day on a non-UTC host).
  await page.goto(storeAUrl);
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('America/Toronto');
  await expect(page.getByLabel('Numéro d’expédition des textos')).toHaveValue(NUMBER.stored);
  await expect(page.getByLabel('Téléphone de la succursale')).toHaveValue(PHONE.stored);
  for (const day of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) {
    await expect(page.getByLabel(`Ouvert — ${day}`)).toBeChecked();
    await expect(page.getByLabel(`Ouverture — ${day}`)).toHaveValue('09:00');
    await expect(page.getByLabel(`Fermeture — ${day}`)).toHaveValue('18:00');
  }
  await expect(page.getByLabel('Ouvert — samedi')).toBeChecked();
  await expect(page.getByLabel('Ouverture — samedi')).toHaveValue('10:00');
  await expect(page.getByLabel('Fermeture — samedi')).toHaveValue('16:00');
  await expect(page.getByLabel('Ouvert — dimanche')).not.toBeChecked();
  await expect(page.getByLabel('Ouverture — dimanche')).toBeDisabled();
  await expect(page.getByLabel('Fermeture — dimanche')).toBeDisabled();
  await expect(holidays(page).locator('time')).toHaveText([...HOLIDAYS]);

  // The hours hint (orgs:hoursHint) is the grid's accessible DESCRIPTION: the
  // fieldset named by the legend (orgs:hoursLegend) carries aria-describedby,
  // so the sentence stating what the assistant does with the grid is
  // announced on entering it, like every sibling hint on this form.
  await expect(page.getByRole('group', { name: 'Heures d’ouverture' })).toHaveAccessibleDescription(MSG.hoursHint);

  // Keyboard removal keeps the focus in the list, never on <body>. A third,
  // UNSAVED date makes all three landings observable: the next « Retirer »
  // after removing a middle row, the previous one after removing the last,
  // and « Date à ajouter » once the list is empty. Nothing is saved, so the
  // server — and every later test — still holds the two dates.
  await page.getByLabel('Date à ajouter').fill('2027-07-01');
  await holidays(page).getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(holidays(page).getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: `Retirer — ${HOLIDAYS[1]}` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Retirer — 2027-07-01' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `Retirer — ${HOLIDAYS[0]}` })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Date à ajouter')).toBeFocused();
  await expect(holidays(page).getByRole('listitem')).toHaveCount(0);

  // The list reflects the SAVED row: settings:hoursSet « Définies », two
  // holidays, the stored number, the new zone.
  await openSettingsStores(page);
  await expect(storeRow(page, STORE_A.name)).toContainText('America/Toronto');
  await expect(cell(page, STORE_A.name, NUMBER.stored)).toHaveCount(1);
  await expect(cell(page, STORE_A.name, 'Définies')).toHaveCount(1);
  await expect(cell(page, STORE_A.name, '2')).toHaveCount(1);
});

test('T3 — one number, one store: the 409 lands on the field, and releasing it makes it available', async ({ page }) => {
  await logIn(page, owner.email, password);
  // B claims A's number: the unique index (idx_stores_sms_number, 0036)
  // answers 409 with path sms_number, mapped under the field
  // (orgs:smsNumberTaken). Nothing else on the form changes; the URL stays.
  await page.goto(storeBUrl);
  await page.getByLabel('Numéro d’expédition des textos').fill(NUMBER.typed);
  await saveButton(page).click();
  await expect(page.locator('#store-sms-error')).toHaveText(MSG.smsNumberTaken);
  await expect(page.getByLabel('Numéro d’expédition des textos')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(storeBUrl);

  // A releases it: a blank field is sent as null (store-patch.ts), never as
  // "" — the list shows « — » again for A.
  await page.goto(storeAUrl);
  await expect(page.getByLabel('Numéro d’expédition des textos')).toHaveValue(NUMBER.stored);
  await page.getByLabel('Numéro d’expédition des textos').fill('');
  await saveButton(page).click();
  await expect(page).toHaveURL(`/organizations/${orgId}`);
  await openSettingsStores(page);
  await expect(cell(page, STORE_A.name, '—')).toHaveCount(1);
  await expect(cell(page, STORE_B.name, NUMBER.stored)).toHaveCount(0);

  // B takes it.
  await page.goto(storeBUrl);
  await page.getByLabel('Numéro d’expédition des textos').fill(NUMBER.typed);
  await saveButton(page).click();
  await expect(page).toHaveURL(`/organizations/${orgId}`);
  await openSettingsStores(page);
  await expect(cell(page, STORE_B.name, NUMBER.stored)).toHaveCount(1);
  await expect(cell(page, STORE_A.name, '—')).toHaveCount(1);
});

test('T4 — a sales manager opens the store form read-only: every control disabled, the sentence says why, no save button', async ({ page }) => {
  // A16: invite « Sam Ventes » as « Directeur des ventes » ALONE —
  // RoleCheckboxes defaults to « Vendeur » (team-page.tsx), which is unticked
  // so the proof is about sales_manager and nothing else. The a13 invite /
  // accept flow: the dev mailer hands the owner the link.
  await logIn(page, owner.email, password);
  await sidebar(page).getByRole('link', { name: 'Équipe' }).click();
  await expect(page).toHaveURL('/team');
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

  // As Sam: the form renders the data, refuses the pen. Before F-76 this form
  // had no permission gate at all; the gate is one <fieldset disabled> around
  // EVERY control, the pre-existing fields included (D-077).
  await page.goto(storeAUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Modifier la succursale' })).toBeVisible();
  await expect(page.getByText(MSG.readOnlyStore)).toBeVisible();
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('America/Toronto');
  for (const label of [
    'Nom de la succursale',
    'Fuseau horaire',
    'Téléphone de la succursale',
    'Numéro d’expédition des textos',
    'Ouvert — lundi',
    'Ouverture — lundi',
    'Date à ajouter',
  ]) {
    await expect(page.getByLabel(label)).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Appliquer le lundi à mardi–vendredi' })).toBeDisabled();
  await expect(holidays(page).getByRole('button', { name: 'Ajouter', exact: true })).toBeDisabled();
  await expect(saveButton(page)).toHaveCount(0);

  // The list is member-readable (sections.ts): Sam sees the row, and no
  // « Nouvelle succursale » — sales_manager lacks store:create too.
  await openSettingsStores(page);
  await expect(cell(page, STORE_A.name, 'Définies')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Nouvelle succursale' })).toHaveCount(0);
});

test("T5 — the English pass: the same screens, every label from en-CA", async ({ page }) => {
  await logIn(page, owner.email, password);
  await sidebar(page).getByRole('link', { name: 'Réglages' }).click();
  await expect(page).toHaveURL('/settings');
  // common:switchLanguage — the switcher's accessible name is in the current language.
  await page.getByRole('button', { name: "Passer à l'anglais" }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Stores/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Automations/ })).toBeVisible();

  await page.getByRole('link', { name: /^Stores/ }).click();
  await expect(page).toHaveURL('/settings/stores');
  await expect(page.getByRole('heading', { level: 1, name: 'Stores' })).toBeVisible();
  // settings:hoursSet 'Set' / hoursUnset 'Not set'
  await expect(cell(page, STORE_A.name, 'Set')).toHaveCount(1);
  await expect(cell(page, STORE_B.name, 'Not set')).toHaveCount(1);

  await page.goto(storeAUrl);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit store' })).toBeVisible();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Time zone')).toHaveValue('America/Toronto');
  await expect(page.getByLabel('Store phone')).toHaveValue(PHONE.stored);
  await expect(page.getByLabel('Open — Monday')).toBeChecked();
  await expect(page.getByLabel('Opens — Monday')).toHaveValue('09:00');
  await expect(page.getByLabel('Closes — Saturday')).toHaveValue('16:00');
  await expect(page.getByLabel('Open — Sunday')).not.toBeChecked();
  await expect(page.getByRole('group', { name: 'Holidays' }).locator('time')).toHaveText([...HOLIDAYS]);
  await expect(page.getByRole('button', { name: 'Apply Monday to Tuesday–Friday' })).toBeVisible();
});
