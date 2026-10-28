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
    assert.deepEqual(['2026-00-10', '2026-13-01', '2026-04-31'].map(S.isDate), [false, false, false]);
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

describe('lead roles', () => {
  test('a team has its list of leads, older teams their one lead', () => {
    assert.deepEqual(plain(S.teamLeads({ lead: 'a@x.de', leads: ['b@x.de', 'c@x.de'] })), ['b@x.de', 'c@x.de']);
    assert.deepEqual(plain(S.teamLeads({ lead: 'a@x.de', leads: [] })), ['a@x.de']);
    assert.deepEqual(plain(S.teamLeads({ lead: 'a@x.de' })), ['a@x.de']);
    assert.deepEqual(plain(S.teamLeads(null)), []);
  });
  test('a project has its list of leads, otherwise the person who created it', () => {
    assert.deepEqual(plain(S.projectLeads({ createdBy: 'a@x.de', leads: ['b@x.de'] })), ['b@x.de']);
    assert.deepEqual(plain(S.projectLeads({ createdBy: 'a@x.de', leads: [] })), ['a@x.de']);
    assert.deepEqual(plain(S.projectLeads({ createdBy: '' })), []);
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
  test('a person named twice is assigned once; p1 to p4 are the priorities', () => {
    assert.deepEqual(plain(S.parse('Termin @anna @anna', ctx)).assignees, ['anna.schmidt@firma.de']);
    assert.deepEqual(['p1', 'p2', 'p3', 'p4'].map(k => S.parse('A ' + k + ' x', ctx).priority), ['urgent', 'high', 'medium', 'low']);
  });
  test('German dates: impossible days and months are no date, two digit years are 20xx', () => {
    assert.deepEqual(['32.1.', '1.13.', '0.5.', '5.0.', '1.2.100'].map(d => S.parse('Bericht ' + d + ' fertig', ctx).dueDate || ''), ['', '', '', '', '']);
    assert.equal(S.parse('Bericht 1.2.27 fertig', ctx).dueDate, '2027-02-01');
    assert.equal(S.parse('Bericht 31.12. fertig', ctx).dueDate, '2026-12-31');
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

describe('jour fixe dates', () => {
  const ser = (rhythm, weekday, extra) => Object.assign({ rhythm: rhythm, weekday: weekday, startDate: '2026-11-02' }, extra || {});
  test('weekly: every matching weekday in the range, from the start date on', () => {
    assert.deepEqual(plain(S.jfDates(ser('weekly', 1), '2026-10-26', '2026-11-22')), ['2026-11-02', '2026-11-09', '2026-11-16']);
  });
  test('every two weeks counts from the first meeting', () => {
    assert.deepEqual(plain(S.jfDates(ser('biweekly', 3), '2026-11-01', '2026-12-10')), ['2026-11-04', '2026-11-18', '2026-12-02']);
  });
  test('monthly: the same weekday in the same week of the month (first Monday)', () => {
    assert.deepEqual(plain(S.jfDates(ser('monthly', 1), '2026-11-01', '2027-01-31')), ['2026-11-02', '2026-12-07', '2027-01-04']);
  });
  test('meetings exactly on the first and the last day of the range count', () => {
    assert.deepEqual(plain(S.jfDates(ser('weekly', 1), '2026-11-02', '2026-11-16')), ['2026-11-02', '2026-11-09', '2026-11-16']);
    assert.deepEqual(plain(S.jfDates(ser('monthly', 1), '2026-12-07', '2027-02-01')), ['2026-12-07', '2027-01-04', '2027-02-01']);
  });
  test('monthly keeps the week of the month: started on the 7th = first week, on a 5th Monday = only months with one', () => {
    assert.deepEqual(plain(S.jfDates(ser('monthly', 1, { startDate: '2026-12-07' }), '2026-12-01', '2027-01-31')), ['2026-12-07', '2027-01-04']);
    assert.deepEqual(plain(S.jfDates(ser('monthly', 1, { startDate: '2026-11-30' }), '2026-11-01', '2027-03-31')), ['2026-11-30', '2027-03-29']);
  });
  test('an empty end date means no end; at most 400 meetings per call', () => {
    assert.equal(S.jfDates(ser('weekly', 1, { endDate: '' }), '2026-11-01', '2026-11-30').length, 5);
    assert.equal(S.jfDates(ser('weekly', 1), '2026-11-01', '2040-01-01').length, 400);
  });
  test('an end date stops the series; a range before the start is empty', () => {
    assert.deepEqual(plain(S.jfDates(ser('weekly', 1, { endDate: '2026-11-10' }), '2026-11-01', '2026-11-30')), ['2026-11-02', '2026-11-09']);
    assert.deepEqual(plain(S.jfDates(ser('weekly', 1), '2026-01-01', '2026-10-31')), []);
  });
});

describe('action items', () => {
  test('an open item with person and due date', () => {
    assert.deepEqual(plain(S.parseActionItem('- [ ] Angebot einholen @anna.schmidt@firma.de !2026-11-03')),
      { done: false, text: 'Angebot einholen', assignee: 'anna.schmidt@firma.de', due: '2026-11-03', taskId: '' });
  });
  test('a done item, an item already turned into a task, and plain lines', () => {
    assert.equal(S.parseActionItem('- [x] Erledigt').done, true);
    assert.equal(S.parseActionItem('* [ ] Folien ⟶ #t_ab12').taskId, 't_ab12');
    assert.equal(S.parseActionItem('- [ ] Folien ⟶ #t_ab12').text, 'Folien');
    assert.equal(S.parseActionItem('- normaler Punkt'), null);
    assert.equal(S.parseActionItem('Text'), null);
    assert.equal(S.parseActionItem('- [ ] Termin !2026-02-31').due, '', 'not a real date');
  });
});

describe('safe file names', () => {
  test('characters Drive or a path would trip over become dashes; never empty, never a dot name', () => {
    assert.equal(S.safeName('Q4 / Plan: "neu"?'), 'Q4 - Plan- -neu--');
    assert.equal(S.safeName('  \u0000 '), '_');
    assert.equal(S.safeName('..'), '_');
    assert.equal(S.safeName('a' + String.fromCharCode(92) + 'b'), 'a-b', 'backslash too');
    assert.equal(S.safeName('x'.repeat(200)).length, 80);
  });
});

describe('jour fixe minutes (structured)', () => {
  const model = () => ({
    title: 'Team-JF', date: '2026-11-02', minuteTaker: 'a@firma.de', present: ['a@firma.de', 'b@firma.de'], absent: ['c@firma.de'],
    topics: [
      { title: 'Reinigung | Geldspeicher', owner: 'a@firma.de', items: [
        { type: 'I', text: 'Schwieriger als gedacht\nzweite Zeile', owner: 'a@firma.de', due: '' },
        { type: 'A', text: 'Bericht im nächsten JF', owner: 'b@firma.de', due: '2026-11-09', done: false, taskId: '' },
        { type: 'A', text: 'Erledigt', owner: 'b@firma.de', due: '', done: true, taskId: 't_1' },
      ] },
      { title: 'Lotterie', owner: '', items: [{ type: 'N', text: 'Nachtrag --> wichtig', owner: '', due: '' }] },
    ],
  });
  test('round trip: text for people (table) plus the data block the form loads again', () => {
    const text = S.protoToText(model());
    assert.match(text, /\| 1\. \| \| \*\*Reinigung \\| Geldspeicher\*\* \| @a@firma\.de \| \|/);
    assert.match(text, /\| \| A \| Bericht im nächsten JF \| @b@firma\.de \| 2026-11-09 \|/);
    assert.match(text, /Schwieriger als gedacht zweite Zeile/, 'one table row per line');
    assert.deepEqual(plain(S.protoFromText(text)), plain(S.protoClean(model())));
  });
  test('text without a data block, or a broken one, gives null', () => {
    assert.equal(S.protoFromText('# nur Text'), null);
    assert.equal(S.protoFromText('x\n<!-- lidlflow:protocol {kaputt -->'), null);
  });
  test('clean: unknown types become I, missing lists become empty, texts are limited', () => {
    const c = S.protoClean({ topics: [{ title: 'x'.repeat(500), items: [{ type: 'Z', text: 'a' }] }] });
    assert.equal(c.topics[0].items[0].type, 'I');
    assert.equal(c.topics[0].title.length, 200);
    assert.deepEqual(plain(c.present), []);
    assert.deepEqual(plain(S.protoClean(null).topics), []);
    assert.equal(S.protoClean({ topics: [{ items: [{ type: 'A', done: 'true' }] }] }).topics[0].items[0].done, true);
  });
  test('open action items carry over: type A and not done', () => {
    const open = S.protoOpenActions(model());
    assert.deepEqual(plain(open.map(i => i.text)), ['Bericht im nächsten JF']);
    assert.equal(open[0].owner, 'b@firma.de');
    assert.deepEqual(plain(S.protoOpenActions({ topics: [] })), []);
  });
});

describe('jour fixe minutes: merging two people saving at the same time', () => {
  const line = (id, text, extra) => Object.assign({ id: id, type: 'I', text: text, owner: '', due: '', done: false, taskId: '' }, extra || {});
  const topic = (id, title, items) => ({ id: id, title: title, owner: '', items: items || [] });
  const base = () => S.protoClean({ date: '2026-11-02', present: ['a@x.de', 'b@x.de'], absent: [], topics: [topic('t1', 'Budget', [line('l1', 'Plan')])] });
  const edit = fn => { const m = JSON.parse(JSON.stringify(base())); fn(m); return S.protoClean(m); };
  const titles = m => plain(m.topics.map(t => t.title));
  test('both add different topics: both are kept, no conflict', () => {
    const mine = edit(m => m.topics.push(topic('t2', 'Personal')));
    const theirs = edit(m => m.topics.push(topic('t3', 'Lotterie')));
    const r = S.protoMerge(base(), mine, theirs);
    assert.deepEqual(plain(r.conflicts), []);
    assert.deepEqual(titles(r.model), ['Budget', 'Lotterie', 'Personal']);
  });
  test('both add lines to the same topic, or change different fields of one line: all kept', () => {
    const mine = edit(m => { m.topics[0].items.push(line('l2', 'Mein Punkt')); m.topics[0].items[0].owner = 'a@x.de'; });
    const theirs = edit(m => { m.topics[0].items.push(line('l3', 'Ihr Punkt')); m.topics[0].items[0].due = '2026-11-06'; });
    const r = S.protoMerge(base(), mine, theirs);
    assert.deepEqual(plain(r.conflicts), []);
    assert.deepEqual(plain(r.model.topics[0].items.map(i => i.text)), ['Plan', 'Ihr Punkt', 'Mein Punkt']);
    assert.equal(r.model.topics[0].items[0].owner, 'a@x.de');
    assert.equal(r.model.topics[0].items[0].due, '2026-11-06');
  });
  test('the same field changed by both is a conflict (mine is kept in the result, the field is named)', () => {
    const mine = edit(m => { m.topics[0].title = 'Budget 2027'; });
    const theirs = edit(m => { m.topics[0].title = 'Budget neu'; });
    const r = S.protoMerge(base(), mine, theirs);
    assert.deepEqual(plain(r.conflicts), ['topics.t1.title']);
    assert.equal(r.model.topics[0].title, 'Budget 2027');
    const same = S.protoMerge(base(), mine, mine);
    assert.deepEqual(plain(same.conflicts), [], 'the same change on both sides is no conflict');
  });
  test('deleting: gone when the other side left it alone, kept when the other side changed it', () => {
    const del = edit(m => { m.topics[0].items = []; });
    assert.deepEqual(plain(S.protoMerge(base(), del, base()).model.topics[0].items), []);
    assert.deepEqual(plain(S.protoMerge(base(), base(), del).model.topics[0].items), []);
    const changed = edit(m => { m.topics[0].items[0].text = 'Plan v2'; });
    assert.equal(S.protoMerge(base(), del, changed).model.topics[0].items[0].text, 'Plan v2');
    assert.equal(S.protoMerge(base(), changed, del).model.topics[0].items[0].text, 'Plan v2');
  });
  test('attendance: additions and removals of both sides are combined; header fields merge like lines', () => {
    const mine = edit(m => { m.present = ['a@x.de']; m.absent = ['b@x.de']; });
    const theirs = edit(m => { m.present.push('c@x.de'); m.minuteTaker = 'c@x.de'; });
    const r = S.protoMerge(base(), mine, theirs);
    assert.deepEqual(plain(r.model.present), ['a@x.de', 'c@x.de']);
    assert.deepEqual(plain(r.model.absent), ['b@x.de']);
    assert.equal(r.model.minuteTaker, 'c@x.de');
    assert.deepEqual(plain(r.conflicts), []);
  });
  test('ids survive cleaning; missing or odd ids get a fixed one from the position (older minutes)', () => {
    assert.equal(S.protoClean({ topics: [{ id: 'ab_12', items: [{ id: 'x' }] }] }).topics[0].id, 'ab_12');
    const c = S.protoClean({ topics: [{ id: '<b>', items: [] }, { items: [{ text: 'a' }, { text: 'b' }] }] });
    assert.deepEqual(plain([c.topics[0].id, c.topics[1].id, c.topics[1].items[1].id]), ['t0', 't1', 'l1_1']);
  });
  test('older minutes without ids: deleting one line while the other side edits another keeps exactly the edit', () => {
    const base = { topics: [{ items: [{ text: 'a' }, { text: 'b' }] }] };
    const mine = { topics: [{ items: [{ id: 'l0_1', text: 'b' }] }] };
    const theirs = { topics: [{ items: [{ text: 'a' }, { text: 'b2' }] }] };
    const r = S.protoMerge(base, mine, theirs);
    assert.deepEqual(plain(r.model.topics[0].items.map(i => i.text)), ['b2']);
    assert.deepEqual(plain(r.conflicts), []);
  });
  test('a person never ends up both present and absent: mine decides', () => {
    const r = S.protoMerge({ present: [], absent: [] }, { present: ['y@x.de'], absent: [] }, { present: [], absent: ['y@x.de'] });
    assert.deepEqual(plain([r.model.present, r.model.absent]), [['y@x.de'], []]);
  });
});

describe('jour fixe minutes: edge cases', () => {
  const merge = (b, m, t) => plain(S.protoMerge({ present: b }, { present: m }, { present: t }).model.present);
  test('people lists: removing the first person, additions on both sides, no doubles', () => {
    assert.deepEqual(merge(['a@x.de', 'b@x.de'], ['b@x.de'], ['a@x.de', 'b@x.de']), ['b@x.de'], 'mine removed the first');
    assert.deepEqual(merge(['a@x.de', 'b@x.de'], ['a@x.de', 'b@x.de'], ['b@x.de']), ['b@x.de'], 'theirs removed the first');
    assert.deepEqual(merge(['a@x.de'], ['a@x.de', 'c@x.de'], ['c@x.de', 'a@x.de']), ['c@x.de', 'a@x.de'], 'added on both sides: once');
  });
  test('cleaning keeps task links, titles and lines; topics are numbered from 1', () => {
    const c = S.protoClean({ topics: [{ title: 'Eins', items: [{ type: 'A', text: 'a', taskId: 't_1' }] }, { title: 'Zwei', items: [] }] });
    assert.equal(c.topics[0].items[0].taskId, 't_1');
    assert.equal(c.topics[0].title, 'Eins');
    assert.equal(c.topics[0].items.length, 1);
    const text = S.protoToText(c);
    assert.match(text, /\| 1\. \| \| \*\*Eins\*\*/);
    assert.match(text, /\| 2\. \| \| \*\*Zwei\*\*/);
  });
  test('a data block at the very start of a text is found as well', () => {
    const full = S.protoToText({ title: 'X', topics: [] });
    const block = full.slice(full.lastIndexOf('<!-- lidlflow:protocol '));
    assert.equal(S.protoFromText(block).title, 'X');
  });
});

describe('jour fixe minutes: what changed', () => {
  test('counts new topics, new, removed and changed lines, and header changes', () => {
    const a = { present: ['a@x.de'], topics: [{ id: 't1', title: 'A', items: [{ id: 'l1', text: 'x' }, { id: 'l2', text: 'y' }] }] };
    const b = { present: ['a@x.de', 'b@x.de'], topics: [{ id: 't1', title: 'A', items: [{ id: 'l1', text: 'x2' }, { id: 'l3', text: 'z' }] }, { id: 't2', title: 'B', items: [] }] };
    assert.deepEqual(plain(S.protoDiff(a, b)), { topics: 1, lines: 1, changed: 1, removed: 1, header: true });
    assert.deepEqual(plain(S.protoDiff(a, a)), { topics: 0, lines: 0, changed: 0, removed: 0, header: false });
    assert.deepEqual(plain(S.protoDiff(b, a)), { topics: -1, lines: 1, changed: 1, removed: 1, header: true });
  });
});

describe('jour fixe minutes: anchored topics and topic tasks', () => {
  test('topics keep their anchor and their task link through cleaning, merging and the text', () => {
    const m = S.protoClean({ topics: [{ id: 't1', title: 'Budget', pinned: true, taskId: 't_9', items: [] }] });
    assert.equal(m.topics[0].pinned, true);
    assert.equal(m.topics[0].taskId, 't_9');
    assert.equal(S.protoFromText(S.protoToText(m)).topics[0].pinned, true);
    assert.equal(S.protoClean({ topics: [{ pinned: 'nein' }] }).topics[0].pinned, false);
    const r = S.protoMerge({ topics: [{ id: 't1', title: 'A' }] }, { topics: [{ id: 't1', title: 'A', pinned: true }] }, { topics: [{ id: 't1', title: 'A' }] });
    assert.equal(r.model.topics[0].pinned, true, 'the anchor merges like a field');
  });
  test('carry-over: anchored topics come again with their open actions; open actions of other topics are collected', () => {
    const c = S.protoCarry({ topics: [
      { id: 'a', title: 'Dauerthema', pinned: true, items: [{ id: 'x', type: 'A', text: 'offen' }, { id: 'y', type: 'A', text: 'fertig', done: true }, { id: 'z', type: 'I', text: 'Info' }] },
      { id: 'b', title: 'Einmal', items: [{ id: 'w', type: 'A', text: 'auch offen' }] },
    ] });
    assert.deepEqual(plain(c.pinned.map(t => [t.title, t.pinned, t.items.map(i => i.text)])), [['Dauerthema', true, ['offen']]]);
    assert.deepEqual(plain(c.open.map(i => i.text)), ['auch offen']);
  });
});
