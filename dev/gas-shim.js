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
  // optional meter: tests and the load simulation count what one request costs
  const meter = (k, n) => { const m = root.__GAS_METER__; if (m) m[k] = (m[k] || 0) + (n === undefined ? 1 : n); };

  function stripQuote(v) {
    return typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v;
  }

  function Range(sheet, row, col, nRows, nCols) {
    this.getValues = () => {
      meter('sheetRead'); meter('rowsRead', nRows);
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
      meter('sheetWrite');
      values.forEach((line, r) => {
        const idx = row - 1 + r;
        while (sheet.data.length <= idx) sheet.data.push([]);
        line.forEach((v, c) => { sheet.data[idx][col - 1 + c] = stripQuote(v); });
      });
      return this;
    };
    this.clearContent = () => {
      meter('sheetWrite');
      for (let r = 0; r < nRows; r++) {
        const line = sheet.data[row - 1 + r];
        if (line) for (let c = 0; c < nCols; c++) line[col - 1 + c] = '';
      }
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
    this.deleteRow = r => { meter('sheetWrite'); this.data.splice(r - 1, 1); };
    this.setFrozenRows = () => {};
    // sheet protection: the owner can always edit; editors listed here could too
    const protections = [];
    this.getProtections = () => protections.slice();
    this.protect = () => {
      const p = { editors: ['someone@firma.de'], domainEdit: true, description: '' };
      Object.assign(p, {
        setDescription: d => { p.description = d; return p; },
        getEditors: () => p.editors.slice(),
        removeEditors: list => { p.editors = p.editors.filter(e => list.indexOf(e) < 0); return p; },
        canDomainEdit: () => p.domainEdit,
        setDomainEdit: v => { p.domainEdit = v; return p; },
      });
      protections.push(p);
      return p;
    };
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
    flush() { meter('flush'); },
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
  };
  root.PropertiesService = { getScriptProperties: () => propStore, getUserProperties: () => propStore };
  root.Session = {
    getActiveUser: () => ({ getEmail: () => root.__GAS_USER__ || '' }),
    getEffectiveUser: () => ({ getEmail: () => root.__GAS_USER__ || '' }),
    getScriptTimeZone: () => 'Europe/Berlin',
  };
  root.LockService = { getScriptLock: () => ({ waitLock() { meter('lock'); }, tryLock: () => { meter('lock'); return true; }, releaseLock() {} }) };
  root.CacheService = {
    getScriptCache: () => ({
      get: k => { meter('cacheCall'); return k in cache ? cache[k] : null; },
      put: (k, v) => { meter('cacheCall'); cache[k] = v; },
      remove: k => { delete cache[k]; },
      getAll: ks => { meter('cacheCall'); const o = {}; ks.forEach(k => { if (k in cache) o[k] = cache[k]; }); return o; },
      putAll: o => { meter('cacheCall'); Object.keys(o).forEach(k => { cache[k] = o[k]; }); },
      removeAll: ks => { ks.forEach(k => { delete cache[k]; }); },
    }),
  };
  // Blobs, gzip and base64 like Apps Script. Node gets real gzip (zlib from dev/load.js);
  // the browser preview has no zlib, there gzip passes the bytes through unchanged.
  const zlib = root.__zlib || null;
  const toBytes = s => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8') : new TextEncoder().encode(s));
  function Blob(bytes) {
    this.getBytes = () => bytes;
    this.getDataAsString = () => (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('utf8') : new TextDecoder().decode(bytes));
  }
  root.Utilities = {
    newBlob: data => new Blob(typeof data === 'string' ? toBytes(data) : data),
    gzip: blob => { meter('zipKB', blob.getBytes().length / 1024); return new Blob(zlib ? zlib.gzipSync(Buffer.from(blob.getBytes())) : blob.getBytes()); },
    ungzip: blob => { const out = new Blob(zlib ? zlib.gunzipSync(Buffer.from(blob.getBytes())) : blob.getBytes()); meter('zipKB', out.getBytes().length / 1024); return out; },
    base64Encode: bytes => (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode.apply(null, Array.from(bytes)))),
    base64Decode: s => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64') : Uint8Array.from(atob(s), c => c.charCodeAt(0))),
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
      if (/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/files/.test(url)) return root.__driveRest(url, opts || {});
      meter('fetch');
      if (root.__GAS_FETCH__) return root.__GAS_FETCH__(url, opts);
      throw new Error('Kein Netzwerk in der Vorschau');
    },
    // like Apps Script: all requests at once; one network failure fails the whole batch
    fetchAll(requests) {
      meter('fetchAll');
      if (!root.__GAS_FETCH__) throw new Error('Kein Netzwerk in der Vorschau');
      return requests.map(r => root.__GAS_FETCH__(r.url, r));
    },
  };
  root.CalendarApp = { getCalendarById: () => null };

  // Drive: folders and text files in memory (only what the app uses with the drive.file scope)
  const drive = {};
  let driveSeq = 0;
  const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  function DFile(name, content, mime, parent) {
    this.id = 'f_' + (++driveSeq);
    let trashed = false;
    let data = String(content);
    this.getId = () => this.id;
    this.getName = () => name;
    this.setName = n => { name = n; return this; };
    this.getMimeType = () => mime;
    this.getUrl = () => 'https://drive.google.com/file/d/' + this.id;
    this.getBlob = () => ({ getDataAsString: () => data });
    this.setContent = c => { meter('driveWrite'); data = String(c); return this; };
    this.getSize = () => data.length;
    this.setTrashed = t => { trashed = !!t; return this; };
    this.isTrashed = () => trashed;
    this.getParents = () => iter([parent]);
    drive[this.id] = this;
  }
  function DFolder(name, parent) {
    this.id = 'd_' + (++driveSeq);
    const folders = [];
    const files = [];
    let trashed = false;
    this.getId = () => this.id;
    this.getName = () => name;
    this.setName = n => { name = n; return this; };
    this.getUrl = () => 'https://drive.google.com/drive/folders/' + this.id;
    this.getParents = () => iter(parent ? [parent] : []);
    this.createFolder = n => { meter('driveWrite'); const f = new DFolder(n, this); folders.push(f); return f; };
    this.getFoldersByName = n => iter(folders.filter(f => f.getName() === n && !f.isTrashed()));
    this.getFolders = () => iter(folders.filter(f => !f.isTrashed()));
    this.createFile = (n, c, m) => { meter('driveWrite'); const f = new DFile(n, c, m || 'text/plain', this); files.push(f); return f; };
    this.getFiles = () => iter(files.filter(f => !f.isTrashed()));
    this.setTrashed = t => { trashed = !!t; return this; };
    this.isTrashed = () => trashed;
    drive[this.id] = this;
  }
  const tops = [];
  root.DriveApp = {
    createFolder: n => { meter('driveWrite'); const f = new DFolder(n, null); tops.push(f); return f; },
    getFolderById: id => { meter('driveRead'); if (!(drive[id] instanceof DFolder)) throw new Error('No item with the given ID could be found.'); return drive[id]; },
    getFileById: id => { meter('driveRead'); if (!(drive[id] instanceof DFile)) throw new Error('No item with the given ID could be found.'); return drive[id]; },
  };
  root.ScriptApp = { getOAuthToken: () => 'test-token' };
  // Drive REST API (v3) on top of the in-memory Drive: what Drive.js calls with UrlFetchApp
  const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const listOf = it => { const a = []; while (it.hasNext()) a.push(it.next()); return a; };
  root.__driveRest = (url, opts) => {
    if (root.__DRIVE_DENIED__) return reply(403, { error: { message: 'Insufficient Permission' } });
    // no URL class in the test context: path and query parameters by hand
    const query = {};
    String(url.split('?')[1] || '').split('&').filter(Boolean).forEach(kv => { const i = kv.indexOf('='); query[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    const u = { pathname: url.split('?')[0], searchParams: { get: k => (k in query ? query[k] : null) } };
    const method = String(opts.method || 'get').toLowerCase();
    const id = decodeURIComponent((/\/files\/([^/?]+)/.exec(u.pathname) || [])[1] || '');
    const item = id && drive[id];
    if (id && !item) return reply(404, { error: { message: 'File not found' } });
    if (!id && method === 'get') {
      meter('driveRead');
      const q = u.searchParams.get('q') || '';
      const name = ((/name = '((?:[^'\\]|\\.)*)'/.exec(q) || [])[1] || '').replace(/\\(.)/g, '$1');
      const parent = (/'([^']+)' in parents/.exec(q) || [])[1];
      const pool = parent ? (drive[parent] ? listOf(drive[parent].getFolders()) : []) : tops.filter(f => !f.isTrashed());
      return reply(200, { files: pool.filter(f => f.getName() === name).map(f => ({ id: f.getId() })) });
    }
    if (!id && method === 'post' && /uploadType=multipart/.test(url)) {
      const parts = String(opts.payload).split(/\r\n--[^\r\n]+/);
      const body = part => part.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      const meta = JSON.parse(body(parts[0]));
      return reply(200, { id: drive[meta.parents[0]].createFile(meta.name, body(parts[1]), meta.mimeType).getId() });
    }
    if (!id && method === 'post') {
      const meta = JSON.parse(opts.payload);
      const f = meta.parents ? drive[meta.parents[0]].createFolder(meta.name) : root.DriveApp.createFolder(meta.name);
      return reply(200, { id: f.getId() });
    }
    if (method === 'get' && u.searchParams.get('alt') === 'media') { meter('driveRead'); return reply(200, item.getBlob().getDataAsString()); }
    if (method === 'get') { meter('driveRead'); return reply(200, { id: id, trashed: item.isTrashed() }); }
    if (method === 'patch' && /uploadType=media/.test(url)) { item.setContent(opts.payload); return reply(200, { id: id }); }
    if (method === 'patch') {
      meter('driveWrite');
      const meta = JSON.parse(opts.payload);
      if (meta.name !== undefined) item.setName(meta.name);
      if (meta.trashed !== undefined) item.setTrashed(meta.trashed);
      return reply(200, { id: id });
    }
    return reply(400, { error: { message: 'unsupported' } });
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
