/**
 * v62 jour fixe only per team: the team is the place (rights, Drive folder, calendar), topics can carry people,
 * a project, links and files without any task, a task from a topic goes to a project or straight to the people,
 * and what projects had before is removed once (with a backup).
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUT = 'fremd.person@firma.de';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const b64 = s => Buffer.from(s).toString('base64');
const plain = v => JSON.parse(JSON.stringify(v));

function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OUT].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  app.ctx.Drive = app.ctx.__driveAdvanced();
  const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Portal', members: [] });
  const s = app.call('jf.saveSeries', { teamId: team.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', attendees: [ME, ANNA] });
  const S = app.x.Shared;
  /** Opens the meeting, changes the model, saves; returns the answer of the save. */
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

describe('team jour fixe: the team is the place', () => {
  test('a series needs a team; people outside the team cannot make one or see it', () => {
    const { app, team, s } = world();
    assert.match(app.error('jf.saveSeries', { title: 'Ohne Team', rhythm: 'weekly', weekday: 1 }), /nur im Team/);
    assert.ok(app.as(OUT).error('jf.saveSeries', { teamId: team.id, title: 'Fremd', rhythm: 'weekly', weekday: 1 }));
    assert.equal(s.projectId, 'team:' + team.id);
    assert.equal(app.as(ANNA).call('jf.list', {}).series.length, 1);
    assert.equal(app.as(OUT).call('jf.list', {}).series.length, 0);
    assert.equal(app.as(LEA).call('bootstrap').jf.series.length, 0, 'not in the team');
    assert.ok(app.as(OUT).error('jf.meeting', { seriesId: s.id, date: '2030-01-07' }));
  });
  test('the Drive folder is Jour Fixe in the team folder, not in a project', () => {
    const { app, edit } = world();
    const d = edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'Start', items: [] }));
    app.call('docs.flush', { id: d.id });
    const names = [];
    for (let f = app.ctx.DriveApp.getFileById(app.x.Db.get('Docs', d.id).fileId); f; ) { names.unshift(f.getName()); const p = f.getParents(); f = p.hasNext() ? p.next() : null; }
    assert.equal(names.join('/'), 'LidlFlow/Projects/Kern/Jour Fixe/Weekly/2030-01-07 Weekly.md');
  });
  test('the meetings are in the calendar of the team and of its people, not in other teams', () => {
    const { app, team } = world();
    const other = app.call('teams.save', { name: 'Andere', members: [ME] });
    const jf = id => app.call('calendar.range', { teamId: id, from: '2030-01-07', to: '2030-01-14' }).events.filter(e => e.type === 'jf');
    assert.equal(jf(team.id).length, 2);
    assert.equal(jf(team.id)[0].teamId, team.id);
    assert.equal(jf(other.id).length, 0);
    assert.equal(app.as(ANNA).call('calendar.range', { from: '2030-01-07', to: '2030-01-14' }).events.filter(e => e.type === 'jf').length, 2);
  });
});

