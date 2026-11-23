// ESLint flat config: recommended rules; browser globals for the site,
// Node globals for tests, tooling and scripts. Vendored code is not ours.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/vendor/**', 'src/vendor/**', 'node_modules/**', '.wrangler/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
  },
  {
    // Shared engine code runs in the browser and, for content and builds, in Node.
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['*.js', 'e2e/**/*.js', 'test/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
