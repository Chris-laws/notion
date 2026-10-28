/**
 * Documents and jour fixe minutes: written in the app, stored as Markdown files in the owner's Drive
 * (LidlFlow/Projects/<team>/<project>/...), metadata in the database. Versions protect against
 * silent overwrites, old versions can be restored, deleting only moves files to the Drive trash.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUT = 'fremd.person@firma.de';
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OUT].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Forecast', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Exception Handling', members: [] });
  return { app, team, project };
}
const D = app => app.ctx.DriveApp;
/** Folder names from the root down to a file. */
function pathOf(app, fileId) {
  const names = [];
  let x = D(app).getFileById(fileId);
  names.unshift(x.getName());
  for (let p = x.getParents(); p.hasNext();) { x = p.next(); names.unshift(x.getName()); p = x.getParents(); }
  return names.join('/');
}

describe('Drive storage', () => {
  test('a new document lands in LidlFlow/Projects/<team>/<project>/Documents as a Markdown file', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'Konzept', content: '# Konzept\n\nText' });
    assert.equal(pathOf(app, d.fileId), 'LidlFlow/Projects/Forecast/Exception Handling/Documents/Konzept.md');
    assert.equal(D(app).getFileById(d.fileId).getBlob().getDataAsString(), '# Konzept\n\nText');
    assert.equal(d.version, 1);
    assert.match(d.preview, /Konzept/);
    assert.ok(app.ctx.PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID'));
  });
  test('the root folder and the project folders are made once and reused', () => {
    const { app, project } = world();
    const a = app.call('docs.save', { projectId: project.id, title: 'A', content: 'a' });
    const b = app.call('docs.save', { projectId: project.id, title: 'B', content: 'b' });
    assert.equal(D(app).getFileById(a.fileId).getParents().next().getId(), D(app).getFileById(b.fileId).getParents().next().getId());
  });
  test('names with path characters cannot leave their folder', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: '../../Geheim/x', content: 'x' });
    assert.equal(pathOf(app, d.fileId), 'LidlFlow/Projects/Forecast/Exception Handling/Documents/..-..-Geheim-x.md');
  });
  test('renaming a project renames its folder; existing documents stay readable', () => {
    const { app, team, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'a' });
    app.call('projects.save', { id: project.id, teamId: team.id, name: 'Neuer Name', members: [] });
    assert.equal(pathOf(app, d.fileId), 'LidlFlow/Projects/Forecast/Neuer Name/Documents/A.md');
    assert.equal(app.call('docs.get', { id: d.id }).content, 'a');
  });
});

