/**
 * The codeguard's list of checks. A new check = one entry here:
 *   id       short name for `npm run guard -- --only <id>`
 *   name     what is checked
 *   purpose  why (one line)
 *   limit    the threshold that makes it fail
 *   stage    the workflow stage it belongs to (see WORKFLOW.md)
 *   cmd      command; exit code 0 = passed
 */
module.exports = [
  { id: 'lint', stage: 'Implementation', name: 'Lint + clean-code rules', cmd: 'npx eslint . --max-warnings 78',
    purpose: 'bugs, unsafe code, function length, complexity, duplicates, unused code',
    limit: '0 errors; ≤ 78 warnings (ratchet)' },
  { id: 'tests', stage: 'TDD', name: 'Unit, mock and integration tests + coverage',
    cmd: 'npx c8 --check-coverage --lines 90 --functions 90 --branches 75 --reporter=text-summary node --test --test-concurrency=4 test/ dev/test.js',
    purpose: 'domain logic, permissions, cache, external services (test doubles), API flows',
    limit: 'all green; coverage lines ≥ 90 %, functions ≥ 90 %, branches ≥ 75 %' },
  { id: 'mutation', stage: 'TDD', name: 'Mutation test (Shared.js)', cmd: 'node dev/checks/mutation.js --min 85',
    purpose: 'tests the tests: changed operators must be caught',
    limit: 'mutation score ≥ 85 %' },
  { id: 'gas', stage: 'Verification', name: 'Apps Script readiness', cmd: 'node dev/check-gas.js',
    purpose: 'syntax, routes and files as clasp pushes them to Apps Script',
    limit: 'no errors' },
  { id: 'security', stage: 'Verification', name: 'Permissions per API method', cmd: 'node --test test/security.test.js',
    purpose: 'every route refuses foreign domains; outsiders change no one else\'s data',
    limit: 'every route covered, 0 open routes' },
  { id: 'xss', stage: 'Verification', name: 'XSS / escaping', cmd: 'node dev/checks/xss.js',
    purpose: 'attack strings in every kind of data never turn into markup in any view',
    limit: '0 injected elements or attributes' },
  { id: 'secrets', stage: 'Verification', name: 'Secret scan', cmd: 'node dev/secret-scan.js',
    purpose: 'no keys, tokens or private keys in the repository',
    limit: '0 hits' },
  { id: 'i18n', stage: 'Verification', name: 'English complete', cmd: 'node dev/i18n-audit.js',
    purpose: 'every page, dialog and server message in English mode',
    limit: '0 German leftovers' },
  { id: 'contrast', stage: 'Verification', name: 'Contrast of the colour tokens', cmd: 'node dev/checks/contrast.js',
    purpose: 'semantic colours readable in light and dark (WCAG 2.2)',
    limit: 'text ≥ 4.5:1, secondary text/icons ≥ 3:1' },
  { id: 'a11y', stage: 'Verification', name: 'Accessibility + skeletons', cmd: 'node dev/checks/a11y.js',
    purpose: 'alt texts, names, labels, dialogs, keyboard, reduced motion, a skeleton per page',
    limit: '0 violations' },
  { id: 'consistency', stage: 'Verification', name: 'Data consistency', cmd: 'node dev/load-sim.js --consistency',
    purpose: '1,500 writes on the real code while rows are shuffled by hand',
    limit: '0 lost updates, 0 duplicate ids' },
  { id: 'load', stage: 'Verification', name: 'Load test (short profile)', cmd: 'node dev/load-sim.js --quick',
    purpose: 'real Apps Script limits: 30 parallel executions, global lock',
    limit: '200 people at once: ≤ 1 % refused, p95 ≤ 3 s' },
  { id: 'budget', stage: 'Verification', name: 'Performance budget', cmd: 'node dev/checks/budget.js',
    purpose: 'page size, first response, duration per request at 1,000 people',
    limit: 'page ≤ 540 KB (gzip ≤ 158), request budgets' },
  { id: 'license', stage: 'Finish', name: 'Licences', cmd: 'node dev/checks/license.js',
    purpose: 'permissive licences, only allowed external hosts, licence section in the README',
    limit: '0 hits' },
  { id: 'migration', stage: 'Finish', name: 'Migration readiness', cmd: 'node dev/checks/migration.js',
    purpose: 'no personal or environment-specific data, docs and comments in English, required files present',
    limit: '0 hits' },
];
