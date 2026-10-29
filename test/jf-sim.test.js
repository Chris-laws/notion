/**
 * Jour fixe end to end: realistic sessions of several people against the real server code
 * (series, concurrent editing, carry-over over several meetings, tasks, versions, rights, Drive failures).
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUT = 'fremd.person@firma.de';
const plain = v => JSON.parse(JSON.stringify(v));
/** I lead a team with Anna; Lea is only in the project; an outsider sees nothing. */
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OUT].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Portal', members: [ME, ANNA, LEA] });
  const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', attendees: [ME, ANNA, LEA] });
  const S = app.x.Shared;
  /** Opens a meeting as `who`, changes the model, saves; returns the answer of the save. */
  const edit = (who, date, fn) => {
    const m = app.as(who).call('jf.meeting', { seriesId: s.id, date: date });
    const model = S.protoFromText(m.content);
    fn(model);
    const p = m.id ? { id: m.id, title: m.title, content: S.protoToText(model), baseVersion: m.version, baseContent: m.content }
      : { projectId: m.projectId, seriesId: s.id, date: date, title: m.title, content: S.protoToText(model), baseContent: m.content };
    return app.as(who).call('docs.save', p);
  };
  const read = (who, id) => S.protoFromText(app.as(who).call('docs.get', { id: id }).content);
  return { app, team, project, s, S, edit, read };
}
const line = (id, text, extra) => Object.assign({ id: id, type: 'A', text: text, owner: '', due: '', done: false, taskId: '' }, extra || {});

