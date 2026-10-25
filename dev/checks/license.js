/**
 * Licences and brands:
 * - no product names of other vendors in the shipped code and the docs (own look, own words),
 * - only allowed external hosts in src/ (fonts, holiday API, Google AI),
 * - every npm package (dev tools only, nothing of it is deployed) has a permissive licence,
 * - the README documents the font licence and the brand use.
 * Usage: node dev/checks/license.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BRANDS = /\b(prime ?task|notion|asana|trello|clickup|monday\.com|jira|todoist|wrike)\b/i;
const DOCS = ['README.md', 'WORKFLOW.md', 'FURPS.md'];
const HOSTS = ['www.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'date.nager.at', 'aiplatform.googleapis.com', 'docs.google.com', 'www.w3.org', 'script.google.com'];
const LICENSES = /^\(?(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|Python-2\.0|Unlicense)(\s+(OR|AND)\s+(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|CC0-1\.0))*\)?$/;

// dev tools only (never deployed: clasp pushes src/ alone), with the reason
const EXCEPTIONS = { 'eslint-plugin-sonarjs': 'LGPL-3.0, nur Lint-Werkzeug in der Entwicklung, wird nicht ausgeliefert' };

const list = dir => fs.readdirSync(dir).map(f => path.join(dir, f));

function brands() {
  const files = list(path.join(ROOT, 'src')).concat(DOCS.map(f => path.join(ROOT, f)).filter(f => fs.existsSync(f)));
  const hits = [];
  files.forEach(f => fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/data:image/.test(line)) return;
    const m = BRANDS.exec(line);
    if (m) hits.push('fremde Marke „' + m[0] + '" in ' + path.relative(ROOT, f) + ':' + (i + 1));
  }));
  return hits;
}

function hosts() {
  const hits = [];
  list(path.join(ROOT, 'src')).forEach(f => {
    const re = /https?:\/\/([a-z0-9.-]+)/gi;
    const code = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(code))) {
      const h = m[1].toLowerCase();
      if (!HOSTS.some(a => h === a || h.endsWith('-' + a) || h.endsWith('.' + a))) hits.push('nicht erlaubter Host ' + h + ' in ' + path.relative(ROOT, f));
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
      if (!LICENSES.test(lic) && !EXCEPTIONS[pkg.name]) hits.push('Lizenz „' + (lic || 'unbekannt') + '" bei ' + pkg.name + '@' + pkg.version);
      walk(path.join(p, 'node_modules'));
    });
  };
  walk(path.join(ROOT, 'node_modules'));
  return { hits, n };
}

function readme() {
  const text = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  return /## Lizenzen und Marken/.test(text) && /SIL Open Font License/.test(text) ? [] : ['README: Abschnitt „Lizenzen und Marken" (Schrift Inter, SIL OFL; Markennutzung) fehlt'];
}

if (require.main === module) {
  const p = packages();
  const all = brands().concat(hosts(), p.hits, readme());
  all.forEach(h => console.log('  ✗ ' + h));
  console.log(all.length ? all.length + ' Lizenz-/Markenbefunde' : 'Lizenzen und Marken ok: ' + p.n + ' Pakete mit freier Lizenz, nur erlaubte Hosts, keine fremden Marken');
  process.exit(all.length ? 1 : 0);
}
module.exports = { brands, hosts, packages, readme, BRANDS };
