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
  return { app: flushing(app), team, project };
}
/**
 * Saving writes the database; Drive follows with docs.flush, which the page sends right after
 * (see jf-fast.test.js). These tests look at the state once Drive has caught up.
 */
function flushing(app) {
  const call = app.call;
  app.call = (m, p) => {
    const r = call(m, p);
    if (m !== 'docs.save' || !r || !r.id || r.conflict) return r;
    call('docs.flush', { id: r.id });
    return Object.assign({}, r, { fileId: app.x.Db.get('Docs', r.id).fileId });
  };
  return app;
}
const D = app => app.ctx.DriveApp;
/** Saves (that works without Drive) and returns what the flush answered when Drive refused. */
function driveError(app, project) {
  const r = app.call('docs.save', { projectId: project.id, title: 'A', content: 'x' });
  assert.equal(app.call('docs.get', { id: r.id }).content, 'x', 'saved and readable');
  const f = app.call('docs.flush', { id: r.id });
  assert.equal(f.pending, 1, 'still pending, tried again next time');
  return f.error;
}
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
    assert.deepEqual(JSON.parse(JSON.stringify(v.map(x => x.version))), [2, 1], 'the current version on top, the earlier one below');
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
  test('the last 50 earlier versions are kept; older ones go to the Drive trash', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'v1' });
    for (let i = 2; i <= 53; i++) app.call('docs.save', { id: d.id, title: 'A', content: 'v' + i, baseVersion: i - 1 });
    const v = app.call('docs.versions', { id: d.id });
    assert.equal(v.length, 51, 'the current one plus 50 earlier ones');
    assert.equal(v[0].version, 53, 'newest first, the current one on top');
    assert.equal(v[0].current, true);
    assert.equal(app.sheet('DocVersions').data.slice(1).filter(r => r[0]).length, 50);
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
    assert.ok(app.error('docs.get', { id: d.id }), 'the entry is gone');
  });
  test('people outside the project can neither list, read, write nor delete', () => {
    const { app, project } = world();
    const d = app.call('docs.save', { projectId: project.id, title: 'Intern', content: 'vertraulich' });
    for (const [r, p] of [['docs.get', { id: d.id }], ['docs.versions', { id: d.id }],
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
    assert.equal(app.call('jf.list', { projectId: project.id }).minutes.length, 1);
  });
  test('two people saving the same new meeting never create two files', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02');
    const r = app.as(ANNA).call('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: 'x', content: 'x' });
    assert.equal(r.conflict, true);
    assert.equal(app.call('jf.list', { projectId: project.id }).minutes.length, 1);
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
    const topic = S(app).protoFromText(app.call('docs.get', { id: d.id }).content).topics[0];
    const line = topic.items[0];
    const req = id => ({ docId: d.id, topicId: topic.id, projectId: project.id, item: true, requestId: id, items: [{ itemId: line.id, title: line.text, assignees: [line.owner], dueDate: line.due }] });
    const task = app.call('jf.makeTasks', req('a')).tasks[0];
    assert.equal(task.projectId, project.id);
    assert.deepEqual(plain(task.assignees), [ANNA]);
    assert.equal(task.dueDate, '2026-11-06');
    assert.equal(S(app).protoFromText(app.call('docs.get', { id: d.id }).content).topics[0].items[0].taskId, task.id);
    assert.ok(app.error('jf.makeTasks', req('b')), 'not twice');
  });
  test('people outside the project cannot see, open or change a series', () => {
    const { app, project } = world();
    const s = series(app, project);
    assert.ok(app.as(OUT).error('jf.meeting', { seriesId: s.id, date: '2026-11-02' }));
    assert.ok(app.as(OUT).error('jf.saveSeries', { id: s.id, projectId: project.id, title: 'x', rhythm: 'weekly', weekday: 1 }));
    assert.ok(app.as(OUT).error('jf.list', { projectId: project.id }));
    assert.ok(app.as(OUT).error('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: 'x', content: 'x' }));
  });
  test('the tab loads series and minutes in one call without touching Drive', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02');
    app.call('docs.save', { projectId: project.id, title: 'Konzept', content: 'x' });
    app.x.Db.reset();
    let r;
    const m = app.measure(() => { r = app.call('jf.list', { projectId: project.id }); });
    assert.ok(!m.driveRead && !m.driveWrite, 'no Drive call: ' + JSON.stringify(m));
    assert.equal(r.series.length, 1);
    assert.equal(r.minutes.length, 1);
  });
  test('without the Drive permission the save still holds; the flush says what to do', () => {
    const { app, project } = world();
    app.ctx.__DRIVE_DENIED__ = true;
    const err = driveError(app, project);
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

describe('jour fixe: fast and complete (v48)', () => {
  function series(app, project, extra) {
    return app.call('jf.saveSeries', Object.assign({ projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00',
      duration: 30, startDate: '2026-11-02', attendees: [ME, ANNA, LEA] }, extra || {}));
  }
  const S = app => app.x.Shared;
  const plain = v => JSON.parse(JSON.stringify(v));
  function saveMeeting(app, s, date, edit) {
    const m = app.call('jf.meeting', { seriesId: s.id, date: date });
    const model = S(app).protoFromText(m.content);
    if (edit) edit(model);
    return app.call('docs.save', { projectId: m.projectId, seriesId: s.id, date: date, title: m.title, content: S(app).protoToText(model) });
  }
  test('the app start brings the series and the minutes list along: the tab needs no call of its own', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02', m => { m.present = [ME]; m.absent = [ANNA]; });
    const b = app.call('bootstrap');
    assert.equal(b.jf.series.length, 1);
    assert.equal(b.jf.minutes.length, 1);
    assert.deepEqual(plain(b.jf.minutes[0].people), { present: [ME], absent: [ANNA] }, 'who was there and who missed it, without opening the file');
    assert.equal(app.as(OUT).call('bootstrap').jf.series.length, 0, 'only series of visible projects');
  });
  test('a new meeting opens without reading any file: open items of the last meeting come from the table', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02', m => m.topics.push({ title: 'Angebote', items: [{ type: 'A', text: 'Angebot einholen', owner: ANNA }] }));
    app.x.Db.reset();
    let next;
    const m = app.measure(() => { next = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-09' }); });
    assert.ok(!m.driveRead && !m.driveWrite, 'no Drive: ' + JSON.stringify(m));
    assert.deepEqual(plain(S(app).protoFromText(next.content).topics[0].items.map(i => i.text)), ['Angebot einholen']);
  });
  test('saved minutes are read from Drive once, then from the cache until they change', () => {
    const { app, project } = world();
    const s = series(app, project);
    saveMeeting(app, s, '2026-11-02');
    app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    app.x.Db.reset();
    const m = app.measure(() => app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' }));
    assert.ok(!m.driveRead, 'second open from the cache: ' + JSON.stringify(m));
  });
  test('plain documents are gone from the API; minutes keep working', () => {
    const { app } = world();
    assert.match(app.error('docs.list', {}), /Unbekannte Aktion/);
  });
});

describe('jour fixe: two people writing the same minutes at the same time', () => {
  const S = app => app.x.Shared;
  function setup2() {
    const { app, project } = world();
    const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, startDate: '2026-11-02', attendees: [ME, ANNA] });
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const model = S(app).protoFromText(m.content);
    model.topics.push({ id: 't1', title: 'Budget', items: [{ id: 'l1', type: 'I', text: 'Plan' }] });
    const v1 = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: m.title, content: S(app).protoToText(model) });
    const base = app.call('docs.get', { id: v1.id }).content;
    return { app, v1, base };
  }
  const change = (app, text, fn) => { const m = app.x.Shared.protoFromText(text); fn(m); return app.x.Shared.protoToText(m); };
  test('different topics from both: merged automatically, nobody sees a conflict', () => {
    const { app, v1, base } = setup2();
    app.as(ANNA).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: change(app, base, m => m.topics.push({ id: 't2', title: 'Von Anna', items: [] })) });
    const r = app.as(ME).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: change(app, base, m => m.topics.push({ id: 't3', title: 'Von mir', items: [] })) });
    assert.equal(r.merged, true);
    assert.equal(r.version, 3);
    const saved = S(app).protoFromText(app.call('docs.get', { id: v1.id }).content);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.topics.map(t => t.title))), ['Budget', 'Von Anna', 'Von mir']);
  });
  test('the same line changed by both: the conflict dialog with both versions, nothing overwritten', () => {
    const { app, v1, base } = setup2();
    app.as(ANNA).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: change(app, base, m => { m.topics[0].items[0].text = 'Annas Plan'; }) });
    const r = app.as(ME).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: change(app, base, m => { m.topics[0].items[0].text = 'Mein Plan'; }) });
    assert.equal(r.conflict, true);
    assert.deepEqual(JSON.parse(JSON.stringify(r.conflicts)), ['topics.t1.items.l1.text']);
    assert.equal(S(app).protoFromText(app.call('docs.get', { id: v1.id }).content).topics[0].items[0].text, 'Annas Plan');
  });
});

