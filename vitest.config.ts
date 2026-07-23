import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // reference/ is read-only legacy + plan material — never built or tested here.
    exclude: ['**/node_modules/**', '**/dist/**', 'reference/**'],
    passWithNoTests: true,
  },
});
