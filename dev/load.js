/** Loads the Apps Script sources into a Node VM context with the service shims. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

function serverFiles() {
  return fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
}

function load(opts) {
  const quiet = opts && opts.quiet;
  const con = quiet ? Object.assign({}, console, { error() {}, log() {} }) : console;
  const ctx = vm.createContext({ console: con, Intl, Date, Math, JSON, Buffer, __zlib: require('zlib') });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8'), ctx, { filename: 'gas-shim.js' });
  // HTML files for HtmlService.createHtmlOutputFromFile (parts of the page loaded later)
  ctx.__FILES__ = {};
  fs.readdirSync(SRC).filter(f => f.endsWith('.html')).forEach(f => { ctx.__FILES__[f.slice(0, -5)] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
  // mutation testing swaps one file for a mutant: MUTANT=<file>:<path of the mutated copy>
  const mutant = (process.env.MUTANT || '').split('|');
  serverFiles().forEach(f => {
    const file = mutant[0] === f ? mutant[1] : path.join(SRC, f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.join(SRC, f) });
  });
  // Expose script-scoped consts (const/let are not properties of the global object).
  vm.runInContext('globalThis.__exports = { Shared, Db, Tasks, Holidays, Capacity, Calendar, Ai, Config, Availability, Access, Teams, Projects, Users, Auth, Util, Docs, Jf, Assistant };', ctx);
  return ctx;
}

module.exports = { load, serverFiles, SRC };