describe('jour fixe: version history of minutes', () => {
  const S = app => app.x.Shared;
  function minutes() {
    const { app, project } = world();
    const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, startDate: '2026-11-02', attendees: [ME, ANNA] });
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const model = S(app).protoFromText(m.content);
    model.topics.push({ id: 't1', title: 'Budget', items: [{ id: 'l1', type: 'I', text: 'Plan' }] });
    const v1 = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: m.title, content: S(app).protoToText(model) });
    return { app, s, v1 };
  }
  const edit = (app, id, base, fn) => {
    const d = app.call('docs.get', { id: id });
    const model = S(app).protoFromText(d.content);
    fn(model);
    return app.call('docs.save', { id: id, title: d.title, baseVersion: base, baseContent: d.content, content: S(app).protoToText(model) });
  };
  test('every version says who changed what; any version can be viewed', () => {
    const { app, v1 } = minutes();
    app.as(ANNA);
    edit(app, v1.id, 1, m => { m.topics.push({ id: 't2', title: 'Personal', items: [{ id: 'l2', type: 'A', text: 'Stelle' }] }); m.topics[0].items[0].text = 'Plan neu'; });
    const list = app.as(ME).call('docs.versions', { id: v1.id });
    assert.deepEqual(list.map(v => [v.version, v.by]), [[2, ANNA], [1, ME]]);
    assert.deepEqual(JSON.parse(JSON.stringify(list[0].change)), { topics: 1, lines: 1, changed: 1, removed: 0, header: false });
    const old = app.call('docs.version', { id: v1.id, version: 1 });
    assert.equal(S(app).protoFromText(old.content).topics[0].items[0].text, 'Plan');
    assert.equal(S(app).protoFromText(app.call('docs.version', { id: v1.id, version: 2 }).content).topics.length, 2, 'the current version too');
  });
  test('past minutes stay editable for everyone who may change the project; restoring adds a version', () => {
    const { app, s, v1 } = minutes();
    const later = app.as(ANNA).call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    assert.equal(later.canWrite, true);
    edit(app, v1.id, 1, m => { m.topics[0].title = 'Budget 2027'; });
    const r = app.call('docs.restore', { id: v1.id, version: 1 });
    assert.equal(r.version, 3);
    assert.equal(S(app).protoFromText(app.call('docs.get', { id: v1.id }).content).topics[0].title, 'Budget');
    assert.equal(app.call('docs.versions', { id: v1.id }).length, 3, 'nothing lost');
  });
  test('people outside the project see no versions', () => {
    const { app, v1 } = minutes();
    assert.ok(app.as(OUT).error('docs.version', { id: v1.id, version: 1 }));
    assert.ok(app.as(OUT).error('docs.versions', { id: v1.id }));
  });
});

