/** Google Calendar link per person: connect (OAuth), my entries in the calendar, out of office as absence, disconnect. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

/** An app with the OAuth client entered and a Google double; events is what the calendar of ME answers. */
function world(events) {
  const app = freshApp();
  app.call('bootstrap');
  app.call('gcal.setup', { clientId: 'abc123.apps.googleusercontent.com', clientSecret: 'shh' });
  const g = { events: events || [], tokenCode: 200, revoked: 0, account: ME, eventsCode: 200 };
  const calls = app.fakeFetch((url, opts) => {
    if (url.indexOf('oauth2.googleapis.com/token') >= 0) {
      if (g.tokenCode !== 200) return { code: 400, body: { error: 'invalid_grant' } };
      return opts.payload.grant_type === 'refresh_token' ? { code: 200, body: { access_token: 'at2', expires_in: 3600 } }
        : { code: 200, body: { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 } };
    }
    if (url.indexOf('oauth2.googleapis.com/revoke') >= 0) { g.revoked++; return { code: 200, body: {} }; }
    if (/calendars\/primary\?/.test(url)) return { code: 200, body: { id: g.account } };
    if (/calendars\/primary\/events/.test(url)) return g.eventsCode === 200 ? { code: 200, body: { items: g.events } } : { code: 403, body: { error: { message: 'Forbidden' } } };
    throw new Error('unexpected ' + url);
  });
  const state = () => { const u = new URL(app.call('gcal.connect').url); return u.searchParams.get('state'); };
  const connect = () => app.ctx.__exports.Gcal.callback({ code: 'code1', state: state() });
  return { app, g, calls, connect };
}
const day = n => { const x = freshApp(); return x.x.Shared.addDays(x.x.Util.today(), n); };
const ev = (id, o) => Object.assign({ id: id, status: 'confirmed', summary: 'Sync', start: { dateTime: day(2) + 'T10:00:00+01:00' }, end: { dateTime: day(2) + 'T11:00:00+01:00' } }, o);

describe('setup and connect', () => {
  test('only admins enter the OAuth client; the secret is never sent back; a wrong id is refused', () => {
    const app = freshApp();
    app.call('bootstrap');
    assert.equal(app.call('gcal.status').configured, false);
    assert.match(app.as(ANNA).error('gcal.setup', { clientId: 'x.apps.googleusercontent.com', clientSecret: 's' }), /Nur Admins/);
    app.as(ME);
    assert.match(app.error('gcal.setup', { clientId: 'nope', clientSecret: 's' }), /Client-ID/);
    assert.match(app.error('gcal.setup', { clientId: 'x.apps.googleusercontent.com', clientSecret: '' }), /Secret/);
    const st = app.call('gcal.setup', { clientId: 'x.apps.googleusercontent.com', clientSecret: 's' });
    assert.equal(st.configured, true);
    assert.match(st.redirectUri, /\/exec$/);
    assert.ok(!JSON.stringify(app.call('bootstrap').gcal).includes('"s"'));
    assert.equal(app.as(ANNA).call('gcal.status').redirectUri, '', 'only admins see the redirect address');
  });
  test('connect needs the setup; the address carries read-only scope, offline access and a state', () => {
    const app = freshApp();
    assert.match(app.error('gcal.connect'), /nicht eingerichtet/);
    const w = world();
    const u = new URL(w.app.call('gcal.connect').url);
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.ok(u.searchParams.get('state'));
  });
  test('the callback stores the link, reads the calendar and tells the person; the token stays on the server', () => {
    const w = world([ev('e1')]);
    const html = w.connect();
    assert.match(html, /Google Kalender verbunden/);
    const st = w.app.call('gcal.status');
    assert.equal(st.connected, true);
    assert.ok(st.lastSync);
    assert.ok(!JSON.stringify(w.app.call('bootstrap')).includes('rt1'), 'no refresh token to the browser');
  });
  test('a wrong or reused state, another person, another Google account and a refusal are all rejected', () => {
    const w = world();
    const Gcal = w.app.ctx.__exports.Gcal;
    assert.match(Gcal.callback({ code: 'c', state: 'nope' }), /Verbindung nicht möglich/);
    const s = new URL(w.app.call('gcal.connect').url).searchParams.get('state');
    w.app.as(ANNA);
    assert.match(Gcal.callback({ code: 'c', state: s }), /andere Person|abgelaufen/, 'the state belongs to ME');
    w.app.as(ME);
    w.g.account = 'other@firma.de';
    assert.match(w.connect(), /Bitte mit dem Konto/);
    assert.equal(w.app.call('gcal.status').connected, false);
    assert.match(Gcal.callback({ error: 'access_denied', state: 'x' }), /nicht erteilt/);
  });
});

