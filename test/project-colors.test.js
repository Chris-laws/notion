/** Projects show their own colour wherever they appear; the team colour stays on the team mark. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'en' }); });
after(() => w && w.close());

/** Gives the first project a colour that differs from its team's and returns both. */
function colouredProject(color) {
  return w.eval(`(() => {
    const p = S.projects[0];
    p.color = ${JSON.stringify(color)};
    return { id: p.id, team: team(p.teamId).color };
  })()`);
}
const styleOf = html => { const d = w.document.createElement('div'); d.innerHTML = html; return d; };

describe('project colours', () => {
  test('the project mark wears the project colour, with the team colour only as a small dot', () => {
    const p = colouredProject('yellow');
    const el = styleOf(w.eval(`mark(project(${JSON.stringify(p.id)}))`)).firstChild;
    assert.match(el.getAttribute('style'), /--mc:var\(--c-yellow\)/);
    assert.match(el.getAttribute('style'), new RegExp('--tc:var\\(--c-' + p.team + '\\)'));
  });
  test('the project chip shows one mark, not a stack of team and project', () => {
    const p = colouredProject('green');
    const chip = styleOf(w.eval(`projectChip(project(${JSON.stringify(p.id)}))`));
    assert.equal(chip.querySelectorAll('.mark').length, 1);
    assert.match(chip.querySelector('.mark').getAttribute('style'), /--c-green/);
  });
  test('the project pill uses the project colour', () => {
    const p = colouredProject('pink');
    assert.match(styleOf(w.eval(`projectPill(project(${JSON.stringify(p.id)}))`)).firstChild.getAttribute('style'), /--c-pink/);
  });
  test('without a chosen colour the project falls back to the team colour', () => {
    const p = colouredProject('gray');
    assert.match(styleOf(w.eval(`mark(project(${JSON.stringify(p.id)}))`)).firstChild.getAttribute('style'), new RegExp('--mc:var\\(--c-' + p.team + '\\)'));
  });
  test('the sidebar shows each project in its own colour', async () => {
    const p = colouredProject('yellow');
    w.eval("S.collapsed = {}; render()");
    await wait(200);
    const link = w.document.querySelector('#sidebar [data-id="' + p.id + '"] .mark');
    assert.ok(link, 'project link in the sidebar');
    assert.match(link.getAttribute('style'), /--c-yellow/);
  });
});

describe('project colour contrast', () => {
  test('light colours get a dark letter, dark colours a white one', () => {
    const p = colouredProject('yellow');
    assert.match(w.eval(`mark(project(${JSON.stringify(p.id)}))`), /ink-dark/);
    colouredProject('blue');
    assert.doesNotMatch(w.eval(`mark(project(${JSON.stringify(p.id)}))`), /ink-dark/);
  });
  test('the project page banner shows the project colour with readable text', async () => {
    const p = colouredProject('yellow');
    w.eval(`go('project', ${JSON.stringify(p.id)})`);
    await wait(200);
    const b = w.document.querySelector('.pj-banner');
    assert.ok(b, 'project banner');
    assert.match(b.getAttribute('style'), /--c-yellow/);
    assert.ok(b.classList.contains('ink-dark'));
  });
});

describe('colour picker in the project dialog', () => {
  const swatches = () => [...w.document.querySelectorAll('#modal-root .color-row button')];
  const close = () => w.eval('closeModal()');
  test('colours of other projects in the same team are crossed out and disabled, with the project in the tooltip', () => {
    const [a, b] = w.eval(`(() => { const t = S.projects[0].teamId; const ps = S.projects.filter(p => p.teamId === t);
      ps[0].color = 'yellow'; if (ps[1]) ps[1].color = 'red'; return [ps[0].id, ps[1] && ps[1].id]; })()`);
    assert.ok(b, 'demo team has two projects');
    w.eval(`projectModal(project(${JSON.stringify(b)}))`);
    const yellow = swatches().find(s => /--c-yellow/.test(s.getAttribute('style')));
    assert.ok(yellow.disabled && yellow.classList.contains('taken'));
    assert.match(yellow.getAttribute('title'), new RegExp(w.eval(`project(${JSON.stringify(a)}).name`)));
    const own = swatches().find(s => /--c-red/.test(s.getAttribute('style')));
    assert.ok(!own.disabled && own.classList.contains('on'), 'the own colour stays selectable');
    assert.equal(swatches().length, 12);
    close();
  });
  test('a new project starts with the first free colour of its team', () => {
    const tid = w.eval('S.projects[0].teamId');
    w.eval(`projectModal(null, ${JSON.stringify(tid)})`);
    const value = w.document.querySelector('#modal-root input[name=color]').value;
    const used = w.eval(`S.projects.filter(p => p.teamId === ${JSON.stringify(tid)}).map(p => p.color)`);
    assert.ok(used.indexOf(value) < 0, value + ' is free');
    close();
  });
  test('switching the team updates the crossed-out colours', () => {
    const tid = w.eval('S.projects[0].teamId');
    const other = w.eval(`(S.teams.find(t => t.id !== ${JSON.stringify(tid)}) || {}).id`);
    assert.ok(other, 'a second team');
    w.eval(`projectModal(null, ${JSON.stringify(tid)})`);
    const sel = w.document.querySelector('#modal-root select[name=teamId]');
    sel.value = other;
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    const crossed = swatches().filter(s => s.disabled).length;
    const usedThere = w.eval(`new Set(S.projects.filter(p => p.teamId === ${JSON.stringify(other)}).map(p => p.color).filter(c => Shared.PROJECT_PALETTE.indexOf(c) >= 0)).size`);
    assert.equal(crossed, usedThere);
    close();
  });
});
