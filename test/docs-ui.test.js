/** Jour fixe of a team in the page: the table of meetings, the mask with topic cards, results, closing, tasks from topics. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
let pid;
let tid;
let place;
before(async () => {
  w = await bootApp({ lang: 'de', beforeStart: win => { win.TextDecoder = TextDecoder; } });
  pid = w.eval('S.projects[0].id');
  tid = w.eval(`project(${JSON.stringify(pid)}).teamId`);
  place = 'team:' + tid;
  // a series with a past meeting (minutes saved, one person absent) and upcoming ones
  await w.eval(`(async () => {
    const people = S.users.slice(0, 3).map(u => u.email);
    const s = await call('jf.saveSeries', { teamId: ${JSON.stringify(tid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: people });
    const past = Shared.jfDates(s, Shared.addDays(TODAY(), -13), Shared.addDays(TODAY(), -1))[0];
    const m = await call('jf.meeting', { seriesId: s.id, date: past });
    const model = Shared.protoFromText(m.content);
    model.present = people.slice(0, 2); model.absent = [people[2]];
    model.topics.push({ id: 'ta', title: 'Altes Thema', kind: 'B', body: 'Beschluss: wir machen weiter', owners: [people[0]], items: [] });
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
const tab = async () => {
  w.eval(`S.doc = null; S.protoEdit = null; S.teamTab = 'jf'; go('team', ${JSON.stringify(tid)})`);
  await until(() => $('.jfo-tbl'));
};
/** Opens the saved minutes (past meeting) in the read-only view. */
async function openSaved() {
  await tab();
  const m = w.eval(`jfData().minutes.find(x => x.projectId === ${JSON.stringify(place)})`);
  await w.eval(`jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
  await until(() => $('.jfs .tc'));
  return m;
}
async function openEditor() {
  await openSaved();
  // no "Edit" button: the first change starts the form (here a click into the description of the open first topic)
  await until(() => $('.tc-desc[data-action="tc-edit"]'));
  click($('.tc-desc[data-action="tc-edit"]'));
  await until(() => $('.proto-edit'));
}

describe('jour fixe of a team: the overview', () => {
  test('the overview: header, filters, KW chip, date, topics, tasks, last change; no jour fixe tab in the project any more', async () => {
    await tab();
    assert.equal($$('.pj-tabs [data-v="jf"]').length, 0, 'no tab in the project');
    assert.ok($('.pj-tabsin [data-action="team-tab"][data-v="jf"]'), 'the tab is in the team');
    assert.match($('.jfo-head h2').textContent, /Jour Fixe – Übersicht/);
    assert.doesNotMatch($('.jfo-head p').textContent, /Single Source/i, 'no slogan in the header');
    assert.ok($('.jfo-filters select[data-on-change="jf-year"]'), 'year');
    assert.ok($('.jfo-filters input[type="search"]'), 'search');
    assert.ok($('.jfo-filters select[data-on-change="jf-filter"]'), 'filter');
    const heads = $$('.jfo-th [role="columnheader"]').map(x => x.textContent.trim());
    assert.deepEqual(heads.slice(0, 5), ['KW', 'Datum', 'Themen', 'Aufgaben', 'Letzte Änderung']);
    const next = $('.jfo-row.next');
    assert.ok(next, 'the next meeting is marked');
    assert.match(next.textContent, /Team-JF/);
    assert.match(next.querySelector('.jfo-kw b').textContent, /^KW \d+$/);
    assert.match(next.querySelector('.jfo-kw small').textContent, /^\/ \d{4}$/);
    assert.match(next.querySelector('.jfo-kw').title, /Geplant|Protokoll fehlt|In Bearbeitung/);
    assert.match(next.children[1].textContent, /^[A-Z][a-z], \d\d\. /, 'day like "Do, 05. Nov."');
    assert.equal(next.querySelectorAll('.jfo-n').length, 2, 'tasks made and done');
    assert.ok($('[data-action="jf-new"]'), '+ Neuer Jour Fixe');
  });
  test('saved minutes: the status on the week chip, the last change as "Heute, 14:29", tasks made and done', async () => {
    const row = $$('.jfo-row').find(r => !r.classList.contains('next') && r.querySelector('[data-doc]'));
    assert.ok(row, 'a row with saved minutes');
    assert.match(row.querySelector('.jfo-kw').title, /In Bearbeitung/);
    assert.match(row.children[4].textContent, /^(Heute|Gestern), \d\d:\d\d$|^\d\d\. \S+, \d\d:\d\d$/);
    assert.equal(w.eval(`jfStatus({ people: { closed: true } }, false).label`), 'Abgeschlossen');
    assert.equal(w.eval(`jfStatus(null, false).label`), 'Protokoll fehlt');
    assert.equal(w.eval(`jfStamp(new Date().toISOString()).slice(0, 5)`), 'Heute');
    assert.equal(w.eval(`jfWeekYear('2027-01-01')`), '2026', 'calendar week 53 of 2026');
  });
  test('the whole row opens the meeting through one button; Meet is a chip of the sheet', async () => {
    await w.eval(`(async () => { const s = jfData().series.find(x => x.projectId === ${JSON.stringify(place)}); await call('jf.saveSeries', Object.assign({}, s, { meetLink: 'https://meet.google.com/abc-defg-hij' })); S.jf = await call('jf.list', {}); render(); })()`);
    const hit = $('.jfo-row.next .jf-hit');
    assert.equal(hit.tagName, 'BUTTON');
    assert.match(hit.getAttribute('aria-label'), /^Protokoll (vorbereiten|öffnen): Team-JF, /);
    click(hit);
    await until(() => $('.jfs .jfs-chips a[href^="https://meet.google.com/"]'));
    assert.match($('.jfs .jfs-chips a').getAttribute('rel'), /noopener/);
    assert.match($('.jfs-chips').textContent, /Teilnehmende/);
    assert.match($('.jfs-chips').textContent, /\d\d:\d\d – \d\d:\d\d/, 'date and time');
    click($('[data-action="jf-back"]'));
    assert.ok($('.jfo-tbl'), 'back at the overview (nothing was changed)');
  });
  test('with a Meet link the row shows a camera that opens the Meet (not the minutes); without a link there is none', async () => {
    await tab();
    const cam = $('.jfo-row.next .jfo-meet');
    assert.ok(cam, 'the series has a Meet link now');
    assert.match(cam.getAttribute('href'), /^https:\/\/meet\.google\.com\//);
    assert.equal(cam.getAttribute('target'), '_blank');
    assert.match(cam.getAttribute('rel'), /noopener/);
    assert.ok(cam.getAttribute('aria-label'));
    assert.equal(cam.closest('.jfo-row').querySelector('.jf-hit').dataset.action, 'jf-open', 'the row button stays a separate element');
    await w.eval(`(async () => { const s = jfData().series.find(x => x.projectId === ${JSON.stringify(place)}); await call('jf.saveSeries', Object.assign({}, s, { meetLink: '' })); S.jf = await call('jf.list', {}); render(); })()`);
    await tab();
    assert.equal($('.jfo-meet'), null, 'no link, no camera');
  });
  test('9 entries per page with a pager and "1 – 9 von n" (200+ meetings stay fast)', () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ id: 'dc_' + i, projectId: place, seriesId: 'jf_x', date: w.eval(`Shared.addDays('2020-01-06', ${(i % 52) * 7})`), title: 'Alt', people: { present: [], absent: [] } }));
    const html = w.eval(`(() => { const keep = S.jf; S.jf = { series: [], minutes: ${JSON.stringify(many)} }; S.jfPage = 0; S.jfYear = undefined; const h = jfTeamTab(team(${JSON.stringify(tid)})); S.jf = keep; return h; })()`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    assert.equal(d.querySelectorAll('.jfo-row').length, 9);
    assert.match(d.querySelector('.jfo-pager').textContent, /1 – 9 von 230/);
    assert.equal(d.querySelectorAll('.jfo-pager .jfo-pg').length, 7, 'previous, five pages, next');
    assert.ok(d.querySelector('[data-action="jf-page"][data-v="1"]'));
    assert.ok(d.querySelector('[data-action="jf-page"][disabled]'), 'no page before the first');
    assert.equal(d.querySelector('.jfo-pg.on').textContent, '1');
  });
  test('the filters narrow the list and draw only the list (the search field keeps its focus); KW sorts', async () => {
    await tab();
    const n = $$('.jfo-row').length;
    assert.ok(n >= 2);
    const box = $('.jfo-filters input[type="search"]');
    input(box, 'zzz-nichts');
    assert.equal($$('.jfo-row').length, 0);
    assert.match($('#jf-list').textContent, /Keine Einträge/);
    assert.equal($('.jfo-filters input[type="search"]'), box, 'the same field');
    input(box, '');
    assert.equal($$('.jfo-row').length, n);
    change($('select[data-on-change="jf-filter"]'), 'done');
    assert.equal($$('.jfo-row').length, 0, 'no closed meeting');
    change($('select[data-on-change="jf-filter"]'), 'all');
    const weeks = () => $$('.jfo-row .jfo-kw b').map(x => x.textContent);
    const first = weeks();
    click($('[data-action="jf-sort"]'));
    assert.notDeepEqual(weeks(), first, 'the other way round');
    click($('[data-action="jf-sort"]'));
    assert.deepEqual(weeks(), first);
  });
  test('calendars name the team of a jour fixe', () => {
    assert.equal(w.eval(`evLabel({ type: 'jf', title: 'Team-JF', projectId: ${JSON.stringify(place)} })`), 'Team-JF · ' + w.eval(`team(${JSON.stringify(tid)}).name`));
  });
  test('the series form belongs to the team and offers its people', async () => {
    w.eval(`jfModal(null, ${JSON.stringify(tid)})`);
    await until(() => $('#modal-root .pp-field[data-pp="attendees"]'));
    assert.equal($('#modal-root select[name="projectId"]'), null, 'no project to choose');
    assert.equal($('#modal-root [data-action="jf-add-group"]'), null);
    w.eval('closeModal()');
  });
});

describe('the mask: topic cards', () => {
  test('a new topic opens as a card: title, type, description that grows, links / screenshots / files, action bar', async () => {
    await openEditor();
    click($('[data-action="proto-add-topic"]'));
    await until(() => $$('.tc').length >= 2);
    const card = $$('.tc').pop();
    assert.ok(card.classList.contains('open'), 'a new topic is open');
    const k = $$('.tc').length - 1;
    input(card.querySelector('.tc-title'), 'Budget 2031');
    change(card.querySelector('.tc-kind'), 'A');
    const body = $('.proto-edit .tc-body[data-path="topics.' + k + '.body"]');
    assert.ok(body, 'description field');
    input(body, 'Zeile 1\nZeile 2\nhttps://x.example/y');
    assert.equal(w.eval(`S.protoEdit.model.topics[${k}].body`), 'Zeile 1\nZeile 2\nhttps://x.example/y');
    assert.equal(w.eval(`S.protoEdit.model.topics[${k}].kind`), 'A');
    assert.equal($$('.tc-col h4').length >= 3, true, 'three columns');
    const bar = [...$$('.tc-bar')].pop();
    for (const word of ['In Aufgabe übernehmen', 'Projekt zuordnen', 'Verantwortlich', 'Fälligkeit']) assert.match(bar.textContent, new RegExp(word));
  });
  test('responsible people and the project are only notes: no task is made', async () => {
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    const before = w.eval('S.tasks.length');
    const other = w.eval('S.users.find(u => u.email !== S.me.email).email');
    w.eval(`protoSet('topics.${k}.owners', [${JSON.stringify(other)}]); protoRender()`);
    click($('[data-action="tc-project"][data-t="' + k + '"]'));
    await until(() => $('#modal-root .ptree'));
    assert.ok($('#modal-root input[name="projectId"][value=""]'), 'an empty choice');
    assert.equal($$('#modal-root .ptr-team').length, $$('#modal-root .ptr-team summary svg').length, 'every team has its small arrow');
    assert.ok($('#modal-root .ptr-team[open] input[name="projectId"][value="' + pid + '"]'), 'the team of the jour fixe is open');
    $('#modal-root input[name="projectId"][value="' + pid + '"]').checked = true;
    submit();
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].projectId`) === pid);
    await until(() => $$('.tc').pop().querySelector('.tc-proj'));
    assert.ok($$('.tc').pop().querySelector('.tc-own .avatar'), 'person as icon');
    assert.equal(w.eval('S.tasks.length'), before);
  });
  test('a link is added and removed; a link that is no address is refused', async () => {
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    click($('[data-action="tc-link"][data-t="' + k + '"]'));
    await until(() => $('#modal-root input[name="url"]'));
    input($('#modal-root input[name="url"]'), 'javascript:alert(1)');
    submit();
    await wait(50);
    assert.equal(w.eval(`S.protoEdit.model.topics[${k}].links.length`), 0);
    input($('#modal-root input[name="url"]'), 'https://example.com/doc');
    input($('#modal-root input[name="title"]'), 'Doku');
    submit();
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].links.length`) === 1);
    await until(() => $$('.tc').pop().querySelector('.tc-col .tc-lnk'));
    click($$('.tc').pop().querySelector('[data-action="tc-rm"][data-k="link"]'));
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].links.length`) === 0);
  });
  test('a screenshot pasted into the description goes in as a marker; a file is listed under the topic', async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    const ta = $('.proto-edit .tc-body[data-path="topics.' + k + '.body"]');
    const file = new w.File([Uint8Array.from(Buffer.from(PNG, 'base64'))], 'tafel.png', { type: 'image/png' });
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { files: [file] };
    ta.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
    await until(() => /!\[tafel\.png\]\(lf:fl_[a-z0-9]+\)/.test(w.eval(`S.protoEdit.model.topics[${k}].body`)), 6000);
    assert.match(w.eval(`S.protoEdit.model.topics[${k}].body`), /!\[tafel\.png\]\(lf:fl_[a-z0-9]+\)/);
    // an attachment: PDF content is checked by the server
    await w.eval("loadChunk('Images')");
    const pdf = new w.File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'angebot.pdf', { type: 'application/pdf' });
    const r = await w.eval(`(async f => fileUpload(f, { kind: 'project', projectId: S.protoEdit.projectId }, true))`)(pdf);
    assert.equal(r.mime, 'application/pdf');
    w.eval(`S.protoEdit.model.topics[${k}].files.push(${JSON.stringify({ id: r.id, name: r.name, mime: r.mime, size: r.size })}); protoRender()`);
    await until(() => $$('.tc').pop().querySelector('.tc-col [data-action="tc-get"]'));
    assert.match($$('.tc').pop().querySelector('[data-action="tc-get"]').textContent, /angebot\.pdf/);
    const bad = await w.eval(`(async f => fileUpload(f, { kind: 'project', projectId: S.protoEdit.projectId }, true))`)(new w.File(['x'], 'run.exe', { type: 'application/x-msdownload' }));
    assert.equal(bad, null, 'a file type that is not allowed');
  });
  test('Übernehmen: the card shows read only with its chips; the results tab lists decisions and tasks', async () => {
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    click($('[data-action="proto-save"]'));
    await until(() => $('.dv-save.ok') && $('.jfs .tc') && !$('.proto-edit'));
    const card = $$('.tc').pop();
    assert.match(card.textContent, /Budget 2031/);
    assert.ok(card.querySelector('.chip.kind.k-A'), 'type chip');
    assert.ok(card.querySelector('.tc-proj'), 'project chip');
    // a topic made in the form stays open
    if (!card.classList.contains('open')) click(card.querySelector('[data-action="tc-toggle"]'));
    await until(() => $$('.tc').pop().classList.contains('open'));
    assert.match($$('.tc').pop().textContent, /Zeile 1\s*Zeile 2/);
    assert.ok($$('.tc').pop().querySelector('.tc-text a[href="https://x.example/y"]'), 'links in the description are links');
    assert.ok($$('.tc').pop().querySelector('.lf-thumb'), 'the screenshot in the description is a preview');
    assert.ok(k >= 1);
    click($('[data-action="jf-view"][data-v="results"]'));
    await until(() => $('.pr-sec'));
    assert.match($('.jfs').textContent, /Beschluss: wir machen weiter/, 'the decision');
    assert.match($('.jfs').textContent, /Budget 2031/, 'the task topic');
    click($('[data-action="jf-view"][data-v="topics"]'));
  });
  test('the version list shows who changed what; any version opens read only', async () => {
    await until(() => $('[data-action="jf-more"]'));
    click($('[data-action="jf-more"]'));
    await until(() => $('#modal-root [data-action="jf-more-versions"]'));
    click($('#modal-root [data-action="jf-more-versions"]'));
    await until(() => $('#modal-root .ver-list .li'));
    assert.match($('#modal-root .ver-list .li').textContent, /aktuell/);
    click($$('#modal-root [data-action="doc-version-view"]').pop());
    await until(() => $('#modal-root .ver-view .pt'));
    assert.ok($('#modal-root .ver-view .pt'), 'the topics of that version');
    w.eval('closeModal()');
  });
});

