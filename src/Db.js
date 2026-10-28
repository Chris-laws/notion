/**
 * Tiny table layer on top of a Google Spreadsheet.
 *
 * Every table is one sheet with a header row. The first column is the key.
 * Reads are memoised for the duration of one server call; writes run inside
 * Db.tx(), which takes the script lock and re-reads the data so concurrent
 * users never write to a stale row number.
 *
 * Transactions are all or nothing. Before each write, Db.tx() notes how to undo it
 * (insert -> delete, update -> old row, delete -> old rows); an error inside the
 * transaction undoes all its writes in reverse order. From the second write of a
 * transaction on, the undo steps are also written ahead to the Journal sheet and the
 * script property DB_JOURNAL is set: if the script dies before it can undo (time limit),
 * the next transaction replays the journal under the lock before doing anything else.
 */
const SCHEMA = {
  Users: {
    cols: ['email', 'name', 'color', 'country', 'region', 'hoursPerWeek', 'workDays', 'role', 'active', 'createdAt'],
    num: ['hoursPerWeek'],
  },
  Teams: {
    cols: ['id', 'name', 'icon', 'color', 'description', 'lead', 'members', 'createdBy', 'createdAt', 'leads'],
    json: ['members', 'leads'],
  },
  Projects: {
    cols: ['id', 'teamId', 'name', 'icon', 'color', 'description', 'status', 'members', 'startDate', 'endDate', 'createdBy', 'createdAt', 'leads', 'links'],
    json: ['members', 'leads', 'links'],
  },
  Tasks: {
    cols: ['id', 'title', 'description', 'status', 'priority', 'projectId', 'teams', 'assignees', 'tags',
      'startDate', 'dueDate', 'estimate', 'parentId', 'recurrence', 'sort', 'createdBy', 'createdAt',
      'updatedAt', 'completedAt', 'planDate', 'planStart', 'progress', 'spent', 'timerStart', 'links'],
    json: ['teams', 'assignees', 'tags', 'links'],
    num: ['estimate', 'sort', 'planStart', 'progress', 'spent'],
  },
  Comments: {
    cols: ['id', 'taskId', 'author', 'body', 'createdAt'],
  },
  Events: {
    cols: ['id', 'title', 'type', 'startDate', 'endDate', 'teamId', 'attendees', 'note', 'createdBy', 'createdAt'],
    json: ['attendees'],
  },
  Absences: {
    cols: ['id', 'email', 'startDate', 'endDate', 'type', 'note', 'createdAt'],
  },
  CompanyHolidays: {
    cols: ['id', 'date', 'name', 'countries'],
    json: ['countries'],
  },
  HolidayCache: {
    cols: ['key', 'json', 'fetchedAt'],
  },
  // documents and jour fixe minutes: the text is a Markdown file in Drive (fileId), this is the metadata
  Docs: {
    cols: ['id', 'projectId', 'kind', 'seriesId', 'date', 'title', 'fileId', 'version', 'size', 'preview',
      'updatedAt', 'updatedBy', 'createdBy', 'createdAt', 'lockBy', 'lockUntil', 'people', 'openItems', 'change', 'pinnedTopics'],
    // minutes: who was there ({ present, absent }) and the open action items, so lists and the
    // next meeting need no file read; change: what the latest save changed (version list)
    json: ['openItems', 'pinnedTopics'],
    num: ['version', 'size'],
  },
  // earlier versions of a document (files in the project's .versions folder)
  DocVersions: {
    cols: ['id', 'docId', 'version', 'fileId', 'at', 'by', 'change'],
    num: ['version'],
  },
  JfSeries: {
    cols: ['id', 'projectId', 'title', 'rhythm', 'weekday', 'time', 'duration', 'startDate', 'endDate', 'attendees', 'meetLink',
      'active', 'createdBy', 'createdAt'],
    json: ['attendees'],
    num: ['weekday', 'duration'],
  },
  // Drive folder per team, project and series ("project:<id>" -> folder id)
  Folders: {
    cols: ['key', 'folderId'],
  },
  // write-ahead undo steps of the running transaction (empty when nothing is in flight)
  Journal: {
    cols: ['seq', 'tx', 'op', 'tbl', 'rowKey', 'before', 'createdAt'],
  },
};

