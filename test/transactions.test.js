/**
 * Transactions are all or nothing: an error in the middle of Db.tx() undoes every write of it,
 * and a transaction that died without cleaning up (script timeout) is undone by the next one.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME } = require('./helpers');

const TABLES = ['Teams', 'Projects', 'Tasks', 'Comments'];
/** Sheet contents per table, row order ignored (undo appends removed rows at the end). */
function snapshot(app) {
  const out = {};
  TABLES.forEach(t => { out[t] = app.sheet(t).data.slice(1).map(r => JSON.stringify(r)).sort(); });
  return out;
}
/** Makes one sheet method throw on its n-th call (like Google's "Error code INTERNAL"). */
function failOn(app, table, method, n) {
  const sh = app.sheet(table);
  const orig = sh[method];
  let calls = 0;
  sh[method] = function () {
    calls++;
    if (calls === n) throw new Error('Service error: Spreadsheets. Error code INTERNAL.');
    return orig.apply(this, arguments);
  };
  return () => { sh[method] = orig; };
}
function seed(app) {
  const team = app.call('teams.save', { name: 'Forecast', members: [ME] });
  const p = app.call('projects.save', { teamId: team.id, name: 'Exception Handling', members: [] });
  const tasks = [1, 2, 3].map(i => app.call('tasks.save', { title: 'T' + i, projectId: p.id, assignees: [ME] })[0]);
  app.call('comments.add', { taskId: tasks[0].id, body: 'Notiz' });
  app.x.Db.reset();
  return { team, p, tasks };
}

describe('all or nothing', () => {
  test('a failing step in Db.tx undoes insert, update and delete of that transaction', () => {
    const app = freshApp();
    const { tasks } = seed(app);
    const before = snapshot(app);
    const Db = app.x.Db;
    assert.throws(() => Db.tx(() => {
      Db.insert('Tasks', { id: 'tk_new', title: 'Neu', status: 'todo' });
      Db.update('Tasks', tasks[0].id, { title: 'geändert' });
      Db.remove('Tasks', tasks[1].id);
      throw new Error('mittendrin');
    }), /mittendrin/);
    assert.deepEqual(snapshot(app), before);
    Db.reset();
    assert.equal(Db.get('Tasks', tasks[0].id).title, 'T1', 'reads after the rollback see the old state');
    assert.equal(Db.get('Tasks', 'tk_new'), null);
  });
  test('deleting a project fails half-way: tasks keep their project, the project stays', () => {
    const app = freshApp();
    const { p } = seed(app);
    const before = snapshot(app);
    const restore = failOn(app, 'Projects', 'deleteRow', 1);
    assert.ok(app.error('projects.remove', { id: p.id }));
    restore();
    assert.deepEqual(snapshot(app), before);
    assert.ok(app.call('bootstrap').tasks.filter(t => t.projectId === p.id).length === 3, 'also through the cache');
  });
  test('deleting a team with projects and tasks fails at the last step: nothing is lost', () => {
    const app = freshApp();
    const { team } = seed(app);
    const before = snapshot(app);
    const restore = failOn(app, 'Teams', 'deleteRow', 1);
    assert.ok(app.error('teams.remove', { id: team.id }));
    restore();
    assert.deepEqual(snapshot(app), before);
  });
  test('deleting tasks with comments fails in between: tasks and comments are back', () => {
    const app = freshApp();
    const { tasks } = seed(app);
    const before = snapshot(app);
    // comments go first, then the task: fail at the task
    const restore = failOn(app, 'Tasks', 'deleteRow', 1);
    assert.ok(app.error('tasks.remove', { id: tasks[0].id }));
    restore();
    assert.deepEqual(snapshot(app), before);
  });
  test('validation errors happen before any write: no undo needed, no journal written', () => {
    const app = freshApp();
    seed(app);
    const m = app.measure(() => assert.ok(app.error('projects.save', { teamId: 'nope', name: 'X' })));
    assert.ok(!m.sheetWrite);
  });
});

describe('write-ahead journal', () => {
  test('a single write needs no journal (as cheap as before)', () => {
    const app = freshApp();
    const { tasks } = seed(app);
    const writes = app.measure(() => app.x.Db.update('Tasks', tasks[0].id, { title: 'X' })).sheetWrite;
    assert.equal(writes, 1);
    assert.equal(app.sheet('Journal').data.length, 1, 'only the header');
  });
  test('after a successful multi-step transaction the journal is empty again', () => {
    const app = freshApp();
    const { p } = seed(app);
    app.call('projects.remove', { id: p.id });
    assert.equal(app.sheet('Journal').data.length, 1);
    assert.equal(app.ctx.PropertiesService.getScriptProperties().getProperty('DB_JOURNAL'), null);
  });
  test('a transaction that died mid-way (no undo ran) is undone by the next transaction', () => {
    const app = freshApp();
    const { p } = seed(app);
    const before = snapshot(app);
    // the undo fails too (e.g. the script hit its time limit): the journal stays behind
    const projects = app.sheet('Projects');
    const taskSheet = app.sheet('Tasks');
    const orig = { del: projects.deleteRow, range: taskSheet.getRange };
    let dead = false;
    projects.deleteRow = () => { dead = true; throw new Error('Exceeded maximum execution time'); };
    taskSheet.getRange = function () { if (dead) throw new Error('Exceeded maximum execution time'); return orig.range.apply(this, arguments); };
    assert.ok(app.error('projects.remove', { id: p.id }));
    projects.deleteRow = orig.del;
    taskSheet.getRange = orig.range;
    assert.ok(app.sheet('Journal').data.length > 1, 'journal left behind');
    app.x.Db.reset();
    // any next write first replays the journal under the lock
    app.x.Db.tx(() => null);
    assert.deepEqual(snapshot(app), before);
    assert.equal(app.sheet('Journal').data.length, 1);
  });
});
