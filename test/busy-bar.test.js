/** The loading bar stays out of the way: only after 500 ms, never for background refreshes. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => {
  w = await bootApp({ lang: 'de' });
  // a server that answers after 700 ms
  w.eval(`window.__run = google.script.run;
    window.slowServer = () => { google.script.run = { withSuccessHandler: ok => ({ withFailureHandler: () => new Proxy({}, { get: () => () =>
      setTimeout(() => ok(JSON.stringify({ ok: true, data: { same: true } })), 1500) }) }) }; };
    window.fastServer = () => { google.script.run = window.__run; };`);
});
after(() => w && w.close());
/** waits until cond() is true or ms have passed */
async function until(cond, ms) { const end = Date.now() + ms; while (!cond() && Date.now() < end) await wait(25); }
const on = () => w.document.querySelector('#busy-bar').classList.contains('on');

describe('loading bar', () => {
  test('a quick answer shows no bar; a slow one shows it only after 500 ms', async () => {
    w.eval("slowServer(); call('tasks.list', {})");
    await wait(250);
    assert.equal(on(), false, 'not within the first 500 ms');
    await until(on, 1200);
    assert.equal(on(), true, 'shown while it takes longer');
    await until(() => !on(), 3000);
    assert.equal(on(), false, 'gone when done');
  });
  test('background refreshes never show the bar', async () => {
    w.eval("call('tasks.list', {}, { quiet: true })");
    await wait(900);
    assert.equal(on(), false);
    await wait(900);
    w.eval('fastServer()');
  });
});
