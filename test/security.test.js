/** Rights per API method: every route is checked, a new route without a rule fails this test. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const FOREIGN = 'fremd@example.com';
const OUTSIDER = 'extern@firma.de';

/** The admin owns a team with Anna, a project, a task, an event; Anna has an absence. */
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OUTSIDER].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Geheim', members: [] });
  const [task] = app.call('tasks.save', { title: 'Intern', projectId: project.id, teams: [team.id], assignees: [ME] });
  app.call('comments.add', { taskId: task.id, body: 'vertraulich' });
  const ev = app.call('events.save', { title: 'Board', type: 'meeting', startDate: '2030-02-01', teamId: team.id });
  const abs = app.as(ANNA).call('absences.save', { email: ANNA, type: 'vacation', startDate: '2030-02-04', endDate: '2030-02-05', note: 'privat' });
  app.as(ME);
  const hol = app.call('companyHolidays.save', { date: '2030-12-31', name: 'Silvester' });
  return { app, team, project, task, ev, abs: abs.absence || abs, hol };
}

/** What an in-domain outsider tries on data that is not theirs. Every route needs an entry. */
const ATTEMPTS = w => ({
  'bootstrap': null, 'tasks.list': null, 'ai.status': null, 'ai.test': {}, 'ai.ask': null, 'ui.chunk': null, 'files.upload': { kind: 'task', taskId: w.task.id, name: 'x.png', mime: 'image/png', data: 'iVBORw0KGgo=' }, 'files.get': { id: 'fl_x' }, 'ai.setAssistant': { on: false }, 'ai.apply': { items: [{ type: 'task', title: 'x', projectId: w.project.id }] }, 'ai.report': null, 'ai.briefing': null, 'ai.parse': null, 'ai.assist': null,
  'calendar.range': null, 'capacity': null, 'availability': null, 'users.save': { email: ANNA, name: 'Gehackt' },
  'tasks.save': { id: w.task.id, title: 'Gehackt' },
  'tasks.move': { items: [{ id: w.task.id, status: 'done' }] },
  'tasks.remove': { id: w.task.id },
  'comments.list': { taskId: w.task.id },
  'comments.add': { taskId: w.task.id, body: 'x' },
  'teams.save': { id: w.team.id, name: 'Gehackt' },
  'teams.remove': { id: w.team.id },
  'teams.setRole': { teamId: w.team.id, email: OUTSIDER, lead: true },
  'projects.setRole': { projectId: w.project.id, email: OUTSIDER, lead: true },
  'projects.setLinks': { projectId: w.project.id, links: [{ title: 'x', url: 'https://evil.example' }] },
  'projects.save': { id: w.project.id, teamId: w.team.id, name: 'Gehackt' },
  'projects.remove': { id: w.project.id },
  'events.save': { id: w.ev.id, title: 'Gehackt', startDate: '2030-02-01' },
  'events.remove': { id: w.ev.id },
  'absences.save': { email: ANNA, type: 'vacation', startDate: '2030-03-02' },
  'absences.remove': { id: w.abs.id },
  'companyHolidays.save': { date: '2030-05-05', name: 'Gehackt' },
  'companyHolidays.remove': { id: w.hol.id },
  'ai.suggestAssignee': { id: w.task.id },
  'ai.breakdown': { id: w.task.id },
  'docs.get': { id: 'x' }, 'docs.save': { projectId: w.project.id, title: 'x', content: 'x' },
  'docs.versions': { id: 'x' }, 'docs.version': { id: 'x', version: 1 }, 'docs.restore': { id: 'x', version: 1 }, 'docs.lock': { id: 'x' }, 'docs.unlock': { id: 'x' }, 'docs.remove': { id: 'x' },
  'jf.list': { projectId: w.project.id }, 'jf.saveSeries': { projectId: w.project.id, title: 'x', rhythm: 'weekly', weekday: 1 },
  'jf.removeSeries': { id: 'x' }, 'jf.makeTasks': { projectId: w.project.id, requestId: 'r', item: true, items: [{ title: 'x' }] }, 'docs.flush': { id: 'x' }, 'jf.meeting': { seriesId: 'x', date: '2030-01-07' },
  'storage.links': {},
  'backup.status': {},
  'backup.run': {},
});
// read-only routes that answer the outsider with their OWN data only (checked below)
const OWN_DATA = ['bootstrap', 'tasks.list', 'ai.status', 'ai.report', 'ai.briefing', 'ai.parse', 'ai.assist', 'calendar.range', 'capacity', 'availability'];

describe('rights per API method', () => {
  const w = world();
  const routes = Object.keys(vm.runInContext('ROUTES', w.app.ctx));

  test('every route has a rule in this test', () => {
    const missing = routes.filter(r => !(r in ATTEMPTS(w)));
    assert.deepEqual(missing, []);
  });
  test('every route refuses someone outside the company domain', () => {
    const open = routes.filter(r => !w.app.as(FOREIGN).error(r, {}));
    assert.deepEqual(open, []);
  });
  test('every changing route refuses an outsider on data that is not theirs', () => {
    const attempts = ATTEMPTS(w);
    const allowed = routes.filter(r => attempts[r] && !w.app.as(OUTSIDER).error(r, attempts[r]));
    assert.deepEqual(allowed, []);
  });
  test('read routes give the outsider none of the team data', () => {
    const app = w.app.as(OUTSIDER);
    const b = app.call('bootstrap');
    assert.equal(b.tasks.some(t => t.id === w.task.id), false);
    assert.equal(app.call('tasks.list', { ver: '' }).tasks.some(t => t.id === w.task.id), false);
    const cal = app.call('calendar.range', { from: '2030-02-01', to: '2030-02-10' });
    assert.equal(cal.absences.some(a => a.note === 'privat'), false, 'absence notes stay private');
    assert.ok(OWN_DATA.every(r => r in ATTEMPTS(w)));
  });
  test('the data is unchanged after all attempts', () => {
    const app = w.app.as(ME);
    const t = app.call('tasks.list', { ver: '' }).tasks.find(x => x.id === w.task.id);
    assert.deepEqual([t.title, t.status], ['Intern', 'todo']);
    assert.equal(app.call('bootstrap').teams.find(x => x.id === w.team.id).name, 'Kern');
  });
});
