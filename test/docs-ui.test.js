/** Documents and jour fixe in the project page: safe rendering, editor with "Übernehmen", conflicts, action items. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 3000); while (!cond() && Date.now() < end) await wait(25); }

describe('markdown rendering', () => {
  const html = text => { const d = w.document.createElement('div'); d.innerHTML = w.eval('mdRender(' + JSON.stringify(text) + ')'); return d; };
  test('attack strings stay text: no tags, no event handlers, no script links', () => {
    const d = html([
      '<img src=x onerror=alert(1)>', '# <script>alert(1)</script>', '[klick](javascript:alert(1))', '**<svg onload=alert(1)>**',
      '- [ ] x @"><img src=x onerror=1>@a.de !2026-11-03', '| <b onclick=x>a</b> | b |', '> <iframe src=//x>', '[x](https://ok.de" onmouseover="alert(1))',
    ].join('\n'));
    assert.equal(d.querySelectorAll('img, script, iframe, svg:not(.i)').length, 0, 'only the own icons');
    const attrs = [...d.querySelectorAll('*')].flatMap(el => [...el.attributes].map(a => a.name));
    assert.ok(!attrs.some(a => /^on/i.test(a)), attrs.join(','));
    assert.ok(![...d.querySelectorAll('a')].some(a => !/^https?:\/\//.test(a.getAttribute('href'))));
  });
  test('headings, lists, action items, links, tables and mentions', () => {
    const d = html('# Titel\n- Punkt\n- [ ] Angebot @anna.schmidt@firma.de !2026-11-03\n- [x] erledigt\n[Doku](https://example.com)\n| a | b |\n|---|---|\n| 1 | 2 |');
    assert.ok(d.querySelector('h2'));
    assert.equal(d.querySelectorAll('.md-ai').length, 2);
    assert.ok(d.querySelector('.md-ai.done'));
    assert.match(d.querySelector('.md-at').textContent, /Anna/);
    assert.equal(d.querySelector('a').getAttribute('rel'), 'noopener noreferrer');
    assert.equal(d.querySelectorAll('td').length, 2);
  });
});

describe('documents tab', () => {
  let pid;
  test('a new document is written in the app and saved with "Übernehmen"', async () => {
    pid = w.eval('S.projects[0].id');
    w.eval(`S.projTab = 'docs'; go('project', ${JSON.stringify(pid)})`);
    await until(() => $('[data-action="doc-new"]'));
    click($('[data-action="doc-new"]'));
    await until(() => $('.de-text'));
    assert.ok($('[data-action="doc-save"]').disabled, 'nothing to save yet');
    const t = $('.de-title');
    t.value = 'Konzept';
    t.dispatchEvent(new w.Event('input', { bubbles: true }));
    const ta = $('.de-text');
    ta.value = '# Ziel\n\nSchneller liefern.';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(250);
    assert.ok($('.de-preview h2'), 'live preview');
    assert.equal($('[data-action="doc-save"]').disabled, false);
    click($('[data-action="doc-save"]'));
    await until(() => $('.doc-view'));
    assert.match($('.doc-view').textContent, /Schneller liefern/);
    assert.equal(w.eval('store.get(draftKey(null), null)'), null, 'draft cleared after saving');
  });
  test('when someone else saved in between, a dialog offers both versions instead of overwriting', async () => {
    const id = w.eval('S.doc.id');
    // someone else saves version 2
    await w.eval(`call('docs.save', { id: ${JSON.stringify(id)}, title: 'Konzept', content: 'Fremde Fassung', baseVersion: 1 })`);
    click($('[data-action="doc-edit"]'));
    await until(() => $('.de-text'));
    w.eval('S.docEdit.base = 1');
    const ta = $('.de-text');
    ta.value = 'Meine Fassung';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    await wait(200);
    click($('[data-action="doc-save"]'));
    await until(() => $('#modal-root .de-preview'));
    assert.match($('#modal-root').textContent, /Fremde Fassung/);
    assert.equal(w.eval('JSON.stringify(store.get(draftKey(S.docEdit.id), null).content)'), JSON.stringify('Meine Fassung'), 'my text is kept');
    w.eval('closeModal()');
  });
});

describe('jour fixe tab', () => {
  test('a series shows its next meeting; minutes open with the template; an action item becomes a task', async () => {
    const pid = w.eval('S.projects[0].id');
    w.eval('docEndEdit(); S.doc = null');
    await w.eval(`call('jf.saveSeries', { projectId: ${JSON.stringify(pid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: [S.me.email] })`);
    w.eval(`delete S.jfs[${JSON.stringify(pid)}]; S.projTab = 'jf'; render()`);
    await until(() => $('.jf-card'));
    assert.match($('.jf-card').textContent, /Team-JF/);
    click($('.jf-card [data-action="jf-open"]'));
    await until(() => $('.doc-view'));
    assert.match($('.doc-view').textContent, /Agenda/);
    const doc = w.eval('S.doc');
    await w.eval(`call('docs.save', { id: ${JSON.stringify(doc.id)}, title: ${JSON.stringify(doc.title)}, baseVersion: ${doc.version},
      content: S.doc.content + '\\n- [ ] Folien bauen !2030-01-10' })`);
    await w.eval(`docOpen(${JSON.stringify(doc.id)})`);
    await until(() => $('[data-action="doc-to-task"]'));
    const before = w.eval('S.tasks.length');
    click($('[data-action="doc-to-task"]'));
    await until(() => w.eval('S.tasks.length') > before && $('.md-task'));
    assert.ok(w.eval("S.tasks.some(t => t.title === 'Folien bauen' && t.dueDate === '2030-01-10')"));
  });
});