describe('documents', () => {
  test('saving with the version that was loaded writes a new version; the old one is kept', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'eins' });
    const d2 = app.as(ANNA).call('docs.save', { id: d.id, title: 'A', content: 'zwei', baseVersion: 1 });
    assert.equal(d2.version, 2);
    assert.equal(d2.updatedBy, ANNA);
    assert.equal(app.call('docs.get', { id: d.id }).content, 'zwei');
    const v = app.call('docs.versions', { id: d.id });
    assert.deepEqual(v.map(x => x.version), [1]);
  });
  test('saving on top of an older version is refused with the current text (never a silent overwrite)', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'eins' });
    app.as(ANNA).call('docs.save', { id: d.id, title: 'A', content: 'von Anna', baseVersion: 1 });
    const r = app.as(ME).call('docs.save', { id: d.id, title: 'A', content: 'von mir', baseVersion: 1 });
    assert.equal(r.conflict, true);
    assert.equal(r.current.content, 'von Anna');
    assert.equal(r.current.updatedBy, ANNA);
    assert.equal(app.call('docs.get', { id: d.id }).content, 'von Anna');
  });
  test('an older version can be restored as a new version', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'eins' });
    app.call('docs.save', { id: d.id, title: 'A', content: 'zwei', baseVersion: 1 });
    const r = app.call('docs.restore', { id: d.id, version: 1 });
    assert.equal(r.version, 3);
    assert.equal(app.call('docs.get', { id: d.id }).content, 'eins');
  });
  test('only the last 10 versions are kept; older ones go to the Drive trash', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'v1' });
    for (let i = 2; i <= 13; i++) app.call('docs.save', { id: d.id, title: 'A', content: 'v' + i, baseVersion: i - 1 });
    const v = app.call('docs.versions', { id: d.id });
    assert.equal(v.length, 10);
    assert.equal(v[0].version, 12, 'newest first');
    const first = app.sheet('DocVersions').data.slice(1).filter(r => r[0]).length;
    assert.equal(first, 10);
  });
  test('who is editing is shown to others for 5 minutes', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'x' });
    app.as(ANNA).call('docs.lock', { id: d.id });
    const seen = app.as(ME).call('docs.get', { id: d.id });
    assert.equal(seen.lockBy, ANNA);
    app.as(ANNA).call('docs.unlock', { id: d.id });
    assert.equal(app.as(ME).call('docs.get', { id: d.id }).lockBy, '');
  });
  test('deleting moves the file to the Drive trash and removes the entry', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'x' });
    app.call('docs.remove', { id: d.id });
    assert.equal(D(app).getFileById(d.fileId).isTrashed(), true);
    assert.equal(app.call('docs.list', { projectId: project.id }).length, 0);
  });
  test('people outside the project can neither list, read, write nor delete', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'Intern', content: 'vertraulich' });
    for (const [r, p] of [['docs.list', { projectId: project.id }], ['docs.get', { id: d.id }], ['docs.versions', { id: d.id }],
      ['docs.save', { id: d.id, title: 'x', content: 'x', baseVersion: 1 }], ['docs.save', { projectId: project.id, title: 'x', content: 'x' }],
      ['docs.remove', { id: d.id }], ['docs.restore', { id: d.id, version: 1 }], ['docs.lock', { id: d.id }]]) {
      const res = app.as(OUT).raw(r, p);
      assert.equal(res.ok, false, r);
      assert.doesNotMatch(JSON.stringify(res), /vertraulich|Intern/, r);
    }
    assert.equal(app.as(ME).call('docs.get', { id: d.id }).content, 'vertraulich');
  });
  test('very large texts are refused', () => {
    const { app, project } = world();
    assert.ok(app.error('docs.save', { projectId: project.id, title: 'A', content: 'x'.repeat(300001) }));
  });
  test('if the database write fails, the Drive file keeps its previous text', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'alt' });
    const upd = app.x.Db.update;
    app.x.Db.update = function (table) { if (table === 'Docs') throw new Error('Service error: Spreadsheets'); return upd.apply(this, arguments); };
    try { assert.ok(app.error('docs.save', { id: d.id, title: 'A', content: 'neu', baseVersion: 1 })); } finally { app.x.Db.update = upd; }
    assert.equal(D(app).getFileById(d.fileId).getBlob().getDataAsString(), 'alt');
    assert.equal(app.call('docs.get', { id: d.id }).version, 1);
  });
});

