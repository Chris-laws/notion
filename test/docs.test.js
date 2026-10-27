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
  test('a series shows its meetings in the calendar of people who see the project', () => {
    const { app, project } = world();
    const s = series(app, project);
    const cal = app.call('calendar.range', { from: '2026-11-02', to: '2026-11-15' });
    const jf = cal.events.filter(e => e.type === 'jf');
    assert.deepEqual(jf.map(e => e.startDate), ['2026-11-02', '2026-11-09']);
    assert.equal(jf[0].seriesId, s.id);
    assert.equal(app.as(OUT).call('calendar.range', { from: '2026-11-02', to: '2026-11-15' }).events.filter(e => e.type === 'jf').length, 0);
  });
  test('opening a meeting creates its minutes once, from the template, in Jour Fixe/<series>', () => {
    const { app, project } = world();
    const s = series(app, project);
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const again = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    assert.equal(again.id, m.id);
    assert.equal(pathOf(app, m.fileId), 'LidlFlow/Projects/Forecast/Exception Handling/Jour Fixe/Weekly/2026-11-02 Weekly.md');
    const text = app.call('docs.get', { id: m.id }).content;
    ['## Agenda', '## Teilnehmende', '## Notizen', '## Beschlüsse', '## Action Items'].forEach(h => assert.ok(text.indexOf(h) >= 0, h));
    assert.ok(text.indexOf('Anna Schmidt') >= 0 || text.indexOf(ANNA) >= 0, 'attendees listed');
  });
  test('open action items of the last meeting are carried over, done ones are not', () => {
    const { app, project } = world();
    const s = series(app, project);
    const m1 = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const c = app.call('docs.get', { id: m1.id });
    app.call('docs.save', { id: m1.id, title: m1.title, baseVersion: c.version,
      content: c.content.replace('## Action Items', '## Action Items\n- [ ] Angebot einholen @' + ANNA + ' !2026-11-06\n- [x] Raum buchen') });
    const m2 = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-09' });
    const t2 = app.call('docs.get', { id: m2.id }).content;
    assert.match(t2, /## Offene Punkte vom letzten Jour Fixe[\s\S]*- \[ \] Angebot einholen @anna\.schmidt@firma\.de !2026-11-06/);
    assert.doesNotMatch(t2, /Raum buchen/);
  });
  test('an action item becomes a project task once, and the line links to it', () => {
    const { app, project } = world();
    const s = series(app, project);
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    const c = app.call('docs.get', { id: m.id });
    app.call('docs.save', { id: m.id, title: m.title, baseVersion: c.version, content: c.content + '\n- [ ] Angebot einholen @' + ANNA + ' !2026-11-06' });
    const r = app.call('jf.actionToTask', { docId: m.id, text: 'Angebot einholen' });
    assert.equal(r.task.projectId, project.id);
    assert.deepEqual(JSON.parse(JSON.stringify(r.task.assignees)), [ANNA]);
    assert.equal(r.task.dueDate, '2026-11-06');
    assert.match(app.call('docs.get', { id: m.id }).content, new RegExp('Angebot einholen @' + ANNA.replace(/\./g, '\\.') + ' !2026-11-06 ⟶ #' + r.task.id));
    assert.ok(app.error('jf.actionToTask', { docId: m.id, text: 'Angebot einholen' }), 'not twice');
  });
  test('people outside the project cannot see, open or change a series', () => {
    const { app, project } = world();
    const s = series(app, project);
    assert.ok(app.as(OUT).error('jf.meeting', { seriesId: s.id, date: '2026-11-02' }));
    assert.ok(app.as(OUT).error('jf.saveSeries', { id: s.id, projectId: project.id, title: 'x', rhythm: 'weekly', weekday: 1 }));
    assert.ok(app.as(OUT).error('jf.list', { projectId: project.id }));
  });
  test('ending a series keeps all its minutes', () => {
    const { app, project } = world();
    const s = series(app, project);
    const m = app.call('jf.meeting', { seriesId: s.id, date: '2026-11-02' });
    app.call('jf.removeSeries', { id: s.id });
    assert.equal(app.call('docs.get', { id: m.id }).id, m.id);
    assert.equal(app.call('calendar.range', { from: '2026-11-02', to: '2026-11-15' }).events.filter(e => e.type === 'jf').length, 0);
  });
});
