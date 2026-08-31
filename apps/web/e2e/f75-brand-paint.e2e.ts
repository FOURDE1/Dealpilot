import { Buffer } from 'node:buffer';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { wcagRatio } from './support/contrast.js';

/**
 * F-75 (D-076) — the brand paint, through the real shell in the real Chrome.
 *
 * Three journeys, each with its own signup and organization (no shared state,
 * no bootstrap helper, retries 0, no waits):
 *   1. a PALE primary (#FDE047, 1.32:1 on white as text) paints the button
 *      as a raw fill under a near-black label, the link as a DIFFERENT, proven
 *      tone, the focus ring, the sidebar's active item (the accent unit), the
 *      radius, compact density, the system font, the logo, the favicon and the
 *      tab title — in light and, through the toggle, in dark (where the radius
 *      and the font are asserted again: they are theme-independent) — the
 *      editor's asset rows say the published logo/favicon are live even after
 *      an unrelated draft edit, and sign-out leaves /login unbranded;
 *   2. `dark_mode: 'disabled'` holds the document to light over a STORED dark
 *      preference without erasing it, and a republish to `derived` gives the
 *      preference back;
 *   3. an ERRORED GET /api/v1/branding (500) renders the shell once, in the
 *      platform look, and the request count stays at the cold load's — the
 *      shell is the query's only observer, so an error cannot re-trigger a
 *      fetch (the skeleton ↔ shell loop this test exists for measured 1215
 *      requests in 15.6 s on the unfixed tree, the shell never rendering).
 * The unbranded half (no stylesheet, no density attribute, no favicon, no
 * gated diagnostics) lives in f14-branding.e2e.ts.
 *
 * Determinism: every expected colour is read back from GET /api/v1/branding
 * AFTER publish (the server's own adjusted palette), never a pasted OKLCH
 * string, and asserted EQUAL to the computed style after ONE browser
 * serialisation on both sides (`canon()`; Chrome serialises a computed OKLCH
 * colour as `oklch(…)` and a platform hex token as `rgb(…)`) — that equality
 * is what fails on a shell that did not paint. Each of the twelve palette
 * cells this spec reads back (light: fill, label, hover fill, hover label,
 * text tone, ring, accent fill, accent label; dark: fill, label, text tone,
 * ring) is ALSO asserted to differ from the platform value captured from the
 * same shell before the brand existed, in ONE colour space (`srgb()`: the
 * specified colour's sRGB channels, whatever form Chrome serialises), so two
 * spellings of one colour never satisfy the inequality and a seed moved onto
 * the platform palette would be caught. The dark platform values are read
 * from a scratch element carrying `data-theme="dark"` (tokens.css scopes its
 * dark block with `[data-theme="dark"]`), so the pre-brand phase never
 * touches the stored theme preference. Floors go through
 * support/contrast.ts, which parses the `oklch(…)` form. Every computed style
 * is asserted with `toHaveCSS` or `expect.poll` (Button has
 * `transition-colors`; a one-shot read after hover() or a theme flip can catch
 * a mid-transition value).
 *
 * Locators, and why: the security link is scoped to `header` because the MFA
 * banner can render a second link to /security; the logo uses
 * `getByRole('img', { name }).first()` because BrandMark renders in the
 * sidebar (≥lg) AND the topbar (<lg) and one is always hidden; density is
 * proven on a `td`'s padding, the root `--row-h` / `--input-h` and the editor's
 * `#brand-name` height — never on a row height, because /team's rows carry
 * `size="sm"` buttons (36 px) and are taller than the 34 px MINIMUM; the page
 * background is read from the shell's `bg-background` div, since nothing
 * paints `html` itself. Every French string is a fr-CA value
 * (packages/i18n/src/locales/fr-CA.ts): `leads:create`, `security:title`,
 * `nav:prospects`, `common:themeDark` / `themeLight` / `signOut`, `common:appName`.
 */
const stamp = Date.now();
const password = 'MotDePasse!2026-f75';

/** The 10×10 SVG and the 1×1 PNG the API suite uploads (apps/api/src/f14-branding.test.ts). */
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** What this spec reads from the published snapshot (the rest is typed by the SPA, not here). */
interface Published {
  version: number;
  palette: Record<string, Record<string, string> | undefined>;
}

