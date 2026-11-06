/** v58: the overview carries what the page needs to open a meeting without asking the server again. */
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
  model.minuteTaker = ANNA;
  model.topics = [
    { id: 'a', title: 'Offen', items: [{ id: 'a1', type: 'A', text: 'Angebot', owner: ANNA }, { id: 'a2', type: 'A', text: 'Erledigt', done: true }] },
    { id: 'b', title: 'Dauerthema', pinned: true, items: [{ id: 'b1', type: 'I', text: 'Stand' }] },
  ];
  app.call('docs.save', { projectId: project.id, seriesId: s.id, date: '2030-01-07', title: m.title, content: S.protoToText(model) });
  return { app, s, S };
}

describe('opening a meeting needs no extra call', () => {
  test('each minutes row says how many topics, who wrote them, and how many are anchored', () => {
    const { app } = world();
    const row = app.call('jf.list', {}).minutes[0];
    assert.equal(row.people.topics, 2);
    assert.equal(row.people.by, ANNA);
    assert.equal(row.pinnedCount, 1);
    assert.equal(row.openCount, 1 + 0, 'the open action; the anchored topic has no open action');
  });
  test('each series brings the carry-over of its last minutes; the page builds the same draft as the server', () => {
    const { app, s, S } = world();
    const series = app.call('jf.list', {}).series.find(x => x.id === s.id);
    assert.equal(series.carryFrom, '2030-01-07');
    const local = S.jfTemplate(series, '2030-01-14', series.carry, ME);
    const server = app.call('jf.meeting', { seriesId: s.id, date: '2030-01-14' }).content;
    assert.equal(local, server);
    assert.deepEqual(plain(S.protoFromText(local).topics.map(t => t.title)), ['Offene Punkte aus dem letzten Jour Fixe', 'Dauerthema']);
  });
  test('a series without minutes carries nothing', () => {
    const app = freshApp();
    app.call('bootstrap');
    const team = app.call('teams.save', { name: 'T', members: [ME] });
    const project = app.call('projects.save', { teamId: team.id, name: 'P', members: [] });
    app.call('jf.saveSeries', { projectId: project.id, title: 'W', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2030-01-07', attendees: [ME] });
    const series = app.call('jf.list', {}).series[0];
    assert.equal(series.carryFrom, '');
    assert.deepEqual(plain(series.carry), { open: [], pinned: [] });
  });
});
