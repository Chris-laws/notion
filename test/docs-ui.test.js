/** Jour fixe in the project page: meetings in rows, the minutes form, attendance, action items as tasks. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
let pid;
before(async () => {
  w = await bootApp({ lang: 'de' });
  pid = w.eval('S.projects[0].id');
  // a series with a past meeting (minutes saved, one person absent) and upcoming ones
  await w.eval(`(async () => {
    const people = S.users.slice(0, 3).map(u => u.email);
    const s = await call('jf.saveSeries', { projectId: ${JSON.stringify(pid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: people });
    const past = Shared.jfDates(s, Shared.addDays(TODAY(), -13), Shared.addDays(TODAY(), -1))[0];
    const m = await call('jf.meeting', { seriesId: s.id, date: past });
    const model = Shared.protoFromText(m.content);
    model.present = people.slice(0, 2); model.absent = [people[2]];
    await call('docs.save', { projectId: m.projectId, seriesId: s.id, date: past, title: m.title, content: Shared.protoToText(model) });
    S.jf = await call('jf.list', {});
  })()`);
});
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const $$ = sel => [...w.document.querySelectorAll(sel)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }

describe('jour fixe overview', () => {
  test('top: one row per active series for the next meeting, no "noch kein Protokoll"; no documents', async () => {
    w.eval(`S.projTab = 'jf'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('.jf-row'));
    assert.equal($$('.pj-tabs [data-v="docs"]').length, 0);
    assert.equal($$('[data-action="doc-new"]').length, 0, 'no plain documents any more');
    const top = $$('.jf-active .jf-row');
    assert.equal(top.length, 1, 'one row per series');
    assert.match(top[0].textContent, /Team-JF\s*Nächster: /);
    assert.doesNotMatch($('#view').textContent, /noch kein Protokoll/);
    assert.equal(top[0].querySelectorAll('.avatar').length, 3, 'everybody invited');
  });
  test('bottom: the archive is collapsed, opens on click (remembered) and lists minutes newest first with who missed them', async () => {
    const toggle = $('[data-action="jf-archive"]');
    assert.ok(toggle, 'archive toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal($$('.jf-archive .jf-row').length, 0, 'collapsed');
    click(toggle);
    await until(() => $$('.jf-archive .jf-row').length > 0);
    assert.equal($('[data-action="jf-archive"]').getAttribute('aria-expanded'), 'true');
    assert.equal(w.eval("store.get('jfArchive', false)"), true, 'remembered in the browser');
    const rows = $$('.jf-archive .jf-row');
    assert.match(rows[0].textContent, /Gefehlt:/);
    assert.equal(rows[0].querySelectorAll('.avatar').length, 1);
    const dates = w.eval(`jfArchiveRows(${JSON.stringify(pid)}).map(m => m.date)`);
    assert.deepEqual(JSON.parse(JSON.stringify(dates)), JSON.parse(JSON.stringify(dates)).slice().sort().reverse(), 'newest first');
  });
  test('an ended series leaves the top; its minutes stay in the archive', async () => {
    const before = w.eval(`jfArchiveRows(${JSON.stringify(pid)}).length`);
    await w.eval(`(async () => { const s = jfData().series.find(x => x.projectId === ${JSON.stringify(pid)}); await call('jf.removeSeries', { id: s.id }); S.jf = await call('jf.list', {}); render(); })()`);
    await until(() => $$('.jf-active .jf-row').length === 0);
    assert.equal($$('.jf-active .jf-row').length, 0);
    assert.equal(w.eval(`jfArchiveRows(${JSON.stringify(pid)}).length`), before, 'minutes kept');
    assert.match($('.jf-archive').textContent, /Team-JF/);
    // a new series for the remaining tests
    await w.eval(`(async () => { await call('jf.saveSeries', { projectId: ${JSON.stringify(pid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: S.users.slice(0, 3).map(u => u.email) }); S.jf = await call('jf.list', {}); render(); })()`);
    await until(() => $$('.jf-active .jf-row').length === 1);
  });
  test('the archive shows 50 minutes first and the rest on request (200+ minutes stay fast)', () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ id: 'dc_' + i, projectId: pid, seriesId: 'jf_x', date: w.eval(`Shared.addDays('2020-01-06', ${i * 7})`), title: 'Alt', people: { present: [], absent: [] } }));
    const html = w.eval(`(() => { const keep = S.jf; S.jf = { series: [], minutes: ${JSON.stringify(many)} }; S.jfArchiveAll = false; const h = jfArchive(project(${JSON.stringify(pid)})); S.jf = keep; return h; })()`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    assert.equal(d.querySelectorAll('.jf-row').length, 50);
    assert.ok(d.querySelector('[data-action="jf-archive-all"]'), '"show all" button');
  });
  test('the whole row opens the meeting, also with the keyboard', async () => {
    const hit = $('.jf-active .jf-hit');
    assert.equal(hit.getAttribute('role'), 'button');
    assert.equal(hit.getAttribute('tabindex'), '0');
    hit.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => $('.proto-edit'));
    assert.ok($('.proto-edit'), 'the form for the next meeting');
    click($('[data-action="proto-discard"]'));
    await until(() => $('.jf-row'));
  });
  test('calendars and "Woche im Blick" name the team and project of a jour fixe', () => {
    const label = w.eval(`evLabel({ type: 'jf', title: 'Team-JF', projectId: ${JSON.stringify(pid)} })`);
    const p = w.eval(`project(${JSON.stringify(pid)}).name`);
    const t = w.eval(`team(project(${JSON.stringify(pid)}).teamId).name`);
    assert.equal(label, 'Team-JF · ' + t + ' / ' + p);
  });
});

describe('minutes form', () => {
  test('no "T" icon in the status bar; topics and lines are filled in and saved; an action becomes a task', async () => {
    click($('.jf-active .jf-hit'));
    await until(() => $('.proto-edit'));
    assert.equal($('.proto-edit .doc-commit svg'), null, 'no icon in the status bar');
    click($('[data-action="proto-add-topic"]'));
    await until(() => $('.pe-topic'));
    const title = $('.pe-topic input[data-path="topics.0.title"]');
    title.value = 'Budget';
    title.dispatchEvent(new w.Event('input', { bubbles: true }));
    const type = $('.pe-topic select[data-path="topics.0.items.0.type"]');
    type.value = 'A';
    type.dispatchEvent(new w.Event('change', { bubbles: true }));
    const text = $('.pe-topic textarea[data-path="topics.0.items.0.text"]');
    text.value = 'Angebot einholen';
    text.dispatchEvent(new w.Event('input', { bubbles: true }));
    const due = $('.pe-topic input[data-path="topics.0.items.0.due"]');
    due.value = '2030-01-10';
    due.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(200);
    click($('[data-action="proto-save"]'));
    await until(() => $('.pt'));
    assert.match($('.pt').textContent, /Budget/);
    const before = w.eval('S.tasks.length');
    click($('[data-action="proto-task"]'));
    await until(() => w.eval('S.tasks.length') > before && $('.pt .md-task'));
    assert.ok(w.eval("S.tasks.some(t => t.title === 'Angebot einholen' && t.dueDate === '2030-01-10')"));
  });
  test('a text field dragged larger keeps its size when a topic is added', async () => {
    click($('[data-action="proto-edit"]'));
    await until(() => $('.proto-edit textarea[data-path]'));
    const ta = $('.proto-edit textarea[data-path="topics.0.items.0.text"]');
    ta.style.height = '180px';
    click($('[data-action="proto-add-topic"]'));
    await until(() => $$('.pe-topic').length === 2);
    assert.equal($('.proto-edit textarea[data-path="topics.0.items.0.text"]').style.height, '180px');
    click($('[data-action="proto-discard"]'));
  });
});
