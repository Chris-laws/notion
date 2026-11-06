/** Lead roles in teams and projects: leads appoint and demote leads, at least one lead stays, nobody promotes themselves. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const OTTO = 'otto.meier@firma.de';

/** I lead a team with Anna and Lea; Otto is outside. One project of the team, created by Anna. */
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, OTTO].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA, LEA] });
  const project = app.as(ANNA).call('projects.save', { teamId: team.id, name: 'Portal', members: [] });
  app.as(ME);
  return { app, team, project };
}
const teamOf = (app, id) => app.call('bootstrap').teams.find(t => t.id === id);
const projectOf = (app, id) => app.call('bootstrap').projects.find(p => p.id === id);
const plain = v => JSON.parse(JSON.stringify(v));

describe('team leads', () => {
  test('the person who creates a team is its lead', () => {
    const { team } = world();
    assert.deepEqual(plain(team.leads), [ME]);
    assert.equal(team.lead, ME);
  });
  test('a lead makes a member lead too; the new lead may manage the team', () => {
    const { app, team } = world();
    const t = app.call('teams.setRole', { teamId: team.id, email: ANNA, lead: true });
    assert.deepEqual(plain(t.leads).sort(), [ANNA, ME].sort());
    assert.ok(app.as(ANNA).call('teams.save', { id: team.id, name: 'Kern 2', members: [ME, ANNA, LEA] }));
    assert.equal(teamOf(app, team.id).name, 'Kern 2');
  });
  test('a lead may give up the role while another lead stays', () => {
    const { app, team } = world();
    app.call('teams.setRole', { teamId: team.id, email: ANNA, lead: true });
    const t = app.call('teams.setRole', { teamId: team.id, email: ME, lead: false });
    assert.deepEqual(plain(t.leads), [ANNA]);
    assert.equal(t.lead, ANNA);
    assert.ok(plain(t.members).indexOf(ME) >= 0, 'still a member');
    // Anna (no admin) hands the role back and cannot take it again on her own
    app.as(ANNA).call('teams.setRole', { teamId: team.id, email: LEA, lead: true });
    app.as(ANNA).call('teams.setRole', { teamId: team.id, email: ANNA, lead: false });
    assert.match(app.as(ANNA).error('teams.setRole', { teamId: team.id, email: ANNA, lead: true }), /Lead/, 'and cannot take it back alone');
  });
  test('the last lead cannot be demoted', () => {
    const { app, team } = world();
    assert.match(app.error('teams.setRole', { teamId: team.id, email: ME, lead: false }), /mindestens ein/i);
    assert.deepEqual(plain(teamOf(app, team.id).leads), [ME]);
  });
  test('a member cannot make themselves or others lead; an outsider cannot either', () => {
    const { app, team } = world();
    assert.ok(app.as(ANNA).error('teams.setRole', { teamId: team.id, email: ANNA, lead: true }));
    assert.ok(app.as(ANNA).error('teams.setRole', { teamId: team.id, email: LEA, lead: true }));
    assert.ok(app.as(OTTO).error('teams.setRole', { teamId: team.id, email: OTTO, lead: true }));
    assert.deepEqual(plain(teamOf(app.as(ME), team.id).leads), [ME]);
  });
  test('only members of the team can become lead', () => {
    const { app, team } = world();
    assert.match(app.error('teams.setRole', { teamId: team.id, email: OTTO, lead: true }), /Mitglied/);
  });
  test('saving the team keeps all leads as members, even if the list leaves one out', () => {
    const { app, team } = world();
    app.call('teams.setRole', { teamId: team.id, email: ANNA, lead: true });
    const t = app.call('teams.save', { id: team.id, name: 'Kern', members: [ME, LEA] });
    assert.deepEqual(plain(t.leads).sort(), [ANNA, ME].sort());
    assert.ok(plain(t.members).indexOf(ANNA) >= 0);
  });
  test('teams from before keep their one lead', () => {
    const { app, team } = world();
    app.x.Db.update('Teams', team.id, { leads: [] });
    assert.deepEqual(plain(teamOf(app, team.id).leads), [ME]);
    assert.ok(app.call('teams.setRole', { teamId: team.id, email: LEA, lead: true }));
  });
});

describe('project leads', () => {
  test('the person who creates a project is its lead', () => {
    const { project } = world();
    assert.deepEqual(plain(project.leads), [ANNA]);
  });
  test('project leads and team leads appoint project leads; plain members cannot', () => {
    const { app, team, project } = world();
    assert.ok(app.as(LEA).error('projects.setRole', { projectId: project.id, email: LEA, lead: true }), 'a member cannot promote herself');
    const p = app.as(ANNA).call('projects.setRole', { projectId: project.id, email: LEA, lead: true });
    assert.deepEqual(plain(p.leads).sort(), [ANNA, LEA].sort());
    assert.ok(app.as(ME).call('projects.setRole', { projectId: project.id, email: ANNA, lead: false }), 'the team lead may change project roles');
    assert.deepEqual(plain(projectOf(app, project.id).leads), [LEA]);
    assert.equal(team.id, projectOf(app, project.id).teamId);
  });
  test('the last project lead stays; only people of the project can become lead', () => {
    const { app, project } = world();
    assert.match(app.as(ANNA).error('projects.setRole', { projectId: project.id, email: ANNA, lead: false }), /mindestens ein/i);
    assert.match(app.as(ANNA).error('projects.setRole', { projectId: project.id, email: OTTO, lead: true }), /Mitglied/);
  });
  test('a project with its own people keeps its leads among them', () => {
    const { app, team, project } = world();
    const p = app.as(ANNA).call('projects.save', { id: project.id, teamId: team.id, name: 'Portal', members: [LEA] });
    assert.ok(plain(p.members).indexOf(ANNA) >= 0, 'the lead stays in the project');
  });
});
