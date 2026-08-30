import { expect, test } from '@playwright/test';

/**
 * F-68 — the task board (/tasks), through the real screens.
 *
 * The board has no create affordance of its own: a follow-up is born on the
 * record it is about, which is why this journey goes signup → org → store →
 * lead → the lead's "Planifier un suivi" panel, and only then to /tasks.
 *
 * The claim worth an e2e is the bucket. "Aujourd'hui" is computed in SQL from
 * the TASK'S STORE timezone, never from whoever is looking — so the browser
 * here is deliberately parked on the other side of the planet. A bucket that
 * followed the browser's calendar would land in the other column, and the
 * board's own bucket filter is what proves it: the store's column holds the
 * row, and the column the browser's clock would have chosen is empty.
 */

/**
 * Every store the UI can create is stamped America/Montreal — the create form
 * hardcodes it and offers no field (store-form-page.tsx: "dedicated fields
 * come with a later slice"). So the store clock is a constant here, and the
 * only clock this test can move is the browser's.
 */
const STORE_TZ = 'America/Montreal';
const BROWSER_TZ = 'Asia/Tokyo';
test.use({ timezoneId: BROWSER_TZ });

const stamp = Date.now();
const password = 'MotDePasse!2026-f68';
const owner = { name: 'Odile Tache', email: `f68-${stamp}@1dealer.test` };
const org = { name: `Groupe F68 ${stamp}`, slug: `groupe-f68-${stamp}` };
const STORE = 'Succursale F68';
const LEAD = { first: 'Perrine', last: 'Suivie' };
const TASK = `Rappeler Perrine ${stamp}`;

type Bucket = 'today' | 'week';
const BUCKET_LABEL: Record<Bucket, string> = { today: 'Aujourd’hui', week: 'Cette semaine' };
const ALERT_LINE: Record<Bucket, string> = { today: '1 à faire aujourd’hui', week: '1 cette semaine' };

