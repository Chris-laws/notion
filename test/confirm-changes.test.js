/**
 * Changes are confirmed before they are saved: the people dialog and the task side panel collect
 * changes and save them with "Übernehmen"; "Verwerfen"/"Abbrechen" drops them; closing with open
 * changes warns first. Ticking a task off stays instant.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => {
  w = await bootApp({ lang: 'de' });
  // count the server writes for tasks
  w.eval(`window.__saves = []; window.__run = runCall;
    runCall = (m, p) => { if (m === 'tasks.save') window.__saves.push(p); return window.__run(m, p); }`);
});
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

describe('people dialog', () => {
  const open = () => w.eval(`window.__got = null; peopleModal({ title: 'T', selected: [S.me.email], prefer: S.users.map(u => u.email), onChange: l => { window.__got = l; } })`);
  test('adding and removing only changes the list; "Übernehmen" saves once with the result', () => {
    open();
    const apply = $('#people-root [data-action="pm-apply"]');
    assert.ok(apply.disabled, 'nothing to apply yet');
    click($('#people-root [data-action="pm-add"]'));
    assert.equal(w.eval('window.__got'), null, 'not saved yet');
    assert.match($('#people-root .pm-count').textContent, /1 Änderung/);
    click($('#people-root [data-action="pm-apply"]'));
    assert.equal(w.eval('window.__got.length'), 2);
    assert.equal($('#people-root .pm'), null, 'closed');
  });
  test('closing with open changes warns first, "Verwerfen" closes without saving', () => {
    open();
    click($('#people-root [data-action="pm-add"]'));
    click($('#people-root .pm-top [data-action="pm-close"]'));
    assert.ok($('#people-root .pm'), 'still open');
    assert.ok($('#people-root .pm-warn'), 'warning shown');
    click($('#people-root [data-action="pm-discard"]'));
    assert.equal($('#people-root .pm'), null);
    assert.equal(w.eval('window.__got'), null);
  });
  test('without changes it closes at once', () => {
    open();
    click($('#people-root .pm-top [data-action="pm-close"]'));
    assert.equal($('#people-root .pm'), null);
  });
});

describe('task side panel', () => {
  let id;
  const stage = patch => w.eval(`stageTask(${JSON.stringify(id)}, ${JSON.stringify(patch)})`);
  test('a changed property is shown at once but saved only with "Übernehmen"', async () => {
    id = w.eval("S.tasks.find(t => !t.parentId && t.status !== 'done' && t.priority !== 'urgent').id");
    w.eval(`openPeek(${JSON.stringify(id)})`);
    await wait(100);
    w.eval('window.__saves = []');
    stage({ priority: 'urgent' });
    assert.equal(w.eval('window.__saves.length'), 0);
    assert.notEqual(w.eval(`task(${JSON.stringify(id)}).priority`), 'urgent', 'the task itself is unchanged');
    assert.match($('#peek .peek-commit').textContent, /1 ungespeicherte Änderung/);
    assert.ok($('#peek .ppill.prio-urgent'), 'the panel shows the new value');
    click($('#peek [data-action="peek-apply"]'));
    await wait(100);
    assert.equal(w.eval('window.__saves.length'), 1);
    assert.equal(w.eval('window.__saves[0].priority'), 'urgent');
    assert.equal($('#peek .peek-commit'), null);
  });
  test('"Verwerfen" drops the changes', () => {
    stage({ priority: 'low' });
    click($('#peek [data-action="peek-discard"]'));
    assert.equal($('#peek .peek-commit'), null);
    assert.equal(w.eval(`task(${JSON.stringify(id)}).priority`), 'urgent');
  });
  test('setting a value back to the saved one leaves nothing to apply', () => {
    stage({ priority: 'low' });
    stage({ priority: 'urgent' });
    assert.equal($('#peek .peek-commit'), null);
  });
  test('closing with open changes warns first, the second close discards', () => {
    stage({ priority: 'low' });
    w.eval('closePeek()');
    assert.ok(w.eval('S.peekId'), 'still open');
    assert.ok($('#peek .peek-commit.warn'));
    w.eval('closePeek()');
    assert.equal(w.eval('S.peekId'), null);
    assert.equal(w.eval('window.__saves.filter(s => s.priority === "low").length'), 0);
  });
  test('ticking the task off is still saved at once', async () => {
    w.eval(`openPeek(${JSON.stringify(id)})`);
    w.eval('window.__saves = []');
    click($('#peek [data-action="toggle-done"]'));
    await wait(100);
    assert.equal(w.eval('window.__saves.length'), 1);
  });
});