describe('jour fixe: review findings (v49)', () => {
  const S = app => app.x.Shared;
  function opened() {
    const { app, project } = world();
    const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, startDate: '2026-11-02', attendees: [ME, ANNA] });
    return { app, project, s };
  }
  const withTopic = (app, text, id, title) => { const m = S(app).protoFromText(text); m.topics.push({ id: id, title: title, items: [] }); return S(app).protoToText(m); };
  test('"keep mine" after a conflict keeps the other changes of the other person (only the clashing field is mine)', () => {
    const { app, project, s } = opened();
    const d = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const m0 = S(app).protoFromText(d.content);
    m0.topics.push({ id: 't1', title: 'Budget', items: [] });
    const v1 = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: d.date, title: d.title, content: S(app).protoToText(m0) });
    const base = app.call('docs.get', { id: v1.id }).content;
    const anna = S(app).protoFromText(base); anna.topics[0].title = 'Annas Titel'; anna.topics.push({ id: 't2', title: 'Anna extra', items: [] });
    app.as(ANNA).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: S(app).protoToText(anna) });
    const mine = S(app).protoFromText(base); mine.topics[0].title = 'Mein Titel';
    const r = app.as(ME).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: base, content: S(app).protoToText(mine) });
    assert.equal(r.conflict, true);
    assert.ok(r.merged, 'the merge with mine winning the clash comes along');
    // "Meine Fassung speichern" saves that merge on top of the current version
    app.as(ME).call('docs.save', { id: v1.id, title: v1.title, baseVersion: r.current.version, baseContent: r.current.content, content: r.merged });
    const final = S(app).protoFromText(app.call('docs.get', { id: v1.id }).content);
    assert.deepEqual(JSON.parse(JSON.stringify(final.topics.map(t => t.title))), ['Mein Titel', 'Anna extra']);
  });
  test('two people starting the same new minutes with different topics: merged, no dialog', () => {
    const { app, project, s } = opened();
    const a = app.as(ANNA).call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const b = app.as(ME).call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    app.as(ANNA).call('docs.save', { projectId: project.id, seriesId: s.id, date: a.date, title: a.title, baseContent: a.content, content: withTopic(app, a.content, 'ta', 'Von Anna') });
    const r = app.as(ME).call('docs.save', { projectId: project.id, seriesId: s.id, date: b.date, title: b.title, baseContent: b.content, content: withTopic(app, b.content, 'tb', 'Von mir') });
    assert.ok(!r.conflict, JSON.stringify(r.conflicts));
    const final = S(app).protoFromText(app.call('docs.get', { id: r.id }).content);
    assert.deepEqual(JSON.parse(JSON.stringify(final.topics.map(t => t.title))), ['Von Anna', 'Von mir']);
  });
  test('"Als Aufgabe" finds the line by its id, even after someone inserted a line above it', () => {
    const { app, project, s } = opened();
    const d = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const m = S(app).protoFromText(d.content);
    m.topics.push({ id: 't1', title: 'X', items: [{ id: 'mine', type: 'A', text: 'Meine Aufgabe' }] });
    const v1 = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: d.date, title: d.title, content: S(app).protoToText(m) });
    m.topics[0].items.unshift({ id: 'other', type: 'A', text: 'Andere' });
    app.as(ANNA).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, content: S(app).protoToText(m) });
    const r = app.as(ME).call('jf.makeTasks', { docId: v1.id, topicId: 't1', projectId: project.id, item: true, requestId: 'm', items: [{ itemId: 'mine', title: 'Meine Aufgabe' }] });
    const lines = S(app).protoFromText(app.call('docs.get', { id: v1.id }).content).topics[0].items;
    assert.equal(lines.find(i => i.id === 'mine').taskId, r.tasks[0].id);
    assert.equal(lines.find(i => i.id === 'other').taskId, '');
  });
  test('a conflict hands back the current version with the right to edit it', () => {
    const { app, project, s } = opened();
    const d = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const v1 = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: d.date, title: d.title, content: d.content });
    const t = app.call('docs.get', { id: v1.id }).content;
    const x = S(app).protoFromText(t); x.minuteTaker = ANNA;
    app.as(ANNA).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: t, content: S(app).protoToText(x) });
    const y = S(app).protoFromText(t); y.minuteTaker = LEA;
    const r = app.as(ME).call('docs.save', { id: v1.id, title: v1.title, baseVersion: 1, baseContent: t, content: S(app).protoToText(y) });
    assert.equal(r.conflict, true);
    assert.equal(r.current.canWrite, true);
  });
});

