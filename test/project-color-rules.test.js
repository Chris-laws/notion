/** Two projects of the same team never share a colour: server rule, automatic choice and clean-up of old data. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME } = require('./helpers');

function teamWith(app, n, colors) {
  const t = app.call('teams.save', { name: 'Forecast', members: [ME] });
  const list = [];
  for (let i = 0; i < n; i++) list.push(app.call('projects.save', { teamId: t.id, name: 'P' + i, color: colors && colors[i], members: [] }));
  return { team: t, projects: list };
}

describe('project colours within a team', () => {
  test('the palette has 12 colours and the helper lists the taken ones per team', () => {
    const app = freshApp();
    const S = app.x.Shared;
    assert.equal(S.PROJECT_PALETTE.length, 12);
    const projects = [{ id: 'a', teamId: 't', color: 'yellow', name: 'A' }, { id: 'b', teamId: 'u', color: 'blue', name: 'B' }];
    const plain = o => JSON.parse(JSON.stringify(o));
    assert.deepEqual(plain(S.takenProjectColors(projects, 't')), { yellow: 'A' });
    assert.deepEqual(plain(S.takenProjectColors(projects, 't', 'a')), {});
    assert.equal(S.freeProjectColor(projects, 't'), 'blue');
  });
  test('a new project without a colour gets the first free one of its team', () => {
    const app = freshApp();
    const { projects } = teamWith(app, 3);
    assert.deepEqual(projects.map(p => p.color), ['blue', 'orange', 'green']);
  });
  test('a colour already used in the team is refused with a clear message', () => {
    const app = freshApp();
    const { team } = teamWith(app, 1, ['yellow']);
    const err = app.error('projects.save', { teamId: team.id, name: 'Zweites', color: 'yellow', members: [] });
    assert.match(err, /^Diese Farbe hat im Team schon das Projekt „P0“\. Bitte eine andere wählen\.$/);
  });
  test('the same colour in another team is fine', () => {
    const app = freshApp();
    teamWith(app, 1, ['yellow']);
    const other = app.call('teams.save', { name: 'Logistik', members: [ME] });
    assert.equal(app.call('projects.save', { teamId: other.id, name: 'X', color: 'yellow', members: [] }).color, 'yellow');
  });
  test('editing keeps the own colour, also when the dialog sends none', () => {
    const app = freshApp();
    const { team, projects } = teamWith(app, 2, ['yellow', 'red']);
    assert.equal(app.call('projects.save', { id: projects[0].id, teamId: team.id, name: 'P0', color: 'yellow', members: [] }).color, 'yellow');
    assert.equal(app.call('projects.save', { id: projects[1].id, teamId: team.id, name: 'P1 neu', members: [] }).color, 'red');
  });
  test('two requests that picked the same free colour: the second one is refused (checked under the lock)', () => {
    const app = freshApp();
    const { team } = teamWith(app, 0);
    // both clients saw "pink" as free; the server decides in order
    assert.equal(app.call('projects.save', { teamId: team.id, name: 'Erster', color: 'pink', members: [] }).color, 'pink');
    assert.ok(app.error('projects.save', { teamId: team.id, name: 'Zweiter', color: 'pink', members: [] }));
  });
  test('moving a project into a team where its colour is taken is refused', () => {
    const app = freshApp();
    const a = teamWith(app, 1, ['teal']);
    const b = app.call('teams.save', { name: 'B', members: [ME] });
    const p = app.call('projects.save', { teamId: b.id, name: 'Wandert', color: 'teal', members: [] });
    assert.ok(app.error('projects.save', { id: p.id, teamId: a.team.id, name: 'Wandert', color: 'teal', members: [] }));
  });
  test('once all 12 colours are used in a team, colours may repeat instead of failing', () => {
    const app = freshApp();
    const { team } = teamWith(app, 12);
    const extra = app.call('projects.save', { teamId: team.id, name: 'Dreizehn', members: [] });
    assert.ok(app.x.Shared.PROJECT_PALETTE.indexOf(extra.color) >= 0);
    assert.ok(app.call('projects.save', { teamId: team.id, name: 'Vierzehn', color: 'yellow', members: [] }));
  });
});

describe('clean-up of existing projects', () => {
  test('duplicates and colourless projects get the next free colour, the oldest keeps its own', () => {
    const app = freshApp();
    const { team, projects } = teamWith(app, 2, ['yellow', 'red']);
    // data from before the rule: same colour twice, one without colour
    app.x.Db.update('Projects', projects[1].id, { color: 'yellow' });
    const third = app.x.Db.insert('Projects', { id: 'pr_old', teamId: team.id, name: 'Alt', color: 'gray', members: [], createdAt: '2099-01-01T00:00:00.000Z' });
    const boot = app.call('bootstrap');
    const colorOf = id => boot.projects.find(p => p.id === id).color;
    assert.equal(colorOf(projects[0].id), 'yellow');
    assert.notEqual(colorOf(projects[1].id), 'yellow');
    assert.notEqual(colorOf(third.id), 'gray');
    const mine = boot.projects.filter(p => p.teamId === team.id).map(p => p.color);
    assert.equal(new Set(mine).size, mine.length, 'all different');
  });
  test('nothing to fix: no write', () => {
    const app = freshApp();
    teamWith(app, 2);
    app.call('bootstrap');
    const m = app.measure(() => app.call('bootstrap'));
    assert.ok(!m.sheetWrite && !m.lock, 'no sheet writes: ' + JSON.stringify(m));
  });
});
