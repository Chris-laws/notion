/** Findings of the code review (2026-10-25): each one pinned by a test before the fix. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../dev/load');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUTSIDER = 'extern@firma.de';
function people(app) { [ME, ANNA, LEA, OUTSIDER].forEach(e => app.as(e).call('bootstrap')); return app.as(ME); }

describe('privacy', () => {
  test('others see a sick leave only as "away", the person and admins see "sick"', () => {
    const app = people(freshApp());
    app.call('teams.save', { name: 'T', members: [ME, ANNA, LEA] });
    app.as(ANNA).call('absences.save', { email: ANNA, type: 'sick', startDate: '2030-03-04', endDate: '2030-03-05' });
    const typeFor = email => app.as(email).call('calendar.range', { from: '2030-03-01', to: '2030-03-10' }).absences.find(a => a.email === ANNA).type;
    assert.deepEqual([typeFor(LEA), typeFor(ANNA), typeFor(ME)], ['other', 'sick', 'sick']);
  });
  test('the availability grid does not show "sick" to colleagues', () => {
    const app = people(freshApp());
    const team = app.call('teams.save', { name: 'T', members: [ME, ANNA, LEA] });
    app.as(ANNA).call('absences.save', { email: ANNA, type: 'sick', startDate: '2030-03-04', endDate: '2030-03-04' });
    const cell = app.as(LEA).call('availability', { teamId: team.id, from: '2030-03-04', weeks: 1 }).members.find(m => m.email === ANNA).cells['2030-03-04'];
    assert.equal(cell.kind, 'other');
  });
});

describe('rights', () => {
  test('a refused team change creates no new people', () => {
    const app = people(freshApp());
    const team = app.call('teams.save', { name: 'Kern', members: [ME] });
    app.as(OUTSIDER).error('teams.save', { id: team.id, name: 'X', members: ['neu.person@firma.de'] });
    assert.equal(app.as(ME).call('bootstrap').users.some(u => u.email === 'neu.person@firma.de'), false);
  });
  test('a project cannot be moved into a team the person is not in', () => {
    const app = people(freshApp());
    const hr = app.call('teams.save', { name: 'HR', members: [ME] });
    const own = app.as(ANNA).call('teams.save', { name: 'Anna', members: [ANNA] });
    const p = app.call('projects.save', { teamId: own.id, name: 'P', members: [] });
    assert.ok(app.error('projects.save', { id: p.id, teamId: hr.id, name: 'P' }));
  });
});

describe('data', () => {
  test('editing a team or project without an icon keeps the icon', () => {
    const app = people(freshApp());
    const t = app.call('teams.save', { name: 'Raketen', icon: '🚀', members: [ME] });
    const saved = app.call('teams.save', { id: t.id, name: 'Raketen', description: 'neu', members: [ME] });
    const p = app.call('projects.save', { teamId: t.id, name: 'P', icon: '📦', members: [] });
    const p2 = app.call('projects.save', { id: p.id, teamId: t.id, name: 'P2', members: [] });
    assert.deepEqual([saved.icon, p2.icon], ['🚀', '📦']);
  });
  test('a project colour outside the palette is not stored', () => {
    const app = people(freshApp());
    const t = app.call('teams.save', { name: 'T', members: [ME] });
    const p = app.call('projects.save', { teamId: t.id, name: 'P', color: 'x)"tabindex=1', members: [] });
    assert.equal(p.color, 'blue', 'the first free palette colour instead');
  });
  test('a task cannot become a sub-task of its own sub-task (no cycle)', () => {
    const app = people(freshApp());
    const [a] = app.call('tasks.save', { title: 'A', assignees: [ME] });
    const [b] = app.call('tasks.save', { title: 'B', parentId: a.id, assignees: [ME] });
    assert.ok(app.error('tasks.save', { id: a.id, parentId: b.id }));
  });
  test('a parent that does not exist is refused on update too', () => {
    const app = people(freshApp());
    const [a] = app.call('tasks.save', { title: 'A', assignees: [ME] });
    assert.ok(app.error('tasks.save', { id: a.id, parentId: 'tk_gibtsnicht' }));
  });
  test('deleting a task with many comments reads each table only a few times', () => {
    const app = people(freshApp());
    const [t] = app.call('tasks.save', { title: 'Viel', assignees: [ME] });
    for (let i = 0; i < 30; i++) app.call('comments.add', { taskId: t.id, body: 'c' + i });
    for (let i = 0; i < 5; i++) app.call('tasks.save', { title: 's' + i, parentId: t.id, assignees: [ME] });
    const m = app.measure(() => app.call('tasks.remove', { id: t.id }));
    assert.ok((m.sheetRead || 0) <= 6, m.sheetRead + ' sheet reads');
    assert.equal(app.sheet('Comments').data.filter(r => r[1] === t.id).length, 0, 'comments are gone');
    assert.equal(app.sheet('Tasks').data.filter(r => r[0] === t.id || r[12] === t.id).length, 0, 'task and sub-tasks are gone');
  });
  test('an empty answer of the holiday service falls back to the built-in list', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 200, body: [] }));
    assert.ok(app.x.Holidays.forCountry('DE', 2032).length > 5);
  });
});

describe('quick-add dates', () => {
  const S = load({ quiet: true }).__exports.Shared;
  test('31.2. is not a date', () => {
    assert.equal(S.parse('Bericht 31.2.', { today: '2026-10-23', me: ME, users: [], teams: [], projects: [] }).dueDate || '', '');
  });
});
