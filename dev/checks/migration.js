/**
 * Migration readiness: the repository can be handed over to a company Workspace as it is.
 * - no environment-specific data: local paths, machine names, script/deployment/spreadsheet ids,
 *   web-app URLs, addresses of personal mail providers
 * - only own product names (word list compared as SHA-256, so the list itself reveals nothing)
 * - optional extra terms from dev/local/deny.json (git-ignored, never part of an export)
 * - documentation and code comments in English
 * - required files present, .clasp.json not versioned, safe defaults
 * Scans what an export contains: tracked files plus untracked, not ignored files.
 * Usage: node dev/checks/migration.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// structural patterns: they describe shapes, not names
const SHAPES = [
  ['local Windows path', /[A-Za-z]:\\+(Users|Benutzer)\\+[^\\\s"'`]+/],
  ['local home path', /\/(home|Users)\/[a-z][\w.-]+\//],
  ['machine name', /\bDESKTOP-[A-Z0-9]{5,}\b/],
  ['web-app deployment URL', /script\.google\.com\/(a\/[\w.]+\/)?macros\/s\/[\w-]{20,}/],
  ['deployment id', /\bAKfyc[\w-]{20,}/],
  ['spreadsheet or file URL', /docs\.google\.com\/(spreadsheets|document|file)\/d\/[\w-]{25,}/],
  ['drive folder URL', /drive\.google\.com\/drive\/(u\/\d\/)?folders\/[\w-]{20,}/],
  ['script id', /"scriptId"\s*:\s*"(?!YOUR_SCRIPT_ID")[\w-]{20,}"/],
  ['GitHub handle URL', /github\.com\/[\w-]+\/[\w.-]+/],
];
// hashed word lists: other vendors' product names, personal mail providers
const WORDS = new Set(['1563113587c34bd9', '0660ce8b70ce522e', '31f61ed3e6e210c5', '4de4a07ad031569c', '1768c21fc46884df', 'c0d67255424148d8',
  'df9ba8c57b8c2795', '1e32847769dc4a15', '282a6dc5066d4725', '0549e836108aab45']);
const MAIL_DOMAINS = new Set(['591bfe88c880df96', '38c27a992c92962e', '16903debca7c3db0', 'abc34802cb5ecee9', '1eec7adc7a3b2d82', 'b33960790a6de22c',
  'b43832b11cd83820', '06ae6b52ed986ed5', 'f81e0a262b0f3b39', '0f1de5405979e6c3', '98094d8ac24edb4c', 'e4a000438535d167', 'ada31fee6a0c5c92',
  'a259c2b50d785080', '3e2ae79c33547fe9']);
const REQUIRED = ['README.md', 'MIGRATION.md', 'WORKFLOW.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.clasp.json.example', 'src/appsscript.json'];
// German in comments/docs: umlauts or frequent words; quoted UI text ("…", „…“, `…`) is allowed
const GERMAN = /[äöüÄÖÜß]|\b(der|die|das|und|nicht|wird|für|mit|ist|eine?|auf|bei|wenn|oder|sind|werden|kein|keine|nur|auch|nach|über|alle|Datei|Dateien|Aufgaben|Seite|Tabelle)\b/;
const QUOTED = /"[^"]*"|“[^”]*”|„[^“”]*[“”]|`[^`]*`|'[^']*'/g;
const BINARY = /\.(png|jpe?g|gif|webp|ico|zip|pdf|woff2?)$/i;

function exportFiles() {
  const out = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map(f => f.trim()).filter(f => f && !f.startsWith('node_modules/') && fs.existsSync(path.join(ROOT, f)));
}

function localTerms() {
  const file = path.join(ROOT, 'dev', 'local', 'deny.json');
  if (!fs.existsSync(file)) return [];
  const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (conf.terms || []).map(t => new RegExp(String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

function scanFile(f, extra) {
  const hits = [];
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const isDoc = /\.md$/.test(f);
  const isCode = /\.(js|html|yml)$/.test(f) && !/LogoAssets\.html$/.test(f);
  text.split(/\r?\n/).forEach((line, i) => {
    if (/data:image\//.test(line)) return;
    const at = f + ':' + (i + 1);
    SHAPES.forEach(([name, re]) => { if (re.test(line)) hits.push(at + '  ' + name); });
    extra.forEach(re => { if (re.test(line)) hits.push(at + '  local deny term'); });
    const words = line.toLowerCase().match(/[a-z0-9][a-z0-9.@-]*[a-z0-9]/g) || [];
    words.forEach((w, k) => {
      if (WORDS.has(hash(w)) || (words[k + 1] && WORDS.has(hash(w + ' ' + words[k + 1])))) hits.push(at + '  unlisted product name');
      const m = /@([a-z0-9.-]+\.[a-z]{2,})$/.exec(w);
      if (m && MAIL_DOMAINS.has(hash(m[1]))) hits.push(at + '  personal mail address');
    });
    const comment = isCode ? (/(\/\/.*$|^\s*\/?\*+.*$|^\s*#.*$)/.exec(line) || [])[1] : isDoc && !/^\s*(\||```)/.test(line) ? line : '';
    if (comment && GERMAN.test(comment.replace(QUOTED, ''))) hits.push(at + '  not English');
  });
  return hits;
}

function check() {
  const files = exportFiles();
  const extra = localTerms();
  const hits = [];
  REQUIRED.forEach(f => { if (!files.includes(f)) hits.push('missing file ' + f); });
  if (files.includes('.clasp.json')) hits.push('.clasp.json is part of the export (contains the script id)');
  files.filter(f => !BINARY.test(f) && !/package-lock\.json$/.test(f)).forEach(f => hits.push(...scanFile(f, extra)));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'appsscript.json'), 'utf8'));
  if (!manifest.webapp || manifest.webapp.access !== 'DOMAIN') hits.push('appsscript.json: web app access must be DOMAIN');
  return { hits, files: files.length, local: extra.length };
}

if (require.main === module) {
  const r = check();
  r.hits.forEach(h => console.log('  ✗ ' + h));
  console.log(r.hits.length ? r.hits.length + ' migration findings' : 'Migration ready: ' + r.files + ' files clean' + (r.local ? ' (incl. ' + r.local + ' local terms)' : ''));
  process.exit(r.hits.length ? 1 : 0);
}
module.exports = { check, scanFile, hash };
