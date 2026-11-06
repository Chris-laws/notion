/** Links in the task panel (with "Mail öffnen" for Gmail links in the description) and in the project banner. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const $$ = sel => [...w.document.querySelectorAll(sel)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }
const submit = () => $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
function fill(name, value) { const i = $('#modal-root [name="' + name + '"]'); i.value = value; i.dispatchEvent(new w.Event('input', { bubbles: true })); }

describe('links on a task', () => {
  let id;
  test('"+ Link" adds a link; it shows with the icon of its kind and opens in a new tab', async () => {
    id = w.eval('S.tasks.find(t => isMine(t)).id');
    w.eval(`openPeek(${JSON.stringify(id)})`);
    await until(() => $('#peek [data-action="link-add"]'));
    click($('#peek [data-action="link-add"]'));
    await until(() => $('#modal-root [name="url"]'));
    fill('title', 'Umsatz-Dashboard');
    fill('url', 'https://abc.snowflakecomputing.com/console');
    submit();
    await until(() => $('#peek .lk-a.k-snowflake') && !$('#modal-root form'));
    const a = $('#peek .lk-a.k-snowflake');
    assert.equal(a.getAttribute('href'), 'https://abc.snowflakecomputing.com/console');
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /noopener/);
    assert.match(a.textContent, /Umsatz-Dashboard/);
    assert.equal(w.eval(`task(${JSON.stringify(id)}).links.length`), 1);
  });
  test('an address that is no web or mail link is refused in the form', async () => {
    click($('#peek [data-action="link-add"]'));
    await until(() => $('#modal-root [name="url"]'));
    fill('url', 'javascript:alert(1)');
    submit();
    await wait(300);
    assert.ok($('#modal-root [name="url"]'), 'the form stays open');
    assert.equal(w.eval(`task(${JSON.stringify(id)}).links.length`), 1);
    w.eval('closeModal()');
  });
  test('a Gmail link in the description becomes a "Mail öffnen" chip right away', async () => {
    const ta = $('#peek textarea.desc');
    ta.value = 'Thread: https://mail.google.com/mail/u/0/#inbox/FMfcgzQ and more';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    await until(() => $('#peek .lk-a.k-mail'));
    const a = $('#peek .lk-a.k-mail');
    assert.equal(a.getAttribute('href'), 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQ');
    assert.match(a.textContent, /Mail öffnen/);
  });
  test('a link is removed with its x', async () => {
    click($('#peek [data-action="link-rm"]'));
    await until(() => w.eval(`task(${JSON.stringify(id)}).links.length`) === 0);
    assert.equal($('#peek .lk-a.k-snowflake'), null);
    w.eval('closePeek()');
  });
});

describe('links in the project banner', () => {
  test('people of the project add links (e.g. Databricks) to the banner', async () => {
    const pid = w.eval('S.projects.find(p => canEditProject(p)).id');
    w.eval(`S.projTab = 'overview'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('.pj-banner [data-action="link-add"]'));
    click($('.pj-banner [data-action="link-add"]'));
    await until(() => $('#modal-root [name="url"]'));
    fill('url', 'https://dbc-1.cloud.databricks.com/');
    submit();
    await until(() => $('.pj-banner .lk-a.k-databricks'));
    assert.match($('.pj-banner .lk-a.k-databricks').textContent, /Databricks/, 'a label from the kind when no title is given');
    assert.equal(w.eval(`project(${JSON.stringify(pid)}).links.length`), 1);
    assert.equal($$('.pj-banner [data-action="link-rm"]').length, 1);
  });
});