const Db = (function () {
  let spreadsheet = null;
  let memo = {};
  let txDepth = 0;
  let dirty = false;
  let sheetReads = 0; // spreadsheet reads in this request (for the timing log)
  // Tables are also kept in the script cache so most reads skip the spreadsheet.
  // Each table has a version token; every write replaces it, so a cached copy is
  // only used while its token is still current (no stale reads after a write).
  // Big tables are split into chunks (the cache takes up to 100 KB per value).
  const CACHED = { Users: 1, Teams: 1, Projects: 1, CompanyHolidays: 1, Tasks: 1, Events: 1, Absences: 1, Comments: 1, Docs: 1, JfSeries: 1, Folders: 1 };
  const CACHE_TTL = 600;
  // characters per chunk: at most 3 bytes each in UTF-8, so a chunk stays under the 100 KB limit;
  // compressed copies are base64 (1 byte per character) and use bigger chunks
  const CHUNK = 30000;
  const ZCHUNK = 90000;
  const MAX_CHUNKS = 80;
  // above this size a table is gzipped before it goes to the cache (JSON shrinks ~8-10x)
  const ZIP_FROM = 2 * CHUNK;
  const zip = raw => Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(raw)).getBytes());
  const unzip = b64 => Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString();
  const newToken = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function scriptCache() {
    try { return CacheService.getScriptCache(); } catch (e) { return null; }
  }
  /** Returns { entries, ver }: entries when the cached copy is current, ver = token seen. */
  function cacheGet(table) {
    const c = CACHED[table] && scriptCache();
    if (!c) return { entries: null, ver: null };
    try {
      const k = 'tbl_' + table;
      const first = c.getAll(['ver_' + table, k + '_h', k + '_0']);
      const ver = first['ver_' + table] || null;
      const head = first[k + '_h'] ? JSON.parse(first[k + '_h']) : null;
      if (!ver || !head || head.ver !== ver) return { entries: null, ver: ver };
      let raw = first[k + '_0'];
      if (raw == null) return { entries: null, ver: ver };
      if (head.n > 1) {
        const keys = [];
        for (let i = 1; i < head.n; i++) keys.push(k + '_' + i);
        const rest = c.getAll(keys);
        for (let i = 0; i < keys.length; i++) {
          if (rest[keys[i]] == null) return { entries: null, ver: ver };
          raw += rest[keys[i]];
        }
      }
      return { entries: JSON.parse(head.z ? unzip(raw) : raw), ver: ver };
    } catch (e) { return { entries: null, ver: null }; }
  }
  /** Cache entries (chunks + head) for a table under version ver; null when it is too big. */
  function cacheEntries(table, entries, ver) {
    const json = JSON.stringify(entries);
    const z = json.length > ZIP_FROM;
    const raw = z ? zip(json) : json;
    const size = z ? ZCHUNK : CHUNK;
    if (raw.length > size * MAX_CHUNKS) return null;
    const k = 'tbl_' + table;
    const out = {};
    let n = 0;
    for (let at = 0; at < raw.length || n === 0; n++) {
      let end = Math.min(raw.length, at + size);
      // never cut an emoji (surrogate pair) in half
      const code = raw.charCodeAt(end - 1);
      if (end < raw.length && code >= 0xD800 && code <= 0xDBFF) end--;
      out[k + '_' + n] = raw.slice(at, end);
      at = end;
    }
    out[k + '_h'] = JSON.stringify({ ver: ver, n: n, z: z });
    return out;
  }
  function cachePut(table, entries, seen) {
    const c = CACHED[table] && scriptCache();
    if (!c) return;
    try {
      // someone wrote meanwhile: our copy may be old, leave it out (checked before the costly part)
      let ver = c.get('ver_' + table);
      if (ver !== seen) return;
      if (!ver) { ver = newToken(); c.put('ver_' + table, ver, 21600); }
      const out = cacheEntries(table, entries, ver);
      if (out) c.putAll(out, CACHE_TTL);
    } catch (e) { /* cache is optional */ }
  }
  /**
   * After a write: a new token makes every cached copy of the table invalid.
   * Set once the write has landed (end of tx), so nobody caches the old rows under it.
   */
  let written = {};
  function cacheDrop(table) { written[table] = 1; }
  function bumpVersions() {
    const c = scriptCache();
    const tables = Object.keys(written);
    written = {};
    if (!c || !tables.length) return;
    try {
      tables.filter(t => CACHED[t]).forEach(t => {
        const ver = newToken();
        // write-through: the rows of this request are exact (still under the lock), so the next
        // reader and the next writer get them from the cache instead of reading the whole sheet
        const out = (memo[t] && cacheEntries(t, memo[t], ver)) || {};
        c.putAll(out, CACHE_TTL);
        c.put('ver_' + t, ver, 21600);
      });
    } catch (e) { /* optional */ }
  }

  function open() {
    if (spreadsheet) return spreadsheet;
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) {
      throw new Error('Die Datenbank ist noch nicht eingerichtet. Bitte im Apps-Script-Editor einmal setup() ausführen.');
    }
    spreadsheet = SpreadsheetApp.openById(id);
    return spreadsheet;
  }

  function sheet(table) {
    const sh = open().getSheetByName(table);
    if (!sh) throw new Error('Tabelle "' + table + '" fehlt. Bitte setup() erneut ausführen.');
    return sh;
  }

  function def(table) {
    const d = SCHEMA[table];
    if (!d) throw new Error('Unbekannte Tabelle ' + table);
    return d;
  }

  function cellToValue(d, col, v) {
    if ((d.json || []).indexOf(col) >= 0) {
      if (!v) return [];
      try { return JSON.parse(v); } catch (e) { return []; }
    }
    if ((d.num || []).indexOf(col) >= 0) return Number(v) || 0;
    if (v instanceof Date) {
      // Sheets may still turn text into dates if someone edits the sheet by hand.
      const tz = Session.getScriptTimeZone();
      return /date$/i.test(col) || col === 'date'
        ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
        : v.toISOString();
    }
    if (typeof v === 'boolean') return v;
    return v === null || v === undefined ? '' : String(v);
  }

  function valueToCell(d, col, v) {
    if ((d.json || []).indexOf(col) >= 0) return JSON.stringify(v || []);
    if ((d.num || []).indexOf(col) >= 0) return Number(v) || 0;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v;
    const s = String(v);
    // Never let user input become a spreadsheet formula.
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  function toObj(d, row) {
    const o = {};
    d.cols.forEach((c, i) => { o[c] = cellToValue(d, c, row[i]); });
    return o;
  }

  function toRow(d, obj) {
    return d.cols.map(c => valueToCell(d, c, obj[c]));
  }

  // tables of this request that were read from the sheet itself (row numbers known to be exact)
  let fromSheet = {};
  function load(table, fresh) {
    if (memo[table] && !fresh) return memo[table];
    // inside a write the cached copy is fine too: its version proves no write happened since;
    // locate() still checks the row before anything is written
    // after a write in this request the cache is behind until the transaction ends
    const hit = fresh || written[table] ? { entries: null, ver: null } : cacheGet(table);
    if (hit.entries) { memo[table] = hit.entries; fromSheet[table] = false; return hit.entries; }
    const d = def(table);
    const sh = sheet(table);
    sheetReads++;
    const last = sh.getLastRow();
    const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, d.cols.length).getValues();
    const entries = [];
    rows.forEach((r, i) => {
      if (r[0] === '' || r[0] === null) return;
      entries.push({ obj: toObj(d, r), row: i + 2 });
    });
    memo[table] = entries;
    fromSheet[table] = true;
    if (!txDepth) cachePut(table, entries, hit.ver);
    return entries;
  }

  function find(table, key) {
    const k = String(key);
    return load(table).find(e => String(e.obj[def(table).cols[0]]) === k) || null;
  }

  /**
   * Entry plus its row, safe for writing: with a cached copy one cell is read to make sure
   * the row still holds this key (someone may have sorted the sheet by hand). If not: read the sheet.
   */
  function locate(table, key) {
    const e = find(table, key);
    if (fromSheet[table]) return e;
    if (e && String(sheet(table).getRange(e.row, 1).getValues()[0][0]) === String(key)) return e;
    load(table, true);
    return find(table, key);
  }

  /* ---- undo journal ---- */
  // undo steps of the running transaction: { op: 'insert'|'update'|'remove', table, key, before }
  let undo = null;
  let walOpen = false;
  let txId = '';
  const props = () => PropertiesService.getScriptProperties();

  /** Notes how to undo the next write; from the second write on it is also written ahead. */
  function noteUndo(step) {
    if (!undo) return;
    undo.push(step);
    const multi = step.op === 'remove' && step.before.length > 1;
    if (!walOpen && (undo.length > 1 || multi)) {
      walOpen = true;
      walWrite(undo);
      props().setProperty('DB_JOURNAL', txId);
    } else if (walOpen) walWrite([step]);
  }
  function journalSheet() {
    const ss = open();
    let sh = ss.getSheetByName('Journal');
    if (!sh) {
      sh = ss.insertSheet('Journal');
      sh.getRange(1, 1, 1, SCHEMA.Journal.cols.length).setValues([SCHEMA.Journal.cols]);
    }
    return sh;
  }
  function walWrite(list) {
    // one row per deleted record: a sheet cell holds at most 50,000 characters
    const steps = [];
    list.forEach(s => (s.op === 'remove' ? s.before.forEach(o => steps.push({ op: 'remove', table: s.table, before: [o] })) : steps.push(s)));
    const sh = journalSheet();
    const at = sh.getLastRow() + 1;
    const now = new Date().toISOString();
    sh.getRange(at, 1, steps.length, SCHEMA.Journal.cols.length).setValues(steps.map((s, i) =>
      [at + i, txId, s.op, s.table, String(s.key === undefined ? '' : s.key), JSON.stringify(s.before === undefined ? null : s.before), now]));
  }
  function walClear() {
    const sh = journalSheet();
    for (let r = sh.getLastRow(); r >= 2; r--) sh.deleteRow(r);
    props().deleteProperty('DB_JOURNAL');
  }
  /** Writes one undo step back, straight on the sheet (row numbers read fresh). */
  function applyUndo(s) {
    const d = def(s.table);
    const sh = sheet(s.table);
    const rows = load(s.table, true);
    const at = key => rows.find(e => String(e.obj[d.cols[0]]) === String(key));
    cacheDrop(s.table);
    dirty = true;
    if (s.op === 'insert') {
      const e = at(s.key);
      if (e) sh.deleteRow(e.row);
    } else if (s.op === 'update') {
      const e = at(s.key);
      const row = e ? e.row : sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, d.cols.length).setValues([toRow(d, s.before)]);
    } else {
      const missing = s.before.filter(o => !at(o[d.cols[0]]));
      if (missing.length) sh.getRange(sh.getLastRow() + 1, 1, missing.length, d.cols.length).setValues(missing.map(o => toRow(d, o)));
    }
    delete memo[s.table];
  }
  /** Undoes the steps in reverse order. If that fails too, the written-ahead journal stays for recovery. */
  function rollback(steps) {
    memo = {};
    fromSheet = {};
    try {
      steps.slice().reverse().forEach(applyUndo);
      if (walOpen) walClear();
    } catch (e) {
      console.error('rollback failed, journal kept for recovery: ' + (e && e.message));
    }
    memo = {};
  }
  /** A transaction died without undoing its writes: replay its journal (under the lock). */
  function recover() {
    if (!props().getProperty('DB_JOURNAL')) return;
    const sh = journalSheet();
    const last = sh.getLastRow();
    const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, SCHEMA.Journal.cols.length).getValues();
    const steps = rows.filter(r => r[2]).map(r => ({ op: r[2], table: r[3], key: r[4], before: JSON.parse(r[5]) }));
    console.warn('recovering ' + steps.length + ' journal steps of an interrupted transaction');
    memo = {};
    fromSheet = {};
    steps.reverse().forEach(applyUndo);
    walClear();
    memo = {};
  }

  function tx(fn) {
    if (txDepth > 0) return fn();
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    txDepth++;
    memo = {};
    fromSheet = {};
    undo = [];
    walOpen = false;
    txId = newToken();
    try {
      recover();
      const result = fn();
      if (walOpen) walClear();
      return result;
    } catch (e) {
      if (undo.length) rollback(undo);
      throw e;
    } finally {
      undo = null;
      walOpen = false;
      txDepth--;
      if (dirty) SpreadsheetApp.flush();
      dirty = false;
      bumpVersions();
      lock.releaseLock();
    }
  }

  return {
    tx: tx,
    reads() { return sheetReads; },
    /** The table was changed outside Db (restore): drop cached copies at the end of the transaction. */
    touch(table) { cacheDrop(table); delete memo[table]; dirty = true; },

    /** Version token over some tables: changes whenever one of them is written. */
    version(tables) {
      const c = scriptCache();
      if (!c) return newToken();
      try {
        const keys = tables.map(t => 'ver_' + t);
        const got = c.getAll(keys);
        const missing = {};
        keys.forEach(k => { if (!got[k]) { got[k] = newToken(); missing[k] = got[k]; } });
        if (Object.keys(missing).length) c.putAll(missing, 21600);
        return keys.map(k => got[k]).join('.');
      } catch (e) { return newToken(); }
    },

    all(table) {
      return load(table).map(e => e.obj);
    },

    get(table, key) {
      const e = find(table, key);
      return e ? e.obj : null;
    },

    insert(table, obj) {
      return tx(() => {
        const d = def(table);
        if (find(table, obj[d.cols[0]])) throw new Error('Eintrag existiert bereits.');
        const sh = sheet(table);
        noteUndo({ op: 'insert', table: table, key: obj[d.cols[0]] });
        cacheDrop(table);
        dirty = true;
        const row = sh.getLastRow() + 1;
        sh.getRange(row, 1, 1, d.cols.length).setValues([toRow(d, obj)]);
        const clean = toObj(d, toRow(d, obj).map(v => (typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v)));
        load(table).push({ obj: clean, row: row });
        return clean;
      });
    },

    update(table, key, patch) {
      return tx(() => {
        const d = def(table);
        const e = locate(table, key);
        if (!e) throw new Error('Eintrag nicht gefunden.');
        noteUndo({ op: 'update', table: table, key: key, before: Object.assign({}, e.obj) });
        cacheDrop(table);
        dirty = true;
        const merged = Object.assign({}, e.obj, patch);
        merged[d.cols[0]] = e.obj[d.cols[0]];
        sheet(table).getRange(e.row, 1, 1, d.cols.length).setValues([toRow(d, merged)]);
        e.obj = merged;
        return merged;
      });
    },

    /** Deletes many rows in one pass: rows from the sheet itself, deleted bottom-up so numbers stay right. */
    removeMany(table, keys) {
      if (!keys || !keys.length) return 0;
      return tx(() => {
        const d = def(table);
        const wanted = {};
        keys.forEach(k => { wanted[String(k)] = true; });
        const hits = load(table, true).filter(e => wanted[String(e.obj[d.cols[0]])]);
        const rows = hits.map(e => e.row).sort((a, b) => b - a);
        if (!rows.length) return 0;
        noteUndo({ op: 'remove', table: table, before: hits.map(e => Object.assign({}, e.obj)) });
        cacheDrop(table);
        dirty = true;
        const sh = sheet(table);
        rows.forEach(r => sh.deleteRow(r));
        delete memo[table];
        return rows.length;
      });
    },

    remove(table, key) {
      return tx(() => {
        const e = locate(table, key);
        if (!e) return false;
        noteUndo({ op: 'remove', table: table, before: [Object.assign({}, e.obj)] });
        cacheDrop(table);
        dirty = true;
        sheet(table).deleteRow(e.row);
        delete memo[table];
        return true;
      });
    },

    /** Creates missing sheets and headers. Used by setup(). */
    ensureSchema(ss) {
      spreadsheet = ss;
      Object.keys(SCHEMA).forEach(name => {
        const d = SCHEMA[name];
        let sh = ss.getSheetByName(name);
        if (!sh) sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, d.cols.length).setValues([d.cols]).setFontWeight('bold');
        sh.setFrozenRows(1);
        // Plain text everywhere so ISO dates and ids stay untouched.
        sh.getRange(1, 1, sh.getMaxRows(), d.cols.length).setNumberFormat('@');
      });
      memo = {};
    },

    /** For tests: forget the open spreadsheet and all cached rows. */
    reset() {
      spreadsheet = null;
      memo = {};
      fromSheet = {};
      sheetReads = 0;
      if (typeof Config !== 'undefined' && Config.reset) Config.reset();
    },
  };
})();
