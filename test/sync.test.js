/** Background refresh: every 60 s while someone works, 5 min when idle; new teams, projects and jour fixe come along. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');
const { bootApp, wait } = require('../dev/checks/dom');

describe('server: one poll brings everything that changed', () => {
  test('with full: true a change brings tasks, teams, projects, people and jour fixe; nothing changed = "same"', () => {
    const app = freshApp();
    [ME, ANNA].forEach(e => app.as(e).call('bootstrap'));
    const first = app.as(ANNA).call('tasks.list', { ver: '', full: true });
    assert.equal(app.as(ANNA).call('tasks.list', { ver: first.ver, full: true }).same, true);
    const t = app.as(ME).call('teams.save', { name: 'Neu', members: [ME, ANNA] });
    const r = app.as(ANNA).call('tasks.list', { ver: first.ver, full: true });
    assert.ok(!r.same, 'a new team changes the stamp');
    assert.ok(r.teams.some(x => x.id === t.id));
    assert.ok(Array.isArray(r.projects) && Array.isArray(r.users) && r.jf && Array.isArray(r.jf.series));
  });
  test('a new jour fixe series changes the stamp too', () => {
    const app = freshApp();
    app.as(ME).call('bootstrap');
    const t = app.call('teams.save', { name: 'T', members: [ME] });
    const p = app.call('projects.save', { teamId: t.id, name: 'P', members: [] });
    const v = app.call('tasks.list', { ver: '', full: true }).ver;
    app.call('jf.saveSeries', { projectId: p.id, title: 'JF', rhythm: 'weekly', weekday: 1 });
    assert.equal(app.call('tasks.list', { ver: v, full: true }).jf.series.length, 1);
  });
});

describe('client: interval and the new-team hint', () => {
  let w;
  before(async () => { w = await bootApp({ lang: 'de' }); });
  after(() => w && w.close());
  test('60 s (±25 %) while active, 5 min after 10 idle minutes', () => {
    w.eval('lastActive = Date.now()');
    const active = w.eval('pollDelayNow(0.5)');
    assert.equal(active, 60000);
    assert.ok(w.eval('pollDelayNow(0)') >= 45000 && w.eval('pollDelayNow(1)') <= 75000);
    w.eval('lastActive = Date.now() - 11 * 60000');
    assert.equal(w.eval('pollDelayNow(0.5)'), 300000);
  });
  test('a team I was added to shows up after the next refresh, with a hint', async () => {
    const before = w.eval('S.teams.length');
    await w.eval(`call('teams.save', { name: 'Neues Team', members: ['anna.schmidt@firma.de', S.me.email], lead: 'anna.schmidt@firma.de' })`);
    // pretend the team was made by someone else: forget it locally, then refresh like the timer does
    w.eval("S.teams = S.teams.filter(t => t.name !== 'Neues Team'); window.__toasts = []; const t0 = toast; toast = (m, o) => { window.__toasts.push(m); return t0(m, o); }");
    await w.eval('refresh(true)');
    for (let end = Date.now() + 3000; w.eval('S.teams.length') === before && Date.now() < end;) await wait(30);
    assert.equal(w.eval('S.teams.length'), before + 1);
    assert.ok(w.eval("window.__toasts.some(m => /Neues Team/.test(m))"), 'hint shown');
  });
});