describe('team jour fixe: topics', () => {
  test('people, project, due date, description, links and files are saved with the topic and make no task', () => {
    const { app, project, edit, read } = world();
    const before = app.x.Db.all('Tasks').length;
    const d = edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'Budget', kind: 'B', owners: [ANNA], projectId: project.id, due: '2030-02-01',
      body: 'Viel Text\n'.repeat(500), links: [{ url: 'https://example.com/a', title: 'Doku' }, { url: 'javascript:alert(1)' }],
      files: [{ id: 'fl_abc123', name: 'a.pdf', mime: 'application/pdf', size: 12 }, { id: '../x', name: 'böse' }], items: [] }));
    const t = read(ME, d.id).topics[0];
    assert.equal(t.kind, 'B');
    assert.deepEqual(plain(t.owners), [ANNA]);
    assert.equal(t.projectId, project.id);
    assert.equal(t.due, '2030-02-01');
    assert.equal(t.body.length, 5000);
    assert.deepEqual(plain(t.links), [{ title: 'Doku', url: 'https://example.com/a' }], 'no script addresses');
    assert.deepEqual(plain(t.files.map(f => f.id)), ['fl_abc123'], 'only real ids');
    assert.equal(t.taskId, '');
    assert.equal(app.x.Db.all('Tasks').length, before, 'a note is not a task');
  });
  test('a task from a topic without project goes to the team and the people; the people become responsible for the topic', () => {
    const { app, team, edit, read, s } = world();
    const d = edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'Release', owners: [ME], items: [{ id: 'l1', type: 'A', text: 'Changelog', owner: '', due: '', done: false, taskId: '' }] }));
    const out = app.call('jf.makeTasks', { docId: d.id, topicId: 't1', projectId: '', requestId: 'r1', task: { title: 'Release', assignees: [ANNA, LEA], dueDate: '2030-01-20' }, items: [] });
    const parent = out.tasks[0];
    assert.equal(parent.projectId, '');
    assert.deepEqual(plain(parent.teams), [team.id]);
    assert.deepEqual(plain(parent.assignees).sort(), [ANNA, LEA].sort());
    const t = read(ME, d.id).topics[0];
    assert.equal(t.taskId, parent.id);
    assert.deepEqual(plain(t.owners).sort(), [ANNA, ME, LEA].sort(), 'the person who was noted stays, the new ones are added');
    assert.ok(app.as(ANNA).call('jf.meeting', { seriesId: s.id, date: '2030-01-07' }));
  });
  test('a task from a topic in a project notes the project on the topic', () => {
    const { app, project, edit, read } = world();
    const d = edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'Roadmap', items: [] }));
    const out = app.call('jf.makeTasks', { docId: d.id, topicId: 't1', projectId: project.id, requestId: 'r2', task: { title: 'Roadmap', assignees: [ANNA] }, items: [] });
    assert.equal(out.tasks[0].projectId, project.id);
    const t = read(ME, d.id).topics[0];
    assert.equal(t.projectId, project.id);
    assert.deepEqual(plain(t.owners), [ANNA]);
  });
  test('a task without project in a team the person is not in is refused; so is a project the person cannot write in', () => {
    const { app, edit, project, team } = world();
    const d = edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'X', items: [] }));
    assert.ok(app.as(OUT).error('jf.makeTasks', { docId: d.id, topicId: 't1', projectId: '', task: { title: 'X' }, items: [] }));
    assert.ok(app.as(OUT).error('jf.makeTasks', { draft: true, teamId: team.id, topicId: 't1', projectId: '', task: { title: 'X' }, items: [] }));
    assert.ok(app.as(OUT).error('jf.makeTasks', { docId: d.id, topicId: 't1', projectId: project.id, task: { title: 'X' }, items: [] }));
  });
  test('the table knows tasks and whether a meeting is closed', () => {
    const { app, edit } = world();
    edit(ME, '2030-01-07', m => { m.closed = true; m.topics.push({ id: 't1', title: 'A', taskId: '', items: [] }); });
    const row = app.call('jf.list', {}).minutes[0];
    assert.equal(row.people.closed, true);
    assert.equal(row.people.tasks, 0);
  });
  test('the table counts the tasks of a meeting and how many are done (ids stay on the server)', () => {
    const { app, edit, team, s } = world();
    const saved = edit(ME, '2030-01-07', m => { m.topics.push({ id: 't1', title: 'A', items: [] }, { id: 't2', title: 'B', items: [] }); });
    const mk = (topicId, title) => app.call('jf.makeTasks', { teamId: team.id, docId: saved.id, topicId: topicId, requestId: 'r' + topicId, task: { title: title, assignees: [ME] }, items: [] }).tasks[0];
    const a = mk('t1', 'Erste');
    mk('t2', 'Zweite');
    app.call('tasks.save', { id: a.id, status: 'done' });
    const row = app.call('jf.list', {}).minutes.find(x => x.seriesId === s.id);
    assert.equal(row.people.tasks, 2);
    assert.equal(row.tasksDone, 1);
    assert.equal(row.people.taskIds, undefined);
  });
});