describe('simulation: a series over several meetings', () => {
  test('editing the series moves the calendar blocks; ending it keeps the minutes, the calendar stops', () => {
    const { app, s, edit } = world();
    edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'Start', items: [] }); });
    app.call('jf.saveSeries', Object.assign({}, s, { time: '14:30', duration: 60 }));
    const ev = app.call('calendar.range', { from: '2030-01-14', to: '2030-01-14' }).events.find(e => e.type === 'jf');
    assert.deepEqual([ev.time, ev.duration], ['14:30', 60]);
    app.call('jf.removeSeries', { id: s.id });
    assert.equal(app.call('calendar.range', { from: '2030-01-14', to: '2030-01-21' }).events.filter(e => e.type === 'jf').length, 0);
    assert.equal(app.call('jf.list', {}).minutes.length, 1, 'minutes kept');
  });
  test('weekly meetings across the end of summer time stay on their weekday and time', () => {
    const { app, S } = world();
    const s = app.call('jf.saveSeries', { projectId: app.call('bootstrap').projects[0].id, title: 'DST', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-10-14', attendees: [ME] });
    assert.deepEqual(plain(S.jfDates(s, '2030-10-14', '2030-11-04')), ['2030-10-14', '2030-10-21', '2030-10-28', '2030-11-04']);
    const evs = app.call('calendar.range', { from: '2030-10-21', to: '2030-11-04' }).events.filter(e => e.seriesId === s.id);
    assert.deepEqual(plain(evs.map(e => e.startDate + ' ' + e.time)), ['2030-10-21 09:00', '2030-10-28 09:00', '2030-11-04 09:00']);
  });
  test('an anchored topic and open actions travel over three meetings until unpinned or done', () => {
    const { edit, read, app, s } = world();
    const d1 = edit(ME, '2030-01-07', m => {
      m.topics.push({ id: 'pin', title: 'Risiken', pinned: true, items: [line('r1', 'Risiko A')] });
      m.topics.push({ id: 'x', title: 'Einmalig', items: [line('o1', 'Offen'), line('o2', 'Fertig', { done: true })] });
    });
    const d2 = edit(ANNA, '2030-01-14', m => {
      assert.deepEqual(plain(m.topics.map(t => t.title)), ['Offene Punkte aus dem letzten Jour Fixe', 'Risiken']);
      assert.deepEqual(plain(m.topics[0].items.map(i => i.text)), ['Offen'], 'only the open one');
      m.topics[0].items[0].done = true;
    });
    const d3 = edit(LEA, '2030-01-21', m => {
      assert.deepEqual(plain(m.topics.map(t => t.title)), ['Risiken'], 'done action gone, anchor still there');
      m.topics[0].pinned = false;
    });
    const m4 = app.call('jf.meeting', { seriesId: s.id, date: '2030-01-28' });
    const t4 = app.x.Shared.protoFromText(m4.content).topics;
    assert.deepEqual(plain(t4.map(t => t.title)), ['Offene Punkte aus dem letzten Jour Fixe'], 'unpinned: the topic is no longer carried');
    assert.deepEqual(plain(t4[0].items.map(i => i.text)), ['Risiko A'], 'its open action still is, until done');
    assert.equal(read(ME, d3.id).topics[0].title, 'Risiken');
    assert.ok(d1.id && d2.id);
  });
  test('who was there and who missed it: the row shows the absent ones; the next draft invites everybody again', () => {
    const { edit, app, s } = world();
    edit(ME, '2030-01-07', m => { m.present = [ME, ANNA]; m.absent = [LEA]; });
    const row = app.call('jf.list', {}).minutes[0];
    assert.deepEqual(plain(row.people.absent), [LEA]);
    assert.deepEqual(plain(app.x.Shared.protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2030-01-14' }).content).present), [ME, ANNA, LEA]);
  });
  test('the archive lists minutes newest first', () => {
    const { edit, app } = world();
    ['2030-01-14', '2030-01-07', '2030-01-21'].forEach(d => edit(ME, d, () => {}));
    assert.deepEqual(plain(app.call('jf.list', {}).minutes.map(m => m.date)), ['2030-01-21', '2030-01-14', '2030-01-07']);
  });
});

describe('simulation: two people in the same minutes', () => {
  test('both start the same new minutes and add different topics: one file, both topics, no dialog', () => {
    const { app, s, S, read } = world();
    const a = app.as(ANNA).call('jf.meeting', { seriesId: s.id, date: '2030-01-07' });
    const b = app.as(LEA).call('jf.meeting', { seriesId: s.id, date: '2030-01-07' });
    const add = (m, id, title) => { const x = S.protoFromText(m.content); x.topics.push({ id: id, title: title, items: [] }); return S.protoToText(x); };
    app.as(ANNA).call('docs.save', { projectId: a.projectId, seriesId: s.id, date: a.date, title: a.title, content: add(a, 'ta', 'Von Anna'), baseContent: a.content });
    const r = app.as(LEA).call('docs.save', { projectId: b.projectId, seriesId: s.id, date: b.date, title: b.title, content: add(b, 'tb', 'Von Lea'), baseContent: b.content });
    assert.ok(!r.conflict);
    assert.equal(app.call('jf.list', {}).minutes.length, 1);
    assert.deepEqual(plain(read(ME, r.id).topics.map(t => t.title)), ['Von Anna', 'Von Lea']);
  });
  test('both change the same line: a conflict with both versions; "keep mine" keeps the other changes too', () => {
    const { app, edit, S, read } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'T', items: [line('l', 'Alt')] }, { id: 'u', title: 'U', items: [] }); });
    const base = app.call('docs.get', { id: d.id });
    const mine = S.protoFromText(base.content); mine.topics[0].items[0].text = 'Meins';
    const theirs = S.protoFromText(base.content); theirs.topics[0].items[0].text = 'Annas'; theirs.topics[1].title = 'U von Anna';
    app.as(ANNA).call('docs.save', { id: d.id, title: d.title, content: S.protoToText(theirs), baseVersion: base.version, baseContent: base.content });
    const r = app.as(ME).call('docs.save', { id: d.id, title: d.title, content: S.protoToText(mine), baseVersion: base.version, baseContent: base.content });
    assert.equal(r.conflict, true);
    assert.match(r.current.content, /Annas/);
    const kept = app.as(ME).call('docs.save', { id: d.id, title: d.title, content: r.merged, baseVersion: r.current.version, baseContent: r.current.content });
    const final = read(ME, kept.id);
    assert.deepEqual(plain([final.topics[0].items[0].text, final.topics[1].title]), ['Meins', 'U von Anna']);
  });
});

