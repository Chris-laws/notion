/** Pure domain logic from Shared.js: dates, recurrence, quick-add parser, task filter. No services involved. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../dev/load');

const S = load({ quiet: true }).__exports.Shared;
const plain = v => JSON.parse(JSON.stringify(v));

describe('dates', () => {
  test('addDays crosses month and year ends', () => {
    assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
  });
  test('addMonths clamps to the last day of a shorter month', () => {
    assert.equal(S.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(S.addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
  });
  test('mondayOf a Sunday is the Monday before', () => {
    assert.equal(S.mondayOf('2026-10-25'), '2026-10-19');
  });
  test('isoWeek follows ISO 8601 at the year boundary', () => {
    assert.equal(S.isoWeek('2026-12-31'), 53);
    assert.equal(S.isoWeek('2027-01-04'), 1);
  });
  test('isDate rejects impossible dates', () => {
    assert.equal(S.isDate('2026-02-30'), false);
    assert.equal(S.isDate('2026-02-28'), true);
  });
});

describe('recurrence', () => {
  test('weekdays skip from Friday to Monday', () => {
    assert.equal(S.nextOccurrence('2026-10-23', 'weekdays'), '2026-10-26');
  });
  test('monthly keeps the end of the month', () => {
    assert.equal(S.nextOccurrence('2026-01-31', 'monthly'), '2026-02-28');
  });
});

describe('quick-add parser', () => {
  const ctx = {
    today: '2026-10-23', me: 'chris@firma.de',
    users: [{ email: 'anna.schmidt@firma.de', name: 'Anna Schmidt' }, { email: 'chris@firma.de', name: 'Chris' }],
    teams: [{ id: 'tm1', name: 'Marketing' }],
    projects: [{ id: 'pr1', name: 'Website' }],
  };
  test('reads person, project, priority, date and effort', () => {
    const r = plain(S.parse('Angebot schicken morgen @anna #website !hoch 2h', ctx));
    assert.deepEqual([r.title, r.dueDate, r.assignees, r.projectId, r.priority, r.estimate],
      ['Angebot schicken', '2026-10-24', ['anna.schmidt@firma.de'], 'pr1', 'high', 2]);
  });
  test('keeps an unknown @name in the title', () => {
    const r = plain(S.parse('Mit @niemand reden', ctx));
    assert.deepEqual(r.assignees || [], []);
    assert.match(r.title, /niemand/);
  });
  test('falls back to the raw text when only tokens are given', () => {
    assert.equal(S.parse('morgen', ctx).title, 'morgen');
  });
});

describe('timing of retries and polling', () => {
  test('retry delay doubles per attempt and is spread by ±50 %', () => {
    assert.deepEqual([0, 1, 2].map(n => S.retryDelay(n, 0.5)), [500, 1000, 2000]);
    assert.equal(S.retryDelay(1, 0), 500);
    assert.equal(S.retryDelay(1, 0.999), 1499);
  });
  test('retry delay never exceeds 8 s', () => {
    assert.equal(S.retryDelay(10, 0.999), 8000);
  });
  test('poll delay spreads users by ±25 % so they do not poll in lockstep', () => {
    assert.deepEqual([0, 0.5, 0.999].map(r => S.pollDelay(120, 0, r)), [90000, 120000, 149940]);
  });
  test('poll delay backs off after failed polls, at most 8x', () => {
    assert.deepEqual([1, 2, 3, 9].map(f => S.pollDelay(120, f, 0.5)), [240000, 480000, 960000, 960000]);
  });
});

describe('focus order', () => {
  const t = (id, due, prio) => ({ id, dueDate: due, priority: prio || '' });
  test('earlier due date first, then higher priority on the same day', () => {
    const list = [t('lowToday', '2026-10-23', 'low'), t('late', '2026-10-20'), t('urgentToday', '2026-10-23', 'urgent'), t('noDate', '')];
    assert.deepEqual(list.sort(S.focusOrder).map(x => x.id), ['late', 'urgentToday', 'lowToday', 'noDate']);
  });
});

describe('task filter (taskQuery)', () => {
  const ME = 'chris@firma.de';
  const day = '2026-10-23';
  const mk = (id, status, due, extra) => Object.assign({ id, title: id, status, dueDate: due || '', tags: [], assignees: [ME], priority: '' }, extra || {});
  const ids = r => r.list.map(t => t.id).join(',');
  const run = (tasks, f, c) => S.taskQuery(tasks, f, Object.assign({ me: ME, today: day, quickTabs: true, includeSub: true }, c));

  test('"upcoming" includes day +7 and excludes day +8 and today', () => {
    const tasks = [mk('today', 'todo', day), mk('d7', 'todo', '2026-10-30'), mk('d8', 'todo', '2026-10-31')];
    assert.equal(ids(run(tasks, { quick: 'upcoming' })), 'd7');
  });
  test('"overdue" does not include tasks due today', () => {
    const tasks = [mk('today', 'todo', day), mk('late', 'todo', '2026-10-22')];
    assert.equal(ids(run(tasks, { quick: 'overdue' })), 'late');
  });
  test('search also matches tags, case-insensitive', () => {
    const tasks = [mk('a', 'todo', '', { tags: ['Kunde'] }), mk('b', 'todo', '')];
    assert.equal(ids(run(tasks, { search: 'KUNDE' })), 'a');
  });
  test('priority filter "" finds tasks without priority', () => {
    const tasks = [mk('none', 'todo', ''), mk('hi', 'todo', '', { priority: 'high' })];
    assert.equal(ids(run(tasks, { prio: [''] })), 'none');
  });
  test('person filter "__none" finds unassigned tasks', () => {
    const tasks = [mk('mine', 'todo', ''), mk('free', 'todo', '', { assignees: [] })];
    assert.equal(ids(run(tasks, { people: ['__none'] }, { quickTabs: false, allDone: true })), 'free');
  });
  test('an unknown quick tab falls back to "open"', () => {
    const r = run([mk('a', 'todo', ''), mk('b', 'done', '')], { quick: 'gibtsnicht' });
    assert.equal(r.quick, 'open');
    assert.equal(ids(r), 'a');
  });
  test('sub-tasks are hidden outside "my tasks"', () => {
    const tasks = [mk('p', 'todo', ''), mk('s', 'todo', '', { parentId: 'p' })];
    assert.equal(ids(run(tasks, {}, { quickTabs: false, includeSub: false })), 'p');
  });
  test('every tab count equals the length of its list', () => {
    const tasks = [mk('a', 'todo', '2026-10-20'), mk('b', 'done', ''), mk('c', 'doing', day), mk('d', 'todo', '')];
    const counts = run(tasks, { quick: 'open' }).counts;
    S.QUICK_TABS.forEach(k => assert.equal(run(tasks, { quick: k }).list.length, counts[k], k));
  });
});