function cell(pub: Published, group: string, key: string): string {
  const value = pub.palette[group]?.[key];
  if (typeof value !== 'string') throw new Error(`the published palette has no ${group}.${key}`);
  return value;
}

/** One browser serialisation for both sides of an equality — a palette string and a computed style. */
function canon(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((c) => {
    const el = document.createElement('span');
    el.style.color = c;
    document.body.append(el);
    const value = getComputedStyle(el).color;
    el.remove();
    return value;
  }, cssColor);
}

function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

function bgOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

function fgOf(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).color);
}

/**
 * One colour space for a platform-vs-brand inequality: the specified colour's
 * sRGB channels (4 dp), read through Chrome's relative-colour syntax, whether
 * the browser serialises the result as `color(srgb …)` or as legacy `rgb(…)`.
 * Two spellings of one colour compare EQUAL here — a string compare of an
 * `rgb()` token against an `oklch()` cell never can, so it proves nothing.
 */
function srgb(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((c) => {
    const el = document.createElement('span');
    el.style.color = `rgb(from ${c} r g b)`;
    document.body.append(el);
    const value = getComputedStyle(el).color;
    el.remove();
    const modern = /^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)\)$/.exec(value);
    const legacy = /^rgba?\((\d+), (\d+), (\d+)/.exec(value);
    const m = modern ?? legacy;
    if (!m) throw new Error(`srgb(): cannot read "${c}" (computed "${value}")`);
    const scale = modern ? 1 : 255;
    return `srgb(${[m[1], m[2], m[3]].map((n) => (Number(n) / scale).toFixed(4)).join(' ')})`;
  }, cssColor);
}

/**
 * The platform's DARK tokens without flipping the document: a scratch element
 * stamped `data-theme="dark"` matches tokens.css's `[data-theme="dark"]` block,
 * so its own custom properties are the dark platform values.
 */
async function darkPlatformTokens(page: Page, names: readonly string[]): Promise<Record<string, string>> {
  const raw = await page.evaluate((list) => {
    const el = document.createElement('div');
    el.dataset['theme'] = 'dark';
    document.body.append(el);
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const n of list) out[n] = cs.getPropertyValue(n).trim();
    el.remove();
    return out;
  }, names);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === '') throw new Error(`darkPlatformTokens(): ${name} is empty under data-theme="dark"`);
    out[name] = await srgb(page, value);
  }
  return out;
}

const createButton = (page: Page) => page.getByRole('button', { name: 'Créer le prospect' });
const securityLink = (page: Page) => page.locator('header').getByRole('link', { name: 'Sécurité du compte' });
const pageSurface = (page: Page) => page.locator('div.bg-background').first();
const signOutButton = (page: Page) => page.getByRole('button', { name: 'Se déconnecter' });

async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Nom complet').fill(name);
  await page.getByLabel('Courriel').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL('/');
}

