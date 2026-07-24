import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', 'coverage/**', 'reference/**', 'infra/cdk.out/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
