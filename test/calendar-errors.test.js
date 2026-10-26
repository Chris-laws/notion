/** A failing calendar request shows a clear message with "try again" instead of loading forever. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());

describe('calendar request fails', () => {
  test('after two automatic retries a message with a retry button appears, and retrying loads again', async () => {
    w.eval(`window.__calls = 0; window.__orig = runCall;
      runCall = (m, p) => (m === 'calendar.range' ? (window.__calls++, Promise.reject(new Error('internal'))) : window.__orig(m, p));
      S.cal.cache = {}; S.cal.cursor = '2027-02-01'; go('calendar')`);
    // "internal" is retried twice (0.6 s, 1.8 s, plus jitter) before the message shows
    await wait(4000);
    const box = w.document.querySelector('.cal-error');
    assert.ok(box, 'error box shown');
    assert.match(box.textContent, /nicht geladen/);
    const tries = w.eval('window.__calls');
    w.eval('render()');
    await wait(100);
    assert.equal(w.eval('window.__calls'), tries, 'no endless retry loop on re-render');
    w.eval('runCall = window.__orig');
    box.querySelector('[data-action="cal-retry"]').click();
    await wait(400);
    assert.equal(w.document.querySelector('.cal-error'), null, 'gone after a successful retry');
  });
  test('the bare "internal" message becomes a sentence', () => {
    assert.match(w.eval("friendlyError('internal')"), /Server/);
    assert.match(w.eval("friendlyError('Error code INTERNAL')"), /Server/);
  });
});
