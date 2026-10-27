/**
 * Confidential teams and projects: visible only to their listed members. Admins have no override,
 * cannot add themselves, and nothing leaks through any route (data, counts or error messages).
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const BOB = 'bob.berger@firma.de';
const SECRET = /Geheim/;

/** ME is admin (first sign-in) and creates the confidential areas, without being a member. */
function world() {
  const app = freshApp();
  [ME, ANNA, LEA, BOB].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  const gl = app.call('teams.save', { name: 'Geschäftsleitung Geheim', lead: LEA, members: [LEA, BOB], confidential: true });
  const normal = app.call('teams.save', { name: 'Normal', members: [ME, ANNA, LEA] });
  const vp = app.call('projects.save', { teamId: normal.id, name: 'Übernahme Geheim', members: [LEA, BOB], confidential: true });
  app.as(LEA);
  const glp = app.call('projects.save', { teamId: gl.id, name: 'Strategie Geheim', members: [] });
  const [glt] = app.call('tasks.save', { title: 'GL Aufgabe Geheim', projectId: glp.id, assignees: [BOB], estimate: 8, dueDate: '2030-03-04' });
  const [vpt] = app.call('tasks.save', { title: 'VP Aufgabe Geheim', projectId: vp.id, assignees: [LEA], estimate: 5, dueDate: '2030-03-04' });
  const [tt] = app.call('tasks.save', { title: 'Team-Aufgabe Geheim', teams: [gl.id], assignees: [LEA] });
  app.call('comments.add', { taskId: glt.id, body: 'Kommentar Geheim' });
  const ev = app.call('events.save', { title: 'Termin Geheim', type: 'meeting', startDate: '2030-03-04', teamId: gl.id });
  app.as(ME);
  return { app, gl, normal, vp, glp, glt, vpt, tt, ev };
}

describe('confidential: members only', () => {
  const w = world();
  test('members see everything of their confidential area', () => {
    const b = w.app.as(LEA).call('bootstrap');
    assert.ok(b.teams.some(t => t.id === w.gl.id));
    assert.ok(b.projects.some(p => p.id === w.vp.id) && b.projects.some(p => p.id === w.glp.id));
    assert.equal(b.tasks.filter(t => SECRET.test(t.title)).length, 3);
  });
  for (const who of [ME, ANNA]) {
    test((who === ME ? 'an admin' : 'a member of the normal team') + ' who is not a member sees nothing in bootstrap', () => {
      const b = w.app.as(who).call('bootstrap');
      assert.doesNotMatch(JSON.stringify(b), SECRET);
    });
  }
  test('fuzz: every route with every confidential id answers non-members without any trace', () => {
    const routes = Object.keys(vm.runInContext('ROUTES', w.app.ctx));
    const ids = [w.gl.id, w.vp.id, w.glp.id, w.glt.id, w.vpt.id, w.tt.id, w.ev.id];
    const payloads = [{}].concat(...ids.map(id => [
      { id: id }, { teamId: id }, { taskId: id }, { projectId: id },
      { id: id, name: 'X', title: 'X', startDate: '2030-03-04' }, { items: [{ id: id, status: 'done' }] },
      { from: '2030-03-02', to: '2030-03-08', teamId: id },
    ]));
    for (const who of [ME, ANNA]) {
      for (const r of routes) {
        if (/^(backup\.run)$/.test(r)) continue; // writes a copy, covered by its own test
        for (const p of payloads) {
          const res = w.app.as(who).raw(r, p);
          assert.doesNotMatch(JSON.stringify(res), SECRET, who + ' ' + r + ' ' + JSON.stringify(p));
        }
      }
    }
    // and nothing was changed by these attempts
    assert.ok(w.app.as(LEA).call('bootstrap').teams.some(t => t.id === w.gl.id && t.name === 'Geschäftsleitung Geheim'));
    assert.equal(w.app.as(LEA).call('bootstrap').tasks.filter(t => SECRET.test(t.title)).length, 3);
  });
  test('calendar, availability and capacity leave confidential work out, even as numbers', () => {
    const cal = w.app.as(ME).call('calendar.range', { from: '2030-03-02', to: '2030-03-08' });
    assert.equal(cal.events.length, 0);
    const cap = w.app.as(ME).call('capacity', { from: '2030-03-04', weeks: 1 });
    const bob = cap.members ? cap.members.find(m => m.email === BOB) : null;
    if (bob) assert.doesNotMatch(JSON.stringify(bob), /"planned":\{"2030-03-02":8/);
    assert.ok(w.app.as(ME).error('availability', { teamId: w.gl.id }));
    assert.ok(w.app.as(ME).error('capacity', { teamId: w.gl.id }));
  });
});

describe('confidential: rules for creating and managing', () => {
  test('only admins create confidential teams or projects, always with at least 2 members', () => {
    const w = world();
    assert.ok(w.app.as(ANNA).error('teams.save', { name: 'X', members: [ANNA, LEA], confidential: true }));
    assert.ok(w.app.as(ME).error('teams.save', { name: 'X', members: [LEA], confidential: true }));
    assert.ok(w.app.as(ANNA).error('projects.save', { teamId: w.normal.id, name: 'X', members: [ANNA, LEA], confidential: true }));
    assert.ok(w.app.as(ME).error('projects.save', { teamId: w.normal.id, name: 'X', members: [], confidential: true }));
  });
  test('an admin can neither add themselves nor delete, rename or reveal it', () => {
    const w = world();
    assert.ok(w.app.as(ME).error('teams.save', { id: w.gl.id, name: 'X', lead: LEA, members: [LEA, BOB, ME] }));
    assert.ok(w.app.as(ME).error('teams.remove', { id: w.gl.id }));
    assert.ok(w.app.as(ME).error('projects.save', { id: w.vp.id, teamId: w.normal.id, name: 'X', members: [LEA, BOB, ME] }));
    assert.ok(w.app.as(ME).error('projects.remove', { id: w.vp.id }));
    const b = w.app.as(LEA).call('bootstrap');
    assert.equal(b.teams.find(t => t.id === w.gl.id).name, 'Geschäftsleitung Geheim');
    assert.equal(b.projects.find(p => p.id === w.vp.id).name, 'Übernahme Geheim');
  });
  test('members manage it, but at least 2 members stay and the flag cannot be switched off', () => {
    const w = world();
    assert.ok(w.app.as(LEA).error('teams.save', { id: w.gl.id, name: 'GL Geheim', lead: LEA, members: [LEA] }));
    const t = w.app.as(LEA).call('teams.save', { id: w.gl.id, name: 'GL Geheim', lead: LEA, members: [LEA, BOB, ANNA], confidential: false });
    assert.equal(String(t.confidential), 'true');
    assert.ok(w.app.as(ANNA).call('bootstrap').teams.some(x => x.id === w.gl.id), 'a newly added member sees it');
  });
  test('a confidential project in a normal team is not visible to the rest of the team', () => {
    const w = world();
    const b = w.app.as(ANNA).call('bootstrap');
    assert.ok(b.teams.some(t => t.id === w.normal.id));
    assert.ok(!b.projects.some(p => p.id === w.vp.id));
  });
  test('changes to confidential objects are written to the audit log (who, when, what; no content)', () => {
    const w = world();
    const audit = w.app.sheet('Audit').data.slice(1).filter(r => r[0]);
    assert.ok(audit.length >= 4);
    assert.doesNotMatch(JSON.stringify(audit), SECRET, 'the log names ids, not content');
    assert.ok(audit.some(r => r[2] === LEA && /task/.test(r[4])));
  });
});
