import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // reference/ is read-only legacy + plan material — never built or tested here.
    exclude: ['**/node_modules/**', '**/dist/**', 'reference/**'],
    passWithNoTests: true,
    // The db suite's beforeAll drops and rebuilds the schema of the SAME local
    // database the api suite talks to — parallel test files race on it.
    fileParallelism: false,
  },
});
