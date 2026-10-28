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
  test('one tab, meetings as rows: "Nächster: …" ahead, the plain date afterwards; no documents', async () => {
    w.eval(`S.projTab = 'jf'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('.jf-row'));
    assert.equal($$('.pj-tabs [data-v="docs"]').length, 0);
    assert.equal($$('[data-action="doc-new"]').length, 0, 'no plain documents any more');
    const rows = $$('.jf-row');
    assert.ok(rows.length >= 2);
    assert.match(rows[0].textContent, /Team-JF\s*Nächster: /);
    assert.doesNotMatch(rows[1].textContent, /Nächster/);
  });
  test('people: before the meeting everybody invited, afterwards only who missed it', () => {
    const rows = $$('.jf-row');
    assert.equal(rows[0].querySelectorAll('.avatar').length, 3);
    assert.match(rows[1].textContent, /Gefehlt:/);
    assert.equal(rows[1].querySelectorAll('.avatar').length, 1);
  });
  test('the whole row opens the meeting, also with the keyboard', async () => {
    const hit = $('.jf-row.next .jf-hit');
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
    click($('.jf-row.next .jf-hit'));
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
