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
  await until(() => $('.jf-table'));
};
/** Opens the saved minutes (past meeting) in the read-only view. */
async function openSaved() {
  await tab();
  const m = w.eval(`jfData().minutes.find(x => x.projectId === ${JSON.stringify(place)})`);
  await w.eval(`jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
  await until(() => $('.doc-view .tc'));
  return m;
}
async function openEditor() {
  await openSaved();
  click($('[data-action="proto-edit"]'));
  await until(() => $('.proto-edit'));
}

describe('jour fixe of a team: the overview', () => {
  test('one table: next meeting on top with week chip and status; no jour fixe tab in the project any more', async () => {
    await tab();
    assert.equal($$('.pj-tabs [data-v="jf"]').length, 0, 'no tab in the project');
    assert.ok($('.tabs [data-action="team-tab"][data-v="jf"]'), 'the tab is in the team');
    const heads = $$('.jf-table th').map(x => x.textContent.trim());
    assert.deepEqual(heads.slice(0, 5), ['Jour Fixe', 'Termin', 'Status', 'Aufgaben', 'Letzte Änderung']);
    const next = $('.jf-tr.next');
    assert.ok(next, 'the next meeting');
    assert.match(next.textContent, /Team-JF/);
    assert.match(next.querySelector('.chip.kw').textContent, /^KW \d+$/);
    assert.match(next.querySelector('.chip[class*="st-"]').textContent, /Geplant|Protokoll fehlt|In Bearbeitung/);
    assert.equal(next.querySelectorAll('.jf-c-p .avatar').length >= 1, true, 'people invited');
    assert.ok($('[data-action="jf-new"]'), '+ Neuer Jour Fixe');
  });
  test('saved minutes: "In Bearbeitung", the person who changed last, tasks; a closed meeting says so', async () => {
    const row = $$('.jf-tr').find(r => !r.classList.contains('next') && r.querySelector('[data-doc]'));
    assert.ok(row, 'a row with saved minutes');
    assert.match(row.querySelector('[class*="st-"]').textContent, /In Bearbeitung/);
    assert.ok(row.querySelector('.jf-c-c .avatar'), 'who changed last');
    assert.equal(w.eval(`jfStatus({ people: { closed: true } }, false).label`), 'Abgeschlossen');
    assert.equal(w.eval(`jfStatus(null, false).label`), 'Protokoll fehlt');
  });
  test('the whole row opens the meeting through one button; Meet sits outside of it', async () => {
    await w.eval(`(async () => { const s = jfData().series.find(x => x.projectId === ${JSON.stringify(place)}); await call('jf.saveSeries', Object.assign({}, s, { meetLink: 'https://meet.google.com/abc-defg-hij' })); S.jf = await call('jf.list', {}); render(); })()`);
    await until(() => $('.jf-tr.next .jf-meet'));
    const a = $('.jf-tr.next .jf-meet');
    assert.equal(a.getAttribute('href'), 'https://meet.google.com/abc-defg-hij');
    assert.match(a.getAttribute('rel'), /noopener/);
    assert.equal(a.closest('.jf-hit'), null);
    const hit = $('.jf-tr.next .jf-hit');
    assert.equal(hit.tagName, 'BUTTON');
    assert.match(hit.getAttribute('aria-label'), /^Protokoll (vorbereiten|öffnen): Team-JF, /);
  });
  test('15 entries per page with a pager (200+ meetings stay fast)', () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ id: 'dc_' + i, projectId: place, seriesId: 'jf_x', date: w.eval(`Shared.addDays('2020-01-06', ${i * 7})`), title: 'Alt', people: { present: [], absent: [] } }));
    const html = w.eval(`(() => { const keep = S.jf; S.jf = { series: [], minutes: ${JSON.stringify(many)} }; S.jfPage = 0; const h = jfTeamTab(team(${JSON.stringify(tid)})); S.jf = keep; return h; })()`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    assert.equal(d.querySelectorAll('.jf-tr').length, 15);
    assert.match(d.querySelector('.jf-pager').textContent, /Seite 1 \/ 16/);
    assert.ok(d.querySelector('[data-action="jf-page"][data-v="1"]'));
    assert.ok(d.querySelector('[data-action="jf-page"][disabled]'), 'no page before the first');
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
    await until(() => $('#modal-root select[name="projectId"]'));
    assert.ok([...$('#modal-root select[name="projectId"]').options].some(o => o.value === ''), 'an empty choice');
    change($('#modal-root select[name="projectId"]'), pid);
    submit();
    await until(() => w.eval(`S.protoEdit.model.topics[${k}].projectId`) === pid);
    await until(() => $$('.tc').pop().querySelector('.tc-proj'));
    assert.ok($$('.tc').pop().querySelector('.tc-own'), 'person with name');
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
    await until(() => $$('.tc').pop().querySelector('.tc-col .lk-a'));
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
    await until(() => $('.dv-save.ok') && $('.doc-view .tc') && !$('.proto-edit'));
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
    assert.match($('.doc-view').textContent, /Beschluss: wir machen weiter/, 'the decision');
    assert.match($('.doc-view').textContent, /Budget 2031/, 'the task topic');
    click($('[data-action="jf-view"][data-v="topics"]'));
  });
  test('the version list shows who changed what; any version opens read only', async () => {
    await until(() => $('[data-action="doc-versions"]'));
    click($('[data-action="doc-versions"]'));
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
    assert.ok($('[data-action="proto-edit"]'));
    click($('[data-action="proto-close"]'));
    await until(() => $('.dv-save.ok') && /Abgeschlossen/.test($('.dv-t h2').textContent));
    assert.equal($('[data-action="proto-edit"]'), null, 'no editing while closed');
    assert.match($('[data-action="proto-close"]').textContent, /Wieder öffnen/);
    const m = w.eval(`jfData().minutes.find(x => x.id === S.doc.id)`);
    assert.equal(m.people.closed, true, 'the table knows');
    click($('[data-action="proto-close"]'));
    await until(() => $('.dv-save.ok') && $('[data-action="proto-edit"]'));
    assert.match($('.dv-t h2').textContent, /In Bearbeitung/);
  });
  test('a topic can be anchored in the card; the minutes show the anchor', async () => {
    await openEditor();
    click($('.tc [data-action="proto-pin"]'));
    await until(() => $('.tc [data-action="proto-pin"][aria-pressed="true"]'));
    assert.equal(w.eval('S.protoEdit.model.topics[0].pinned'), true);
    click($('[data-action="proto-save"]'));
    await until(() => $('.dv-save.ok') && $('.doc-view .chip.pin'));
    assert.match($('.doc-view .chip.pin').textContent, /Fixiert/);
  });
});

describe('tasks from topics', () => {
  /** Opens the form of the next meeting with a topic of three lines and two responsible people. */
  async function formWithTopic() {
    await tab();
    click($('.jf-tr.next .jf-hit'));
    await until(() => $('.proto-edit') || $('[data-action="proto-edit"]'));
    if (!$('.proto-edit')) { click($('[data-action="proto-edit"]')); await until(() => $('.proto-edit')); }
    w.eval(`(() => { const m = S.protoEdit.model; m.topics.push({ id: 'tq', title: 'Go-Live', kind: 'A', owners: [S.me.email], items: [
      { id: 'q1', type: 'A', text: 'Server buchen', owner: S.users[1].email, due: '2030-02-01', done: false, taskId: '' },
      { id: 'q2', type: 'I', text: 'Budget ist frei', owner: '', due: '', done: false, taskId: '' },
      { id: 'q3', type: 'A', text: 'Doku schreiben', owner: '', due: '2030-02-03', done: false, taskId: '' }] }); S.tcOpen = { tq: true }; protoRender(); })()`);
    await until(() => $('[data-action="pe-task"][data-t]:not([data-i])'));
    return w.eval('S.protoEdit.model.topics.length - 1');
  }
  test('"In Aufgabe übernehmen" without project: the task goes to the team and the people; the topic keeps them as responsible', async () => {
    const k = await formWithTopic();
    const before = w.eval('S.tasks.length');
    click($('.tc [data-action="pe-task"][data-t="' + k + '"]:not([data-i])'));
    await until(() => $$('#modal-root input[name="pick"]').length === 3);
    assert.equal(w.eval('S.tasks.length'), before, 'nothing made yet');
    assert.equal($('#modal-root select[name="projectId"]').value, '', 'no project chosen');
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
});

describe('opening a meeting', () => {
  // records "method" or "method id"
  const spy = () => w.eval(`window.__calls = []; if (!window.__spied) { const oc = call; call = function (m, p) { window.__calls.push(m + (p && p.id ? ' ' + p.id : '')); return oc.apply(null, arguments); }; window.__spied = true; }`);
  const calls = () => JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  test('the next meeting opens at once, without asking the server', async () => {
    await tab();
    spy();
    click($('.jf-tr.next .jf-hit'));
    assert.ok($('.proto-edit') || $('.doc-view'), 'shown in the same moment');
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
    assert.ok($('.doc-view'), 'the page switches at once (a skeleton until the text is there)');
    await until(() => $('.doc-view .tc'));
    assert.deepEqual(calls().filter(c => c.indexOf(m.id) > 0), ['docs.get ' + m.id]);
    spy();
    w.eval(`S.doc = null; render(); jfOpen(${JSON.stringify(m.seriesId)}, ${JSON.stringify(m.date)})`);
    assert.ok($('.doc-view .tc'), 'from the page cache');
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
    await until(() => $('.dv-save.ok') && $('.doc-view .tc') && !$('.proto-edit'));
    assert.equal($('#modal-root form'), null, 'no conflict dialog');
    assert.match($('.doc-view').textContent, /Von nebenan/);
    assert.match($('.doc-view').textContent, /Von mir/);
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
    await until(() => $('.dv-save.ok') && $('.doc-view .tc') && !$('.proto-edit'));
    assert.match($('.doc-view').textContent, /Mein Titel/);
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
    assert.ok($('.doc-view .tc'), 'the minutes are there right away');
    assert.match($('.doc-view').textContent, /Im Hintergrund gespeichert/);
    assert.match($('.doc-view .dv-save').textContent, /Speichert/);
    await until(() => /Gespeichert/.test(($('.doc-view .dv-save') || {}).textContent || ''));
    assert.doesNotMatch($('#toasts').textContent, /Protokoll gespeichert/);
  });
  test('Drive refusing to store the file: a quiet note in the header with details', async () => {
    w.eval("document.querySelector('#toasts').innerHTML = ''; S.driveIssue = null; S.driveToasted = false");
    w.eval("driveTrouble('Die App darf noch nicht in Google Drive speichern. (Google 403: Drive API disabled https://console.developers.google.com/x)')");
    w.eval("driveTrouble('Die App darf noch nicht in Google Drive speichern. (Google 403: Drive API disabled https://console.developers.google.com/x)')");
    assert.ok($$('#toasts .toast').length <= 1, 'at most one short note per session');
    w.eval('render()');
    await until(() => $('.doc-view .dv-drive'));
    click($('.doc-view [data-action="drive-issue"]'));
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
    click($('[data-action="doc-close"]'));
    assert.ok($('.jf-table'), 'back at the list');
    const saved = () => w.eval(`(jfData().minutes.find(x => x.id === ${JSON.stringify(m.id)}) || {}).version`) > m.version;
    await until(saved, 10000);
    assert.ok(saved(), 'saved');
    await wait(50);
    assert.equal($('.doc-view'), null, 'not pulled back into the minutes');
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
