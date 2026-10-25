/**
 * Performance budget: size of the delivered page and the cost of each request at 1000 people
 * with 3000 tasks (real server code + latency model from dev/load-sim.js, warm cache).
 * Usage: node dev/checks/budget.js [--show]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { profile } = require('../load-sim');

/** Budgets: today's values plus a little headroom; tighten them when things get faster. */
const BUDGET = {
  pageKB: 520, pageGzipKB: 150,
  bootstrapKB: 250,
  ms: { bootstrap: 900, poll: 600, pollSame: 450, calendar: 800, report: 600, update: 1000, create: 1000, comment: 1000 },
};

function pageSize() {
  const src = path.join(__dirname, '..', '..', 'src');
  const read = f => fs.readFileSync(path.join(src, f), 'utf8');
  const html = read('Index.html').replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => read(n + '.html'));
  return { kb: Math.round(html.length / 1024), gzipKb: Math.round(zlib.gzipSync(html).length / 1024) };
}

function check() {
  const rows = [];
  const add = (what, value, max, unit) => rows.push({ what, value: Math.round(value), max, unit, ok: value <= max });
  const page = pageSize();
  add('Seite (HTML+CSS+JS)', page.kb, BUDGET.pageKB, 'KB');
  add('Seite gzip', page.gzipKb, BUDGET.pageGzipKB, 'KB');
  const prof = profile(1000, 3000);
  add('Start-Antwort normale Person', prof.bootstrap.bytes / 1024, BUDGET.bootstrapKB, 'KB');
  Object.keys(BUDGET.ms).forEach(k => add('Request ' + k + ' (1000 Personen)', prof[k].warm, BUDGET.ms[k], 'ms'));
  return rows;
}

if (require.main === module) {
  const rows = check();
  rows.filter(r => !r.ok || process.argv.includes('--show')).forEach(r =>
    console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + r.what.padEnd(34) + String(r.value).padStart(6) + ' ' + r.unit + '  (Budget ' + r.max + ' ' + r.unit + ')'));
  const bad = rows.filter(r => !r.ok);
  console.log(bad.length ? bad.length + ' Budget(s) überschritten' : 'Performance-Budget ok: ' + rows.length + ' Werte im Rahmen');
  process.exit(bad.length ? 1 : 0);
}
module.exports = { check, BUDGET, pageSize };
