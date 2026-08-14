import { defineConfig } from '@playwright/test';

/**
 * E2E for the auth journey (H-03 DoD). Requires the local stack:
 * Docker Postgres on :5434 (repo-root docker-compose) + the API on :3001 —
 * the webServer below only starts the SPA. Uses the system Chrome channel so
 * no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  // *.e2e.ts keeps these out of vitest's default *.{test,spec}.* glob.
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    locale: 'fr-CA',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // A ceiling, not a delay: locally Vite is up in about a second. On a cold CI
    // runner the first start also pre-bundles the dependency graph, and 30s was
    // close enough to that to turn a slow boot into a red build.
    timeout: 120_000,
  },
});
