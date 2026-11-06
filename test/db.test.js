/** Table layer (Db.js): cache, versions, transactions, row safety. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME } = require('./helpers');

/** An app with n extra tasks so that full-sheet reads become visible in the meter. */
function appWithTasks(n) {
  const app = freshApp();
  for (let i = 0; i < n; i++) app.call('tasks.save', { title: 'T' + i, assignees: [ME] });
  return app;
}

describe('cache', () => {
  test('a repeated read is served without touching the sheet', () => {
    const app = appWithTasks(3);
    app.raw('tasks.list', { ver: '' });
    const again = app.raw('tasks.list', { ver: '' });
    assert.equal(again.reads, 0);
  });
  test('a write makes the next read see the new row', () => {
    const app = appWithTasks(3);
    app.raw('tasks.list', { ver: '' });
    const [t] = app.call('tasks.save', { title: 'Neu', assignees: [ME] });
    assert.ok(app.call('tasks.list', { ver: '' }).tasks.some(x => x.id === t.id));
  });
  test('the version token changes with every write', () => {
    const app = appWithTasks(1);
    const v1 = app.call('tasks.list', { ver: '' }).ver;
    app.call('tasks.save', { title: 'Neu', assignees: [ME] });
    assert.notEqual(app.call('tasks.list', { ver: '' }).ver, v1);
  });
  test('a table too big for the plain cache is still served from the cache (compressed)', () => {
    const app = freshApp();
    app.call('bootstrap'); // first sign-in registers the user (a write)
    app.bulkTasks(8000);
    const first = app.raw('tasks.list', { ver: '' });
    assert.ok(JSON.stringify(first.data).length > 80 * 30000, 'the test table must exceed the plain cache budget');
    const again = app.raw('tasks.list', { ver: '' });
    assert.equal(again.reads, 0);
    assert.equal(again.data.tasks.length, first.data.tasks.length);
  });
  test('polling with the current version answers "same" without data', () => {
    const app = appWithTasks(2);
    const v = app.call('tasks.list', { ver: '' }).ver;
    assert.deepEqual(JSON.parse(JSON.stringify(app.call('tasks.list', { ver: v }))), { ver: v, same: true });
  });
});

describe('writes', () => {
  test('user input that looks like a formula is stored as text', () => {
    const app = freshApp();
    const [t] = app.call('tasks.save', { title: '=IMPORTXML("http://x")', assignees: [ME] });
    const row = app.sheet('Tasks').data.find(r => r[0] === t.id);
    assert.equal(row[1], '=IMPORTXML("http://x")', 'the shim strips the protecting quote like Sheets does');
    assert.equal(app.call('tasks.list', { ver: '' }).tasks.find(x => x.id === t.id).title, '=IMPORTXML("http://x")');
  });
  test('an update inside the lock does not read the whole table when the cached copy is current', () => {
    const app = appWithTasks(60);
    const target = app.call('tasks.list', { ver: '' }).tasks[30];
    const m = app.measure(() => app.call('tasks.save', { id: target.id, title: 'Geändert' }));
    assert.ok((m.rowsRead || 0) < 10, 'read ' + m.rowsRead + ' rows');
  });
  test('back-to-back writes: the second one does not read the whole table either', () => {
    const app = appWithTasks(60);
    const tasks = app.call('tasks.list', { ver: '' }).tasks;
    app.call('tasks.save', { id: tasks[10].id, title: 'Erster' });
    const m = app.measure(() => app.call('tasks.save', { id: tasks[20].id, title: 'Zweiter' }));
    assert.ok((m.rowsRead || 0) < 10, 'read ' + m.rowsRead + ' rows');
  });
  test('after a write the next read is served from the cache and shows the change', () => {
    const app = appWithTasks(5);
    const t = app.call('tasks.list', { ver: '' }).tasks[2];
    app.call('tasks.save', { id: t.id, title: 'Frisch' });
    app.x.Db.reset(); // next request
    const res = app.raw('tasks.list', { ver: '' });
    assert.equal(res.reads, 0);
    assert.equal(res.data.tasks.find(x => x.id === t.id).title, 'Frisch');
  });
  test('an update hits the right row even after rows were moved by hand in the sheet', () => {
    const app = appWithTasks(5);
    const tasks = app.call('tasks.list', { ver: '' }).tasks;
    const a = tasks[1], b = tasks[2];
    const data = app.sheet('Tasks').data;
    const ia = data.findIndex(r => r[0] === a.id), ib = data.findIndex(r => r[0] === b.id);
    const tmp = data[ia]; data[ia] = data[ib]; data[ib] = tmp; // someone sorted the sheet
    app.call('tasks.save', { id: a.id, title: 'A neu' });
    const byId = id => app.sheet('Tasks').data.find(r => r[0] === id);
    assert.equal(byId(a.id)[1], 'A neu');
    assert.equal(byId(b.id)[1], b.title, 'the other row is untouched');
  });
  test('two updates of different fields of the same task both survive', () => {
    const app = appWithTasks(1);
    const t = app.call('tasks.list', { ver: '' }).tasks[0];
    app.call('tasks.save', { id: t.id, priority: 'high' });
    app.call('tasks.save', { id: t.id, dueDate: '2030-01-02' });
    const now = app.call('tasks.list', { ver: '' }).tasks.find(x => x.id === t.id);
    assert.deepEqual([now.priority, now.dueDate], ['high', '2030-01-02']);
  });
  test('deleting a row keeps the following rows addressable', () => {
    const app = appWithTasks(4);
    const tasks = app.call('tasks.list', { ver: '' }).tasks;
    app.call('tasks.remove', { id: tasks[0].id });
    app.call('tasks.save', { id: tasks[2].id, title: 'Nach Löschen' });
    assert.equal(app.sheet('Tasks').data.find(r => r[0] === tasks[2].id)[1], 'Nach Löschen');
  });
});
