/**
 * Lint for the codeguard. Errors = bugs and unsafe code; clean-code metrics (function length,
 * complexity, duplicates) are warnings with a ratchet: `npm run lint` fails as soon as there are
 * more warnings than today (see package.json "lint"), so the code can only get cleaner.
 */
const js = require('@eslint/js');
const globals = require('globals');
const sonarjs = require('eslint-plugin-sonarjs');
const html = require('eslint-plugin-html');

const cleanCode = {
  complexity: ['warn', 15],
  'max-depth': ['warn', 4],
  'max-params': ['warn', 5],
  'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
  'sonarjs/cognitive-complexity': ['warn', 20],
  'sonarjs/no-identical-functions': 'warn',
  'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
  'sonarjs/no-collapsible-if': 'warn',
  'sonarjs/no-redundant-jump': 'warn',
};
const correctness = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  // Apps Script shares one global scope across files: cross-file names are not visible to ESLint
  'no-undef': 'off',
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'dev/preview.html', 'src/Index.html', 'src/LogoAssets.html'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    plugins: { sonarjs },
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { ...globals.es2020 } },
    rules: { ...correctness, ...cleanCode },
  },
  {
    files: ['src/**/*.html'],
    plugins: { html, sonarjs },
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { ...globals.browser } },
    rules: { ...correctness, ...cleanCode },
  },
  {
    files: ['dev/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    plugins: { sonarjs },
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { ...correctness, 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] },
  },
];