describe('closing a meeting and anchoring', () => {
  test('"Abschließen" marks the meeting closed; editing is off until "Wieder öffnen"', async () => {
    await openSaved();
    assert.ok($('.tc-desc[data-action="tc-edit"]'), 'a click into the text starts the form');
    assert.equal($('[data-action="proto-edit"]'), null, 'no "Edit" step');
    click($('[data-action="proto-close"]'));
    await until(() => $('.dv-save.ok') && /Abgeschlossen/.test($('.jfs-head .chip').textContent));
    assert.equal($('.tc-desc[data-action="tc-edit"]'), null, 'no editing while closed');
    assert.match($('[data-action="proto-close"]').textContent, /Wieder öffnen/);
    const m = w.eval(`jfData().minutes.find(x => x.id === S.doc.id)`);
    assert.equal(m.people.closed, true, 'the table knows');
    click($('[data-action="proto-close"]'));
    await until(() => $('.dv-save.ok') && $('.tc-desc[data-action="tc-edit"]'));
    assert.match($('.jfs-head .chip').textContent, /In Bearbeitung/);
  });
  test('a topic can be anchored in the card; the minutes show the anchor', async () => {
    await openEditor();
    click($('.tc [data-action="proto-pin"]'));
    await until(() => $('.tc [data-action="proto-pin"][aria-pressed="true"]'));
    assert.equal(w.eval('S.protoEdit.model.topics[0].pinned'), true);
    click($('[data-action="proto-save"]'));
    await until(() => $('.dv-save.ok') && $('.jfs .chip.pin'));
    assert.match($('.jfs .chip.pin').textContent, /Fixiert/);
  });
});

