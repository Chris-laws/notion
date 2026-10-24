/**
 * Tiny table layer on top of a Google Spreadsheet.
 *
 * Every table is one sheet with a header row. The first column is the key.
 * Reads are memoised for the duration of one server call; writes run inside
 * Db.tx(), which takes the script lock and re-reads the data so concurrent
 * users never write to a stale row number.
 */
const SCHEMA = {
  Users: {
    cols: ['email', 'name', 'color', 'country', 'region', 'hoursPerWeek', 'workDays', 'role', 'active', 'createdAt'],
    num: ['hoursPerWeek'],
  },
  Teams: {
    cols: ['id', 'name', 'icon', 'color', 'description', 'lead', 'members', 'createdBy', 'createdAt'],
    json: ['members'],
  },
  Projects: {
    cols: ['id', 'teamId', 'name', 'icon', 'color', 'description', 'status', 'members', 'startDate', 'endDate', 'createdBy', 'createdAt'],
    json: ['members'],
  },
  Tasks: {
    cols: ['id', 'title', 'description', 'status', 'priority', 'projectId', 'teams', 'assignees', 'tags',
      'startDate', 'dueDate', 'estimate', 'parentId', 'recurrence', 'sort', 'createdBy', 'createdAt',
      'updatedAt', 'completedAt', 'planDate', 'planStart', 'progress', 'spent', 'timerStart'],
    json: ['teams', 'assignees', 'tags'],
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
};

const Db = (function () {
  let spreadsheet = null;
  let memo = {};
  let txDepth = 0;
  let dirty = false;
  // Small, rarely changing tables are also kept in the script cache so most
  // requests skip a spreadsheet round trip. Every write drops the entry.
  const CACHED = { Users: 1, Teams: 1, Projects: 1, CompanyHolidays: 1 };
  const CACHE_TTL = 120;

  function cacheGet(table) {
    if (!CACHED[table]) return null;
    try {
      const raw = CacheService.getScriptCache().get('tbl_' + table);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cachePut(table, entries) {
    if (!CACHED[table]) return;
    try {
      const raw = JSON.stringify(entries);
      if (raw.length < 90000) CacheService.getScriptCache().put('tbl_' + table, raw, CACHE_TTL);
    } catch (e) { /* cache is optional */ }
  }
  function cacheDrop(table) {
    if (!CACHED[table]) return;
    try { CacheService.getScriptCache().remove('tbl_' + table); } catch (e) { /* optional */ }
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

  function load(table) {
    if (memo[table]) return memo[table];
    const cached = cacheGet(table);
    if (cached) { memo[table] = cached; return cached; }
    const d = def(table);
    const sh = sheet(table);
    const last = sh.getLastRow();
    const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, d.cols.length).getValues();
    const entries = [];
    rows.forEach((r, i) => {
      if (r[0] === '' || r[0] === null) return;
      entries.push({ obj: toObj(d, r), row: i + 2 });
    });
    memo[table] = entries;
    cachePut(table, entries);
    return entries;
  }

  function find(table, key) {
    const k = String(key);
    return load(table).find(e => String(e.obj[def(table).cols[0]]) === k) || null;
  }

  function tx(fn) {
    if (txDepth > 0) return fn();
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    txDepth++;
    memo = {};
    try {
      return fn();
    } finally {
      txDepth--;
      if (dirty) SpreadsheetApp.flush();
      dirty = false;
      lock.releaseLock();
    }
  }

  return {
    tx: tx,

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
        const e = find(table, key);
        if (!e) throw new Error('Eintrag nicht gefunden.');
        cacheDrop(table);
        dirty = true;
        const merged = Object.assign({}, e.obj, patch);
        merged[d.cols[0]] = e.obj[d.cols[0]];
        sheet(table).getRange(e.row, 1, 1, d.cols.length).setValues([toRow(d, merged)]);
        e.obj = merged;
        return merged;
      });
    },

    remove(table, key) {
      return tx(() => {
        const e = find(table, key);
        if (!e) return false;
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
      if (typeof Config !== 'undefined' && Config.reset) Config.reset();
    },
  };
})();
