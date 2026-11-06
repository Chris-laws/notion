/** Links: on tasks (Snowflake, Databricks, Drive, Gmail …), mails linked in the description, links in the project banner. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

const OTTO = 'otto.meier@firma.de';
const plain = v => JSON.parse(JSON.stringify(v));

describe('links on tasks', () => {
  test('a task keeps its links; only http, https and mailto, no duplicates, short titles', () => {
    const app = freshApp();
    app.call('bootstrap');
    const [t] = app.call('tasks.save', { title: 'Report' });
    const [s] = app.call('tasks.save', { id: t.id, links: [
      { title: 'Dashboard', url: 'https://abc123.snowflakecomputing.com/console#/worksheets' },
      { title: 'Notebook', url: ' https://adb-1.2.azuredatabricks.net/?o=1#notebook/2 ' },
      { title: 'Doppelt', url: 'https://adb-1.2.azuredatabricks.net/?o=1#notebook/2' },
      { title: 'Böse', url: 'javascript:alert(1)' },
      { title: 'x'.repeat(500), url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQ' },
    ] });
    assert.deepEqual(plain(s.links).map(l => l.url), [
      'https://abc123.snowflakecomputing.com/console#/worksheets',
      'https://adb-1.2.azuredatabricks.net/?o=1#notebook/2',
      'https://mail.google.com/mail/u/0/#inbox/FMfcgzQ',
    ]);
    assert.equal(s.links[2].title.length, 120);
    const again = app.call('tasks.list', { ver: '' }).tasks.find(x => x.id === t.id);
    assert.equal(again.links.length, 3, 'stored');
  });
  test('a new task has no links; saving other fields keeps them', () => {
    const app = freshApp();
    app.call('bootstrap');
    const [t] = app.call('tasks.save', { title: 'Report' });
    assert.deepEqual(plain(t.links), []);
    app.call('tasks.save', { id: t.id, links: [{ title: '', url: 'https://example.org/a' }] });
    const [s] = app.call('tasks.save', { id: t.id, title: 'Report 2' });
    assert.deepEqual(plain(s.links), [{ title: '', url: 'https://example.org/a' }]);
  });
});

describe('links in the project banner', () => {
  function world() {
    const app = freshApp();
    [ME, ANNA, OTTO].forEach(e => app.as(e).call('bootstrap'));
    app.as(ME);
    const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA] });
    const project = app.call('projects.save', { teamId: team.id, name: 'Portal', members: [] });
    return { app, project };
  }
  test('people of the project set the links of the project; they come with the project', () => {
    const { app, project } = world();
    const p = app.as(ANNA).call('projects.setLinks', { projectId: project.id, links: [{ title: 'Databricks', url: 'https://dbc-1.cloud.databricks.com/' }, { title: 'x', url: 'ftp://alt' }] });
    assert.deepEqual(plain(p.links), [{ title: 'Databricks', url: 'https://dbc-1.cloud.databricks.com/' }]);
    assert.deepEqual(plain(app.as(ME).call('bootstrap').projects.find(x => x.id === project.id).links), plain(p.links));
  });
  test('people outside the project cannot change them', () => {
    const { app, project } = world();
    assert.ok(app.as(OTTO).error('projects.setLinks', { projectId: project.id, links: [{ title: 'x', url: 'https://evil.example' }] }));
    assert.deepEqual(plain(app.as(ME).call('bootstrap').projects.find(x => x.id === project.id).links || []), []);
  });
  test('saving the project keeps its links', () => {
    const { app, project } = world();
    app.call('projects.setLinks', { projectId: project.id, links: [{ title: 'Wiki', url: 'https://wiki.example/p' }] });
    const p = app.call('projects.save', { id: project.id, teamId: project.teamId, name: 'Portal 2', members: [] });
    assert.equal(p.links.length, 1);
  });
});
