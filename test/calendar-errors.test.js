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
    for (let end = Date.now() + 9000; !w.document.querySelector('.cal-error') && Date.now() < end;) await wait(50);
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

describe('calendar scroll position', () => {
  const grid = () => w.document.querySelector('[data-keep-scroll="wk"]');
  test('opening, changing the date and switching the view always start at the top', async () => {
    w.eval("S.cal.mode = 'week'; go('calendar')");
    await wait(300);
    assert.ok(grid(), 'time grid');
    assert.equal(grid().scrollTop, 0, 'on open');
    grid().scrollTop = 300;
    w.document.querySelector('#view').scrollTop = 200;
    w.eval("A['cal-next']()");
    await wait(100);
    assert.equal(grid().scrollTop, 0, 'after next week');
    assert.equal(w.document.querySelector('#view').scrollTop, 0);
    grid().scrollTop = 300;
    w.eval("A['cal-mode']({ dataset: { v: 'day' } })");
    await wait(100);
    assert.equal(grid().scrollTop, 0, 'after switching to the day view');
  });
  test('data arriving in the background keeps the position the user scrolled to', async () => {
    grid().scrollTop = 120;
    w.eval('render()');
    await wait(50);
    assert.equal(grid().scrollTop, 120);
  });
});

describe('reloading after a change', () => {
  test('the calendar keeps showing the last data while fresh data loads (no placeholders flashing)', async () => {
    w.eval("S.cal.mode = 'month'; S.cal.cursor = null; go('calendar')");
    await wait(400);
    assert.equal(w.document.querySelectorAll('#view .sk-on, #view [aria-busy="true"]').length, 0, 'loaded');
    w.eval(`window.__slow = runCall; runCall = (m, p) => (m === 'calendar.range' ? new Promise(r => setTimeout(() => window.__slow(m, p).then(r), 300)) : window.__slow(m, p))`);
    w.eval('calReload()');
    await wait(50);
    assert.equal(w.document.querySelectorAll('#view .sk-on, #view [aria-busy="true"]').length, 0, 'old data stays visible meanwhile');
    await wait(500);
    w.eval('runCall = window.__slow');
    assert.equal(w.eval('Object.keys(S.cal.stale).length'), 0, 'stale copies are dropped once fresh data is in');
  });
});