const dayIn = (tz: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The value a `datetime-local` input holds for `at`, read in `tz`. */
function fieldValue(tz: string, at: Date): string {
  const p = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${p.get('year')}-${p.get('month')}-${p.get('day')}T${p.get('hour')}:${p.get('minute')}`;
}

/**
 * Searched, not hardcoded: WHICH instant separates the two clocks depends on
 * the hour the suite happens to run at. Before Montreal 11:00 the separating
 * instant is later the same Montreal day (Tokyo has already turned over);
 * after it, it is early the next Montreal day (Tokyo has not). A fixed
 * timestamp would prove the point for a few hours a day and prove nothing for
 * the rest — which is exactly the bug this test exists to catch.
 *
 * `settle` is the slack the plan must survive: the classification has to hold
 * both now and three minutes out, so a bucket cannot quietly change between
 * here and the board's query (the journey below takes about twenty seconds).
 *
 * In the last minutes before the store's midnight no separating instant can
 * exist — "not the store's today" then means two days out, which is never the
 * browser's today either — so the search falls through to an instant that is
 * stably `week` on both clocks. The annotation on the test says which of the
 * two ran, so a report never has to guess.
 */
function planDue(now: Date): { due: Date; store: Bucket; browser: Bucket } {
  const base = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const settle = new Date(base.getTime() + 3 * 60_000);
  const stable = (tz: string, due: Date, sameDay: boolean) => {
    const hit = dayIn(tz, due) === dayIn(tz, base) && dayIn(tz, due) === dayIn(tz, settle);
    const miss = dayIn(tz, due) !== dayIn(tz, base) && dayIn(tz, due) !== dayIn(tz, settle);
    return sameDay ? hit : miss;
  };
  for (let minutes = 90; minutes <= 6 * 24 * 60; minutes += 15) {
    const due = new Date(base.getTime() + minutes * 60_000);
    if (stable(STORE_TZ, due, true) && stable(BROWSER_TZ, due, false)) return { due, store: 'today', browser: 'week' };
    if (stable(STORE_TZ, due, false) && stable(BROWSER_TZ, due, true)) return { due, store: 'week', browser: 'today' };
  }
  return { due: new Date(base.getTime() + 50 * 60 * 60_000), store: 'week', browser: 'week' };
}

test.describe.configure({ mode: 'serial' });

test('a fresh tenant opens the board and is told it is empty, not left spinning', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(owner.name);
  await page.getByLabel('Courriel').fill(owner.email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');

  // The board reads tasks per store, so the tenant needs somewhere to keep them.
  await page.goto('/organizations/new');
  await page.getByLabel("Nom de l'organisation").fill(org.name);
  await page.getByLabel('Identifiant (slug)').fill(org.slug);
  await page.getByRole('button', { name: "Créer l'organisation" }).click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Nouvelle succursale' }).click();
  await page.getByLabel('Nom de la succursale').fill(STORE);
  await page.getByLabel('Code').fill(`F68-${stamp % 10000}`);
  await page.getByRole('button', { name: 'Créer la succursale' }).click();
  await expect(page.getByRole('link', { name: STORE })).toBeVisible();

  // Reached the way a person reaches it — the sidebar, not a typed URL.
  await page.getByRole('link', { name: 'Tâches' }).first().click();
  await expect(page).toHaveURL('/tasks');
  await expect(page).toHaveTitle(/^Tâches — /);
  await expect(page.getByRole('heading', { name: 'Tâches', level: 1 })).toBeVisible();

  // Empty has to be SAID, in both places that speak here: the all-clear line
  // and the table's own empty message. A spinner that never resolves would
  // satisfy "the page loads" and tell the user nothing.
  await expect(page.getByRole('status', { name: 'Suivis' })).toHaveText(
    'Aucun suivi en retard — tout est à jour.',
  );
  await expect(page.getByText('Aucune tâche.')).toBeVisible();
  await expect(page.getByText('Chargement des tâches…')).toHaveCount(0);

  // It opens on what the morning question actually is: mine, still open.
  await expect(page.getByLabel('Mes tâches seulement')).toBeChecked();
  await expect(page.getByLabel('Afficher les terminées')).not.toBeChecked();
  await expect(page.getByLabel('Échéance')).toHaveValue('');
});

test('a follow-up lands in the bucket the STORE clock says, not the browser one', async ({ page }) => {
  const plan = planDue(new Date());
  // The fallback plan puts the task in `week` on BOTH clocks, and then the
  // "other column is empty" assertion below is satisfied by a browser-clock
  // implementation too — a green that proves nothing. That window is real (the
  // last minutes before the store's midnight, when no separating instant
  // exists), so it is skipped out loud rather than run vacuously: a skip is
  // visible in the report, a vacuous pass is not.
  test.skip(
    plan.store === plan.browser,
    `no instant separates ${STORE_TZ} from ${BROWSER_TZ} right now — both clocks ` +
      `bucket every candidate as ${BUCKET_LABEL[plan.store]}, so this journey ` +
      'could not tell the two apart and would pass either way',
  );
  test.info().annotations.push({
    type: 'store-clock',
    description:
      `due ${fieldValue(STORE_TZ, plan.due)} in ${STORE_TZ} -> ${BUCKET_LABEL[plan.store]}; ` +
      `the same instant reads ${fieldValue(BROWSER_TZ, plan.due)} in ${BROWSER_TZ}, ` +
      `where a browser-clock bucket would say ${BUCKET_LABEL[plan.browser]}`,
  });

  await page.goto('/login');
  await page.getByLabel('Courriel').fill(owner.email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL('/');

  // A task's store comes from its subject, so the lead is what carries the clock.
  await page.goto('/leads/new');
  await page.getByLabel('Succursale').selectOption({ label: STORE });
  await page.getByLabel('Téléphone').fill('+15145550768');
  await page.getByLabel('Prénom').fill(LEAD.first);
  await page.getByLabel('Nom de famille').fill(LEAD.last);
  await page.getByRole('button', { name: 'Créer le prospect' }).click();
  await expect(page.getByRole('heading', { name: `${LEAD.first} ${LEAD.last}` })).toBeVisible();

  // Nobody has planned the next touch on a live lead, and the panel says so.
  await expect(page.getByText('Aucun suivi planifié pour ce prospect.')).toBeVisible();

  const panel = page.getByRole('form', { name: 'Planifier un suivi' });
  await panel.getByLabel('Titre').fill(TASK);
  await panel.getByLabel('Échéance').fill(fieldValue(BROWSER_TZ, plan.due));
  await panel.getByLabel('Priorité').selectOption({ label: 'Haute' });
  // Assigned to me, because the board opens on "mine".
  await panel.getByLabel('Responsable').selectOption({ label: owner.name });
  await panel.getByRole('button', { name: 'Planifier' }).click();
  await expect(page.getByText('Suivi planifié.')).toBeVisible();
  await expect(page.getByText(TASK)).toBeVisible();
  // The warning is answered by the follow-up that answers it.
  await expect(page.getByText('Aucun suivi planifié pour ce prospect.')).toHaveCount(0);

  await page.getByRole('link', { name: 'Tâches' }).first().click();
  await expect(page).toHaveURL('/tasks');

  const row = page.getByRole('row').filter({ hasText: TASK });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: `${LEAD.first} ${LEAD.last}` })).toBeVisible();
  await expect(row.getByText('Suivi', { exact: true })).toBeVisible();
  await expect(row.getByText('Haute', { exact: true })).toBeVisible();
  await expect(row.getByText(owner.name, { exact: true })).toBeVisible();
  await expect(row.getByText('À faire', { exact: true })).toBeVisible();
  await expect(row.getByText(BUCKET_LABEL[plan.store], { exact: true })).toBeVisible();

  // The summary bar counts through the same store-timezone CTE, so it has to
  // agree with the chip — two readers of one clock, not two clocks.
  await expect(page.getByRole('status', { name: 'Suivis' })).toHaveText(ALERT_LINE[plan.store]);

  // The filter re-asks the SERVER for one bucket, so this is the board's own
  // claim about where the task lives, not a chip rendered beside it.
  const other: Bucket = plan.store === 'today' ? 'week' : 'today';
  await page.getByLabel('Échéance').selectOption({ label: BUCKET_LABEL[plan.store] });
  await expect(page).toHaveURL(`/tasks?bucket=${plan.store}`);
  await expect(row).toHaveCount(1);

  // ...and the column the browser's own calendar would have filed it under is
  // empty. This is the assertion a bucket computed from the browser's clock
  // instead of the store's timezone cannot survive.
  await page.getByLabel('Échéance').selectOption({ label: BUCKET_LABEL[other] });
  await expect(page).toHaveURL(`/tasks?bucket=${other}`);
  await expect(page.getByText('Aucune tâche.')).toBeVisible();
  await expect(row).toHaveCount(0);
});
