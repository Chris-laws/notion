/**
 * In-memory stand-ins for the Apps Script services the server code uses.
 * Lets the real server code run in Node (tests) and in the browser preview.
 * Not deployed (clasp only pushes src/).
 */
(function (root) {
  const props = {};
  const cache = {};
  const spreadsheets = {};
  let uuid = 0;

  function stripQuote(v) {
    return typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v;
  }

  function Range(sheet, row, col, nRows, nCols) {
    this.getValues = () => {
      const out = [];
      for (let r = 0; r < nRows; r++) {
        const src = sheet.data[row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < nCols; c++) {
          const v = src[col - 1 + c];
          line.push(v === undefined || v === null ? '' : v);
        }
        out.push(line);
      }
      return out;
    };
    this.setValues = values => {
      values.forEach((line, r) => {
        const idx = row - 1 + r;
        while (sheet.data.length <= idx) sheet.data.push([]);
        line.forEach((v, c) => { sheet.data[idx][col - 1 + c] = stripQuote(v); });
      });
      return this;
    };
    ['setNumberFormat', 'setFontWeight', 'setBackground'].forEach(m => { this[m] = () => this; });
  }

  function Sheet(name) {
    this.data = [];
    this.getName = () => name;
    this.getLastRow = () => {
      for (let i = this.data.length - 1; i >= 0; i--) {
        if ((this.data[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      }
      return 0;
    };
    this.getMaxRows = () => Math.max(1000, this.data.length);
    this.getRange = (r, c, nr, nc) => new Range(this, r, c, nr || 1, nc || 1);
    this.deleteRow = r => { this.data.splice(r - 1, 1); };
    this.setFrozenRows = () => {};
  }

  function Spreadsheet(id, name) {
    const sheets = [new Sheet('Sheet1')];
    this.getId = () => id;
    this.getName = () => name;
    this.getUrl = () => 'https://docs.google.com/spreadsheets/d/' + id;
    this.getSheets = () => sheets.slice();
    this.getSheetByName = n => sheets.find(s => s.getName() === n) || null;
    this.insertSheet = n => { const s = new Sheet(n); sheets.push(s); return s; };
    this.deleteSheet = s => { sheets.splice(sheets.indexOf(s), 1); };
  }

  const propStore = {
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); return propStore; },
    deleteProperty: k => { delete props[k]; return propStore; },
    getProperties: () => Object.assign({}, props),
  };

  root.SpreadsheetApp = {
    create(name) {
      const id = 'ss_' + (++uuid);
      spreadsheets[id] = new Spreadsheet(id, name);
      return spreadsheets[id];
    },
    openById(id) {
      if (!spreadsheets[id]) throw new Error('Spreadsheet not found');
      return spreadsheets[id];
    },
    flush() {},
  };
  root.PropertiesService = { getScriptProperties: () => propStore, getUserProperties: () => propStore };
  root.Session = {
    getActiveUser: () => ({ getEmail: () => root.__GAS_USER__ || '' }),
    getEffectiveUser: () => ({ getEmail: () => root.__GAS_USER__ || '' }),
    getScriptTimeZone: () => 'Europe/Berlin',
  };
  root.LockService = { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) };
  root.CacheService = {
    getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
      remove: k => { delete cache[k]; },
      getAll: ks => { const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; },
      putAll: o => { Object.keys(o).forEach(k => { cache[k] = o[k]; }); },
      removeAll: ks => { ks.forEach(k => { delete cache[k]; }); },
    }),
  };
  root.Utilities = {
    getUuid() {
      const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      return hex() + hex() + '-' + hex() + '-' + hex() + '-' + hex() + '-' + hex() + hex() + hex();
    },
    formatDate(date, tz) {
      // Only the 'yyyy-MM-dd' pattern is used by the app.
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(date);
    },
  };
  root.Logger = { log: function () { if (!root.__GAS_QUIET__) console.log.apply(console, arguments); } };
  root.UrlFetchApp = {
    fetch(url, opts) {
      if (root.__GAS_FETCH__) return root.__GAS_FETCH__(url, opts);
      throw new Error('Kein Netzwerk in der Vorschau');
    },
  };
  root.CalendarApp = { getCalendarById: () => null };
})(typeof globalThis !== 'undefined' ? globalThis : window);