describe('team jour fixe: files', () => {
  test('a PDF goes in as an attachment; the team gets it back, outsiders do not', () => {
    const { app, team } = world();
    const pdf = b64('%PDF-1.4\n1 0 obj\n');
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'angebot.pdf', mime: 'application/pdf', data: pdf, attach: true });
    assert.equal(r.mime, 'application/pdf');
    assert.equal(r.size, 17);
    assert.equal(app.as(ME).call('files.get', { id: r.id }).data, pdf);
    assert.ok(app.as(OUT).error('files.get', { id: r.id }));
    assert.ok(app.as(OUT).error('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'x.png', mime: 'image/png', data: PNG }));
  });
  test('binary files come back byte for byte (the Drive service alone would decode them as text)', () => {
    const { app, team } = world();
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0xff, 0xfe, 0x80, 0x00, 0xc3, 0x28, 0xe2, 0x82, 0xac, 0x89, 0x50, 0x4e, 0x47])]).toString('base64');
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'echt.pdf', mime: 'application/pdf', data: bytes, attach: true });
    assert.equal(app.as(ME).call('files.get', { id: r.id }).data, bytes);
  });
  test('a failed REST read falls back to the Drive service; a missing file is reported', () => {
    const { app, team } = world();
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'a.csv', mime: 'text/csv', data: b64('a;b\n'), attach: true });
    app.ctx.__DRIVE_DENIED__ = 'network down';
    assert.equal(app.as(ME).call('files.get', { id: r.id }).data, b64('a;b\n'));
    app.ctx.__DRIVE_DENIED__ = false;
    const lost = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'b.csv', mime: 'text/csv', data: b64('c;d\n'), attach: true });
    app.x.Db.update('Files', lost.id, { driveId: 'f_nope' });
    assert.match(app.as(ME).error('files.get', { id: lost.id }), /nicht gefunden/);
  });
  test('a file read once is served from the cache the next time (no Drive call), still only to people who may see it', () => {
    const { app, team } = world();
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'a.csv', mime: 'text/csv', data: b64('a;b\n'), attach: true });
    const first = app.measure(() => app.as(ME).call('files.get', { id: r.id }));
    assert.ok(first.driveRead >= 1, 'the first read goes to Drive');
    let data;
    const second = app.measure(() => { data = app.as(ME).call('files.get', { id: r.id }).data; });
    assert.equal(data, b64('a;b\n'));
    assert.ok(!second.driveRead, 'the second read does not touch Drive');
    assert.ok(app.as(OUT).error('files.get', { id: r.id }), 'the cache holds no access decision');
  });
  test('a bigger file is cut in pieces below the cache limit and comes back whole; a very big one is not cached', () => {
    const { app, team } = world();
    const body = '%PDF-1.4\n' + 'x'.repeat(200000);
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'mid.pdf', mime: 'application/pdf', data: b64(body), attach: true });
    app.as(ME).call('files.get', { id: r.id });
    const hit = app.measure(() => { assert.equal(app.as(ME).call('files.get', { id: r.id }).data, b64(body)); });
    assert.ok(!hit.driveRead, 'served from the cache in pieces');
    const huge = '%PDF-1.4\n' + 'y'.repeat(900000);
    const h = app.as(ANNA).call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'big.pdf', mime: 'application/pdf', data: b64(huge), attach: true });
    app.as(ME).call('files.get', { id: h.id });
    const again = app.measure(() => { app.as(ME).call('files.get', { id: h.id }); });
    assert.ok(again.driveRead >= 1, 'too big for the cache: Drive again');
  });
  test('a document needs the attach flag and content that fits its type; HTML and scripts never get in', () => {
    const { app, team } = world();
    const up = (mime, data, attach) => app.error('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'x', mime: mime, data: data, attach: attach });
    assert.match(up('application/pdf', b64('%PDF-1.4'), false), /Nur Bilder/, 'images only without the flag');
    assert.match(up('application/pdf', b64('<html><script>alert(1)</script>'), true), /passt nicht/);
    assert.match(up('text/html', b64('<html>'), true), /nicht erlaubt/);
    assert.match(up('application/x-msdownload', b64('MZ'), true), /nicht erlaubt/);
    assert.match(up('text/plain', Buffer.from([0x61, 0, 0x62]).toString('base64'), true), /passt nicht/, 'binary data is no text');
    assert.match(up('application/vnd.openxmlformats-officedocument.wordprocessingml.document', b64('nicht gezippt'), true), /passt nicht/);
    const ok = app.call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'liste.csv', mime: 'text/csv', data: b64('a;b\n1;2\n'), attach: true });
    assert.match(ok.id, /^fl_/);
    const zip = app.call('files.upload', { kind: 'project', projectId: 'team:' + team.id, name: 'a.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: Buffer.from([0x50, 0x4b, 3, 4, 0, 0]).toString('base64'), attach: true });
    assert.match(zip.id, /^fl_/);
  });
});