describe('jour fixe', () => {
  function series(app, project, extra) {
    return app.call('jf.saveSeries', Object.assign({ projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00',
      duration: 30, startDate: '2026-11-02', attendees: [ME, ANNA] }, extra || {}));
  }
  const S = app => app.x.Shared;
  /** Opens a meeting and saves its minutes (the first save creates the file). */
  function saveMeeting(app, s, date, edit) {
    const m = app.call('jf.meeting', { seriesId: s.id, date: date });
    const model = S(app).protoFromText(m.content);
    if (edit) edit(model);
    return app.call('docs.save', { projectId: m.projectId, seriesId: s.id, date: date, title: m.title, content: S(app).protoToText(model) });
  }
  const plain = v => JSON.parse(JSON.stringify(v));

  test('a series shows its meetings in the calendar of people who see the project', () => {
    const { app, project } = world();
    const s = series(app, project);
    const cal = app.call('calendar.range', { from: '2026-11-02', to: '2026-11-15' });
    const jf = cal.events.filter(e => e.type === 'jf');
    assert.deepEqual(jf.map(e => e.startDate), ['2026-11-02', '2026-11-09']);
    assert.equal(jf[0].seriesId, s.id);
    assert.equal(app.as(OUT).call('calendar.range', { from: '2026-11-02', to: '2026-11-15' }).events.filter(e => e.type === 'jf').length, 0);
  });
  test('opening a meeting writes nothing: a draft from the template with header and attendees', () => {
    const { app, project } = world();
    const s = series(app, project);
    const m = app.measure(() => app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' }));
    assert.ok(!m.driveWrite && !m.sheetWrite, 'no Drive or sheet writes when opening');
    const d = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    assert.equal(d.draft, true);
    const model = S(app).protoFromText(d.content);
    assert.equal(model.date, '2026-11-02');
    assert.deepEqual(plain(model.present), [ME, ANNA]);
    assert.equal(model.minuteTaker, ME);
  });
  test('the first save creates the file in Jour Fixe/<series>; opening again returns it', () => {
    const { app, project } = world();
    const s = series(app, project);
    const saved = saveMeeting(app, s, '2026-11-02', m => m.topics.push({ title: 'Budget', items: [{ type: 'I', text: 'Plan steht' }] }));
    assert.equal(pathOf(app, saved.fileId), 'LidlFlow/Projects/Forecast/Exception Handling/Jour Fixe/Weekly/2026-11-02 Weekly.md');
    const again = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    assert.equal(again.id, saved.id);
    assert.equal(S(app).protoFromText(again.content).topics[0].title, 'Budget');
    assert.equal(app.call('jf.list', { projectId: project.id }).meetings.length, 1);
  });
  test('two people saving the same new meeting never create two files', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02');
    const r = app.as(ANNA).call('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: 'x', content: 'x' });
    assert.equal(r.conflict, true);
    assert.equal(app.call('jf.list', { projectId: project.id }).meetings.length, 1);
  });
  test('open action items of the last meeting are carried over, done ones are not', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02', m => m.topics.push({ title: 'Angebote', items: [
      { type: 'A', text: 'Angebot einholen', owner: ANNA, due: '2026-11-06' }, { type: 'A', text: 'Raum buchen', done: true }, { type: 'I', text: 'Info' }] }));
    const next = S(app).protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2026-11-09' }).content);
    assert.equal(next.topics[0].title, 'Offene Punkte aus dem letzten Jour Fixe');
    assert.deepEqual(plain(next.topics[0].items.map(i => i.text)), ['Angebot einholen']);
    assert.equal(next.topics[0].items[0].owner, ANNA);
  });
  test('an action line becomes a project task once, and the line keeps the link', () => {
    const { app, project } = world();
    const s = series(app, project);
    const d = saveMeeting(app, s, '2026-11-02', m => m.topics.push({ title: 'Angebote', items: [{ type: 'A', text: 'Angebot einholen', owner: ANNA, due: '2026-11-06' }] }));
    const r = app.call('jf.actionToTask', { docId: d.id, topic: 0, item: 0 });
    assert.equal(r.task.projectId, project.id);
    assert.deepEqual(plain(r.task.assignees), [ANNA]);
    assert.equal(r.task.dueDate, '2026-11-06');
    assert.equal(S(app).protoFromText(app.call('docs.get', { id: d.id }).content).topics[0].items[0].taskId, r.task.id);
    assert.ok(app.error('jf.actionToTask', { docId: d.id, topic: 0, item: 0 }), 'not twice');
  });
  test('people outside the project cannot see, open or change a series', () => {
    const { app, project } = world();
    const s = series(app, project);
    assert.ok(app.as(OUT).error('jf.meeting', { seriesId: s.id, date: '2026-11-02' }));
    assert.ok(app.as(OUT).error('jf.saveSeries', { id: s.id, projectId: project.id, title: 'x', rhythm: 'weekly', weekday: 1 }));
    assert.ok(app.as(OUT).error('jf.list', { projectId: project.id }));
    assert.ok(app.as(OUT).error('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: 'x', content: 'x' }));
  });
  test('the tab loads series, minutes and documents in one call without touching Drive', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02');
    app.call('docs.save', { projectId: project.id, title: 'Konzept', content: 'x' });
    app.x.Db.reset();
    let r;
    const m = app.measure(() => { r = app.call('jf.list', { projectId: project.id }); });
    assert.ok(!m.driveRead && !m.driveWrite, 'no Drive call: ' + JSON.stringify(m));
    assert.equal(r.series.length, 1);
    assert.equal(r.meetings.length, 1);
    assert.equal(r.docs.length, 1);
  });
  test('without the Drive permission the message says what to do', () => {
    const { app, project } = world();
    app.ctx.__DRIVE_DENIED__ = true;
    const err = app.error('docs.save', { projectId: project.id, title: 'A', content: 'x' });
    app.ctx.__DRIVE_DENIED__ = false;
    assert.match(err, /setup/);
  });
  test('ending a series keeps all its minutes', () => {
    const { app, project } = world();
    const s = series(app, project);
    const d = saveMeeting(app, s, '2026-11-02');
    app.call('jf.removeSeries', { id: s.id });
    assert.equal(app.call('docs.get', { id: d.id }).id, d.id);
    assert.equal(app.call('calendar.range', { from: '2026-11-02', to: '2026-11-15' }).events.filter(e => e.type === 'jf').length, 0);
  });
});
