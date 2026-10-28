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
    assert.equal($$('.jf-active .jf-row.next').length, 1, 'one "next" row per series');
    assert.match(top[0].textContent, /Team-JF\s*Nächster: /);
    // a past meeting of the last month without minutes stays on top, so its minutes can still be written
    const missing = w.eval(`jfMissing(${JSON.stringify(pid)}).map(x => x.date)`);
    assert.equal(top.length, 1 + missing.length);
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
    await until(() => $('#modal-root input[name="title"]'));
    await wait(150);
    assert.equal(w.eval('S.tasks.length'), before, 'the button only opens the form');
    assert.equal($('#modal-root input[name="title"]').value, 'Angebot einholen');
    assert.equal($('#modal-root input[name="due"]').value, '2030-01-10');
    $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
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
  test('the version list shows who changed what; any version opens read only', async () => {
    await until(() => $('[data-action="doc-versions"]'));
    click($('[data-action="doc-versions"]'));
    await until(() => $('#modal-root .ver-list'));
    const first = $('#modal-root .ver-list .li');
    assert.match(first.textContent, /aktuell/);
    assert.ok($('#modal-root [data-action="doc-version-view"]'));
    assert.match($('#modal-root .ver-list').textContent, /Thema|Zeile|geändert|Kopf/);
    click($$('#modal-root [data-action="doc-version-view"]').pop());
    await until(() => $('#modal-root .ver-view'));
    assert.ok($('#modal-root .ver-view .pt'), 'the minutes of that version');
    w.eval('closeModal()');
  });
});

