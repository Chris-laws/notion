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
  test('endOfMonth knows short months', () => {
    assert.equal(S.endOfMonth('2026-02-10'), '2026-02-28');
    assert.equal(S.endOfMonth('2026-04-30'), '2026-04-30');
  });
  test('isDate rejects other types and formats', () => {
    assert.deepEqual([S.isDate(20261023), S.isDate('2026-1-1'), S.isDate('')], [false, false, false]);
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
    today: '2026-10-23', me: 'demo.user@firma.de',
    users: [{ email: 'anna.schmidt@firma.de', name: 'Anna Schmidt' }, { email: 'demo.user@firma.de', name: 'Demo User' }],
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
  test('"ab" sets the start date, not the due date', () => {
    const r = plain(S.parse('Workshop ab morgen', ctx));
    assert.equal(r.startDate, '2026-10-24');
    assert.equal(r.dueDate || '', '');
  });
  test('@ich assigns me', () => {
    assert.deepEqual(plain(S.parse('Bericht @ich', ctx)).assignees, ['demo.user@firma.de']);
  });
  test('a team or tag given twice is taken once', () => {
    const r = plain(S.parse('Plan +marketing +marketing #q4 #q4', ctx));
    assert.deepEqual([r.teams, r.tags], [['tm1'], ['q4']]);
  });
  test('one bang is high, two bangs are urgent', () => {
    assert.equal(S.parse('A !', ctx).priority, 'high');
    assert.equal(S.parse('A !!', ctx).priority, 'urgent');
  });
  test('a weekday name means the next such day (from Friday to Monday)', () => {
    assert.equal(S.parse('Call Montag', ctx).dueDate, '2026-10-26');
  });
  test('a date without year that has passed this year means next year', () => {
    assert.equal(S.parse('Steuer 01.03.', ctx).dueDate, '2027-03-01');
    assert.equal(S.parse('Steuer 23.10.', ctx).dueDate, '2026-10-23', 'today itself stays this year');
  });
  test('dates like 31.12. are taken, 32.12. is not a date', () => {
    assert.equal(S.parse('Abschluss 31.12.', ctx).dueDate, '2026-12-31');
    assert.equal(S.parse('Abschluss 32.12.', ctx).dueDate || '', '');
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

describe('time tracking', () => {
  const now = Date.parse('2026-10-25T10:30:00Z');
  test('adding minutes while the timer runs counts the running time once and restarts it', () => {
    const r = S.addTime(0, '2026-10-25T10:00:00Z', now, 10);
    assert.deepEqual([r.spent, r.timerStart], [40, '2026-10-25T10:30:00.000Z']);
  });
  test('adding minutes without a timer just adds them', () => {
    assert.deepEqual(plain(S.addTime(15, '', now, 10)), { spent: 25, timerStart: '' });
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
  const ME = 'demo.user@firma.de';
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
  test('"today" holds overdue, due today and planned for today, not tomorrow', () => {
    const tasks = [mk('late', 'todo', '2026-10-20'), mk('due', 'todo', day), mk('plan', 'todo', '', { planDate: day }), mk('tomorrow', 'todo', '2026-10-24')];
    assert.equal(ids(run(tasks, { quick: 'today' })), 'late,due,plan');
  });
  test('a status filter on "done" shows done tasks although done ones are hidden', () => {
    const tasks = [mk('open', 'todo', ''), mk('closed', 'done', '')];
    assert.equal(ids(run(tasks, { statuses: ['done'], showDone: false }, { quickTabs: false })), 'closed');
  });
  test('project and person filters also match the first entry of their list', () => {
    const tasks = [mk('a', 'todo', '', { projectId: 'p1' }), mk('b', 'todo', '', { projectId: 'p2', assignees: ['x@firma.de'] })];
    assert.equal(ids(run(tasks, { projects: ['p1', 'p9'] }, { quickTabs: false })), 'a');
    assert.equal(ids(run(tasks, { people: ['x@firma.de'] }, { quickTabs: false })), 'b');
  });
  test('every tab count equals the length of its list', () => {
    const tasks = [mk('a', 'todo', '2026-10-20'), mk('b', 'done', ''), mk('c', 'doing', day), mk('d', 'todo', '')];
    const counts = run(tasks, { quick: 'open' }).counts;
    S.QUICK_TABS.forEach(k => assert.equal(run(tasks, { quick: k }).list.length, counts[k], k));
  });
});

describe('project colours per team', () => {
  const P = (id, teamId, color) => ({ id: id, teamId: teamId, color: color, name: 'Projekt ' + id });
  test('taken colours: only the same team, not the project itself, only palette colours, first project wins', () => {
    const list = [P('a', 't', 'yellow'), P('b', 't', 'yellow'), P('c', 'u', 'red'), P('d', 't', 'gray'), P('e', 't', 'blue')];
    assert.deepEqual(plain(S.takenProjectColors(list, 't')), { yellow: 'Projekt a', blue: 'Projekt e' });
    assert.deepEqual(plain(S.takenProjectColors(list, 't', 'e')), { yellow: 'Projekt a' });
    assert.deepEqual(plain(S.takenProjectColors(list, 'x')), {});
  });
  test('the first free colour follows the palette order', () => {
    assert.equal(S.freeProjectColor([], 't'), 'blue');
    assert.equal(S.freeProjectColor([P('a', 't', 'blue')], 't'), 'orange');
    assert.equal(S.freeProjectColor([P('a', 't', 'blue')], 't', 'a'), 'blue');
    assert.equal(S.freeProjectColor([P('a', 'u', 'blue')], 't'), 'blue');
  });
  test('with the palette full, the least used colour comes next (ties: palette order)', () => {
    const full = S.PROJECT_PALETTE.map((c, i) => P('p' + i, 't', c));
    assert.equal(S.freeProjectColor(full, 't'), 'blue');
    const more = full.concat([P('x', 't', 'blue'), P('y', 't', 'orange')]);
    assert.equal(S.freeProjectColor(more, 't'), 'green');
    assert.equal(S.freeProjectColor(more.concat([P('z', 'u', 'green')]), 't'), 'green');
    assert.equal(S.freeProjectColor(full.concat([P('x', 't', 'blue')]), 't', 'x'), 'blue');
  });
});
