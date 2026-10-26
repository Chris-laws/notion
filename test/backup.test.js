/**
 * Weekly backups into a separate spreadsheet (no extra permission): one sheet per table and date,
 * the last 8 dates are kept, admins can back up by hand and see the last backup; restore is an
 * editor-only function that first backs up the current state.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

function app0() {
  const app = freshApp();
  // the first person signed in becomes admin: the owner first, then a member
  app.as(ME).call('bootstrap');
  app.as(ANNA).call('bootstrap');
  app.as(ME);
  const team = app.call('teams.save', { name: 'Forecast', members: [ME] });
  app.call('tasks.save', { title: 'Eins', assignees: [ME] });
  app.call('tasks.save', { title: 'Zwei', assignees: [ME] });
  return { app, team };
}
const backupSheets = app => {
  const id = app.ctx.PropertiesService.getScriptProperties().getProperty('BACKUP_SPREADSHEET_ID');
  return app.ctx.SpreadsheetApp.openById(id).getSheets().map(s => s.getName());
};
const rows = (app, name) => app.sheet(name).data.slice(1).filter(r => r[0] !== '' && r[0] !== undefined);

describe('backup', () => {
  test('backupDatabase() copies every table into the backup spreadsheet under the date', () => {
    const { app } = app0();
    const res = app.ctx.backupDatabase();
    const names = backupSheets(app);
    ['Users', 'Teams', 'Projects', 'Tasks', 'Comments', 'Events', 'Absences', 'CompanyHolidays'].forEach(t =>
      assert.ok(names.indexOf(res.date + ' ' + t) >= 0, t));
    assert.ok(names.indexOf(res.date + ' Journal') < 0, 'the journal is not part of a backup');
    assert.ok(names.indexOf('Backups') >= 0, 'an index sheet lists every backup');
    assert.equal(res.rows.Tasks, 2);
  });
  test('a second backup on the same day replaces that day; only the last 8 dates are kept', () => {
    const { app } = app0();
    const S = app.x;
    for (let i = 0; i < 10; i++) app.ctx.backupDatabase('2026-0' + (1 + Math.floor(i / 3)) + '-1' + (i % 3));
    app.ctx.backupDatabase('2026-04-10');
    const dates = [...new Set(backupSheets(app).filter(n => /^\d{4}-/.test(n)).map(n => n.slice(0, 10)))];
    assert.equal(dates.length, 8);
    assert.ok(dates.indexOf('2026-01-10') < 0, 'the oldest dates are gone');
    assert.ok(S);
  });
  test('admins can back up from the app and see the last backup; others cannot', () => {
    const { app } = app0();
    assert.equal(app.call('backup.status').last, null);
    const r = app.call('backup.run');
    const st = app.call('backup.status');
    assert.equal(st.last.date, r.date);
    assert.ok(st.url);
    assert.ok(app.as(ANNA).error('backup.run'));
    assert.ok(app.as(ANNA).error('backup.status'));
  });
  test('restoreBackup() brings back a date, after backing up the current state first', () => {
    const { app } = app0();
    const b = app.ctx.backupDatabase('2026-01-05');
    app.as(ME).call('tasks.save', { title: 'Drei', assignees: [ME] });
    const t = rows(app, 'Tasks')[0];
    app.call('tasks.remove', { id: t[0] });
    assert.equal(rows(app, 'Tasks').length, 2);
    app.ctx.restoreBackup(b.date);
    assert.deepEqual(rows(app, 'Tasks').map(r => String(r[1])).sort().join('|'), 'Eins|Zwei');
    assert.ok(backupSheets(app).some(n => / Tasks$/.test(n) && n.slice(0, 10) !== '2026-01-05'), 'the state before the restore was saved');
    // the app sees the restored data (caches dropped)
    assert.deepEqual(JSON.parse(JSON.stringify(app.call('bootstrap').tasks.map(x => x.title).sort())), ['Eins', 'Zwei']);
  });
  test('restoring an unknown date changes nothing', () => {
    const { app } = app0();
    assert.throws(() => app.ctx.restoreBackup('1999-01-01'), /1999-01-01/);
    assert.equal(rows(app, 'Tasks').length, 2);
  });
});

describe('backup on the settings page', () => {
  test('admins see the last backup and can back up now', async () => {
    const { bootApp, wait } = require('../dev/checks/dom');
    const w = await bootApp({ lang: 'de' });
    try {
      w.eval("go('settings')");
      await wait(400);
      const btn = w.document.querySelector('[data-action="backup-run"]');
      assert.ok(btn, 'button shown');
      assert.match(w.document.querySelector('#view').textContent, /Datensicherung/);
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await wait(500);
      assert.match(w.document.querySelector('#view').textContent, /Letztes Backup/);
    } finally { w.close(); }
  });
});
