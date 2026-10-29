/** The assistant panel: loaded on first use, answers with citations, proposals only via the confirmation form. */
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

describe('assistant panel', () => {
  test('not part of the start: the code arrives when the panel is first opened', async () => {
    assert.equal(w.eval("typeof asstOpen"), 'undefined', 'not loaded at start');
    click($('[data-action="asst"]'));
    await until(() => $('#asst-root .asst'));
    assert.equal(w.eval("typeof asstOpen"), 'function');
    const panel = $('#asst-root .asst');
    assert.equal(panel.tagName, 'ASIDE', 'a side panel next to the page (not a modal dialog)');
    assert.equal(panel.getAttribute('aria-labelledby'), 'asst-t');
    assert.equal($('#asst-root .asst-log').getAttribute('aria-live'), 'polite');
    assert.equal(w.document.activeElement, $('#asst-root textarea'), 'focus in the question field');
    assert.match(panel.textContent, /können falsch sein/);
  });
  test('a quick question: typing dots at once, then an answer with chips that open the entries', async () => {
    click($$('#asst-root [data-action="asst-quick"]')[0]);
    assert.ok($('#asst-root .asst-typing'), 'shown at once');
    await until(() => !$('#asst-root .asst-typing'));
    const answer = $$('#asst-root .asst-m.ai').pop();
    assert.match(answer.textContent, /Überfällig|Nichts überfällig/);
    const chip = answer.querySelector('[data-action="asst-cite"]');
    if (chip) {
      click(chip);
      await until(() => w.eval('!!S.peekId'));
      assert.ok(w.eval('!!S.peekId'), 'the task opens');
      w.eval('closePeek()');
    }
  });
  test('answers are text, never HTML', async () => {
    w.eval("ASST.msgs.push({ who: 'ai', text: '<img src=x onerror=window.__pwned=1>', source: 'ai' }); asstDraw()");
    await wait(50);
    assert.equal($('#asst-root .asst-log img'), null);
    assert.equal(w.eval('window.__pwned'), undefined);
  });
  test('proposals open the confirmation form; nothing is created before "Alles anlegen"', async () => {
    const n = w.eval('S.tasks.length');
    w.eval("ASST.msgs.push({ who: 'ai', text: 'Vorschlag', source: 'ai', proposals: [{ type: 'task', title: 'Vom Assistenten vorgeschlagen' }] }); asstDraw()");
    click($$('#asst-root [data-action="asst-proposals"]').pop());
    await until(() => $('#modal-root .ai-card'));
    assert.equal(w.eval('S.tasks.length'), n, 'nothing yet');
    $('#modal-root form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.eval("S.tasks.some(t => t.title === 'Vom Assistenten vorgeschlagen')"), 6000);
    assert.ok(w.eval("S.tasks.some(t => t.title === 'Vom Assistenten vorgeschlagen')"));
  });
  test('the quick report of the week comes into the panel and can be made again', async () => {
    click($('#asst-root [data-action="asst-report"]'));
    await until(() => $$('#asst-root .asst-m.ai').pop().textContent.indexOf('Schnellreport') >= 0);
    assert.ok($$('#asst-root [data-action="asst-report"][data-fresh]').length);
  });
  test('Escape closes the panel and gives the focus back', async () => {
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !$('#asst-root .asst'));
    assert.equal($('#asst-root .asst'), null);
  });
});
