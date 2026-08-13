import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // reference/ is read-only legacy + plan material — never built or tested here.
    exclude: ['**/node_modules/**', '**/dist/**', 'reference/**'],
    passWithNoTests: true,
    // The db suite's beforeAll drops and rebuilds the schema of the SAME local
    // database the api suite talks to — parallel test files race on it.
    fileParallelism: false,
    /**
     * Every database suite rebuilds the schema from zero in `beforeAll`, which
     * is measured at 3.6–4.2 s against 37 migrations on an idle machine. The
     * default 10 s ceiling left under three seconds of headroom, so under load
     * a suite would occasionally time out, pass alone, and pass on re-run — the
     * least useful bug report there is. It surfaced the day the migration count
     * made the work slow enough to matter, and would have got worse quietly.
     *
     * This buys room; it does not fix the cost. ~25 suites × ~4 s is most of
     * the run, and the real fix is one reset per RUN rather than per suite,
     * which needs the suites audited for the isolation they currently get free.
     */
    hookTimeout: 60_000,
  },
});