describe('simulation: tasks from the minutes', () => {
  test('before saving: a line and a topic with sub-tasks; after saving, edited and deleted tasks are reflected', () => {
    const { app, s, S, project, read } = world();
    const m = app.as(ANNA).call('jf.meeting', { seriesId: s.id, date: '2030-01-07' });
    const model = S.protoFromText(m.content);
    model.topics.push({ id: 'a', title: 'Angebot', items: [line('a1', 'Einholen')] }, { id: 'b', title: 'Release', items: [line('b1', 'Changelog'), line('b2', 'Tests'), line('b3', 'Info', { type: 'I' })] });
    const one = app.as(ANNA).call('jf.makeTasks', { projectId: project.id, requestId: 's1', item: true, items: [{ itemId: 'a1', title: 'Einholen', assignees: [LEA], dueDate: '2030-01-10' }] }).tasks;
    const topic = app.as(ANNA).call('jf.makeTasks', { projectId: project.id, requestId: 's2', task: { title: 'Release' }, items: [{ itemId: 'b1', title: 'Changelog' }, { itemId: 'b2', title: 'Tests' }] }).tasks;
    model.topics[0].items[0].taskId = one[0].id;
    model.topics[1].taskId = topic[0].id;
    model.topics[1].items[0].taskId = topic[1].id;
    model.topics[1].items[1].taskId = topic[2].id;
    const d = app.as(ANNA).call('docs.save', { projectId: m.projectId, seriesId: s.id, date: m.date, title: m.title, content: S.protoToText(model), baseContent: m.content });
    app.call('tasks.save', { id: topic[1].id, title: 'Changelog v2' });
    app.call('tasks.save', { id: one[0].id, status: 'done' });
    app.call('tasks.remove', { id: topic[2].id });
    const now = read(LEA, d.id);
    assert.equal(now.topics[0].items[0].done, true, 'done task: line done');
    assert.equal(now.topics[1].items[0].taskId, topic[1].id, 'renamed task keeps its link');
    assert.equal(now.topics[1].items[1].taskId, '', 'deleted task: line free again');
    assert.equal(now.topics[1].taskId, topic[0].id);
    const again = app.as(ANNA).call('jf.makeTasks', { docId: d.id, topicId: 'b', projectId: project.id, item: true, requestId: 's3', items: [{ itemId: 'b2', title: 'Tests' }] });
    assert.equal(again.tasks.length, 1);
    assert.ok(app.as(ANNA).error('jf.makeTasks', { docId: d.id, topicId: 'b', projectId: project.id, requestId: 's4', task: { title: 'x' }, items: [] }), 'the topic still has its task');
  });
});

