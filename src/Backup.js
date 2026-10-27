/**
 * Backups of the database into a second spreadsheet "LidlFlow – Backups" (created on the first run,
 * its id in the script property BACKUP_SPREADSHEET_ID). Each backup copies every table into a sheet
 * named "<date> <table>"; the sheet "Backups" lists them. The last KEEP dates are kept.
 * Needs no permission beyond the spreadsheets one the app already has.
 *
 * Weekly: in the Apps Script editor, Triggers -> Add trigger -> backupDatabase, time-driven, week timer.
 * Restore: run restoreBackup('YYYY-MM-DD') in the editor; it backs up the current state first.
 */
const Backup = {
  KEEP: 8,
  // tables worth keeping (the journal and the holiday cache are rebuilt by the app)
  TABLES: ['Users', 'Teams', 'Projects', 'Tasks', 'Comments', 'Events', 'Absences', 'CompanyHolidays', 'Docs', 'DocVersions', 'JfSeries', 'Folders'],
  INDEX: ['date', 'createdAt', 'by', 'rows'],

  target_() {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('BACKUP_SPREADSHEET_ID');
    if (id) {
      try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted: start a new one */ }
    }
    const ss = SpreadsheetApp.create('LidlFlow – Backups');
    props.setProperty('BACKUP_SPREADSHEET_ID', ss.getId());
    return ss;
  },

  index_(ss) {
    let sh = ss.getSheetByName('Backups');
    if (!sh) {
      sh = ss.insertSheet('Backups');
      sh.getRange(1, 1, 1, Backup.INDEX.length).setValues([Backup.INDEX]);
    }
    return sh;
  },

  /** Copies all tables (consistent: under the write lock) and drops dates beyond KEEP. */
  run(date) {
    date = Shared.isDate(date) ? date : Util.today();
    const db = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
    const data = {};
    Db.tx(() => Backup.TABLES.forEach(t => {
      const sh = db.getSheetByName(t);
      const cols = SCHEMA[t].cols.length;
      data[t] = sh && sh.getLastRow() > 0 ? sh.getRange(1, 1, sh.getLastRow(), cols).getValues() : [SCHEMA[t].cols];
    }));
    const ss = Backup.target_();
    const rows = {};
    Backup.TABLES.forEach(t => {
      const name = date + ' ' + t;
      const old = ss.getSheetByName(name);
      if (old) ss.deleteSheet(old);
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, data[t].length, data[t][0].length).setNumberFormat('@').setValues(data[t]);
      rows[t] = data[t].length - 1;
    });
    const index = Backup.index_(ss);
    const by = Session.getActiveUser().getEmail() || 'trigger';
    const keep = Backup.dates_(ss).filter(d => d !== date).concat([date]).sort().slice(-Backup.KEEP);
    Backup.dates_(ss).filter(d => keep.indexOf(d) < 0).forEach(d => Backup.TABLES.forEach(t => {
      const sh = ss.getSheetByName(d + ' ' + t);
      if (sh) ss.deleteSheet(sh);
    }));
    // index: one line per kept date, newest first
    const lines = Backup.list_(index).filter(l => keep.indexOf(l[0]) >= 0 && l[0] !== date)
      .concat([[date, new Date().toISOString(), by, JSON.stringify(rows)]])
      .sort((a, b) => (a[0] < b[0] ? 1 : -1));
    if (index.getLastRow() > 1) index.getRange(2, 1, index.getLastRow() - 1, Backup.INDEX.length).clearContent();
    if (lines.length) index.getRange(2, 1, lines.length, Backup.INDEX.length).setNumberFormat('@').setValues(lines);
    console.log('backup ' + date + ': ' + JSON.stringify(rows));
    return { date: date, rows: rows, url: ss.getUrl() };
  },

  dates_(ss) {
    const out = [];
    ss.getSheets().forEach(sh => {
      const m = /^(\d{4}-\d{2}-\d{2}) /.exec(sh.getName());
      if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
    });
    return out.sort();
  },

  list_(index) {
    const last = index.getLastRow();
    return last < 2 ? [] : index.getRange(2, 1, last - 1, Backup.INDEX.length).getValues().filter(l => l[0]).map(l => l.map(String));
  },

  /** Last backup and where the backups are (admins only). */
  status() {
    if (!Auth.isAdmin(Auth.currentUser())) throw new Error('Nur Admins können Backups verwalten.');
    const id = PropertiesService.getScriptProperties().getProperty('BACKUP_SPREADSHEET_ID');
    if (!id) return { last: null, count: 0, url: '' };
    const ss = Backup.target_();
    const list = Backup.list_(Backup.index_(ss));
    const last = list[0];
    return {
      last: last ? { date: last[0], at: last[1], by: last[2] } : null,
      count: Backup.dates_(ss).length, keep: Backup.KEEP, url: ss.getUrl(),
    };
  },

  /** "Jetzt sichern" on the settings page (admins only). */
  runNow() {
    if (!Auth.isAdmin(Auth.currentUser())) throw new Error('Nur Admins können Backups verwalten.');
    return Backup.run();
  },

  /** Writes the tables of one backup date back (under the lock); the current state is backed up first. */
  restore(date) {
    const ss = Backup.target_();
    if (Backup.dates_(ss).indexOf(date) < 0) throw new Error('Kein Backup vom ' + date + ' gefunden.');
    const stamp = Util.today() === date ? Shared.addDays(date, 1) : Util.today();
    Backup.run(stamp);
    const db = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
    Db.tx(() => Backup.TABLES.forEach(t => {
      const src = ss.getSheetByName(date + ' ' + t);
      const sh = db.getSheetByName(t);
      if (!src || !sh) return;
      const cols = SCHEMA[t].cols.length;
      const values = src.getLastRow() > 1 ? src.getRange(2, 1, src.getLastRow() - 1, cols).getValues() : [];
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols).clearContent();
      if (values.length) sh.getRange(2, 1, values.length, cols).setValues(values);
      Db.touch(t);
    }));
    console.warn('restored backup ' + date + ' (state before it saved as ' + stamp + ')');
    return { restored: date, savedBefore: stamp };
  },
};

/** Run weekly by a time-driven trigger (see above); also callable from the editor. */
function backupDatabase(date) {
  return Backup.run(date);
}

/** Run from the editor only: restoreBackup('2026-10-25'). */
function restoreBackup(date) {
  return Backup.restore(date);
}
