/** Team page: the absence warning is one compact line under the team name; details (days, people) open on click. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
let tid;
before(async () => {
  w = await bootApp({ lang: 'de' });
  tid = w.eval('S.teams[0].id');
  const people = w.eval(`teamMembers(team(${JSON.stringify(tid)})).slice(0, 2)`);
  // two days in the next weeks with half of the team away
  w.eval(`(() => {
    const t = TODAY(), id = ${JSON.stringify(tid)};
    const warn = d => ({ teamId: id, teamName: team(id).name, date: Shared.addDays(t, d), absent: 2, total: 4, ratio: 0.5, people: ${JSON.stringify(people)} });
    S.cal.cache[calKey(t, Shared.addDays(t, 27), id)] = { events: [], absences: [], holidays: [], warnings: [warn(3), warn(4)], threshold: 50 };
  })()`);
});
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }

describe('absence warning on the team page', () => {
  test('one compact line in the team header, no big block further down', async () => {
    w.eval(`S.teamTab = 'tasks'; go('team', ${JSON.stringify(tid)})`);
    await until(() => $('.tw-line'));
    const line = $('.tw-line');
    assert.ok(line.closest('.ph'), 'inside the team header, under the name');
    assert.equal(line.getAttribute('role'), 'status');
    assert.match(line.textContent, /2 Tage/);
    assert.match(line.textContent, /50 %/);
    assert.equal($('#view .banner.danger'), null, 'the old block is gone');
    assert.equal($('.tw-details'), null, 'details closed');
  });
  test('"Details" lists the days with who is away and leads to the availability', async () => {
    const btn = $('[data-action="tw-toggle"]');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    click(btn);
    await until(() => $('.tw-details'));
    assert.equal($('[data-action="tw-toggle"]').getAttribute('aria-expanded'), 'true');
    const name = w.eval(`user(teamMembers(team(${JSON.stringify(tid)}))[0]).name`);
    assert.match($('.tw-details').textContent, new RegExp(name));
    assert.ok($('.tw-details [data-action="warn-open"]'));
    click($('[data-action="tw-toggle"]'));
    await until(() => !$('.tw-details'));
  });
});
