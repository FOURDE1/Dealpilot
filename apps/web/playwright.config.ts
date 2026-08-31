import { defineConfig } from '@playwright/test';

/**
 * E2E suite config (H-03 DoD, rebuilt by F-74). The stack — a disposable
 * dealpilot_e2e_test database reset from migration zero, Redis, an API on its
 * own port — is assembled by scripts/e2e.mjs, the same file CI runs; the
 * webServer below starts the SPA ONLY. Uses the system Chrome channel so no
 * browser download is needed.
 *
 * There is deliberately NO globalSetup here, and the database reset must
 * never be "tidied" into one: verified in playwright@1.61.1
 * (lib/runner/index.js, createGlobalSetupTasks) that global-setup tasks run
 * as [removeOutputDirs, ...pluginSetup(webServer), ...globalTeardowns,
 * ...globalSetups] — webServer plugins start strictly BEFORE every
 * globalSetup file, so a reset there would DROP SCHEMA under an API that had
 * already booted and opened its pool. The reset lives in scripts/e2e.mjs,
 * before the API is spawned.
 */
if (process.env['DEALPILOT_E2E'] !== '1') {
  throw new Error(
    'Run the suite with `pnpm e2e` (scripts/e2e.mjs). It is the only path that builds the stack CI builds: ' +
      'a disposable dealpilot_e2e_test database rebuilt from migration zero, Redis, and an API it started itself. ' +
      'A bare `playwright test` points the browser at whatever answers on the dev ports — the DEV stack, on the DEV ' +
      'database. For --ui / --debug / --grep, forward through the runner: `pnpm e2e -- --headed --grep console`.',
  );
}

/**
 * The SPA port. scripts/e2e.mjs is the sole producer of the real value
 * (5176, off Vite's 5173 default so the dev stack can stay up); the `?? 5173`
 * fallback below is unreachable on the e2e path — this module refuses to load
 * without DEALPILOT_E2E=1, only the runner sets that, and the runner always
 * sets the port. It is kept only so the expression stays total.
 */
const PORT = Number(process.env['DEALPILOT_WEB_PORT'] ?? 5173);
const BASE = `http://localhost:${PORT}`;

/**
 * The API port the SPA proxies to, written into webServer.env below rather
 * than inherited. If it failed to arrive, Vite would proxy /api to the dev
 * API on :3001 and the suite would pass green against the dev database —
 * so it is REQUIRED here, at module load, like DEALPILOT_E2E: the runner
 * always sets it, and a missing value means something other than the runner
 * is loading this config. (vite.config.ts refuses on its own side too.)
 */
const API_PORT = process.env['DEALPILOT_API_PORT'];
if (!API_PORT) {
  throw new Error('DEALPILOT_API_PORT is unset — run the suite with `pnpm e2e` (scripts/e2e.mjs), which sets it.');
}

export default defineConfig({
  testDir: './e2e',
  // *.e2e.ts keeps these out of vitest's default *.{test,spec}.* glob.
  testMatch: '**/*.e2e.ts',
  /**
   * A hang detector, not a performance budget.
   *
   * 30s was set when these were short journeys. F-13 alone now signs up, builds
   * an org and a store, desks a deal, generates a document file, edits F&I
   * products, denies a permission and re-checks the file — 39.5s of real HTTP
   * against a real API and a real database. It was passing at 19s and crossed
   * the ceiling, which reads as a failure at whatever line the clock happened to
   * run out on: the last run pointed at a dialog button that was never the
   * problem.
   *
   * Raised rather than trimmed because the journey is the point — it is the only
   * thing asserting that the document file survives a permission change. Kept
   * finite because a genuinely hung test must still fail rather than run
   * forever.
   *
   * If this needs raising again, database growth is no longer a suspect: the
   * suite runs against dealpilot_e2e_test, which was empty seconds earlier
   * (F-74). A test near this ceiling is a test doing too much.
   */
  timeout: 90_000,
  /**
   * Playwright's default is 5s per assertion, which assumes the thing being
   * awaited is a render. Here almost every assertion follows a real HTTP round
   * trip — create a driver company, save a status, apply a permission — and
   * eight parallel workers share one API process and one Postgres. Under that
   * load a round trip can outlast 5s, and the failure reads as "element not
   * found", indistinguishable from a genuine bug.
   *
   * This does not weaken anything: a wrong assertion still fails, it just gets
   * long enough to be sure it is wrong. The per-test ceiling above is what stops
   * a hang running forever.
   */
  expect: { timeout: 15_000 },
  /**
   * Matched to what the stack can actually serve, not to the CPU count.
   *
   * Playwright defaults to cores/2 — eight here — but every one of those workers
   * is driving the SAME single-process Fastify API and the same Postgres, on a
   * desktop that also runs about eighteen other containers. Past a handful,
   * extra workers buy no throughput and simply convert into round trips that
   * outlast their assertion; the tell was that a DIFFERENT test failed each run
   * while none of them had anything wrong with it.
   *
   * Left at the default in CI, where the runner is small and Playwright's own
   * arithmetic already lands lower than this.
   */
  workers: process.env['CI'] ? undefined : 4,
  retries: 0,
  use: {
    baseURL: BASE,
    channel: 'chrome',
    locale: 'fr-CA',
  },
  webServer: {
    // --strictPort so Vite fails loudly instead of quietly moving to 5174 and
    // leaving Playwright waiting on a URL nothing will ever answer.
    // --host 127.0.0.1 because Chrome resolves localhost to IPv4: a server bound
    // only to [::1] is reachable by curl and invisible to the browser.
    command: `pnpm dev --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE,
    /**
     * The adoption trap is REMOVED, not documented (it bit twice: an orphan of
     * ours bound to IPv6-only [::1], and an unrelated project's server on
     * 5173). With `false`, Playwright checks the URL BEFORE launching the
     * command and throws "... is already used ..." — verified in
     * playwright@1.61.1: Vite is never started, nothing is adopted. The API
     * port has the same rule in scripts/e2e.mjs (a TCP probe that refuses).
     */
    reuseExistingServer: false,
    // Merged over process.env by Playwright; the value is the one required
    // above, so Vite's proxy target can only ever be the runner's API.
    env: { DEALPILOT_API_PORT: API_PORT },
    // A ceiling, not a delay: locally Vite is up in about a second. On a cold CI
    // runner the first start also pre-bundles the dependency graph, and 30s was
    // close enough to that to turn a slow boot into a red build.
    timeout: 120_000,
  },
});