describe('simulation: versions, rights, size, Drive', () => {
  test('several saves before Drive caught up: any version can be restored, then everything lands in Drive', () => {
    const { app, edit, read } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'v1', items: [] }); });
    edit(ANNA, '2030-01-07', m => { m.topics[0].title = 'v2'; });
    edit(LEA, '2030-01-07', m => { m.topics[0].title = 'v3'; });
    assert.deepEqual(plain(app.call('docs.versions', { id: d.id }).map(v => v.version)), [3, 2, 1]);
    const r = app.call('docs.restore', { id: d.id, version: 1 });
    assert.equal(r.version, 4);
    assert.equal(read(ME, d.id).topics[0].title, 'v1');
    assert.equal(app.call('docs.flush', { id: d.id }).pending, 0);
    assert.deepEqual(plain(app.call('docs.versions', { id: d.id }).map(v => v.version)), [4, 3, 2, 1]);
    assert.match(app.call('docs.version', { id: d.id, version: 2 }).content, /v2/);
  });
  test('rights: project people write, the team lead too; outsiders get nothing at all', () => {
    const { app, edit, s } = world();
    const d = edit(LEA, '2030-01-07', m => { m.topics.push({ id: 't', title: 'Intern', items: [] }); });
    assert.equal(app.as(ANNA).call('docs.get', { id: d.id }).canWrite, true);
    for (const [r, p] of [['docs.get', { id: d.id }], ['jf.meeting', { seriesId: s.id, date: '2030-01-07' }], ['docs.flush', { id: d.id }],
      ['jf.saveSeries', Object.assign({}, s, { title: 'x' })], ['jf.removeSeries', { id: s.id }], ['docs.versions', { id: d.id }]]) {
      const res = app.as(OUT).raw(r, p);
      assert.equal(res.ok, false, r);
      assert.doesNotMatch(JSON.stringify(res), /Intern/, r);
    }
    assert.equal(app.as(OUT).call('jf.list', {}).minutes.length, 0);
  });
  test('large minutes (200 lines) save fast and read back; very large ones go to Drive at once and still work', () => {
    const { app, edit, read } = world();
    const big = n => m => { m.topics = Array.from({ length: 20 }, (_, k) => ({ id: 't' + k, title: 'Thema ' + k, items: Array.from({ length: n }, (_, i) => line('l' + k + '_' + i, 'Punkt ' + i + ' mit etwas Text')) })); };
    const d = edit(ME, '2030-01-07', big(10));
    assert.equal(read(ME, d.id).topics.reduce((n, t) => n + t.items.length, 0), 200);
    const huge = edit(ME, '2030-01-14', m => { big(10)(m); m.topics.forEach(t => t.items.forEach(i => { i.text += ' ' + 'x'.repeat(150); })); });
    assert.ok(app.x.Db.get('Docs', huge.id).fileId, 'over the cell limit: written to Drive right away');
    assert.equal(read(ANNA, huge.id).topics.length, 20);
  });
  test('Drive refuses for a while: the minutes stay readable and editable; the next flush catches up', () => {
    const { app, edit, read } = world();
    app.ctx.__DRIVE_DENIED__ = true;
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'A', items: [] }); });
    assert.equal(app.call('docs.flush', { id: d.id }).pending, 1);
    edit(ANNA, '2030-01-07', m => { m.topics[0].title = 'B'; });
    assert.equal(read(LEA, d.id).topics[0].title, 'B');
    app.ctx.__DRIVE_DENIED__ = false;
    assert.equal(app.call('docs.flush', { id: d.id }).pending, 0);
    const doc = app.x.Db.get('Docs', d.id);
    assert.match(app.ctx.DriveApp.getFileById(doc.fileId).getBlob().getDataAsString(), /\*\*B\*\*/);
    assert.deepEqual(plain(app.call('docs.versions', { id: d.id }).map(v => v.version)), [2, 1]);
  });
  test('a series without minutes: empty carry-over, an empty draft, nothing in the archive', () => {
    const { app, s } = world();
    const l = app.call('jf.list', {});
    assert.deepEqual(plain(l.series[0].carry), { open: [], pinned: [] });
    assert.equal(l.minutes.length, 0);
    assert.deepEqual(plain(app.x.Shared.protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2030-01-07' }).content).topics), []);
  });
});

