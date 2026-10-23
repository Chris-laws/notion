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
  const ctx = vm.createContext({ console: con, Intl, Date, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-shim.js'), 'utf8'), ctx, { filename: 'gas-shim.js' });
  serverFiles().forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });
  // Expose script-scoped consts (const/let are not properties of the global object).
  vm.runInContext('globalThis.__exports = { Shared, Db, Tasks, Holidays, Capacity, Calendar, Ai, Config, Availability };', ctx);
  return ctx;
}

module.exports = { load, serverFiles, SRC };
