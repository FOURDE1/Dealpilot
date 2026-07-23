const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off', // Server uses console for logging
    },
  },
  // Protected files — suppress warnings without modifying source
  {
    files: ['services/reportGenerator.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
  // Test files — Vitest globals injected at runtime
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    ignores: ['node_modules/'],
  },
];
