import { defineConfig } from '@playwright/test';

/**
 * E2E for the auth journey (H-03 DoD). Requires the local stack:
 * Docker Postgres on :5434 (repo-root docker-compose) + the API on :3001 —
 * the webServer below only starts the SPA. Uses the system Chrome channel so
 * no browser download is needed.
 */

/**
 * The SPA port, overridable like DEALPILOT_DB_PORT.
 *
 * 5173 is Vite's default, which means it is also the default of every other
 * Vite project on the machine — and this one shares a desktop with several.
 * `reuseExistingServer` cannot tell our dev server from somebody else's, so a
 * foreign app already on 5173 gets adopted silently and every spec dies at
 * page.goto with an HTTP error that says nothing about the cause. That has now
 * happened twice: once to an orphan of ours bound to IPv6-only [::1], and once
 * to an unrelated project's server.
 *
 *   DEALPILOT_WEB_PORT=5175 pnpm --filter @dealpilot/web test:e2e
 *
 * MOVING THE PORT MEANS MOVING THE API'S ORIGIN TOO. `WEB_ORIGIN` defaults to
 * http://localhost:5173 and CORS is locked to exactly that one value, so an SPA
 * on any other port has every request rejected — which shows up as a signup that
 * silently never leaves /signup, not as a CORS message anyone will see. Start
 * the API with a matching origin:
 *
 *   WEB_ORIGIN=http://localhost:5175 <api start command>
 */
const PORT = Number(process.env['DEALPILOT_WEB_PORT'] ?? 5173);
const BASE = `http://localhost:${PORT}`;

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
   * If this needs raising again, look first at whether the dev database has
   * grown: the e2e suite runs against it and it is never reset, so every run
   * leaves rows behind and the queries behind these screens get slower.
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
    reuseExistingServer: true,
    // A ceiling, not a delay: locally Vite is up in about a second. On a cold CI
    // runner the first start also pre-bundles the dependency graph, and 30s was
    // close enough to that to turn a slow boot into a red build.
    timeout: 120_000,
  },
});
