/**
 * Codeguard: every check in one run, a summary at the end, exit code 1 if one fails.
 * Usage: npm run guard   (also runs in GitHub Actions on every push and pull request)
 */
const { spawnSync } = require('child_process');

const COVERAGE = '--check-coverage --lines 90 --functions 90 --branches 75';
const STEPS = [
  ['Lint + Clean-Code-Regeln', 'npx eslint . --max-warnings 80'],
  ['Unit- und Integrationstests + Coverage', 'npx c8 ' + COVERAGE + ' --reporter=text-summary node --test test/ dev/test.js'],
  ['Apps-Script-Prüfung', 'node dev/check-gas.js'],
  ['Englisch vollständig', 'node dev/i18n-audit.js'],
  ['Secret-Scan', 'node dev/secret-scan.js'],
  ['Lasttest (Kurzprofil)', 'node dev/load-sim.js --quick'],
];

const results = STEPS.map(([name, cmd]) => {
  process.stdout.write('\n▶ ' + name + '\n');
  const t0 = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  return { name, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(1) };
});

console.log('\nCodeguard');
results.forEach(r => console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.name.padEnd(42) + r.s + ' s'));
const failed = results.filter(r => !r.ok);
console.log(failed.length ? '\n' + failed.length + ' Prüfung(en) fehlgeschlagen' : '\nAlles grün');
process.exit(failed.length ? 1 : 0);