describe('team jour fixe: a legacy series of a project never shows (v62.6)', () => {
  test('an old series of a project that still exists is neither in the calendar nor in the list, for admins too; a deleted team drops its series', () => {
    const { app, team, project, s } = world();
    const { Db } = app.x;
    Db.insert('JfSeries', { id: 'jf_legacy', projectId: project.id, title: 'Altes JF', rhythm: 'weekly', weekday: 1, time: '10:00', duration: 30, startDate: '2024-01-01', endDate: '', attendees: [ME], meetLink: '', active: true, createdBy: ME, createdAt: '2024-01-01' });
    const range = () => app.call('calendar.range', { from: '2030-01-07', to: '2030-02-04' }).events.filter(e => e.type === 'jf').map(e => e.seriesId);
    assert.ok(range().indexOf(s.id) >= 0, 'the team series is in the calendar');
    assert.equal(range().indexOf('jf_legacy'), -1, 'the legacy series is not');
    assert.equal(plain(app.call('jf.list', {}).series.map(x => x.id)).indexOf('jf_legacy'), -1);
    assert.equal(plain(app.call('jf.list', { teamId: team.id }).series.map(x => x.id)).indexOf('jf_legacy'), -1);
    app.call('teams.remove', { id: team.id });
    assert.equal(range().indexOf(s.id), -1, 'a deleted team takes its series out of the calendar');
  });
});

describe('team jour fixe: what projects had before is removed once', () => {
  /** A jour fixe of a project as v61 stored it: series, minutes with a Drive file, a version and an image. */
  function legacy(app, project) {
    const D = app.ctx.DriveApp;
    const dir = D.createFolder('Altlast');
    const file = name => dir.createFile(name, 'alt').getId();
    const { Db } = app.x;
    const series = Db.insert('JfSeries', { id: 'jf_alt', projectId: project.id, title: 'Alt-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', endDate: '', attendees: [ME], meetLink: '', active: true, createdBy: ME, createdAt: '2030-01-01' });
    const doc = Db.insert('Docs', { id: 'dc_alt', projectId: project.id, kind: 'jf', seriesId: series.id, date: '2030-01-07', title: 'Alt', fileId: file('alt.md'), version: 1, createdBy: ME, createdAt: '2030-01-01' });
    Db.insert('DocVersions', { id: 'dv_alt', docId: doc.id, version: 1, fileId: file('alt-v1.md'), at: '2030-01-01', by: ME, change: '' });
    Db.insert('Files', { id: 'fl_altbild', driveId: file('alt.png'), kind: 'project', taskId: '', projectId: project.id, name: 'alt.png', mime: 'image/png', size: 1, createdBy: ME, createdAt: '2030-01-01' });
    Db.insert('Files', { id: 'fl_taskbild', driveId: file('task.png'), kind: 'task', taskId: 'x', projectId: project.id, name: 'task.png', mime: 'image/png', size: 1, createdBy: ME, createdAt: '2030-01-01' });
    return { doc, series };
  }
  test('series, minutes, versions and images of projects go; a backup file and the Drive trash keep them; tasks and task images stay', () => {
    const { app, project, edit } = world();
    const { Db } = app.x;
    edit(ME, '2030-01-07', m => m.topics.push({ id: 't1', title: 'Neu', items: [] }));
    const { doc } = legacy(app, project);
    const oldFile = doc.fileId;
    assert.equal(app.x.Jf.migrateToTeams(), 1);
    assert.equal(Db.get('JfSeries', 'jf_alt'), null);
    assert.equal(Db.get('Docs', 'dc_alt'), null);
    assert.equal(Db.get('DocVersions', 'dv_alt'), null);
    assert.equal(Db.get('Files', 'fl_altbild'), null);
    assert.ok(Db.get('Files', 'fl_taskbild'), 'images of tasks stay');
    assert.equal(app.ctx.DriveApp.getFileById(oldFile).isTrashed(), true, 'restorable from the Drive trash');
    const backups = [];
    for (const it = app.ctx.DriveApp.getFolderById(app.ctx.PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID')).getFiles(); it.hasNext();) { const f = it.next(); if (f.getName() === 'JF-Sicherung-v62-' + app.x.Util.today() + '.json') backups.push(f); }
    assert.equal(backups.length, 1);
    assert.match(backups[0].getBlob().getDataAsString(), /Alt-JF/);
    assert.equal(Db.all('JfSeries').length, 1, 'the team series stays');
    assert.equal(Db.all('Docs').length, 2 - 1, 'the team minutes stay');
  });
  test('running it again changes nothing; setup runs it', () => {
    const { app, project } = world();
    legacy(app, project);
    app.ctx.setup();
    assert.equal(app.x.Db.get('JfSeries', 'jf_alt'), null);
    assert.equal(app.x.Jf.migrateToTeams(), 0);
    assert.equal(app.x.Db.all('JfSeries').length, 1);
  });
});
