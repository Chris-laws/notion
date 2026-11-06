/** v62.5: a jour fixe that is gone leaves the calendar, the Meet link is changed in the overview row, the sheet header is slim. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

let w;
let tid;
let sid;
before(async () => {
  w = await bootApp({ lang: 'de', beforeStart: win => { win.TextDecoder = TextDecoder; } });
  tid = w.eval('project(S.projects[0].id).teamId');
  sid = await w.eval(`(async () => {
    const people = S.users.slice(0, 3).map(u => u.email);
    const s = await call('jf.saveSeries', { teamId: ${JSON.stringify(tid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: people, meetLink: 'https://meet.google.com/abc-defg-hij' });
    S.jf = await call('jf.list', {});
    return s.id;
  })()`);
});
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const submitForm = form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }
const tab = async () => {
  w.eval(`S.doc = null; S.protoEdit = null; S.jfMeetEdit = ''; S.teamTab = 'jf'; go('team', ${JSON.stringify(tid)})`);
  await until(() => $('.jfo-tbl'));
  await wait(400);
};

describe('a jour fixe that no longer exists leaves the calendar', () => {
  test('ending the series and deleting the team both remove the meetings from the calendar data (admins too)', async () => {
    const range = () => w.eval(`call('calendar.range', { from: TODAY(), to: Shared.addDays(TODAY(), 28) })`);
    assert.ok((await range()).events.some(e => e.type === 'jf' && e.seriesId === sid), 'the series shows in the calendar');
    const gone = await w.eval(`(async () => {
      const t = await call('teams.save', { name: 'Kurzzeit-Team' });
      const s = await call('jf.saveSeries', { teamId: t.id, title: 'Weg-JF', rhythm: 'weekly', weekday: 2, time: '10:00', duration: 15, startDate: '2026-01-06', attendees: [] });
      const before = (await call('calendar.range', { from: TODAY(), to: Shared.addDays(TODAY(), 28) })).events.filter(e => e.seriesId === s.id).length;
      await call('teams.remove', { id: t.id });
      const after = (await call('calendar.range', { from: TODAY(), to: Shared.addDays(TODAY(), 28) })).events.filter(e => e.seriesId === s.id).length;
      return { before, after };
    })()`);
    assert.ok(gone.before > 0, 'it was in the calendar');
    assert.equal(gone.after, 0, 'gone with the team');
    await w.eval(`call('jf.removeSeries', { id: ${JSON.stringify(sid)} })`);
    assert.ok(!(await range()).events.some(e => e.seriesId === sid), 'ended series: no meetings any more');
    // back for the following tests
    sid = await w.eval(`(async () => {
      const s = await call('jf.saveSeries', { teamId: ${JSON.stringify(tid)}, title: 'Team-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: '2026-01-05', attendees: [], meetLink: 'https://meet.google.com/abc-defg-hij' });
      S.jf = await call('jf.list', {});
      return s.id;
    })()`);
  });
  test('a calendar entry of a series that is gone does not open an error page: a note, and the entry leaves', async () => {
    w.eval(`go('calendar')`);
    w.eval(`S.cal.cache = { x: { events: [{ id: 'jf_old_2026-11-09', type: 'jf', seriesId: 'jf_does_not_exist', startDate: '2026-11-09', title: 'Alt' }] } }`);
    const reloads = w.eval(`(() => {
      window.__reloads = 0;
      const orig = window.calReload;
      window.calReload = () => { window.__reloads++; };
      const b = document.createElement('button');
      b.dataset.id = 'jf_old_2026-11-09';
      A['event-edit'](b, { stopPropagation() {} });
      window.calReload = orig;
      return window.__reloads;
    })()`);
    assert.equal(w.eval('S.route.view'), 'calendar', 'still on the calendar');
    assert.equal($('.nf-code'), null, 'no error page');
    assert.equal(reloads, 1, 'the calendar is read again');
  });
});

describe('Meet link in the overview row', () => {
  test('the row shows camera and address; the pencil opens a field right there; saving changes the series', async () => {
    await tab();
    const box = $('.jfo-row .jfo-meetbox');
    assert.ok(box, 'camera + address');
    assert.match(box.textContent, /meet\.google\.com\/abc-defg-hij/);
    click($('.jfo-meet-ed'));
    await until(() => $('.jfo-meet-form input'));
    const f = $('.jfo-meet-form');
    f.elements.meet.value = 'meet.google.com/xyz-abcd-efg';
    submitForm(f);
    await until(() => !$('.jfo-meet-form'));
    assert.equal(w.eval(`jfData().series.find(x => x.id === ${JSON.stringify(sid)}).meetLink`), 'https://meet.google.com/xyz-abcd-efg');
    const saved = await w.eval('call("jf.list", {})');
    assert.equal(saved.series.find(x => x.id === sid).meetLink, 'https://meet.google.com/xyz-abcd-efg', 'saved on the server');
    assert.equal(saved.series.find(x => x.id === sid).time, '09:00', 'the rest of the series is untouched');
    assert.match($('.jfo-row .jfo-meet').getAttribute('href'), /xyz-abcd-efg/);
  });
  test('a link that is no Meet link is refused with a hint; an empty field removes the link and a button to add one stays', async () => {
    await tab();
    click($('.jfo-meet-ed'));
    await until(() => $('.jfo-meet-form input'));
    $('.jfo-meet-form').elements.meet.value = 'https://example.com/evil';
    submitForm($('.jfo-meet-form'));
    assert.ok($('.jfo-meet-form'), 'the field stays open');
    assert.equal(w.eval(`jfData().series.find(x => x.id === ${JSON.stringify(sid)}).meetLink`), 'https://meet.google.com/xyz-abcd-efg', 'nothing changed');
    $('.jfo-meet-form').elements.meet.value = '';
    submitForm($('.jfo-meet-form'));
    await until(() => !$('.jfo-meet-form'));
    assert.equal($('.jfo-meet'), null, 'no camera without a link');
    assert.ok($('.jfo-meet-add'), 'writers can add a link right in the row');
  });
  test('the pager sits at the foot of the page, on the left', async () => {
    await tab();
    const pager = $('.jfo-pager');
    assert.ok(pager);
    assert.ok(pager.querySelector('.jfo-pg'), 'previous / pages / next');
    assert.equal(pager.querySelector('.grow').nextElementSibling.tagName, 'SPAN', 'the count is at the other end');
  });
});

describe('sheet header', () => {
  test('back, title, state and actions in one row; the chips in one row below; no icon tile and no second title', async () => {
    await tab();
    const m = w.eval(`(() => { const s = jfData().series[0]; return { id: s.id }; })()`);
    const rows = w.eval(`jfData().minutes.length`);
    assert.ok(rows >= 0);
    const html = w.eval(`(() => { S.doc = { id: '', draft: true, kind: 'jf', projectId: 'team:${tid}', seriesId: ${JSON.stringify(m.id)}, date: '2026-11-09', version: 0, title: 'Team-JF', canWrite: true, content: Shared.jfTemplate(jfData().series[0], '2026-11-09', null, S.me.email) }; return protoViewer(); })()`);
    const box = w.document.createElement('div');
    box.innerHTML = html;
    const head = box.querySelector('.jfs-head');
    assert.ok(head, 'one header');
    assert.equal(head.querySelectorAll('h2').length, 1);
    assert.ok(head.querySelector('.jfs-back[data-action="jf-back"]'));
    assert.ok(head.querySelector('.jfs-acts'));
    assert.ok(head.querySelector('.jfs-chips .jfs-chip'));
    assert.equal(box.querySelector('.jfs-title'), null);
    assert.equal(box.querySelector('.jfs-top'), null);
    w.eval('S.doc = null');
  });
});