describe('my entries in the calendar', () => {
  test('timed and all-day entries show for me only; declined, cancelled and private ones are handled', () => {
    const w = world([
      ev('a'),
      ev('day', { summary: 'Offsite', start: { date: day(3) }, end: { date: day(5) } }),
      ev('no', { status: 'cancelled' }),
      ev('dec', { attendees: [{ self: true, responseStatus: 'declined' }] }),
      ev('priv', { visibility: 'private', summary: 'Arzt' }),
    ]);
    w.connect();
    const r = w.app.call('calendar.range', { from: day(0), to: day(10) });
    const g = r.events.filter(e => e.type === 'google');
    assert.deepEqual(g.map(e => e.title).sort(), ['Offsite', 'Privater Termin', 'Sync']);
    const off = g.find(e => e.title === 'Offsite');
    assert.deepEqual([off.startDate, off.endDate, off.allDay], [day(3), day(4), true], 'Google ends all-day entries one day late');
    const timed = g.find(e => e.title === 'Sync');
    assert.deepEqual([timed.time, timed.endTime], ['10:00', '11:00']);
    assert.equal(g.find(e => e.title === 'Privater Termin').link, '', 'nothing of a private entry');
    assert.equal(w.app.as(ANNA).call('calendar.range', { from: day(0), to: day(10) }).events.some(e => e.type === 'google'), false, 'colleagues see none of it');
  });
  test('Google problems never break the calendar; an expired link is noted for the settings', () => {
    const w = world([ev('a')]);
    w.connect();
    w.app.ctx.CacheService.getScriptCache().removeAll(['gcal_at_' + ME]);
    w.g.tokenCode = 400;
    const r = w.app.call('calendar.range', { from: day(30), to: day(40) });
    assert.equal(r.events.some(e => e.type === 'google'), false);
    assert.match(w.app.call('gcal.status').lastError, /abgelaufen/);
    w.g.tokenCode = 200;
    w.g.eventsCode = 403;
    assert.match(w.app.error('gcal.sync'), /nicht lesbar/);
  });
  test('without a link nothing is asked from Google', () => {
    const w = world();
    w.app.call('calendar.range', { from: day(0), to: day(10) });
    assert.equal(w.calls.filter(c => /google/.test(c.url)).length, 0);
  });
});

describe('out of office becomes absence', () => {
  const away = (id, a, b) => ev(id, { eventType: 'outOfOffice', summary: 'Urlaub', start: { date: day(a) }, end: { date: day(b + 1) } });
  test('imported as vacation, no double entry, removed again when it is gone from Google', () => {
    const w = world([away('o1', 5, 7)]);
    w.connect();
    const abs = () => w.app.call('calendar.range', { from: day(0), to: day(20) }).absences.filter(a => a.email === ME);
    assert.deepEqual(abs().map(a => [a.startDate, a.endDate, a.type]), [[day(5), day(7), 'vacation']]);
    w.app.call('gcal.sync');
    assert.equal(abs().length, 1, 'the second sync adds nothing');
    w.g.events = [];
    const r = w.app.call('gcal.sync');
    assert.equal(r.removed, 1);
    assert.equal(abs().length, 0);
  });
  test('days somebody entered by hand are not entered twice; an entry changed by hand is left alone', () => {
    const w = world([away('o1', 5, 7), away('o2', 10, 11)]);
    w.app.call('absences.save', { type: 'training', startDate: day(5), endDate: day(7) });
    w.connect();
    const abs = () => w.app.call('calendar.range', { from: day(0), to: day(20) }).absences.filter(a => a.email === ME);
    assert.equal(abs().length, 2, 'one by hand, one from Google');
    const g = abs().find(a => a.startDate === day(10));
    w.app.call('absences.save', { id: g.id, type: 'training', startDate: day(10), endDate: day(11) });
    w.g.events = [];
    w.app.call('gcal.sync');
    assert.equal(abs().filter(a => a.startDate === day(10)).length, 1, 'changed by hand: it stays');
  });
  test('the team capacity counts it', () => {
    const w = world([away('o1', 5, 7)]);
    const team = w.app.call('teams.save', { name: 'Kern', members: [ME] });
    w.connect();
    const r = w.app.call('calendar.range', { from: day(0), to: day(20), teamId: team.id });
    assert.ok(r.absences.some(a => a.email === ME && a.startDate === day(5)));
  });
});

