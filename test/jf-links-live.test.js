/**
 * v59: links between minutes and tasks follow the tasks. A deleted task frees its topic or line again
 * (it can be made a task anew); a done task closes its action line in the minutes and in the carry-over.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

const plain = v => JSON.parse(JSON.stringify(v));
function world() {
  const app = freshApp();
  [ME, ANNA].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'T', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'P', members: [] });
  const s = app.call('jf.saveSeries', { projectId: project.id, title: 'Weekly', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', attendees: [ME, ANNA] });
  const S = app.x.Shared;
  const m = app.call('jf.meeting', { seriesId: s.id, date: '2030-01-07' });
  const model = S.protoFromText(m.content);
  model.topics = [{ id: 'tp', title: 'Release', owner: ANNA, items: [
    { id: 'l1', type: 'A', text: 'Changelog', owner: ANNA },
    { id: 'l2', type: 'A', text: 'Tests', owner: ME },
  ] }];
  const d = app.call('docs.save', { projectId: project.id, seriesId: s.id, date: '2030-01-07', title: m.title, content: S.protoToText(model) });
  const made = app.call('jf.makeTasks', { docId: d.id, topicId: 'tp', projectId: project.id, requestId: 'r1', task: { title: 'Release' },
    items: [{ itemId: 'l1', title: 'Changelog' }, { itemId: 'l2', title: 'Tests' }] }).tasks;
  return { app, s, S, d, project, parent: made[0], sub1: made[1], sub2: made[2] };
}
const topicOf = (app, S, id) => S.protoFromText(app.call('docs.get', { id: id }).content).topics[0];

describe('minutes follow their tasks', () => {
  test('a deleted task frees its line: no link any more, and it can be made a task again', () => {
    const { app, S, d, project, sub1 } = world();
    app.call('tasks.remove', { id: sub1.id });
    const t = topicOf(app, S, d.id);
    assert.equal(t.items[0].taskId, '', 'the link of the deleted task is gone');
    assert.ok(t.items[1].taskId, 'the other one stays');
    const again = app.call('jf.makeTasks', { docId: d.id, topicId: 'tp', projectId: project.id, item: true, requestId: 'r2', items: [{ itemId: 'l1', title: 'Changelog neu' }] });
    assert.equal(topicOf(app, S, d.id).items[0].taskId, again.tasks[0].id);
  });
  test('deleting the topic task (with its sub-tasks) frees the whole topic', () => {
    const { app, S, d, project, parent } = world();
    app.call('tasks.remove', { id: parent.id });
    const t = topicOf(app, S, d.id);
    assert.deepEqual(plain([t.taskId, t.items[0].taskId, t.items[1].taskId]), ['', '', '']);
    assert.ok(app.call('jf.makeTasks', { docId: d.id, topicId: 'tp', projectId: project.id, requestId: 'r3', task: { title: 'Release' }, items: [] }).tasks.length);
  });
  test('a done task closes its action line: shown done, not carried to the next meeting, not counted as open', () => {
    const { app, S, s, d, sub1 } = world();
    app.call('tasks.save', { id: sub1.id, status: 'done' });
    assert.equal(topicOf(app, S, d.id).items[0].done, true);
    const next = S.protoFromText(app.call('jf.meeting', { seriesId: s.id, date: '2030-01-14' }).content);
    assert.deepEqual(plain(next.topics[0].items.map(i => i.text)), ['Tests']);
    const list = app.call('jf.list', {});
    assert.equal(list.minutes[0].openCount, 1);
    assert.deepEqual(plain(list.series[0].carry.open.map(i => i.text)), ['Tests']);
  });
  test('saving the minutes stores the cleaned links (a stale draft cannot bring a deleted link back)', () => {
    const { app, S, d, sub1 } = world();
    const stale = app.call('docs.get', { id: d.id });
    app.call('tasks.remove', { id: sub1.id });
    const r = app.call('docs.save', { id: d.id, title: d.title, content: stale.content, baseVersion: stale.version });
    assert.ok(!r.conflict);
    app.ctx.CacheService.getScriptCache().remove('docv:' + d.id + ':' + r.version);
    assert.equal(topicOf(app, S, d.id).items[0].taskId, '');
  });
  test('a task the reader cannot see (moved to a project of others) still shows as linked', () => {
    const { app, S, d, sub1 } = world();
    const team2 = app.call('teams.save', { name: 'Nur ich', members: [ME] });
    const hidden = app.call('projects.save', { teamId: team2.id, name: 'Geheim', members: [ME] });
    app.call('tasks.save', { id: sub1.id, projectId: hidden.id, assignees: [ME] });
    assert.equal(app.as(ANNA).call('tasks.list', { ver: '' }).tasks.some(t => t.id === sub1.id), false, 'Anna does not see the task');
    assert.equal(S.protoFromText(app.as(ANNA).call('docs.get', { id: d.id }).content).topics[0].items[0].taskId, sub1.id, 'but the line stays linked');
  });
});
