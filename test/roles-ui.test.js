/** Lead roles in the people dialog: a chip "Lead" / "Mitglied" that leads can switch; others only see it. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }

describe('lead roles in the people dialog', () => {
  test('a team lead makes a member lead with one click; the chip and the team follow', async () => {
    const tid = w.eval('myTeams().find(t => teamLeads(t).indexOf(S.me.email) >= 0).id');
    const other = w.eval(`teamMembers(team(${JSON.stringify(tid)})).find(e => teamLeads(team(${JSON.stringify(tid)})).indexOf(e) < 0)`);
    w.eval(`S.teamTab = 'members'; go('team', ${JSON.stringify(tid)})`);
    await until(() => $('[data-action="team-members"]'));
    click($('[data-action="team-members"]'));
    await until(() => $('#people-root .pm-row'));
    const chip = () => $('#people-root [data-action="pm-role"][data-v="' + other + '"]');
    assert.ok(chip(), 'role chip as a button');
    assert.equal(chip().textContent.trim(), 'Mitglied');
    assert.equal(chip().getAttribute('aria-pressed'), 'false');
    click(chip());
    await until(() => chip() && chip().getAttribute('aria-pressed') === 'true');
    assert.equal(chip().textContent.trim(), 'Lead');
    assert.ok(w.eval(`teamLeads(team(${JSON.stringify(tid)})).indexOf(${JSON.stringify(other)}) >= 0`));
    assert.ok($('#people-root [data-v="' + other + '"].pm-keep, #people-root .pm-row .pm-keep'), 'leads cannot be removed from the list');
    click($('#people-root [data-action="pm-close"]'));
    await until(() => !$('#people-root .pm'));
    assert.match($('.members-list').textContent, /Lead/);
  });
  test('people who are not lead see the roles but cannot switch them', async () => {
    const tid = w.eval('S.teams[0].id');
    w.eval(`(() => { const t = team(${JSON.stringify(tid)}); window.__keep = { leads: t.leads, admin: S.me.admin }; t.leads = ['someone.else@firma.de']; S.me.admin = false; })()`);
    w.eval(`A['team-members']({ dataset: { id: ${JSON.stringify(tid)} } })`);
    await until(() => $('#people-root .pm-row'));
    assert.equal($('#people-root [data-action="pm-role"]'), null);
    assert.ok($('#people-root .pm-role'), 'the role is shown');
    click($('#people-root [data-action="pm-close"]'));
    w.eval(`(() => { const t = team(${JSON.stringify(tid)}); t.leads = window.__keep.leads; S.me.admin = window.__keep.admin; })()`);
  });
});
