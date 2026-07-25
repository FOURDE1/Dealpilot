import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', 'coverage/**', 'reference/**', 'infra/cdk.out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-run maintenance scripts (db/intake helpers, generators): plain ESM
    // executed by node, so the Node globals are legitimately in scope.
    files: ['**/scripts/**/*.mjs', '**/scripts/**/*.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' },
    },
  },
);
