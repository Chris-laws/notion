/**
 * v57: saving minutes ("Übernehmen") writes the database only; Drive (file and version snapshot) follows
 * in a second call nobody waits for. Tasks from a topic (with sub-tasks for the checked lines) or from
 * one line, also before the minutes are saved; nothing twice.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUT = 'fremd.person@firma.de';
const plain = v => JSON.parse(JSON.stringify(v));
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OUT].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Forecast', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Portal', members: [] });
  const other = app.call('projects.save', { teamId: team.id, name: 'Anderes', members: [] });
  const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', attendees: [ME, ANNA] });
  return { app, team, project, other, s };
}
const S = app => app.x.Shared;
/** Minutes with a topic of three lines (an action of Anna, an info, an action of Lea). */
function draft(app, s) {
  const m = app.call('jf.meeting', { seriesId: s.id, date: '2030-01-07' });
  const model = S(app).protoFromText(m.content);
  model.topics = [{ id: 'tp1', title: 'Release', owner: ANNA, items: [
    { id: 'l1', type: 'A', text: 'Changelog schreiben', owner: ANNA, due: '2030-01-10' },
    { id: 'l2', type: 'I', text: 'Termin steht', owner: '' },
    { id: 'l3', type: 'A', text: 'Tests fahren', owner: LEA, due: '2030-01-11' },
  ] }];
  return { m, model };
}
function saveDraft(app, s, model) {
  return app.call('docs.save', { projectId: model.projectId, seriesId: s.id, date: '2030-01-07', title: 'Weekly · 2030-01-07', content: S(app).protoToText(model) });
}
const driveOps = m => (m.driveWrite || 0) + (m.driveRead || 0) + (m.fetch || 0);

describe('Übernehmen is fast: the database first, Drive afterwards', () => {
  test('saving new minutes touches no Drive; they read back at once; the flush writes the file', () => {
    const { app, s } = world();
    const { model } = draft(app, s);
    let r;
    const m = app.measure(() => { r = saveDraft(app, s, model); });
    assert.equal(driveOps(m), 0, 'no Drive call while the person waits');
    assert.ok(r.jf && r.jf.minutes.some(x => x.id === r.id), 'the overview comes with the answer (no second request)');
    app.ctx.CacheService.getScriptCache().remove('docv:' + r.id + ':' + r.version);
    assert.match(app.call('docs.get', { id: r.id }).content, /Changelog schreiben/, 'readable before Drive has it');
    const f = app.call('docs.flush', { id: r.id });
    assert.equal(f.pending, 0);
    const doc = app.x.Db.get('Docs', r.id);
    assert.ok(doc.fileId, 'the file exists now');
    assert.match(app.ctx.DriveApp.getFileById(doc.fileId).getBlob().getDataAsString(), /Changelog schreiben/);
  });
  test('saving again: no Drive call; after the flush the file has the new text and the old one is a version', () => {
    const { app, s } = world();
    const { model } = draft(app, s);
    const r1 = saveDraft(app, s, model);
    app.call('docs.flush', { id: r1.id });
    model.topics[0].title = 'Release 2';
    let r2;
    const m = app.measure(() => { r2 = app.call('docs.save', { id: r1.id, title: r1.title, content: S(app).protoToText(model), baseVersion: r1.version }); });
    assert.equal(driveOps(m), 0);
    assert.equal(r2.version, r1.version + 1);
    const v = app.call('docs.versions', { id: r1.id });
    assert.deepEqual(plain(v.map(x => x.version)), [2, 1], 'the earlier version is listed before the flush');
    assert.match(app.call('docs.version', { id: r1.id, version: 1 }).content, /Release\b(?! 2)/);
    app.call('docs.flush', { id: r1.id });
    const doc = app.x.Db.get('Docs', r1.id);
    assert.match(app.ctx.DriveApp.getFileById(doc.fileId).getBlob().getDataAsString(), /Release 2/);
    assert.equal(app.x.Db.all('DocVersions').filter(x => x.docId === r1.id).length, 1);
    assert.match(app.call('docs.version', { id: r1.id, version: 1 }).content, /Release\b(?! 2)/);
    app.call('docs.flush', { id: r1.id });
    assert.equal(app.x.Db.all('DocVersions').filter(x => x.docId === r1.id).length, 1, 'a second flush adds nothing');
  });
  test('two saves before one flush: both versions end up in Drive in the right order', () => {
    const { app, s } = world();
    const { model } = draft(app, s);
    const r1 = saveDraft(app, s, model);
    model.topics[0].title = 'B';
    const r2 = app.call('docs.save', { id: r1.id, title: r1.title, content: S(app).protoToText(model), baseVersion: r1.version });
    model.topics[0].title = 'C';
    app.call('docs.save', { id: r1.id, title: r1.title, content: S(app).protoToText(model), baseVersion: r2.version });
    app.call('docs.flush', { id: r1.id });
    const doc = app.x.Db.get('Docs', r1.id);
    assert.match(app.ctx.DriveApp.getFileById(doc.fileId).getBlob().getDataAsString(), /\*\*C\*\*/);
    assert.deepEqual(plain(app.call('docs.versions', { id: r1.id }).map(x => x.version)), [3, 2, 1]);
    assert.match(app.call('docs.version', { id: r1.id, version: 2 }).content, /\*\*B\*\*/);
  });
  test('people outside the project cannot flush', () => {
    const { app, s } = world();
    const { model } = draft(app, s);
    const r = saveDraft(app, s, model);
    assert.ok(app.as(OUT).error('docs.flush', { id: r.id }));
  });
});

