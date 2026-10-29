/**
 * Test helpers: every test gets its own app (fresh VM, empty spreadsheet, empty cache),
 * so tests never depend on each other (FIRST: independent, repeatable).
 */
const vm = require('vm');
const { load } = require('../dev/load');

const ME = 'demo.user@firma.de';
const ANNA = 'anna.schmidt@firma.de';
const LEA = 'lea.huber@firma.de';

const x_reset = ctx => ctx.__exports.Config.reset();

/** A fresh app. opts.demo seeds the demo teams, projects and tasks. */
function freshApp(opts) {
  const ctx = load({ quiet: true });
  ctx.__GAS_QUIET__ = true;
  ctx.__GAS_USER__ = ME;
  ctx.setup();
  if (opts && opts.demo) {
    ctx.PropertiesService.getScriptProperties().setProperty('ALLOW_DEMO_DATA', 'true');
    x_reset(ctx);
    ctx.seedDemoData();
  }
  const x = ctx.__exports;
  const api = {
    ctx: ctx,
    x: x,
    as(email) { ctx.__GAS_USER__ = email; return api; },
    /** Raw answer of one request: { ok, data, error, reads } */
    raw(method, payload) { return JSON.parse(ctx.api(method, JSON.stringify(payload || {}))); },
    call(method, payload) {
      const res = api.raw(method, payload);
      if (!res.ok) throw new Error(method + ': ' + res.error);
      return res.data;
    },
    error(method, payload) {
      const res = api.raw(method, payload);
      return res.ok ? null : res.error;
    },
    /** Counts the Apps Script operations done inside fn (sheet reads/writes, cache calls, locks, fetches). */
    measure(fn) {
      const m = {};
      ctx.__GAS_METER__ = m;
      try { fn(); } finally { ctx.__GAS_METER__ = null; }
      return m;
    },
    /** Test double for UrlFetchApp: answer(url, opts) -> { code, body } or throws. Records the calls. */
    fakeFetch(answer) {
      const calls = [];
      ctx.__GAS_FETCH__ = (url, opts) => {
        calls.push({ url: url, opts: opts });
        const r = answer(url, opts);
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      };
      return calls;
    },
    /** Writes n tasks straight into the sheet (fast bulk data for size and load tests). */
    bulkTasks(n, extra) {
      const cols = vm.runInContext('SCHEMA', ctx).Tasks.cols;
      const sh = api.sheet('Tasks');
      for (let i = 0; i < n; i++) {
        const t = Object.assign({ id: 'tk_bulk_' + i, title: 'Aufgabe Nummer ' + i + ' mit etwas Beschreibungstext', status: 'todo', teams: [], assignees: [ME], tags: [],
          dueDate: '2030-01-' + String(1 + (i % 28)).padStart(2, '0'), createdBy: ME, createdAt: '2026-01-01T08:00:00.000Z', sort: i }, extra || {});
        sh.data.push(cols.map(c => (Array.isArray(t[c]) ? JSON.stringify(t[c]) : t[c] === undefined ? '' : t[c])));
      }
      ctx.CacheService.getScriptCache().remove('ver_Tasks'); // the sheet changed outside Db
      x.Db.reset();
    },
    sheet(name) {
      const id = ctx.PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      return ctx.SpreadsheetApp.openById(id).getSheetByName(name);
    },
  };
  return api;
}

module.exports = { freshApp, ME, ANNA, LEA };