describe('review findings (v59)', () => {
  const bigText = (S, m, tag) => { m.topics = Array.from({ length: 20 }, (_, k) => ({ id: 't' + k, title: tag + ' ' + k, items: Array.from({ length: 10 }, (_, i) => line('l' + k + '_' + i, 'Punkt ' + i + ' ' + 'x'.repeat(170))) })); };
  test('a very large save after a small one Drive does not have yet: the newest text wins, history stays complete', () => {
    const { app, edit, read, S } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 'a', title: 'V1', items: [] }); });
    app.call('docs.flush', { id: d.id });
    edit(ME, '2030-01-07', m => { m.topics[0].title = 'V2'; });
    edit(ME, '2030-01-07', m => bigText(S, m, 'V3BIG'));
    app.call('docs.flush', { id: d.id });
    const doc = app.x.Db.get('Docs', d.id);
    app.ctx.CacheService.getScriptCache().remove('docv:' + d.id + ':' + doc.version);
    assert.match(read(ME, d.id).topics[0].title, /V3BIG/, 'the newest text, also from Drive');
    edit(ME, '2030-01-07', m => { m.topics = [{ id: 'a', title: 'V4', items: [] }]; });
    app.call('docs.flush', { id: d.id });
    assert.deepEqual(plain(app.call('docs.versions', { id: d.id }).map(v => v.version)), [4, 3, 2, 1]);
    assert.match(app.call('docs.version', { id: d.id, version: 3 }).content, /V3BIG/);
    assert.match(app.call('docs.version', { id: d.id, version: 2 }).content, /V2/);
  });
  test('new minutes Drive does not have yet, then a very large save: works, file made first', () => {
    const { app, edit, read, S } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 'a', title: 'Klein', items: [] }); });
    edit(ME, '2030-01-07', m => bigText(S, m, 'Gross'));
    assert.ok(app.x.Db.get('Docs', d.id).fileId);
    assert.match(read(ANNA, d.id).topics[0].title, /Gross/);
  });
  test('a linked action follows its task both ways: done, and open again when the task is reopened', () => {
    const { app, edit, read, project } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'T', items: [line('l', 'Tun')] }); });
    const t = app.call('jf.makeTasks', { docId: d.id, topicId: 't', projectId: project.id, item: true, requestId: 'q', items: [{ itemId: 'l', title: 'Tun' }] }).tasks[0];
    app.call('tasks.save', { id: t.id, status: 'done' });
    assert.equal(read(ME, d.id).topics[0].items[0].done, true);
    edit(ME, '2030-01-07', m => { m.topics[0].title = 'T2'; });
    app.call('tasks.save', { id: t.id, status: 'todo' });
    assert.equal(read(ME, d.id).topics[0].items[0].done, false, 'reopened');
  });
  test('sending the same task form twice: the second answer brings the minutes with the link', () => {
    const { app, edit, project, S } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'T', items: [line('l', 'Tun')] }); });
    const req = { docId: d.id, topicId: 't', projectId: project.id, item: true, requestId: 'twice', items: [{ itemId: 'l', title: 'Tun' }] };
    const a = app.call('jf.makeTasks', req);
    const b = app.call('jf.makeTasks', req);
    assert.equal(b.tasks[0].id, a.tasks[0].id);
    assert.equal(S.protoFromText(b.doc.content).topics[0].items[0].taskId, a.tasks[0].id);
  });
  test('Drive made the file but the database refused: the file goes to the trash, the save stays pending', () => {
    const { app, edit } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 'a', title: 'A', items: [] }); });
    const upd = app.x.Db.update;
    app.x.Db.update = function (table, id, patch) { if (table === 'Docs' && patch.fileId) throw new Error('Service error: Spreadsheets'); return upd.apply(this, arguments); };
    try { assert.ok(app.error('docs.flush', { id: d.id })); } finally { app.x.Db.update = upd; }
    assert.equal(app.x.Db.get('Docs', d.id).fileId, '');
    assert.equal(app.call('docs.flush', { id: d.id }).pending, 0, 'the next flush makes it');
    const fileId = app.x.Db.get('Docs', d.id).fileId;
    const folder = app.ctx.DriveApp.getFileById(fileId).getParents().next();
    const live = [];
    for (const it = folder.getFiles(); it.hasNext();) { const f = it.next(); if (!f.isTrashed()) live.push(f.getName()); }
    assert.equal(live.length, 1, 'the file of the refused step is in the trash, only one is left');
  });
  test('from the form of saved minutes: known lines are checked and linked by the server, a topic not saved yet just gets its tasks', () => {
    const { app, edit, project, S } = world();
    const d = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't', title: 'T', items: [line('l', 'Tun')] }); });
    const a = app.call('jf.makeTasks', { docId: d.id, draft: true, topicId: 't', projectId: project.id, item: true, requestId: 'f1', items: [{ itemId: 'l', title: 'Tun' }] });
    assert.equal(S.protoFromText(a.doc.content).topics[0].items[0].taskId, a.tasks[0].id);
    assert.ok(app.error('jf.makeTasks', { docId: d.id, draft: true, topicId: 't', projectId: project.id, item: true, requestId: 'f2', items: [{ itemId: 'l', title: 'Tun' }] }), 'a second person cannot make it twice');
    const b = app.call('jf.makeTasks', { docId: d.id, draft: true, topicId: 'neu', projectId: project.id, requestId: 'f3', task: { title: 'Neu' }, items: [] });
    assert.equal(b.tasks.length, 1);
    assert.equal(b.doc, null);
  });
});

