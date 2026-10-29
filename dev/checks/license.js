/**
 * Licences:
 * - every npm package (dev tools only, nothing of it is deployed) has a permissive licence,
 * - only allowed external hosts in src/ (holiday API, Google AI, Google APIs),
 * - the README has its licence section.
 * Usage: node dev/checks/license.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// no web fonts from external hosts: loading them sends every user's IP address to a third party (GDPR)
const HOSTS = ['www.googleapis.com', 'date.nager.at', 'aiplatform.googleapis.com', 'generativelanguage.googleapis.com', 'docs.google.com', 'www.w3.org', 'script.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'drive.google.com', 'meet.google.com'];
const LICENSES = /^\(?(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|Python-2\.0|Unlicense)(\s+(OR|AND)\s+(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|CC0-1\.0))*\)?$/;

// dev tools only (never deployed: clasp pushes src/ alone), with the reason
const EXCEPTIONS = { 'eslint-plugin-sonarjs': 'LGPL-3.0, lint tool during development only, never shipped' };

const list = dir => fs.readdirSync(dir).map(f => path.join(dir, f));

function hosts() {
  const hits = [];
  list(path.join(ROOT, 'src')).forEach(f => {
    const re = /https?:\/\/([a-z0-9.-]+)/gi;
    const code = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(code))) {
      const h = m[1].toLowerCase();
      if (!HOSTS.some(a => h === a || h.endsWith('-' + a) || h.endsWith('.' + a))) hits.push('host not allowed: ' + h + ' in ' + path.relative(ROOT, f));
    }
  });
  return [...new Set(hits)];
}

function packages() {
  const hits = [];
  let n = 0;
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(name => {
      const p = path.join(dir, name);
      if (name.startsWith('@')) return walk(p);
      const pj = path.join(p, 'package.json');
      if (!fs.existsSync(pj)) return;
      const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
      n++;
      const lic = typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || (pkg.licenses && pkg.licenses[0] && pkg.licenses[0].type) || '';
      if (!LICENSES.test(lic) && !EXCEPTIONS[pkg.name]) hits.push('licence "' + (lic || 'unknown') + '" of ' + pkg.name + '@' + pkg.version);
      walk(path.join(p, 'node_modules'));
    });
  };
  walk(path.join(ROOT, 'node_modules'));
  return { hits, n };
}

function readme() {
  const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return /## Licences and brands/.test(text) ? [] : ['README: section "Licences and brands" is missing'];
}

if (require.main === module) {
  const p = packages();
  const all = hosts().concat(p.hits, readme());
  all.forEach(h => console.log('  ✗ ' + h));
  console.log(all.length ? all.length + ' licence findings' : 'Licences ok: ' + p.n + ' packages with permissive licences, only allowed hosts');
  process.exit(all.length ? 1 : 0);
}
module.exports = { hosts, packages, readme };
