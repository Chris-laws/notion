/** Who may see and change what (Access in Auth.js, enforced by the API). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OUTSIDER = 'extern@firma.de';

/** The admin (first user) creates a team with Anna; Lea and the outsider are not in it. */
function teamApp() {
  const app = freshApp();
  app.call('bootstrap');
  [ANNA, LEA, OUTSIDER].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Produkt', members: [ME, ANNA] });
  return { app, team };
}
const visibleTo = (app, email, id) => app.as(email).call('tasks.list').some(t => t.id === id);

describe('seeing tasks', () => {
  test('a team task is visible to team members only', () => {
    const { app, team } = teamApp();
    const [t] = app.call('tasks.save', { title: 'Team', teams: [team.id], assignees: [ME] });
    assert.deepEqual([visibleTo(app, ANNA, t.id), visibleTo(app, LEA, t.id)], [true, false]);
  });
  test('an assignee sees the task without being in the team', () => {
    const { app, team } = teamApp();
    const [t] = app.call('tasks.save', { title: 'Für Lea', teams: [team.id], assignees: [LEA] });
    assert.equal(visibleTo(app, LEA, t.id), true);
  });
  test('a project guest sees the project tasks', () => {
    const { app, team } = teamApp();
    const p = app.call('projects.save', { teamId: team.id, name: 'Gast', members: [ME, LEA] });
    const [t] = app.call('tasks.save', { title: 'P', projectId: p.id, assignees: [ME] });
    assert.equal(visibleTo(app, LEA, t.id), true);
  });
  test('the admin sees everything', () => {
    const { app } = teamApp();
    const [t] = app.as(OUTSIDER).call('tasks.save', { title: 'Privat', assignees: [OUTSIDER] });
    assert.equal(visibleTo(app, ME, t.id), true);
  });
});

describe('changing things', () => {
  test('an outsider cannot edit a task they cannot see', () => {
    const { app, team } = teamApp();
    const [t] = app.call('tasks.save', { title: 'Team', teams: [team.id], assignees: [ME] });
    assert.ok(app.as(OUTSIDER).error('tasks.save', { id: t.id, title: 'Hack' }));
  });
  test('a team member who did not create the task cannot delete it', () => {
    const { app, team } = teamApp();
    const [t] = app.call('tasks.save', { title: 'Team', teams: [team.id], assignees: [ANNA] });
    assert.match(app.as(ANNA).error('tasks.remove', { id: t.id }) || '', /Löschen dürfen nur/);
  });
  test('only admins enter absences for other people', () => {
    const { app } = teamApp();
    assert.match(app.as(ANNA).error('absences.save', { email: LEA, type: 'vacation', startDate: '2030-01-07', endDate: '2030-01-08' }) || '', /nur Admins/);
  });
  test('a non-lead member cannot edit the team', () => {
    const { app, team } = teamApp();
    assert.ok(app.as(ANNA).error('teams.save', { id: team.id, name: 'Umbenannt' }));
  });
  test('a domain outside the company is refused', () => {
    const app = freshApp();
    assert.match(app.as('fremd@example.com').error('bootstrap') || '', /nur für @firma\.de/);
  });
});