describe('Drive through the built-in Drive service (no UrlFetchApp)', () => {
  test('minutes are created, read, updated and trashed through Drive.Files when that service is on', () => {
    const { app, project } = world();
    app.ctx.Drive = app.ctx.__driveAdvanced();
    app.ctx.__DRIVE_DENIED__ = true; // external requests blocked: only the Drive service may work
    try {
      const d = app.call('docs.save', { projectId: project.id, title: 'A', content: 'eins' });
      assert.equal(pathOf(app, d.fileId), 'LidlFlow/Projects/Forecast/Exception Handling/Documents/A.md');
      app.x.Db.reset();
      app.ctx.CacheService.getScriptCache().remove('docv:' + d.id + ':1');
      assert.equal(app.call('docs.get', { id: d.id }).content, 'eins');
      app.call('docs.save', { id: d.id, title: 'A', content: 'zwei', baseVersion: 1 });
      assert.equal(D(app).getFileById(d.fileId).getBlob().getDataAsString(), 'zwei');
      app.call('docs.remove', { id: d.id });
      assert.equal(D(app).getFileById(d.fileId).isTrashed(), true);
    } finally { app.ctx.__DRIVE_DENIED__ = false; delete app.ctx.Drive; }
  });
  test('a permission error of the Drive service says to run setup', () => {
    const { app, project } = world();
    const denied = () => { throw new Error('API call to drive.files failed with error: Insufficient Permission'); };
    app.ctx.Drive = { Files: { list: denied, get: denied, create: denied, update: denied } };
    try { assert.match(driveError(app, project), /setup/); } finally { delete app.ctx.Drive; }
  });
});