describe('tasks from topics', () => {
  /** Opens the form of the next meeting with a topic of three lines and two responsible people. */
  async function formWithTopic(id, title, lines) {
    id = id || 'tq'; title = title || 'Go-Live';
    await tab();
    click($('.jfo-row.next .jf-hit'));
    await until(() => $('.proto-edit') || $('.tc-desc[data-action="tc-edit"]'));
    if (!$('.proto-edit')) { click($('.tc-desc[data-action="tc-edit"]')); await until(() => $('.proto-edit')); }
    const items = lines === undefined ? [
      { id: 'q1', type: 'A', text: 'Server buchen', owner: w.eval('S.users[1].email'), due: '2030-02-01', done: false, taskId: '' },
      { id: 'q2', type: 'I', text: 'Budget ist frei', owner: '', due: '', done: false, taskId: '' },
      { id: 'q3', type: 'A', text: 'Doku schreiben', owner: '', due: '2030-02-03', done: false, taskId: '' }] : lines;
    w.eval(`(() => { const m = S.protoEdit.model; m.topics.push({ id: ${JSON.stringify(id)}, title: ${JSON.stringify(title)}, kind: 'A', owners: [S.me.email], items: ${JSON.stringify(items)} }); S.tcOpen = { ${id}: true }; protoRender(); })()`);
    await until(() => $('.tc.open [data-action="pe-task"][data-t]:not([data-i])'));
    return w.eval('S.protoEdit.model.topics.length - 1');
  }
  test('"In Aufgabe übernehmen" without project: the task goes to the team and the people; the topic keeps them as responsible', async () => {
    const k = await formWithTopic();
    const before = w.eval('S.tasks.length');
    click($('.tc [data-action="pe-task"][data-t="' + k + '"]:not([data-i])'));
    await until(() => $$('#modal-root input[name="pick"]').length === 3);
    assert.equal(w.eval('S.tasks.length'), before, 'nothing made yet');
    assert.equal($('#modal-root input[name="target"]:checked').value, 'person', 'no project chosen: the people');
    assert.ok($('#modal-root input[name="target"][value="team"]') && $('#modal-root input[name="target"][value="project"]'), 'team, project, person');
    assert.ok($('#modal-root .pp-field[data-pp="assignees"]'), 'several people can be responsible');
    const other = w.eval('S.users.find(u => u.email !== S.me.email).email');
    w.eval(`ppSet($('#modal-root .pp-field[data-pp="assignees"]'), [S.me.email, ${JSON.stringify(other)}])`);
    $('#modal-root input[name="pick"][value="q2"]').checked = false;
    submit();
    await until(() => w.eval('S.tasks.length') >= before + 3);
    const parent = w.eval("S.tasks.find(t => t.title === 'Go-Live')");
    assert.ok(parent, 'one task for the topic');
    assert.equal(parent.projectId, '', 'not in a project');
    assert.deepEqual(JSON.parse(JSON.stringify(parent.teams)), [tid], 'but in the team');
    assert.deepEqual(JSON.parse(JSON.stringify(parent.assignees)).sort(), [w.eval('S.me.email'), other].sort());
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].taskId`) === parent.id);
    assert.ok(w.eval(`S.protoEdit.model.topics[${k}].owners.includes(${JSON.stringify(other)})`), 'the person is responsible on the topic too');
    await until(() => $$('.tc').pop().querySelector('.tc-task'));
    assert.match($$('.tc').pop().querySelector('.tc-task').textContent, /In Aufgabe/);
  });
  test('"Übernehmen" keeps the links and makes nothing again; one request while the person waits', async () => {
    const n = w.eval('S.tasks.length');
    w.eval('window.__calls = []; const oc = call; call = function (m) { window.__calls.push(m); return oc.apply(null, arguments); }');
    click($('[data-action="proto-save"]'));
    await until(() => $('.dv-save.ok') && !$('.proto-edit'));
    await wait(100);
    const sent = JSON.parse(w.eval('JSON.stringify(window.__calls)'));
    assert.equal(w.eval('S.tasks.length'), n);
    assert.deepEqual(sent.filter(m => m !== 'docs.flush'), ['docs.save']);
    assert.ok(sent.indexOf('docs.flush') >= 0, 'Drive follows in the background');
    assert.ok($$('.tc .tc-task').length >= 1);
  });
  test('deleting a task made from a topic frees the topic: the link is gone at once', async () => {
    const id = w.eval(`Shared.protoFromText(S.doc.content).topics.find(t => t.title === 'Go-Live').taskId`);
    const before = $$('.tc .tc-task').length;
    w.eval(`deleteWithUndo(task(${JSON.stringify(id)}))`);
    await until(() => $$('.tc .tc-task').length < before);
    assert.equal($('.tc-task[data-id="' + id + '"]'), null);
  });
  test('"Team": all members get the task and become responsible for the topic; no project, no people field', async () => {
    const k = await formWithTopic('tt', 'Für alle', []);
    click($('.tc.open [data-action="pe-task"][data-t="' + k + '"]:not([data-i])'));
    await until(() => $('#modal-root input[name="target"]'));
    const r = $('#modal-root input[name="target"][value="team"]');
    r.checked = true;
    change(r, 'team');
    assert.equal($('#modal-root .jm-sec[data-for="project person"]').hidden, true, 'the people field is off');
    assert.equal($('#modal-root .jm-sec[data-for="project"]').hidden, true);
    assert.equal($('#modal-root .jm-sec[data-for="team"]').hidden, false);
    assert.match($('#modal-root .jm-sec[data-for="team"]').textContent, /Alle \d+ Mitglieder/);
    submit();
    await until(() => w.eval("S.tasks.some(t => t.title === 'Für alle')"));
    const t = JSON.parse(w.eval("JSON.stringify(S.tasks.find(t => t.title === 'Für alle'))"));
    const members = JSON.parse(w.eval(`JSON.stringify(teamMembers(team(${JSON.stringify(tid)})))`));
    assert.deepEqual(t.assignees.slice().sort(), members.slice().sort());
    assert.deepEqual(t.teams, [tid]);
    assert.equal(t.projectId, '');
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].taskId`) === t.id);
    assert.deepEqual(JSON.parse(w.eval(`JSON.stringify(S.protoEdit.model.topics[${k}].owners)`)).sort(), members.slice().sort(), 'the team is responsible');
  });
  test('"Projekt": a project must be chosen; the task lands in it and the topic notes the project', async () => {
    const k = await formWithTopic('tp', 'Im Projekt', []);
    click($('.tc.open [data-action="pe-task"][data-t="' + k + '"]:not([data-i])'));
    await until(() => $('#modal-root input[name="target"]'));
    const r = $('#modal-root input[name="target"][value="project"]');
    r.checked = true;
    change(r, 'project');
    assert.equal($('#modal-root .jm-sec[data-for="project"]').hidden, false);
    assert.ok($('#modal-root .ptr-team summary svg'), 'teams with a small arrow');
    submit();
    await wait(100);
    assert.equal(w.eval("S.tasks.some(t => t.title === 'Im Projekt')"), false, 'no project chosen: nothing made');
    assert.ok($('#modal-root form'), 'the form stays');
    $('#modal-root input[name="projectId"][value="' + pid + '"]').checked = true;
    submit();
    await until(() => w.eval("S.tasks.some(t => t.title === 'Im Projekt')"));
    assert.equal(w.eval("S.tasks.find(t => t.title === 'Im Projekt').projectId"), pid);
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].projectId`) === pid);
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].owners.length`) >= 1);
  });
  test('a task from the read-only sheet: the same form, the responsibility is added to the saved topic', async () => {
    click($('[data-action="proto-save"]'));
    await until(() => $('.jfs .dv-save.ok') && !$('.proto-edit'));
    const before = w.eval('S.tasks.length');
    const id = w.eval(`Shared.protoFromText(S.doc.content).topics.find(t => t.title === 'Für alle').id`);
    assert.equal(w.eval(`Shared.protoFromText(S.doc.content).topics.find(t => t.id === ${JSON.stringify(id)}).owners.length`) >= 1, true);
    w.eval(`S.tcOpen = { ${id}: true }; render({ peek: false })`);
    assert.equal($('.tc.open [data-action="proto-topic-task"]'), null, 'it has its task already: the button opens the task');
    assert.ok($('.tc.open [data-action="open-task"]'));
    assert.equal(w.eval('S.tasks.length'), before);
  });
});

