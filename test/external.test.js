/**
 * External services replaced by test doubles (UrlFetchApp): the holiday API and Vertex AI.
 * Each test checks what the app does with the answer, not what the double does.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME } = require('./helpers');

const nagerOk = [
  { date: '2031-07-14', localName: 'Fête nationale', name: 'Bastille Day', counties: null, types: ['Public'] },
  { date: '2031-12-24', localName: 'Réveillon', name: 'Christmas Eve', counties: null, types: ['Observance'] },
];

/** Google's public holiday calendar as a double: all-day events in the requested year. */
function googleCalendar(app, events) {
  const asked = [];
  app.ctx.CalendarApp = { getCalendarById: id => { asked.push(id); return events && { getEvents: () => events.map(([date, title]) => ({
    getAllDayStartDate: () => new Date(date + 'T00:00:00Z'), getTitle: () => title })) }; } };
  return asked;
}

describe('holidays (Google Calendar double)', () => {
  test('when Nager.Date is down, the Google holiday calendar of the country is used and cached', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 503, body: 'down' }));
    const asked = googleCalendar(app, [['2031-10-03', 'German Unity Day']]);
    const list = app.x.Holidays.forCountry('DE', 2031);
    assert.deepEqual(list.map(h => [h.date, h.nameEn, h.source]), [['2031-10-03', 'German Unity Day', 'google']]);
    assert.match(asked[0], /^en\.de#holiday@group\.v\.calendar\.google\.com$/);
    assert.ok(app.x.Db.get('HolidayCache', 'DE-2031'), 'stored like a Nager answer');
  });
  test('Nager.Date comes first: the calendar is not asked when the API answers', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 200, body: nagerOk }));
    const asked = googleCalendar(app, [['2031-07-14', 'Bastille Day']]);
    assert.equal(app.x.Holidays.forCountry('FR', 2031)[0].source, 'nager');
    assert.equal(asked.length, 0);
  });
  test('no calendar, an empty one or an error: the built-in list takes over', () => {
    [null, []].forEach(events => {
      const app = freshApp();
      app.fakeFetch(() => ({ code: 503, body: 'down' }));
      googleCalendar(app, events);
      assert.equal(app.x.Holidays.forCountry('DE', 2031)[0].source, 'builtin');
    });
    const app = freshApp();
    app.fakeFetch(() => ({ code: 503, body: 'down' }));
    app.ctx.CalendarApp = { getCalendarById: () => { throw new Error('no permission'); } };
    assert.equal(app.x.Holidays.forCountry('DE', 2031)[0].source, 'builtin');
  });
});

describe('holidays (Nager.Date double)', () => {
  test('public holidays are taken with their English name, observances are skipped', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 200, body: nagerOk }));
    const list = app.x.Holidays.forCountry('FR', 2031);
    assert.deepEqual(list.map(h => [h.name, h.nameEn, h.source]), [['Fête nationale', 'Bastille Day', 'nager']]);
  });
  test('the service is asked once per country and year', () => {
    const app = freshApp();
    const calls = app.fakeFetch(() => ({ code: 200, body: nagerOk }));
    app.x.Holidays.forCountry('FR', 2031);
    app.x.Db.reset();
    app.x.Holidays.forCountry('FR', 2031);
    assert.equal(calls.length, 1);
  });
  test('an HTTP error falls back to the built-in list', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 503, body: 'down' }));
    const list = app.x.Holidays.forCountry('DE', 2031);
    assert.ok(list.length > 5);
    assert.equal(list[0].source, 'builtin');
  });
  test('a timeout falls back to the built-in list with English names', () => {
    const app = freshApp();
    app.fakeFetch(() => { throw new Error('Timeout: https://date.nager.at'); });
    const unity = app.x.Holidays.forCountry('DE', 2031).find(h => h.date === '2031-10-03');
    assert.deepEqual([unity.name, unity.nameEn], ['Tag der Deutschen Einheit', 'German Unity Day']);
  });
  test('the built-in fallback is not stored, so the service is tried again later', () => {
    const app = freshApp();
    app.fakeFetch(() => ({ code: 500, body: '' }));
    app.x.Holidays.forCountry('AT', 2031);
    assert.equal(app.x.Db.get('HolidayCache', 'AT-2031'), null);
  });
  test('every built-in holiday of a non-English country has an English translation', () => {
    const app = freshApp();
    const H = app.x.Holidays;
    const missing = [];
    ['DE', 'AT', 'CH', 'FR', 'IT', 'ES', 'NL', 'PL'].forEach(c => H.builtin_(c, 2031).forEach(h => { if (!H.EN_NAMES[h.name]) missing.push(c + ': ' + h.name); }));
    assert.deepEqual(missing, []);
  });
});

describe('AI (Vertex double)', () => {
  function aiApp() {
    const app = freshApp({ demo: true });
    app.ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'test-key');
    app.x.Config.reset();
    return app;
  }
  const gemini = obj => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

  test('quick report falls back to rules when Vertex answers 500', () => {
    const app = aiApp();
    app.fakeFetch(() => ({ code: 500, body: 'error' }));
    const r = app.call('ai.report', { range: 'week', fresh: true });
    assert.equal(r.source, 'rules');
    assert.ok(r.text.length > 0);
  });
  test('quick report falls back to rules on a timeout', () => {
    const app = aiApp();
    app.fakeFetch(() => { throw new Error('Exception: Timeout'); });
    assert.equal(app.call('ai.report', { range: 'day', fresh: true }).source, 'rules');
  });
  test('quick report falls back to rules when Gemini sends no JSON', () => {
    const app = aiApp();
    app.fakeFetch(() => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: 'Sorry, kein JSON' }] } }] } }));
    assert.equal(app.call('ai.report', { range: 'week', fresh: true }).source, 'rules');
  });
  test('the assistant drops people that are not in the directory', () => {
    const app = aiApp();
    app.fakeFetch(() => gemini({ items: [{ type: 'task', title: 'Prüfen', assignees: ['erfunden@firma.de', ME] }] }));
    const d = app.call('ai.assist', { text: 'Prüfen' });
    assert.deepEqual(JSON.parse(JSON.stringify(d.items[0].assignees)), [ME]);
  });
  test('the assistant falls back to rules with a warning when Vertex fails', () => {
    const app = aiApp();
    app.fakeFetch(() => ({ code: 429, body: 'quota' }));
    const d = app.call('ai.assist', { text: 'Angebot prüfen morgen' });
    assert.equal(d.source, 'rules');
    assert.match(d.warning, /429/);
  });
  test('without a key no request leaves the app', () => {
    const app = freshApp({ demo: true });
    const calls = app.fakeFetch(() => ({ code: 200, body: {} }));
    app.call('ai.report', { range: 'week', fresh: true });
    assert.equal(calls.filter(c => /aiplatform/.test(c.url)).length, 0);
  });
});