describe('tasks from the minutes: confirmed in a form, also before saving', () => {
  test('a topic becomes one task; only the checked lines become its sub-tasks, with person and due date', () => {
    const { app, s, project } = world();
    const { model } = draft(app, s);
    const r = saveDraft(app, s, model);
    const out = app.call('jf.makeTasks', { docId: r.id, topicId: 'tp1', projectId: project.id, requestId: 'rq1',
      task: { title: 'Release', assignees: [ANNA], dueDate: '2030-01-12' },
      items: [{ itemId: 'l1', title: 'Changelog schreiben', assignees: [ANNA], dueDate: '2030-01-10' }, { itemId: 'l3', title: 'Tests fahren', assignees: [LEA], dueDate: '2030-01-11' }] });
    const parent = out.tasks[0];
    assert.equal(parent.title, 'Release');
    assert.deepEqual(plain(parent.assignees), [ANNA]);
    const subs = out.tasks.slice(1);
    assert.deepEqual(plain(subs.map(t => [t.title, t.parentId, t.assignees[0], t.dueDate])),
      [['Changelog schreiben', parent.id, ANNA, '2030-01-10'], ['Tests fahren', parent.id, LEA, '2030-01-11']]);
    const saved = S(app).protoFromText(app.call('docs.get', { id: r.id }).content);
    assert.equal(saved.topics[0].taskId, parent.id, 'the topic links to its task');
    assert.deepEqual(plain(saved.topics[0].items.map(i => i.taskId)), [subs[0].id, '', subs[1].id]);
  });
  test('the same request twice creates nothing twice', () => {
    const { app, s, project } = world();
    const { model } = draft(app, s);
    const r = saveDraft(app, s, model);
    const req = { docId: r.id, topicId: 'tp1', projectId: project.id, requestId: 'rq-same', task: { title: 'Release' }, items: [{ itemId: 'l1', title: 'A' }] };
    const a = app.call('jf.makeTasks', req);
    const n = app.call('tasks.list', { ver: '' }).tasks.length;
    const b = app.call('jf.makeTasks', req);
    assert.deepEqual(plain(b.tasks.map(t => t.id)), plain(a.tasks.map(t => t.id)));
    assert.equal(app.call('tasks.list', { ver: '' }).tasks.length, n);
  });
  test('before the minutes are saved: tasks are made, the draft keeps the links, saving keeps them and makes nothing new', () => {
    const { app, s, project } = world();
    const { model } = draft(app, s);
    const out = app.call('jf.makeTasks', { projectId: project.id, requestId: 'rq-d', item: true, items: [{ itemId: 'l1', title: 'Changelog schreiben', assignees: [ANNA], dueDate: '2030-01-10' }] });
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].parentId, '');
    assert.equal(app.x.Db.all('Docs').length, 0, 'the minutes are not saved by this');
    model.topics[0].items[0].taskId = out.tasks[0].id;
    const n = app.call('tasks.list', { ver: '' }).tasks.length;
    const r = saveDraft(app, s, model);
    assert.equal(S(app).protoFromText(app.call('docs.get', { id: r.id }).content).topics[0].items[0].taskId, out.tasks[0].id);
    assert.equal(app.call('tasks.list', { ver: '' }).tasks.length, n);
  });
  test('a topic or line that already has a task is refused (no duplicates)', () => {
    const { app, s, project } = world();
    const { model } = draft(app, s);
    const r = saveDraft(app, s, model);
    app.call('jf.makeTasks', { docId: r.id, topicId: 'tp1', projectId: project.id, requestId: 'x1', task: { title: 'Release' }, items: [] });
    assert.match(app.error('jf.makeTasks', { docId: r.id, topicId: 'tp1', projectId: project.id, requestId: 'x2', task: { title: 'Release' }, items: [] }), /schon/);
  });
  test('another project can be chosen; projects and minutes of others are refused', () => {
    const { app, s, project, other } = world();
    const { model } = draft(app, s);
    const r = saveDraft(app, s, model);
    const out = app.call('jf.makeTasks', { docId: r.id, topicId: 'tp1', projectId: other.id, requestId: 'o1', task: { title: 'Release' }, items: [{ itemId: 'l3', title: 'Tests' }] });
    assert.ok(out.tasks.every(t => t.projectId === other.id));
    assert.ok(app.as(OUT).error('jf.makeTasks', { projectId: project.id, requestId: 'o2', item: true, items: [{ title: 'x' }] }));
    assert.ok(app.as(OUT).error('jf.makeTasks', { docId: r.id, topicId: 'tp1', projectId: project.id, requestId: 'o3', task: { title: 'x' }, items: [] }));
  });
});
