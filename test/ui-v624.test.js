/** v62.4: due date dialog, picture preview under the description, one word mark, availability per team, short calendar blocks. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
let tid;
before(async () => {
  w = await bootApp({ lang: 'de', beforeStart: win => { win.TextDecoder = TextDecoder; } });
  tid = w.eval('project(S.projects[0].id).teamId');
  await w.eval(`(async () => {
    const people = S.users.slice(0, 3).map(u => u.email);
    const s = await call('jf.saveSeries', { teamId: ${JSON.stringify(tid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: people });
    const past = Shared.jfDates(s, Shared.addDays(TODAY(), -13), Shared.addDays(TODAY(), -1))[0];
    const m = await call('jf.meeting', { seriesId: s.id, date: past });
    const model = Shared.protoFromText(m.content);
    model.topics.push({ id: 'ta', title: 'Altes Thema', kind: 'B', body: 'Beschluss', owners: [people[0]], items: [] });
    await call('docs.save', { projectId: m.projectId, seriesId: s.id, date: past, title: m.title, content: Shared.protoToText(model) });
    S.jf = await call('jf.list', {});
  })()`);
});
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const $$ = sel => [...w.document.querySelectorAll(sel)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const submit = () => $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }
const leave = () => { if ($('[data-action="proto-discard"]')) click($('[data-action="proto-discard"]')); w.eval('closeModal()'); };
async function openSaved() {
  w.eval(`S.doc = null; S.protoEdit = null; S.teamTab = 'jf'; go('team', ${JSON.stringify(tid)})`);
  await until(() => $('.jfo-tbl'));
  const m = w.eval(`jfData().minutes.find(x => x.projectId === 'team:${tid}')`);
  await w.eval(`jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
  await until(() => $('.jfs .tc'));
}

describe('due date and pictures in the minutes mask', () => {
  test('"Fälligkeit" opens a dialog with a date field; applying sets the date, removing clears it', async () => {
    await openSaved();
    click($('.tc.open [data-action="tc-due"]'));
    await until(() => $('#modal-root input[type="date"]'));
    assert.ok($('.proto-edit'), 'the first change starts the form');
    assert.equal($('.tc-dw'), null, 'no hidden date field behind the button');
    change($('#modal-root input[type="date"]'), '2026-12-24');
    submit();
    await until(() => !$('#modal-root input'));
    assert.equal(w.eval('S.protoEdit.model.topics[0].due'), '2026-12-24');
    assert.match($('.tc.open [data-action="tc-due"]').textContent, /24/);
    click($('.tc.open [data-action="tc-due"]'));
    await until(() => $('#modal-root input[type="date"]'));
    click($('#modal-root [data-action="modal-danger"]'));
    await until(() => !$('#modal-root input'));
    assert.equal(w.eval('S.protoEdit.model.topics[0].due'), '');
    leave();
  });
  test('a picture marker in the description shows as a picture under the field', async () => {
    await openSaved();
    click($('.tc-desc[data-action="tc-edit"]'));
    await until(() => $('.proto-edit textarea.tc-body'));
    const ta = $('.proto-edit textarea.tc-body');
    assert.equal($('.tc-prev').children.length, 0, 'nothing yet');
    input(ta, 'Ergebnis ![Bild](lf:fl_abc123) und mehr');
    assert.equal($$('.tc-prev .lf-thumb').length, 1, 'one preview for the marker');
    const first = $('.tc-prev .lf-thumb');
    input(ta, 'Ergebnis ![Bild](lf:fl_abc123) und mehr text');
    assert.equal($('.tc-prev .lf-thumb'), first, 'typing on does not redraw the picture');
    input(ta, 'ohne Bild');
    assert.equal($$('.tc-prev .lf-thumb').length, 0);
    leave();
  });
});

describe('look', () => {
  test('the word mark is one markup (mark + Lidl + Flow), independent of the theme', () => {
    const html = w.eval('logoFull()');
    assert.match(html, /logo-lock/);
    assert.match(html, /Lidl<b>Flow<\/b>/);
    assert.doesNotMatch(html, /on-light|on-dark|logo-dark/);
  });
  test('short calendar entries get the one-line layout, long ones keep two lines', () => {
    const html = w.eval(`blocksHtml([], [
      { id: 'e1', title: 'Kurzes JF', startDate: TODAY(), time: '09:00', duration: 15 },
      { id: 'e2', title: 'Workshop', startDate: TODAY(), time: '13:00', duration: 120 }])`);
    const box = w.document.createElement('div');
    box.innerHTML = html;
    const blocks = [...box.querySelectorAll('.blk-ev')];
    assert.equal(blocks.length, 2);
    assert.ok(blocks[0].classList.contains('short'), '15 minutes: one line');
    assert.ok(!blocks[1].classList.contains('short'), '2 hours: normal block');
    assert.match(blocks[0].getAttribute('title'), /Kurzes JF/, 'the full title is always in the tooltip');
  });
});

describe('availability: "all people" is no team', () => {
  test('the page data has no team warning for everybody, but the warnings of the real teams', async () => {
    const d = await w.eval(`call('availability', { teamId: '', weeks: 4 })`);
    assert.equal(d.all, true);
    assert.ok(d.team.every(x => x.warn === false), 'no warning over all people');
    assert.ok(Array.isArray(d.teamWarnings));
    const t = await w.eval(`call('availability', { teamId: ${JSON.stringify(tid)}, weeks: 4 })`);
    assert.equal(t.all, false);
    assert.equal(t.teamWarnings.length, 0);
  });
  test('the page says "all teams well staffed" instead of half of everybody', async () => {
    w.eval(`S.cap = { teamId: '', weeks: 4 }; go('capacity')`);
    await until(() => $('.banner'));
    const text = $('.banner').textContent;
    assert.doesNotMatch(text, /Hälfte des Teams/);
    assert.match(text, /Teams|Team/);
  });
});