describe('jour fixe v54', () => {
  test('a meeting with a time is a block on the time line of the week view, not in the all-day row', () => {
    const html = w.eval(`timeGridHtml(['2030-01-07'], { data: { events: [{ id: 'jf_a_2030-01-07', type: 'jf', title: 'Team-JF', startDate: '2030-01-07', endDate: '2030-01-07', time: '09:00', duration: 60, projectId: ${JSON.stringify(pid)} }, { id: 'ev1', title: 'Messe', startDate: '2030-01-07' }], holidays: [], absences: [], warnings: [] }, show: { events: true, tasks: false }, tasks: [] })`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    const blk = d.querySelector('.wk-col .blk-ev');
    assert.ok(blk, 'a block in the day column');
    assert.match(blk.textContent, /Team-JF/);
    assert.match(blk.textContent, /09:00 – 10:00/);
    assert.equal(blk.style.top, ((9 * 60 - 6 * 60) / 60 * 44) + 'px', 'starts at 09:00');
    assert.equal(blk.style.height, '44px', 'one hour high');
    assert.doesNotMatch(d.querySelector('.wk-a').textContent, /Team-JF/, 'not in the all-day row');
    assert.match(d.querySelector('.wk-a').textContent, /Messe/, 'events without a time stay in the all-day row');
  });
  test('links in texts become safe hyperlinks; nothing else does', () => {
    const html = w.eval(`linkify('See https://x.example/a?b=1&c=2, mail to mailto:a@b.de and javascript:alert(1) <b>')`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    const a = [...d.querySelectorAll('a')];
    assert.deepEqual(a.map(x => x.getAttribute('href')), ['https://x.example/a?b=1&c=2', 'mailto:a@b.de']);
    a.forEach(x => { assert.equal(x.getAttribute('target'), '_blank'); assert.match(x.getAttribute('rel'), /noopener/); });
    assert.equal(d.querySelector('b'), null, 'text is escaped');
    assert.match(d.textContent, /javascript:alert\(1\)/);
  });
  test('the Meet link sits in the row of the meeting, outside the part that opens the minutes', async () => {
    await w.eval(`(async () => { const s = jfData().series.find(x => x.projectId === ${JSON.stringify(pid)}); await call('jf.saveSeries', Object.assign({}, s, { meetLink: 'https://meet.google.com/abc-defg-hij' })); S.jf = await call('jf.list', {}); S.doc = null; S.protoEdit = null; S.projTab = 'jf'; go('project', ${JSON.stringify(pid)}); })()`);
    await until(() => $('.jf-active .jf-meet'));
    const a = $('.jf-active .jf-meet');
    assert.equal(a.getAttribute('href'), 'https://meet.google.com/abc-defg-hij');
    assert.match(a.getAttribute('rel'), /noopener/);
    assert.equal(a.closest('.jf-hit'), null);
  });
  test('a topic can be anchored in the form; the minutes show the anchor', async () => {
    click($('.jf-active .jf-hit'));
    await until(() => $('.proto-edit') || $('[data-action="proto-edit"]'));
    if (!$('.proto-edit')) { click($('[data-action="proto-edit"]')); await until(() => $('.proto-edit')); }
    if (!$('.pe-topic')) { click($('[data-action="proto-add-topic"]')); await until(() => $('.pe-topic')); }
    const title = $('.pe-topic input[data-path="topics.0.title"]');
    title.value = 'Dauerthema Budget';
    title.dispatchEvent(new w.Event('input', { bubbles: true }));
    const pin = $('.pe-topic [data-action="proto-pin"]');
    assert.equal(pin.getAttribute('aria-pressed'), 'false');
    click(pin);
    await until(() => $('.pe-topic [data-action="proto-pin"][aria-pressed="true"]'));
    assert.equal(w.eval('S.protoEdit.model.topics[0].pinned'), true);
    click($('[data-action="proto-save"]'));
    await until(() => $('.pt .pt-pin'));
    assert.ok($('.pt .pt-pin'), 'anchor marker in the minutes');
  });
  test('a topic becomes a task: the project of the jour fixe is preselected, another one can be chosen', async () => {
    const btn = $('.pt [data-action="proto-topic-task"]');
    assert.ok(btn, 'button per topic');
    click(btn);
    await until(() => $('#modal-root select[name="projectId"]'));
    assert.equal($('#modal-root select[name="projectId"]').value, pid);
    const before = w.eval('S.tasks.length');
    $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.eval('S.tasks.length') > before);
    assert.ok(w.eval(`S.tasks.some(t => t.title === 'Dauerthema Budget' && t.projectId === ${JSON.stringify(pid)})`));
    await until(() => $('.pt .pt-topic .md-task'));
    assert.ok($('.pt .pt-topic .md-task'), 'the topic links to its task');
  });
  test('the team page has a "Jour Fixe" tab with the meetings of its projects', async () => {
    const tid = w.eval(`project(${JSON.stringify(pid)}).teamId`);
    w.eval(`S.doc = null; S.protoEdit = null; S.teamTab = 'jf'; go('team', ${JSON.stringify(tid)})`);
    await until(() => $('.jf-row'));
    assert.ok($('.tabs [data-action="team-tab"][data-v="jf"]'));
    assert.match($('.jf-active').textContent, /Team-JF/);
  });
  test('the series form adds a whole project group as participants with one click', async () => {
    const tid = w.eval(`project(${JSON.stringify(pid)}).teamId`);
    w.eval(`jfModal(null, ${JSON.stringify(pid)}, ${JSON.stringify(tid)})`);
    await until(() => $('#modal-root [data-action="jf-add-group"]'));
    const box = $('#modal-root .pp-field[data-pp="attendees"]');
    w.eval(`ppSet($('#modal-root .pp-field[data-pp="attendees"]'), [])`);
    click($('#modal-root [data-action="jf-add-group"][data-id="' + pid + '"]'));
    const want = w.eval(`projectMembers(project(${JSON.stringify(pid)}))`);
    const got = box.querySelector('input[type=hidden]').value.split(',').filter(Boolean);
    assert.deepEqual(got.slice().sort(), JSON.parse(JSON.stringify(want)).slice().sort());
    assert.ok($('#modal-root select[name="projectId"]'), 'from the team page: the project of the series can be chosen');
    w.eval('closeModal()');
  });
});

describe('tasks from the minutes in a form (v57)', () => {
  const submit = () => $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  /** Opens the form of the next meeting with a topic of three lines. */
  async function formWithTopic() {
    w.eval(`S.doc = null; S.protoEdit = null; S.projTab = 'jf'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('.jf-active .jf-hit'));
    click($('.jf-active .jf-hit'));
    await until(() => $('.proto-edit') || $('[data-action="proto-edit"]'));
    if (!$('.proto-edit')) { click($('[data-action="proto-edit"]')); await until(() => $('.proto-edit')); }
    w.eval(`(() => { const m = S.protoEdit.model; m.topics.push({ id: 'tq', title: 'Go-Live', owner: S.me.email, items: [
      { id: 'q1', type: 'A', text: 'Server buchen', owner: S.users[1].email, due: '2030-02-01', done: false, taskId: '' },
      { id: 'q2', type: 'I', text: 'Budget ist frei', owner: '', due: '', done: false, taskId: '' },
      { id: 'q3', type: 'A', text: 'Doku schreiben', owner: '', due: '2030-02-03', done: false, taskId: '' }] }); protoRender(); })()`);
    await until(() => $$('.pe-topic').length && $$('.pe-topic').pop().querySelector('[data-action="pe-task"]'));
    return w.eval("S.protoEdit.model.topics.length - 1");
  }
  test('before "Übernehmen": a topic becomes one task, only the ticked lines its sub-tasks; the form keeps the links', async () => {
    const k = await formWithTopic();
    const before = w.eval('S.tasks.length');
    click($('[data-action="pe-task"][data-t="' + k + '"]:not([data-i])'));
    await until(() => $$('#modal-root input[name="pick"]').length === 3);
    assert.equal(w.eval('S.tasks.length'), before, 'nothing made yet');
    assert.equal($('#modal-root select[name="projectId"]').value, pid, 'the project of the jour fixe');
    assert.equal($$('#modal-root input[name="pick"]:checked').length, 3, 'all lines ticked at first');
    const all = $('#modal-root [data-on-change="jm-all"]');
    all.checked = false;
    all.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal($$('#modal-root input[name="pick"]:checked').length, 0, '"Alle auswählen" clears and ticks all');
    $('#modal-root input[name="pick"][value="q1"]').checked = true;
    $('#modal-root input[name="pick"][value="q3"]').checked = true;
    submit();
    await until(() => w.eval('S.tasks.length') === before + 3);
    const parent = w.eval("S.tasks.find(t => t.title === 'Go-Live')");
    assert.ok(parent, 'one task for the topic');
    const subs = w.eval(`S.tasks.filter(t => t.parentId === ${JSON.stringify(parent.id)}).map(t => t.title).sort()`);
    assert.deepEqual(JSON.parse(JSON.stringify(subs)), ['Doku schreiben', 'Server buchen']);
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].taskId`) === parent.id);
    assert.ok(w.eval(`S.protoEdit.model.topics[${k}].items[0].taskId`), 'the ticked line keeps its task');
    assert.equal(w.eval(`S.protoEdit.model.topics[${k}].items[1].taskId`), '', 'the other one not');
    await until(() => $$('.pe-topic').pop().querySelector('.pe-has'));
    assert.ok($$('.pe-topic').pop().querySelector('.pe-has'), 'the form shows the link instead of the button');
  });
  test('"Übernehmen" keeps the links and makes nothing again; the overview comes along, no extra request', async () => {
    const n = w.eval('S.tasks.length');
    const calls = [];
    w.eval('window.__calls = []; const oc = call; call = function (m) { window.__calls.push(m); return oc.apply(null, arguments); }');
    click($('[data-action="proto-save"]'));
    await until(() => $('.pt') && !$('.proto-edit'));
    await wait(100);
    const sent = JSON.parse(w.eval('JSON.stringify(window.__calls)'));
    calls.push(...sent);
    assert.equal(w.eval('S.tasks.length'), n);
    assert.deepEqual(sent.filter(m => m !== 'docs.flush'), ['docs.save'], 'one request while the person waits (then the Drive flush)');
    assert.ok(sent.indexOf('docs.flush') >= 0, 'Drive follows in the background');
    assert.ok($$('.pt .pt-topic .md-task').length >= 1, 'the saved minutes link the topic to its task');
  });
  test('saved minutes: a line opens the form with person and date; a topic with a task offers no second one', async () => {
    const btn = $$('.pt [data-action="proto-task"]')[0];
    if (btn) {
      click(btn);
      await until(() => $('#modal-root select[name="owner"]'));
      assert.ok($('#modal-root input[name="due"]'));
      w.eval('closeModal()');
    }
    const k = w.eval("Shared.protoFromText(S.doc.content).topics.findIndex(t => t.title === 'Go-Live')");
    assert.equal($('.pt [data-action="proto-topic-task"][data-t="' + k + '"]'), null);
  });
});
