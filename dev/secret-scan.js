/**
 * Secret scan for the codeguard: fails when something that looks like a real key or token is in
 * the repository (keys belong into the Script Properties, never into code).
 * Usage: node dev/secret-scan.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = /node_modules|\.git[\\/]|coverage|dev[\\/]preview\.html|LogoAssets\.html|package-lock\.json/;
const RULES = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OAuth client secret', /GOCSPX-[0-9A-Za-z_-]{20,}/],
  ['OAuth refresh token', /1\/\/0[0-9A-Za-z_-]{30,}/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z]{30,}/],
  ['Slack token', /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['generic secret assignment', /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][0-9A-Za-z_\-/+=]{24,}['"]/i],
];
// placeholders that are fine to have in the code
const ALLOWED = /PLATZHALTER|PLACEHOLDER|test-key|example/i;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (SKIP.test(p)) return [];
    return d.isDirectory() ? files(p) : /\.(js|gs|html|json|md|yml|yaml|txt)$/.test(d.name) ? [p] : [];
  });
}

const hits = [];
files(ROOT).forEach(f => {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    RULES.forEach(([name, re]) => {
      const m = re.exec(line);
      if (m && !ALLOWED.test(line)) hits.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + name + '  ' + m[0].slice(0, 12) + '…');
    });
  });
});
if (hits.length) {
  console.error('Mögliche Geheimnisse im Code:\n  ' + hits.join('\n  '));
  process.exit(1);
}
console.log('Secret-Scan ok: keine Schlüssel oder Tokens im Code');
