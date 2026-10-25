/**
 * Codeguard: runs every check from dev/checks/index.js, prints a summary and exits with 1 when
 * one fails. Also runs in GitHub Actions on every push and pull request.
 *   npm run guard                 all checks
 *   npm run guard -- --only lint,tests
 *   npm run guard -- --list       show the checks with purpose and threshold
 */
const { spawnSync } = require('child_process');
const CHECKS = require('./checks');

const args = process.argv.slice(2);
if (args.includes('--list')) {
  CHECKS.forEach(c => console.log(c.id.padEnd(12) + c.name + '\n' + ' '.repeat(12) + 'Zweck: ' + c.purpose + '\n' + ' '.repeat(12) + 'Schwelle: ' + c.limit + '  · Stufe: ' + c.stage));
  process.exit(0);
}
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const run = CHECKS.filter(c => !only || only.includes(c.id));

const results = run.map(c => {
  process.stdout.write('\n▶ ' + c.name + '  (' + c.limit + ')\n');
  const t0 = Date.now();
  const r = spawnSync(c.cmd, { shell: true, stdio: 'inherit' });
  return { c, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(1) };
});

console.log('\nCodeguard');
results.forEach(r => console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.c.name.padEnd(46) + r.s.padStart(5) + ' s   ' + r.c.limit));
const failed = results.filter(r => !r.ok);
console.log(failed.length ? '\n' + failed.length + ' von ' + results.length + ' Checks fehlgeschlagen: ' + failed.map(r => r.c.id).join(', ')
  : '\nAlle ' + results.length + ' Checks grün');
process.exit(failed.length ? 1 : 0);