describe('files of a topic: open, upload quietly', () => {
  test('an attachment opens a PDF in a tab the click opened itself, and saves other types', async () => {
    const calls = [];
    await openEditor();
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    await w.eval("loadChunk('Images')");
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x80]);
    const r = await w.eval(`(async f => fileUpload(f, { kind: 'project', projectId: S.protoEdit.projectId }, true))`)(new w.File([bytes], 'bericht.pdf', { type: 'application/pdf' }));
    const docx = await w.eval(`(async f => fileUpload(f, { kind: 'project', projectId: S.protoEdit.projectId }, true))`)(new w.File([new Uint8Array([0x50, 0x4b, 3, 4, 1])], 'plan.docx', { type: '' }));
    w.eval(`S.tcOpen = Object.assign({}, S.tcOpen, { [S.protoEdit.model.topics[${k}].id]: true }); S.protoEdit.model.topics[${k}].files.push(${JSON.stringify({ id: r.id, name: r.name, mime: r.mime, size: r.size })}, ${JSON.stringify({ id: docx.id, name: docx.name, mime: docx.mime, size: docx.size })}); protoRender()`);
    await until(() => $$('.tc.open [data-action="tc-get"]').length === 2);
    // the page opens the PDF in a window it opens itself; the bytes arrive untouched
    const opened = [];
    w.window.open = () => { const win = { closed: false, location: { set href(v) { opened.push(v); } } }; return win; };
    w.window.URL.createObjectURL = blob => { opened.push(blob.size + ':' + blob.type); return 'blob:x'; };
    w.window.URL.revokeObjectURL = () => {};
    const sent = [];
    w.eval('window.__quiet = []; const oc = call; call = function (m, p, o) { window.__quiet.push([m, !!(o && o.quiet)]); return oc.apply(null, arguments); }');
    click($$('.tc.open [data-action="tc-get"]')[0]);
    await until(() => opened.length >= 2);
    assert.equal(opened[0], '8:application/pdf', 'every byte');
    assert.equal(opened[1], 'blob:x');
    assert.deepEqual(JSON.parse(w.eval('JSON.stringify(window.__quiet)')).filter(c => c[0] === 'files.get'), [['files.get', true]], 'loaded in the background');
    // a document that a tab cannot show is saved with its name
    let saved = null;
    w.document.addEventListener('click', e => { if (e.target.download) saved = e.target.download; }, true);
    click($$('.tc.open [data-action="tc-get"]')[1]);
    await until(() => saved);
    assert.equal(saved, 'plan.docx');
    void calls; void sent;
  });
  test('uploads and parts of the page load without the loading bar or a message', async () => {
    w.eval('window.__quiet = []; document.querySelector("#toasts").innerHTML = ""');
    await w.eval("loadChunk('Images')");
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const f = new w.File([Uint8Array.from(Buffer.from(PNG, 'base64'))], 'a.png', { type: 'image/png' });
    await w.eval(`(async f => fileUpload(f, { kind: 'project', projectId: S.protoEdit.projectId }, false))`)(f);
    const calls = JSON.parse(w.eval('JSON.stringify(window.__quiet)'));
    assert.deepEqual(calls.filter(c => c[0] === 'files.upload'), [['files.upload', true]]);
    assert.equal($('#toasts').textContent, '', 'no "uploading" message');
    assert.equal(w.eval('S.busyLoud || 0'), 0, 'no loading bar');
  });
  test('a file on its way shows a placeholder in its own box: the screenshot as the picture itself, the document as a row', async () => {
    await openEditor();
    await w.eval("loadChunk('Images')");
    const k = w.eval('S.protoEdit.model.topics.length - 1');
    w.eval(`S.tcOpen = Object.assign({}, S.tcOpen, { [S.protoEdit.model.topics[${k}].id]: true }); protoRender()`);
    await until(() => $('.tc.open .tc-cols'));
    w.window.URL.createObjectURL = () => 'blob:preview';
    // the upload waits until the test lets it go
    let release;
    const realUpload = w.window.fileUpload;
    w.window.fileUpload = () => new w.Promise(ok => { release = ok; });
    const send = (input, file) => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new w.Event('change', { bubbles: true })); };
    const shot = new w.File([new Uint8Array([1])], 'screen.png', { type: 'image/png' });
    send($('.tc.open input[data-attach="0"]'), shot);
    await until(() => $('.tc.open .tc-shots .tc-ph'));
    assert.equal($('.tc.open .tc-shots .tc-ph img').getAttribute('src'), 'blob:preview', 'the picture is there at once');
    assert.equal($$('.tc.open .tc-cols section')[2].querySelector('.tc-ph'), null, 'nothing in the attachments box');
    await until(() => release);
    release({ id: 'fl_fake00000001', name: 'screen.png', mime: 'image/png', size: 1 });
    await until(() => !$('.tc.open .tc-ph'));
    assert.equal($$('.tc.open .tc-shots .lf-thumb').length >= 1, true, 'the real entry replaces the placeholder');
    assert.equal(w.eval("typeof IMG_CACHE['fl_fake00000001']"), 'object', 'the preview stays, nothing is fetched again');
    const doc = new w.File([new Uint8Array([2])], 'plan.pdf', { type: 'application/pdf' });
    send($('.tc.open input[data-attach="1"]'), doc);
    await until(() => $('.tc.open .tc-cols section:nth-child(3) .tc-ph'));
    assert.equal($('.tc.open .tc-shots .tc-ph'), null, 'not in the screenshot box');
    assert.match($('.tc.open .tc-cols section:nth-child(3) .tc-ph').textContent, /plan\.pdf/);
    release = null;
    await until(() => release);
    release(null);
    await until(() => !$('.tc.open .tc-ph'));
    w.window.fileUpload = realUpload;
  });
  test('the sheet can start the form with "Thema hinzufügen" and the topic search narrows the cards', async () => {
    click($('[data-action="proto-discard"]'));
    await openSaved();
    assert.ok($('.jfs:not(.proto-edit)'), 'read only');
    const n = $$('.tc').length;
    input($('.jfs-q input'), 'zzz-kein-thema');
    assert.equal($$('.tc').length, 0);
    assert.match($('.tc-list').textContent, /Kein Thema gefunden/);
    input($('.jfs-q input'), '');
    assert.equal($$('.tc').length, n);
    click($('.jfs-tools [data-action="proto-add-topic"]'));
    await until(() => $('.proto-edit'));
    assert.equal($$('.tc').length, n + 1, 'the new topic');
    click($('[data-action="proto-discard"]'));
  });
});

