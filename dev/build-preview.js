/**
 * Builds dev/preview.html: the real web app UI plus the real server code
 * running in the browser against in-memory shims and demo data.
 * Usage: npm run preview  (then open dev/preview.html, ?user=<email> to switch person)
 */
const fs = require('fs');
const path = require('path');
const { load, serverFiles, SRC } = require('./load');

const ctx = load({ quiet: true });
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

let html = read('Index.html')
  .replace(/<\?!= include\('(\w+)'\) \?>/g, (m, name) => read(name + '.html'))
  .replace(/<\?!= JSON\.stringify\(String\(userEmail.*?\?>/, () => '(new URLSearchParams(location.search).get("user") || "chris@firma.de")')
  .replace('<?!= clientLib() ?>', () => 'var Shared = (' + ctx.SharedFactory.toString() + ')();');

const server = serverFiles().map(f => '// ---- ' + f + '\n' + read(f)).join('\n');
const shim = fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8');
const runtime = `
<script>
// ---- Preview runtime: server code in a private scope, google.script.run shim.
(function () {
  ${shim}
  const params = new URLSearchParams(location.search);
  globalThis.__GAS_USER__ = params.get('user') || 'chris@firma.de';
  globalThis.__GAS_QUIET__ = true;
  ${server}
  setup();
  seedDemoData();
  const server = { api: api };
  function runner(ok, ko) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return fn => runner(fn, ko);
        if (name === 'withFailureHandler') return fn => runner(ok, fn);
        return function () {
          const args = arguments;
          setTimeout(() => {
            try { const out = server[name].apply(null, args); if (ok) ok(out); } catch (e) { if (ko) ko(e); }
          }, 60);
        };
      },
    });
  }
  window.google = { script: { run: runner(null, null), url: { getLocation: cb => cb({ parameter: Object.fromEntries(params) }) } } };
})();
</script>`;

html = html.replace('<body>', '<body>' + runtime);
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('dev/preview.html geschrieben');