describe('Drive errors say what Google answered', () => {
  test('the reason from Google (e.g. Drive API not enabled) is part of the message', () => {
    const { app, project } = world();
    app.ctx.__DRIVE_DENIED__ = 'Google Drive API has not been used in project 123 before or it is disabled.';
    let err;
    try { err = driveError(app, project); } finally { app.ctx.__DRIVE_DENIED__ = false; }
    assert.match(err, /setup/);
    assert.match(err, /Google 403: Google Drive API has not been used/);
  });
});

describe('jour fixe v54: anchors, topic tasks', () => {
  const S = app => app.x.Shared;
  function saved(edit) {
    const { app, project } = world();
    const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, startDate: '2026-11-02', attendees: [ME, ANNA] });
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const model = S(app).protoFromText(m.content);
    edit(model);
    const d = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: '2026-11-02', title: m.title, content: S(app).protoToText(model) });
    return { app, project, s, d };
  }
  test('an anchored topic comes back in the next minutes until the anchor is removed', () => {
    const { app, s, d } = saved(m => m.topics.push({ id: 'p1', title: 'Dauerthema', pinned: true, items: [] }, { id: 'n1', title: 'Einmalig', items: [] }));
    const next = S(app).protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2026-11-09' }).content);
    assert.deepEqual(JSON.parse(JSON.stringify(next.topics.map(t => [t.title, t.pinned]))), [['Dauerthema', true]]);
    const cur = app.call('docs.get', { id: d.id });
    const unpinned = S(app).protoFromText(cur.content); unpinned.topics[0].pinned = false;
    app.call('docs.save', { id: d.id, title: d.title, baseVersion: cur.version, content: S(app).protoToText(unpinned) });
    assert.equal(S(app).protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2026-11-09' }).content).topics.length, 0);
  });
});