async function createOrg(page: Page, tag: string): Promise<string> {
  const res = await page.request.post('/api/v1/organizations', {
    data: { name: `Groupe ${tag} ${stamp}`, slug: `groupe-${tag.toLowerCase()}-${stamp}` },
  });
  if (res.status() !== 201) throw new Error(`org create failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function putBranding(page: Page, orgId: string, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.put(`/api/v1/organizations/${orgId}/branding`, { data });
  if (res.status() !== 200) throw new Error(`branding PUT failed: ${res.status()} ${await res.text()}`);
}

async function uploadAsset(page: Page, orgId: string, slot: string, body: Buffer, contentType: string): Promise<void> {
  const res = await page.request.post(`/api/v1/organizations/${orgId}/branding/assets/${slot}`, {
    data: body,
    headers: { 'content-type': contentType },
  });
  if (res.status() !== 201) throw new Error(`${slot} upload failed: ${res.status()} ${await res.text()}`);
}

async function publish(page: Page, orgId: string): Promise<void> {
  const res = await page.request.post(`/api/v1/organizations/${orgId}/branding/publish`, { data: {} });
  if (res.status() !== 200) throw new Error(`publish failed: ${res.status()} ${await res.text()}`);
}

/** The server's own answer — the values every colour assertion below expects. */
async function readPublished(page: Page): Promise<Published> {
  const res = await page.request.get('/api/v1/branding');
  if (res.status() !== 200) throw new Error(`GET /api/v1/branding failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as Published | null;
  if (body === null) throw new Error('GET /api/v1/branding answered null after publish');
  return body;
}

test('a pale primary paints every branded surface readably, light and dark, and sign-out leaves /login plain', async ({ page }) => {
  await signUp(page, 'Patron Pâle', `f75a-${stamp}@1dealer.test`);
  const orgId = await createOrg(page, 'F75A');

  // The platform look, read from the same shell before any brand exists —
  // every one of the twelve palette cells read back below is asserted to
  // differ from these, in one colour space (`srgb()`); the hover, accent and
  // dark values come from the tokens the same classes read (`--primary-hover`,
  // `--sidebar-accent`, …; dark ones via a scratch `data-theme="dark"` element).
  await page.goto('/leads/new');
  await expect(createButton(page)).toBeVisible();
  await expect(page.getByTestId('brand-style')).toHaveCount(0);
  await expect(page.locator('html[data-density]')).toHaveCount(0);
  const darkTokens = await darkPlatformTokens(page, ['--primary', '--primary-foreground', '--primary-text', '--ring']);
  const platform = {
    fill: await srgb(page, await bgOf(createButton(page))),
    label: await srgb(page, await fgOf(createButton(page))),
    hoverFill: await srgb(page, await rootVar(page, '--primary-hover')),
    hoverLabel: await srgb(page, await rootVar(page, '--primary-hover-foreground')),
    link: await srgb(page, await fgOf(securityLink(page))),
    ring: await srgb(page, await rootVar(page, '--ring')),
    accentFill: await srgb(page, await rootVar(page, '--sidebar-accent')),
    accentLabel: await srgb(page, await rootVar(page, '--sidebar-accent-foreground')),
    darkFill: darkTokens['--primary'] ?? '',
    darkLabel: darkTokens['--primary-foreground'] ?? '',
    darkLink: darkTokens['--primary-text'] ?? '',
    darkRing: darkTokens['--ring'] ?? '',
    radius: await rootVar(page, '--radius'),
    rowH: await rootVar(page, '--row-h'),
    inputH: await rootVar(page, '--input-h'),
  };
  // The scratch element read the DARK block, not the light one it sits under.
  expect(platform.darkFill).not.toBe(platform.fill);
  expect(platform.darkLink).not.toBe(platform.link);
  expect(platform.radius).toBe('0.5rem'); // md
  expect(platform.rowH).toBe('44px');
  expect(platform.inputH).toBe('40px');
  await expect(page.locator('body')).not.toHaveCSS('font-family', /^ui-sans-serif/);

  // Seed and publish through the API; the expected values are the server's answer.
  await putBranding(page, orgId, {
    display_name: 'Marque Pâle',
    primary_color: '#FDE047',
    accent_color: '#0F766E',
    danger_color: '#B91C1C',
    radius: 'sm',
    density: 'compact',
    font_family: 'system',
  });
  await uploadAsset(page, orgId, 'logo_light', SVG, 'image/svg+xml');
  await uploadAsset(page, orgId, 'favicon', PNG, 'image/png');
  await publish(page, orgId);
  const pub = await readPublished(page);

  // --- light ---------------------------------------------------------------
  await page.goto('/leads/new');
  const style = page.getByTestId('brand-style');
  await expect(style).toHaveAttribute('data-brand-version', /^\d+$/);
  await expect(style).toHaveAttribute('data-brand-version', String(pub.version));
  // A fresh publish gates nothing: every cell was proven against today's surfaces.
  await expect(page.locator('[data-testid="brand-style"][data-brand-gated]')).toHaveCount(0);
  await expect.poll(() => rootVar(page, '--radius')).toBe('0.25rem'); // sm

  // The primary button: the RAW brand fill under the label the server chose for it.
  const button = createButton(page);
  const fill = await canon(page, cell(pub, 'fills', 'primary'));
  const label = await canon(page, cell(pub, 'foregrounds', 'primary'));
  await expect(button).toHaveCSS('background-color', fill);
  await expect(button).toHaveCSS('color', label);
  expect(await srgb(page, fill)).not.toBe(platform.fill);
  expect(await srgb(page, label)).not.toBe(platform.label);
  expect(wcagRatio(fill, label)).toBeGreaterThanOrEqual(4.5);
  // Hover is the hover fill with ITS label (the step that keeps the base label
  // when one exists — the platform-blue flip is the bug F-75 fixed in core).
  const hoverFill = await canon(page, cell(pub, 'hover', 'primary'));
  const hoverLabel = await canon(page, cell(pub, 'foregrounds', 'primary_hover'));
  await button.hover();
  await expect(button).toHaveCSS('background-color', hoverFill);
  await expect(button).toHaveCSS('color', hoverLabel);
  expect(await srgb(page, hoverFill)).not.toBe(platform.hoverFill);
  expect(await srgb(page, hoverLabel)).not.toBe(platform.hoverLabel);
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS('background-color', fill);

  // The link: the on-surface TONE, a different colour from the fill, readable
  // on the header (card) and on the page.
  const link = securityLink(page);
  const text = await canon(page, cell(pub, 'text', 'primary'));
  await expect(link).toHaveCSS('color', text);
  expect(text).not.toBe(fill);
  expect(await srgb(page, text)).not.toBe(platform.link);
  const headerBg = await bgOf(page.locator('header'));
  const pageBg = await bgOf(pageSurface(page));
  expect(wcagRatio(text, headerBg)).toBeGreaterThanOrEqual(4.5);
  expect(wcagRatio(text, pageBg)).toBeGreaterThanOrEqual(4.5);

  // The focus ring: the brand's, ≥ 3:1 on the page (1.4.11).
  const ring = await canon(page, cell(pub, 'ring', 'primary'));
  await expect.poll(async () => canon(page, await rootVar(page, '--ring'))).toBe(ring);
  expect(await srgb(page, ring)).not.toBe(platform.ring);
  expect(wcagRatio(ring, pageBg)).toBeGreaterThanOrEqual(3);

  // Density (compact): the producer on <html>, the token values, and the font.
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect.poll(() => rootVar(page, '--row-h')).toBe('34px');
  await expect.poll(() => rootVar(page, '--input-h')).toBe('34px');
  await expect(page.locator('body')).toHaveCSS('font-family', /^ui-sans-serif/);

  // The logo: <img src> from the contract route, with organization_id and the
  // published version; it actually loaded.
  const logo = page.getByRole('img', { name: 'Marque Pâle' }).first();
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', /^\/api\/v1\/branding\/assets\/logo_light\?organization_id=[0-9a-f-]{36}&v=\d+$/);
  await expect(logo).toHaveAttribute('src', `/api/v1/branding/assets/logo_light?organization_id=${orgId}&v=${pub.version}`);
  await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  // The favicon: one brand <link>, same route shape.
  await expect(page.locator('link[rel="icon"][data-brand-favicon]')).toHaveAttribute(
    'href',
    `/api/v1/branding/assets/favicon?organization_id=${orgId}&v=${pub.version}`,
  );

  // The sidebar's active item is the accent UNIT (fill + its label), and the
  // tab carries the brand name.
  await page.goto('/leads');
  await expect(page).toHaveTitle(/Prospects — Marque Pâle/);
  const active = page.locator('aside').getByRole('link', { name: 'Prospects', exact: true });
  await expect(active).toHaveAttribute('aria-current', 'page');
  const accentFill = await canon(page, cell(pub, 'fills', 'accent'));
  const accentLabel = await canon(page, cell(pub, 'foregrounds', 'accent'));
  await expect(active).toHaveCSS('background-color', accentFill);
  await expect(active).toHaveCSS('color', accentLabel);
  expect(await srgb(page, accentFill)).not.toBe(platform.accentFill);
  expect(await srgb(page, accentLabel)).not.toBe(platform.accentLabel);

  // Compact reaches the components: a DataTable cell (the owner's own row on
  // /team) and an Input (the editor's name field, 34 px at the 1280 viewport).
  await page.goto('/team');
  await expect(page.locator('tbody td').first()).toHaveCSS('padding-top', '6px');
  await page.goto(`/organizations/${orgId}/branding`);
  const nameField = page.locator('#brand-name');
  await expect(nameField).toHaveValue('Marque Pâle');
  await expect
    .poll(async () => {
      const box = await nameField.boundingBox();
      return box ? Math.round(box.height) : null;
    })
    .toBe(34);
  // The asset rows say what the floor sees: the published logo and favicon
  // are LIVE, the dark slot is empty — and that stays true when the draft goes
  // dirty for an unrelated field. A slot is live when its key is the one in
  // the PUBLISHED snapshot, not when the draft's status happens to be
  // 'published' (the asset route serves the snapshot through any edit).
  const liveRows = page.getByText('Publié — affiché dans l’application');
  await expect(liveRows).toHaveCount(2);
  await expect(page.getByText('Aucun fichier')).toHaveCount(1);
  await putBranding(page, orgId, { success_color: '#047857' });
  await page.reload();
  await expect(nameField).toHaveValue('Marque Pâle');
  await expect(liveRows).toHaveCount(2);
  await expect(page.getByText('Téléversé — publiez pour l’afficher')).toHaveCount(0);

  // --- dark, through the toggle ---------------------------------------------
  await page.goto('/leads/new');
  await page.getByRole('button', { name: 'Mode sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Theme-independent values hold in dark: the brand radius and the system
  // font live in a plain `:root{}` block, not in the light colour block.
  await expect.poll(() => rootVar(page, '--radius')).toBe('0.25rem');
  await expect(page.locator('body')).toHaveCSS('font-family', /^ui-sans-serif/);
  const darkFill = await canon(page, cell(pub, 'dark', 'primary'));
  const darkLabel = await canon(page, cell(pub, 'foregrounds', 'primary_dark'));
  await expect(createButton(page)).toHaveCSS('background-color', darkFill);
  await expect(createButton(page)).toHaveCSS('color', darkLabel);
  expect(await srgb(page, darkFill)).not.toBe(platform.darkFill);
  expect(await srgb(page, darkLabel)).not.toBe(platform.darkLabel);
  const darkText = await canon(page, cell(pub, 'text', 'primary_dark'));
  await expect(securityLink(page)).toHaveCSS('color', darkText);
  expect(darkText).not.toBe(text); // the light tone never leaks into dark (A4)
  expect(await srgb(page, darkText)).not.toBe(platform.darkLink);
  await expect.poll(() => bgOf(pageSurface(page))).not.toBe(pageBg);
  expect(wcagRatio(darkText, await bgOf(pageSurface(page)))).toBeGreaterThanOrEqual(4.5);
  const darkRing = await canon(page, cell(pub, 'ring', 'primary_dark'));
  await expect.poll(async () => canon(page, await rootVar(page, '--ring'))).toBe(darkRing);
  expect(await srgb(page, darkRing)).not.toBe(platform.darkRing);

  // --- sign-out: /login is the platform, not the tenant ----------------------
  await signOutButton(page).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByLabel('Courriel')).toBeVisible();
  await expect(page.getByTestId('brand-style')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Marque Pâle' })).toHaveCount(0);
  await expect(page.locator('html[data-density]')).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(0);
  await expect(page).toHaveTitle(/1Dealer/);
});

test('dark_mode disabled locks light over a stored dark preference, never erases it, and a republish to derived gives it back', async ({ page }) => {
  await signUp(page, 'Patron Clair', `f75b-${stamp}@1dealer.test`);
  const orgId = await createOrg(page, 'F75B');

  // The platform fill before any brand (one colour space, see `srgb()`).
  await page.goto('/');
  await expect(signOutButton(page)).toBeVisible();
  const platformPrimary = await srgb(page, await rootVar(page, '--primary'));

  await putBranding(page, orgId, { display_name: 'Marque Claire', primary_color: '#1E3A8A', dark_mode: 'disabled' });
  await publish(page, orgId);
  const pub = await readPublished(page);

  // A user who chose dark before this tenant locked it. The init script seeds
  // the preference only when NONE is stored, so a lock that wrote 'light'
  // would be visible below instead of being overwritten on the next load.
  await page.addInitScript(() => {
    if (localStorage.getItem('dealpilot.theme') === null) localStorage.setItem('dealpilot.theme', 'dark');
  });
  await page.goto('/');
  await expect(signOutButton(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: /Mode sombre|Mode clair/ })).toHaveCount(0);
  await expect(page.getByTestId('brand-style')).toHaveAttribute('data-brand-version', String(pub.version));
  await expect(page.locator('[data-testid="brand-style"][data-brand-gated]')).toHaveCount(0);
  const primary = await canon(page, cell(pub, 'fills', 'primary'));
  await expect.poll(async () => canon(page, await rootVar(page, '--primary'))).toBe(primary);
  expect(await srgb(page, primary)).not.toBe(platformPrimary);
  // The lock never touched storage: the preference is intact while locked.
  expect(await page.evaluate(() => localStorage.getItem('dealpilot.theme'))).toBe('dark');

  // Republish with dark allowed: the stored preference comes back on its own,
  // and the dark link tone is the dark palette's, never the light one (A4).
  await putBranding(page, orgId, { dark_mode: 'derived' });
  await publish(page, orgId);
  const republished = await readPublished(page);
  expect(republished.version).toBeGreaterThan(pub.version);
  await page.reload();
  await expect(page.getByTestId('brand-style')).toHaveAttribute('data-brand-version', String(republished.version));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Mode clair' })).toBeVisible();
  const darkText = await canon(page, cell(republished, 'text', 'primary_dark'));
  await expect(securityLink(page)).toHaveCSS('color', darkText);
  expect(darkText).not.toBe(await canon(page, cell(republished, 'text', 'primary')));
});

test('an errored GET /api/v1/branding renders the platform shell once — no skeleton loop, no request storm', async ({ page }) => {
  await signUp(page, 'Patron Panne', `f75c-${stamp}@1dealer.test`);

  // From here the endpoint fails. A 5xx, the client timeout and a snapshot
  // that fails `PublishedBranding.parse` all reach the shell the same way: one
  // errored, data-less query (retry: false).
  let requests = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/branding',
    (route) => {
      requests += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'e2e: branding down' }) });
    },
  );

  // The count is reported whatever happens below, so a loop that never lets
  // the shell render still leaves its number in the report.
  const startedAt = Date.now();
  try {
    // A cold load: the shell renders in the platform look — no brand
    // stylesheet, the platform name in the tab — instead of holding the skeleton.
    await page.goto('/');
    await expect.poll(() => requests).toBeGreaterThanOrEqual(1);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('brand-style')).toHaveCount(0);
    await expect(page).toHaveTitle(/1Dealer/);

    // The cold load itself is bounded by the mount, not by the error:
    // RequireAuth's prefetch, the shell observer's retry-on-mount of the
    // already-errored entry, and — under the dev server's StrictMode — one
    // replayed subscription (the replay unsubscribes, which cancels the
    // in-flight fetch because the queryFn consumed its abort signal, then
    // subscribes again and re-issues it). Measured: 3 on the fixed tree, 1215
    // in 15.6 s under the loop this test exists for.
    await securityLink(page).click();
    await expect(page).toHaveURL('/security');
    const settled = requests;
    expect(settled, 'GET /api/v1/branding requests for one cold load').toBeLessThanOrEqual(3);

    // Nothing under the shell observes the query, so the error cannot re-trigger
    // a fetch: two more client-side navigations later (the shell stays mounted)
    // the count has not moved.
    await page.locator('aside').getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page).toHaveURL('/leads');
    await page.locator('aside').getByRole('link', { name: 'Tableau de bord', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('brand-style')).toHaveCount(0);
    expect(requests, 'GET /api/v1/branding requests after two more navigations — none since the shell settled').toBe(settled);
  } finally {
    const line = `GET /api/v1/branding requests while the endpoint answered 500: ${requests} in ${Date.now() - startedAt} ms`;
    test.info().annotations.push({ type: 'branding-requests', description: line });
    console.log(line);
  }
});