describe('opening a meeting', () => {
  // records "method" or "method id"
  const spy = () => w.eval(`window.__calls = []; if (!window.__spied) { const oc = call; call = function (m, p) { window.__calls.push(m + (p && p.id ? ' ' + p.id : '')); return oc.apply(null, arguments); }; window.__spied = true; }`);
  const calls = () => JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  test('the next meeting opens at once, without asking the server', async () => {
    await tab();
    spy();
    click($('.jfo-row.next .jf-hit'));
    assert.ok($('.proto-edit') || $('.jfs'), 'shown in the same moment');
    assert.deepEqual(calls().filter(m => m !== 'docs.lock'), [], 'no call to open it');
    if ($('[data-action="proto-discard"]')) click($('[data-action="proto-discard"]'));
  });
  test('saved minutes show at once and need at most one call; the second time none', async () => {
    await tab();
    // let the reading ahead of the table settle first
    await wait(600);
    const m = w.eval(`jfData().minutes.find(x => x.projectId === ${JSON.stringify(place)})`);
    w.eval(`delete DOC_TEXT[${JSON.stringify(m.id)}]; delete DOC_LOADING[${JSON.stringify(m.id)}]`);
    spy();
    w.eval(`jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
    assert.ok($('.jfs'), 'the page switches at once (a skeleton until the text is there)');
    await until(() => $('.jfs .tc'));
    assert.deepEqual(calls().filter(c => c.indexOf(m.id) > 0), ['docs.get ' + m.id]);
    spy();
    w.eval(`S.doc = null; render(); jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
    assert.ok($('.jfs .tc'), 'from the page cache');
    assert.deepEqual(calls().filter(c => c.indexOf(m.id) > 0), []);
  });
});

describe('two people, drafts', () => {
  /** Saves the open minutes as someone else (the server of the preview runs in the page). */
  async function saveAs(email, fn) {
    await w.eval(`(async () => {
      const me = globalThis.__GAS_USER__;
      globalThis.__GAS_USER__ = ${JSON.stringify(email)};
      try {
        const cur = await call('docs.get', { id: S.doc.id });
        const m = Shared.protoFromText(cur.content);
        (${fn})(m);
        await call('docs.save', { id: cur.id, title: cur.title, content: Shared.protoToText(m), baseVersion: cur.version, baseContent: cur.content });
      } finally { globalThis.__GAS_USER__ = me; }
    })()`);
  }
  test('someone saves another topic while I write: my save merges, no dialog', async () => {
    await openEditor();
    const other = w.eval('S.users.find(u => u.email !== S.me.email).email');
    await saveAs(other, "m => { m.topics.push({ id: 'zz', title: 'Von nebenan', items: [] }); }");
    w.eval("S.protoEdit.model.topics.push({ id: 'yy', title: 'Von mir', items: [] }); protoRender()");
    click($('[data-action="proto-save"]'));
    await until(() => $('.dv-save.ok') && $('.jfs .tc') && !$('.proto-edit'));
    assert.equal($('#modal-root form'), null, 'no conflict dialog');
    assert.match($('.jfs').textContent, /Von nebenan/);
    assert.match($('.jfs').textContent, /Von mir/);
  });
  test('someone writes in the same description: the dialog shows theirs; "Meine Fassung speichern" keeps mine', async () => {
    await openEditor();
    const other = w.eval('S.users.find(u => u.email !== S.me.email).email');
    await saveAs(other, "m => { m.topics[0].title = 'Titel von nebenan'; }");
    w.eval("S.protoEdit.model.topics[0].title = 'Mein Titel'; protoRender()");
    click($('[data-action="proto-save"]'));
    await until(() => $('#modal-root .de-preview'));
    assert.match($('#modal-root .de-preview').textContent, /Titel von nebenan/);
    submit();
    await until(() => $('.dv-save.ok') && $('.jfs .tc') && !$('.proto-edit'));
    assert.match($('.jfs').textContent, /Mein Titel/);
  });
  test('an unsaved draft survives closing the page and comes back when the meeting is opened again', async () => {
    await openEditor();
    input($('.tc .tc-title'), 'Entwurf bleibt');
    w.eval('S.protoEdit = null; S.doc = null; render()');
    await openEditor();
    assert.equal($('.tc .tc-title').value, 'Entwurf bleibt');
    click($('[data-action="proto-discard"]'));
  });
});

describe('calm messages and saving in the background', () => {
  test('a long message with a web address shows one short line; "Details" opens the full text', async () => {
    w.eval("document.querySelector('#toasts').innerHTML = ''");
    const long = 'Die App darf noch nicht in Google Drive speichern. Bitte im Apps-Script-Editor einmal „setup“ ausführen und die Berechtigung zulassen. (Google 403: Google Drive API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=123 then retry.)';
    w.eval(`toast(${JSON.stringify(long)}, { error: true })`);
    const t = $('#toasts .toast');
    assert.doesNotMatch(t.textContent, /https|Google 403/);
    click([...t.querySelectorAll('button')].find(b => /Details/.test(b.textContent)));
    await until(() => $('#modal-root .msg-full'));
    assert.match($('#modal-root .msg-full').textContent, /https:\/\/console/);
    w.eval('closeModal()');
  });
  test('"Übernehmen" shows the minutes at once with "Speichert…", then "Gespeichert"; no toast for it', async () => {
    await openEditor();
    w.eval("document.querySelector('#toasts').innerHTML = ''");
    input($('.tc .tc-title'), 'Im Hintergrund gespeichert');
    await wait(200);
    click($('[data-action="proto-save"]'));
    assert.ok($('.jfs .tc'), 'the minutes are there right away');
    assert.match($('.jfs').textContent, /Im Hintergrund gespeichert/);
    assert.match($('.jfs .dv-save').textContent, /Speichert/);
    await until(() => /Gespeichert/.test(($('.jfs .dv-save') || {}).textContent || ''));
    assert.doesNotMatch($('#toasts').textContent, /Protokoll gespeichert/);
  });
  test('Drive refusing to store the file: a quiet note in the header with details', async () => {
    w.eval("document.querySelector('#toasts').innerHTML = ''; S.driveIssue = null; S.driveToasted = false");
    w.eval("driveTrouble('Die App darf noch nicht in Google Drive speichern. (Google 403: Drive API disabled https://console.developers.google.com/x)')");
    w.eval("driveTrouble('Die App darf noch nicht in Google Drive speichern. (Google 403: Drive API disabled https://console.developers.google.com/x)')");
    assert.ok($$('#toasts .toast').length <= 1, 'at most one short note per session');
    w.eval('render()');
    await until(() => $('.jfs .dv-drive'));
    click($('.jfs [data-action="drive-issue"]'));
    await until(() => $('#modal-root .msg-full'));
    assert.match($('#modal-root').textContent, /setup/);
    w.eval('closeModal(); S.driveIssue = null; render()');
  });
  test('closing the minutes while they are saved: the page stays where the person went', async () => {
    await openEditor();
    const m = w.eval('S.doc');
    input($('.tc .tc-title'), 'Gespeichert beim Weggehen');
    await wait(200);
    click($('[data-action="proto-save"]'));
    click($('[data-action="jf-back"]'));
    assert.ok($('.jfo-tbl'), 'back at the list');
    const saved = () => w.eval(`(jfData().minutes.find(x => x.id === ${JSON.stringify(m.id)}) || {}).version`) > m.version;
    await until(saved, 10000);
    assert.ok(saved(), 'saved');
    await wait(50);
    assert.equal($('.jfs'), null, 'not pulled back into the minutes');
  });
});

describe('around the mask', () => {
  test('a meeting with a time is a block on the time line of the week view, not in the all-day row', () => {
    const html = w.eval(`timeGridHtml(['2030-01-07'], { data: { events: [{ id: 'jf_a_2030-01-07', type: 'jf', title: 'Team-JF', startDate: '2030-01-07', endDate: '2030-01-07', time: '09:00', duration: 60, projectId: ${JSON.stringify(place)} }, { id: 'ev1', title: 'Messe', startDate: '2030-01-07' }], holidays: [], absences: [], warnings: [] }, show: { events: true, tasks: false }, tasks: [] })`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    const blk = d.querySelector('.wk-col .blk-ev');
    assert.ok(blk, 'a block in the day column');
    assert.match(blk.textContent, /09:00 – 10:00/);
    assert.equal(blk.style.height, '44px', 'one hour high');
    assert.doesNotMatch(d.querySelector('.wk-a').textContent, /Team-JF/, 'not in the all-day row');
  });
  test('links in texts become safe hyperlinks; nothing else does', () => {
    const d = w.document.createElement('div');
    d.innerHTML = w.eval(`linkify('See https://x.example/a?b=1&c=2, mail to mailto:a@b.de and javascript:alert(1) <b>')`);
    assert.deepEqual([...d.querySelectorAll('a')].map(x => x.getAttribute('href')), ['https://x.example/a?b=1&c=2', 'mailto:a@b.de']);
    assert.equal(d.querySelector('b'), null, 'text is escaped');
  });
  test('the project page has no jour fixe; leaving the team page closes the open minutes', async () => {
    w.eval(`S.projTab = 'jf'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('.pj-tabs'));
    assert.equal($$('.pj-tabs button').some(b => /Jour Fixe/.test(b.textContent)), false);
    assert.equal(w.eval("typeof jfTab"), 'undefined');
    await openSaved();
    w.eval("go('home')");
    assert.equal(w.eval('S.doc'), null);
  });
});

describe('less to click: the sheet opens ready, the first change starts the form', () => {
  const leave = () => { if ($('[data-action="proto-discard"]')) click($('[data-action="proto-discard"]')); w.eval('closeModal()'); };
  test('the first topic is open, links / screenshots / files have boxes of a fixed height that scroll inside', async () => {
    leave();
    await openSaved();
    assert.equal($$('.tc.open').length, 1);
    assert.equal($('.tc-list .tc').classList.contains('open'), true, 'the first one');
    assert.equal($$('.tc.open .tc-cols .tc-scroll').length, 3, 'one scroll box per column');
    assert.equal($('[data-action="proto-edit"]'), null, 'no separate "Edit" button');
    assert.equal($('.tc.open [data-action="tc-rm"]'), null, 'nothing to remove while reading');
    assert.ok($('.tc.open [data-action="tc-link"]'), 'a link can be added at once');
  });
  test('"Verantwortlich" in the read-only sheet starts the form and opens the people mask', async () => {
    assert.equal($('.proto-edit'), null);
    click($('.tc.open [data-action="tc-owners"]'));
    await until(() => $('.proto-edit') && $('#modal-root').children.length);
    assert.ok($('.proto-edit'), 'the form started by itself');
    w.eval('closeModal()');
    leave();
  });
  test('the chip with the people opens one mask for the minute taker, the present and the absent; no panel in the form', async () => {
    await openSaved();
    click($('.jfs-chips [data-action="jf-people"]'));
    await until(() => $('#modal-root select'));
    assert.ok($('#modal-root [data-action="proto-person"][data-k="present"]'));
    assert.ok($('#modal-root [data-action="proto-person"][data-k="absent"]'));
    assert.equal($('.jfs-people'), null, 'the big people panel is gone');
    w.eval('closeModal()');
    leave();
  });
});
