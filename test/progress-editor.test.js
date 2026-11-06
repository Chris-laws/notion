/** Progress editor: 1 % steps, a number field, and an explicit automatic/manual switch. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());
const $ = sel => w.document.querySelector('#popover-root ' + sel);
function open(progress) {
  w.eval(`window.__p = []; const t = Object.assign({}, S.tasks.find(x => !x.parentId), { progress: ${progress} });
    PROP_EDITORS.progress(document.body, t, patch => window.__p.push(patch))`);
}
const fire = (el, type, init) => el.dispatchEvent(new (type.startsWith('key') ? w.KeyboardEvent : w.Event)(type, Object.assign({ bubbles: true }, init || {})));
const saved = () => JSON.parse(w.eval('JSON.stringify(window.__p.map(p => p.progress))'));

describe('progress editor', () => {
  test('the slider moves in 1 % steps from 1 to 100 and has an accessible name', () => {
    open(40);
    const r = $('input[type=range]');
    assert.equal(r.step, '1');
    assert.equal(r.min, '1');
    assert.equal(r.max, '100');
    assert.ok(r.getAttribute('aria-label'));
    r.value = '43';
    fire(r, 'change');
    assert.deepEqual(saved(), [43]);
  });
  test('any number can be typed; values are kept between 1 and 100', () => {
    open(40);
    const n = $('input[type=number]');
    n.value = '37'; fire(n, 'change');
    n.value = '150'; fire(n, 'change');
    n.value = '12.6'; fire(n, 'change');
    assert.deepEqual(saved(), [37, 100, 13]);
  });
  test('Enter in the number field saves too', () => {
    open(40);
    const n = $('input[type=number]');
    n.value = '55';
    fire(n, 'keydown', { key: 'Enter' });
    assert.deepEqual(saved(), [55]);
  });
  test('Shift + arrow moves by 10', () => {
    open(40);
    fire($('input[type=range]'), 'keydown', { key: 'ArrowUp', shiftKey: true });
    assert.deepEqual(saved(), [50]);
  });
  test('"Automatisch" and "Manuell" are explicit; 0 in the field means automatic', () => {
    open(0);
    assert.equal($('[data-mode="auto"]').getAttribute('aria-pressed'), 'true');
    fire($('[data-mode="manual"]'), 'click');
    assert.equal(saved().length, 1);
    assert.ok(saved()[0] >= 1, 'manual starts at the current value (at least 1 %)');
    open(70);
    assert.equal($('[data-mode="manual"]').getAttribute('aria-pressed'), 'true');
    const n = $('input[type=number]');
    n.value = '0'; fire(n, 'change');
    assert.deepEqual(saved(), [0]);
  });
});
