/**
 * Mutation check for the pure domain logic (src/Shared.js): each mutant flips one operator
 * (< ↔ <=, > ↔ >=, === ↔ !==, && ↔ ||, + 1 ↔ - 1). The unit tests must notice (fail) for the
 * mutant to count as "killed". Surviving mutants show where tests do not pin the behaviour.
 * Deterministic: same file, same mutants. Usage: node dev/checks/mutation.js [--min 70]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE = 'Shared.js';
const SRC = path.join(__dirname, '..', '..', 'src', FILE);
const TESTS = [path.join(__dirname, '..', '..', 'test', 'shared.test.js')];
const SWAPS = [[' <= ', ' < '], [' >= ', ' > '], [' < ', ' <= '], [' > ', ' >= '], [' === ', ' !== '], [' !== ', ' === '], [' && ', ' || '], [' || ', ' && '], [' + 1', ' - 1'], [' - 1', ' + 1']];
// every mutant is run (a sample would shift whenever the file changes)
const MAX = Infinity;

/** All mutants: { line, from, to, code } – comment lines and string-only lines are skipped. */
function mutants(code) {
  const lines = code.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /^\[\/|^'.*',?$/.test(t)) return;
    SWAPS.forEach(([from, to]) => {
      let at = line.indexOf(from);
      while (at >= 0) {
        // not inside a quoted string on this line
        const before = line.slice(0, at);
        if ((before.split("'").length - 1) % 2 === 0) {
          const copy = lines.slice();
          copy[i] = line.slice(0, at) + to + line.slice(at + from.length);
          out.push({ line: i + 1, from: from.trim(), to: to.trim(), code: copy.join('\n') });
        }
        at = line.indexOf(from, at + 1);
      }
    });
  });
  // spread evenly over the file when there are more than MAX
  if (out.length <= MAX) return out;
  const step = out.length / MAX;
  return Array.from({ length: MAX }, (_, k) => out[Math.floor(k * step)]);
}

function run() {
  const code = fs.readFileSync(SRC, 'utf8');
  const list = mutants(code);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutant-'));
  const survivors = [];
  list.forEach((m, i) => {
    const file = path.join(dir, 'm' + i + '.js');
    fs.writeFileSync(file, m.code);
    const r = spawnSync(process.execPath, ['--test', ...TESTS], { env: Object.assign({}, process.env, { MUTANT: FILE + '|' + file }), encoding: 'utf8' });
    if (r.status === 0) survivors.push(m);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { total: list.length, killed: list.length - survivors.length, survivors };
}

if (require.main === module) {
  const minArg = process.argv.indexOf('--min');
  const min = minArg > 0 ? Number(process.argv[minArg + 1]) : 0;
  const r = run();
  const score = Math.round(100 * r.killed / Math.max(1, r.total));
  r.survivors.slice(0, 15).forEach(m => console.log('  überlebt: ' + FILE + ':' + m.line + '  ' + m.from + ' → ' + m.to));
  console.log('Mutation-Score ' + FILE + ': ' + score + ' % (' + r.killed + ' von ' + r.total + ' Mutanten erkannt, Schwelle ' + min + ' %)');
  process.exit(score >= min ? 0 : 1);
}
module.exports = { mutants, run };