describe('disconnect', () => {
  test('Google is told, the link and the imported absences go, manual ones stay', () => {
    const w = world([ev('o1', { eventType: 'outOfOffice', start: { date: day(5) }, end: { date: day(6) } })]);
    w.app.call('absences.save', { type: 'sick', startDate: day(15), endDate: day(15) });
    w.connect();
    const st = w.app.call('gcal.disconnect');
    assert.equal(st.connected, false);
    assert.equal(w.g.revoked, 1);
    const abs = w.app.call('calendar.range', { from: day(0), to: day(20) }).absences.filter(a => a.email === ME);
    assert.deepEqual(abs.map(a => a.type), ['sick']);
    assert.match(w.app.error('gcal.sync'), /nicht verbunden/);
  });
  test('the sync for everybody (time trigger) reads each connected person and survives a failing one', () => {
    const w = world([ev('o1', { eventType: 'outOfOffice', start: { date: day(5) }, end: { date: day(6) } })]);
    w.connect();
    assert.equal(w.app.ctx.gcalSyncAll(), 1);
    w.g.eventsCode = 403;
    assert.equal(w.app.ctx.gcalSyncAll(), 0);
  });
});

describe('direct link: the app reads the shared calendar as its owner (no cloud settings)', () => {
  function direct(shared, events) {
    const app = freshApp();
    app.ctx.__GAS_OWNER__ = 'chris@firma.de';
    app.as(ANNA).call('bootstrap');
    const state = { shared: shared, events: events || [] };
    const calls = app.fakeFetch((url, opts) => {
      const m = /calendars\/([^/]+)\/events/.exec(url);
      if (!m) throw new Error('unexpected ' + url);
      assert.equal(opts.headers.Authorization, 'Bearer test-token', 'the app\'s own token');
      return state.shared ? { code: 200, body: { items: state.events } } : { code: 404, body: { error: { message: 'Not Found' } } };
    });
    return { app, state, calls };
  }
  test('not shared: a clear hint with the owner, nothing is saved; shared: connected and entries appear', () => {
    const w = direct(false);
    assert.match(w.app.error('gcal.connectDirect'), /chris@firma\.de/);
    assert.equal(w.app.call('gcal.status').connected, false);
    w.state.shared = true;
    w.state.events = [ev('a'), ev('o', { eventType: 'outOfOffice', start: { date: day(5) }, end: { date: day(6) } })];
    const st = w.app.call('gcal.connectDirect');
    assert.deepEqual([st.connected, st.mode, st.owner], [true, 'direct', 'chris@firma.de']);
    const r = w.app.call('calendar.range', { from: day(0), to: day(10) });
    assert.equal(r.events.filter(e => e.type === 'google').length, 2);
    assert.ok(r.absences.some(a => a.email === ANNA && a.startDate === day(5)));
    assert.ok(w.calls.filter(c => /googleapis/.test(c.url)).every(c => c.url.indexOf(encodeURIComponent(ANNA)) >= 0), 'only the person\'s own calendar is read');
  });
  test('sharing taken back later: the error is noted, the calendar stays usable; disconnect asks Google for nothing', () => {
    const w = direct(true, [ev('a')]);
    w.app.call('gcal.connectDirect');
    w.state.shared = false;
    assert.match(w.app.error('gcal.sync'), /nicht freigegeben/);
    assert.match(w.app.call('gcal.status').lastError, /nicht freigegeben/);
    w.app.call('calendar.range', { from: day(30), to: day(40) });
    const n = w.calls.length;
    w.app.call('gcal.disconnect');
    assert.equal(w.calls.length, n, 'no token to revoke');
  });
});
