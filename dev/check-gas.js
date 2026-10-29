// Static check before the upload to Apps Script: node dev/check-gas.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(src);
const errors = [];
const fail = m => errors.push(m);

// Manifest
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(path.join(src, 'appsscript.json'), 'utf8')); } catch (e) { fail('appsscript.json ungültig: ' + e.message); }
if (manifest.runtimeVersion !== 'V8') fail('runtimeVersion muss V8 sein');
if (!manifest.webapp || !manifest.webapp.executeAs || !manifest.webapp.access) fail('webapp.executeAs/access fehlt');

// server files: syntax, no ES modules
files.filter(f => f.endsWith('.js')).forEach(f => {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  if (/^\s*(import|export)\s/m.test(code)) fail(f + ': import/export wird in Apps Script nicht unterstützt');
  try { new vm.Script(code, { filename: f }); } catch (e) { fail(f + ': Syntaxfehler ' + e.message); }
});

// HTML: include() targets, script tags, inline JS syntax
const html = files.filter(f => f.endsWith('.html'));
html.forEach(f => {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  (code.match(/<script\b/g) || []).length === (code.match(/<\/script>/g) || []).length || fail(f + ': <script>-Tags unausgewogen');
  (code.match(/<style\b/g) || []).length === (code.match(/<\/style>/g) || []).length || fail(f + ': <style>-Tags unausgewogen');
  for (const m of code.matchAll(/include\('([^']+)'\)/g)) {
    if (!files.includes(m[1] + '.html')) fail(f + ': include(\'' + m[1] + '\') hat keine Datei');
  }
  for (const m of code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const js = m[1].replace(/<\?[=!]?[\s\S]*?\?>/g, '0');
    if (!js.trim()) continue;
    try { new vm.Script(js, { filename: f }); } catch (e) { fail(f + ': Browser-JS Syntaxfehler ' + e.message); }
  }
});

// every server route the client calls exists
const code = fs.readFileSync(path.join(src, 'Code.js'), 'utf8');
const routes = new Set([...code.matchAll(/^\s*'([\w.]+)':/gm)].map(m => m[1]));
html.forEach(f => {
  const c = fs.readFileSync(path.join(src, f), 'utf8');
  for (const m of c.matchAll(/\bcall\(\s*'([\w.]+)'/g)) if (!routes.has(m[1])) fail(f + ': Route ' + m[1] + ' fehlt in Code.js');
});

// the placeholder key must never appear in browser code
html.forEach(f => { if (/AIza[0-9A-Za-z_-]{20,}/.test(fs.readFileSync(path.join(src, f), 'utf8'))) fail(f + ': möglicher API-Schlüssel im Browser-Code'); });

if (errors.length) { console.error('Check failed:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('Apps Script check ok: ' + files.length + ' files, ' + routes.size + ' routes');
