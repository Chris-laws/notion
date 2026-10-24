/**
 * Runs the real server code against in-memory Apps Script shims.
 * Usage: npm test
 */
const assert = require('assert');
const { load } = require('./load');

const ctx = load({ quiet: true });
const X = ctx.__exports;
const S = X.Shared;
ctx.__GAS_QUIET__ = true;

const ME = 'chris@firma.de';
const as = email => { ctx.__GAS_USER__ = email; };
const call = (method, payload) => {
  const res = JSON.parse(ctx.api(method, JSON.stringify(payload || {})));
  if (!res.ok) throw new Error(method + ': ' + res.error);
  return res.data;
};
const fails = (method, payload) => JSON.parse(ctx.api(method, JSON.stringify(payload || {}))).ok === false;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + (e.stack || e.message));
    process.exitCode = 1;
  }
}

console.log('Shared');
test('date helpers', () => {
  assert.strictEqual(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(S.mondayOf('2026-10-25'), '2026-10-19'); // Sunday
  assert.strictEqual(S.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(S.isoWeek('2026-10-23'), 43);
  assert.strictEqual(S.nextOccurrence('2026-10-23', 'weekdays'), '2026-10-26');
});

test('quick-add parser', () => {
  const pctx = {
    today: '2026-10-23', me: ME,
    users: [{ email: 'anna.schmidt@firma.de', name: 'Anna Schmidt' }, { email: ME, name: 'Chris' }],
    teams: [{ id: 'tm1', name: 'Marketing' }],
    projects: [{ id: 'pr1', name: 'Website' }],
  };
  const parse = (t, c) => JSON.parse(JSON.stringify(S.parse(t, c)));
  const r = parse('Angebot schicken morgen @anna #website !hoch 2h', pctx);
  assert.strictEqual(r.title, 'Angebot schicken');
  assert.strictEqual(r.dueDate, '2026-10-24');
  assert.deepStrictEqual(r.assignees, ['anna.schmidt@firma.de']);
  assert.strictEqual(r.projectId, 'pr1');
  assert.strictEqual(r.priority, 'high');
  assert.strictEqual(r.estimate, 2);

  const r2 = parse('Report +marketing @ich bis 15.11. #q4 30min jeden Montag', pctx);
  assert.deepStrictEqual(r2.teams, ['tm1']);
  assert.deepStrictEqual(r2.assignees, [ME]);
  assert.deepStrictEqual(r2.tags, ['q4']);
  assert.strictEqual(r2.recurrence, 'weekly');
  assert.strictEqual(r2.estimate, 0.5);
  assert.strictEqual(r2.title, 'Report');

  const r3 = parse('Planung ab Montag bis Freitag', pctx);
  assert.strictEqual(r3.startDate, '2026-10-26');
  assert.strictEqual(r3.dueDate, '2026-10-30');
  assert.strictEqual(S.parse('E-Mail an @unbekannt schreiben', pctx).title, 'E-Mail an @unbekannt schreiben');
  assert.strictEqual(S.parse('Morgenrunde planen', pctx).dueDate, '');
});

console.log('Holidays');
test('built-in holidays (offline fallback)', () => {
  const de = X.Holidays.builtin_('DE', 2026);
  const find = n => de.find(h => h.name === n);
  assert.strictEqual(find('Karfreitag').date, '2026-04-03');
  assert.strictEqual(find('Fronleichnam').date, '2026-06-04');
  assert.strictEqual(find('Buß- und Bettag').date, '2026-11-18');
  assert.deepStrictEqual(find('Allerheiligen').counties.indexOf('DE-BY') >= 0, true);
  assert.strictEqual(X.Holidays.builtin_('US', 2026).find(h => h.name === 'Thanksgiving Day').date, '2026-11-26');
  const by = { country: 'DE', region: 'DE-BY' }, be = { country: 'DE', region: 'DE-BE' };
  assert.ok(X.Holidays.appliesTo(find('Allerheiligen'), by));
  assert.ok(!X.Holidays.appliesTo(find('Allerheiligen'), be));
  assert.ok(X.Holidays.appliesTo(find('Neujahr'), be));
});

test('Nager.Date response is used and cached', () => {
  as(ME);
  ctx.setup();
  let calls = 0;
  ctx.__GAS_FETCH__ = url => {
    calls++;
    assert.ok(url.indexOf('/PublicHolidays/2030/FR') > 0);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify([
        { date: '2030-07-14', localName: 'Fête nationale', counties: null, types: ['Public'] },
        { date: '2030-12-24', localName: 'Heiligabend', counties: null, types: ['Observance'] },
      ]),
    };
  };
  X.Db.reset();
  const list = X.Holidays.forCountry('FR', 2030);
  X.Holidays.forCountry('FR', 2030);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].source, 'nager');
  assert.strictEqual(calls, 1);
  ctx.__GAS_FETCH__ = null;
});

console.log('API');
test('setup + demo data + bootstrap', () => {
  as(ME);
  ctx.seedDemoData();
  const b = call('bootstrap');
  assert.strictEqual(b.me.email, ME);
  assert.strictEqual(b.me.admin, true);
  assert.strictEqual(b.teams.length, 2);
  assert.strictEqual(b.projects.length, 3);
  assert.ok(b.tasks.length >= 14);
  assert.strictEqual(b.ai.enabled, false);
});

test('visibility: outsiders only see their own tasks', () => {
  as('extern@firma.de');
  const b = call('bootstrap');
  assert.strictEqual(b.me.admin, false);
  assert.strictEqual(b.tasks.length, 0);
  const created = call('tasks.save', { title: 'Privat', assignees: ['extern@firma.de'] });
  assert.strictEqual(call('tasks.list').length, 1);
  as('lea.huber@firma.de');
  assert.ok(!call('tasks.list').some(t => t.id === created[0].id));
  const product = b.teams.find(t => t.name === 'Produkt');
  const productTasks = call('tasks.list').filter(t => t.teams.indexOf(product.id) >= 0);
  assert.strictEqual(productTasks.length, 0, 'Lea is not in team Produkt');
  assert.ok(fails('tasks.save', { id: created[0].id, title: 'Hack' }));
});

test('assign to several people and teams, edit, delete with subtasks', () => {
  as(ME);
  const b = call('bootstrap');
  const marketing = b.teams.find(t => t.name === 'Marketing');
  const [t] = call('tasks.save', {
    title: '=IMPORTXML("http://evil")', assignees: ['anna.schmidt@firma.de', 'Neu.Person@firma.de'], teams: [marketing.id],
    dueDate: '2026-11-02', estimate: 3, status: 'todo',
  });
  assert.strictEqual(t.title, '=IMPORTXML("http://evil")');
  assert.deepStrictEqual(t.assignees, ['anna.schmidt@firma.de', 'neu.person@firma.de']);
  assert.ok(call('bootstrap').users.some(u => u.email === 'neu.person@firma.de'), 'invited user is created');
  as('lea.huber@firma.de'); // Marketing lead
  assert.ok(call('tasks.list').some(x => x.id === t.id), 'team assignment makes it visible');
  as(ME);
  const [sub] = call('tasks.save', { title: 'Teil', parentId: t.id });
  const [upd] = call('tasks.save', { id: t.id, status: 'done' });
  assert.ok(upd.completedAt);
  assert.strictEqual(upd.title, t.title, 'untouched fields survive');
  const removed = call('tasks.remove', { id: t.id });
  assert.deepStrictEqual(removed.sort(), [t.id, sub.id].sort());
});

test('recurring task spawns next occurrence', () => {
  as(ME);
  const [t] = call('tasks.save', { title: 'Weekly', recurrence: 'weekly', dueDate: '2026-10-26', startDate: '2026-10-25' });
  const changed = call('tasks.save', { id: t.id, status: 'done' });
  assert.strictEqual(changed.length, 2);
  assert.strictEqual(changed[1].dueDate, '2026-11-02');
  assert.strictEqual(changed[1].startDate, '2026-11-01');
  assert.strictEqual(changed[1].status, 'todo');
});

test('day planner: time block is stored in 5-minute steps and cleared with the date', () => {
  as(ME);
  const [t] = call('tasks.save', { title: 'Fokuszeit', estimate: 1.5 });
  assert.strictEqual(t.planDate, '');
  const [p] = call('tasks.save', { id: t.id, planDate: '2026-10-26', planStart: 9 * 60 + 12 });
  assert.strictEqual(p.planDate, '2026-10-26');
  assert.strictEqual(p.planStart, 9 * 60 + 10);
  const [c] = call('tasks.save', { id: t.id, planDate: '' });
  assert.strictEqual(c.planStart, 0);
  assert.strictEqual(call('tasks.list').find(x => x.id === t.id).planDate, '');
});

test('progress is clamped, time tracking stores minutes and a running timer', () => {
  as(ME);
  const [t] = call('tasks.save', { title: 'Zeit messen' });
  assert.strictEqual(t.progress, 0);
  assert.strictEqual(t.spent, 0);
  const [a] = call('tasks.save', { id: t.id, progress: 140, spent: 12.6, timerStart: '2026-10-26T09:00:00Z' });
  assert.strictEqual(a.progress, 100);
  assert.strictEqual(a.spent, 13);
  assert.strictEqual(a.timerStart, '2026-10-26T09:00:00.000Z');
  const [b] = call('tasks.save', { id: t.id, progress: 0, timerStart: 'kaputt' });
  assert.strictEqual(b.progress, 0);
  assert.strictEqual(b.timerStart, '');
});

test('board move updates several tasks', () => {
  as(ME);
  const tasks = call('tasks.list').slice(0, 2);
  const changed = call('tasks.move', { items: tasks.map((t, i) => ({ id: t.id, status: 'review', sort: i })) });
  assert.strictEqual(changed.length, 2);
  assert.ok(changed.every(t => t.status === 'review'));
});

test('comments', () => {
  as(ME);
  const t = call('tasks.list')[0];
  call('comments.add', { taskId: t.id, body: 'Sieht gut aus 👍' });
  assert.strictEqual(call('comments.list', { taskId: t.id }).length, 1);
  as('extern@firma.de');
  assert.ok(fails('comments.list', { taskId: t.id }));
});

test('teams & projects permissions', () => {
  as('extern@firma.de');
  const b = call('bootstrap');
  const product = b.teams.find(t => t.name === 'Produkt');
  assert.ok(fails('teams.save', { id: product.id, name: 'Übernommen' }));
  assert.ok(fails('projects.save', { teamId: product.id, name: 'Nope' }));
  const own = call('teams.save', { name: 'Extern', members: ['anna.schmidt@firma.de'] });
  assert.strictEqual(own.lead, 'extern@firma.de');
  const p = call('projects.save', { teamId: own.id, name: 'Mixed', members: ['sofia.rossi@firma.de'] });
  as('sofia.rossi@firma.de');
  const [t] = call('tasks.save', { title: 'In Mixed', projectId: p.id });
  as('anna.schmidt@firma.de');
  assert.ok(call('tasks.list').some(x => x.id === t.id), 'team member sees project task');
  as('extern@firma.de');
  call('teams.remove', { id: own.id });
  assert.ok(!call('bootstrap').projects.some(x => x.id === p.id));
});

test('capacity respects holidays, absences, part-time', () => {
  as(ME);
  // Week of 2026-12-21: Christmas 25+26 (Fri/Sat) in DE/AT/IT; Thanksgiving not in range.
  const team = call('bootstrap').teams.find(t => t.name === 'Produkt');
  call('absences.save', { email: 'anna.schmidt@firma.de', startDate: '2026-12-21', endDate: '2026-12-22', type: 'vacation' });
  const cap = call('capacity', { teamId: team.id, from: '2026-12-23', weeks: 2 });
  assert.strictEqual(cap.from, '2026-12-21');
  const m = e => cap.members.find(x => x.email === e);
  assert.strictEqual(m(ME).weeks[0].available, 32); // 25.12. off
  assert.strictEqual(m('anna.schmidt@firma.de').weeks[0].available, 16); // + 2 vacation days
  assert.strictEqual(m('anna.schmidt@firma.de').weeks[0].absentDays, 2);
  assert.strictEqual(m('james.carter@firma.de').weeks[0].available, 32); // US: Christmas only
  assert.strictEqual(m(ME).weeks[1].available, 32); // Neujahr
  const lea = call('capacity', { from: '2026-10-26', weeks: 1 }).members.find(x => x.email === 'lea.huber@firma.de');
  assert.strictEqual(lea.weeks[0].available, 22.5); // AT 30h/4 days, 26.10. Nationalfeiertag
});

test('capacity counts task load over working days', () => {
  as(ME);
  const start = S.addDays(S.mondayOf(X.Shared.fmt(new Date())), 14);
  call('tasks.save', { title: 'Load', assignees: ['james.carter@firma.de', ME], startDate: start, dueDate: S.addDays(start, 4), estimate: 20 });
  const cap = call('capacity', { from: start, weeks: 1 });
  const james = cap.members.find(x => x.email === 'james.carter@firma.de');
  assert.ok(james.weeks[0].planned >= 10, 'half of the 20h estimate');
});

test('calendar range, events, absences privacy', () => {
  as(ME);
  const ev = call('events.save', { title: 'Release', startDate: '2026-12-01', type: 'milestone' });
  call('absences.save', { startDate: '2026-12-02', note: 'Arzt' });
  as('anna.schmidt@firma.de');
  const r = call('calendar.range', { from: '2026-11-30', to: '2026-12-31' });
  assert.ok(r.events.some(e => e.id === ev.id));
  const mine = r.absences.find(a => a.email === ME && a.startDate === '2026-12-02');
  assert.strictEqual(mine.note, '', 'notes of others are hidden');
  const xmas = r.holidays.find(h => h.date === '2026-12-25' && h.country === 'DE');
  assert.ok(xmas.affects.indexOf('anna.schmidt@firma.de') >= 0);
  assert.ok(fails('events.remove', { id: ev.id }));
});

test('company holidays (admin only)', () => {
  as('anna.schmidt@firma.de');
  assert.ok(fails('companyHolidays.save', { date: '2026-12-24', name: 'Heiligabend' }));
  as(ME);
  call('companyHolidays.save', { date: '2026-12-24', name: 'Heiligabend (Firma)' });
  const cap = call('capacity', { from: '2026-12-21', weeks: 1 });
  assert.strictEqual(cap.members.find(x => x.email === ME).weeks[0].available, 24);
});

test('AI placeholder: rules mode works without key', () => {
  as(ME);
  const st = call('ai.status');
  assert.strictEqual(st.enabled, false);
  const parsed = call('ai.parse', { text: 'Budget prüfen morgen @anna 2h' });
  assert.strictEqual(parsed.source, 'rules');
  assert.strictEqual(parsed.assignees[0], 'anna.schmidt@firma.de');
  const b = call('ai.breakdown', { id: call('tasks.list')[0].id });
  assert.strictEqual(b.configured, false);
  assert.strictEqual(b.dummy, true);
  assert.ok(b.subtasks.length >= 3 && b.subtasks.every(x => x.title && x.estimate > 0), 'dummy split is usable');
  const sug = call('ai.suggestAssignee', { id: call('tasks.list').find(t => t.projectId).id });
  assert.ok(sug.candidates.length > 0);
  const brief = call('ai.briefing');
  assert.ok(brief.text.length > 10);
});

test('AI assistant: dummy without key, validated items with key', () => {
  as(ME);
  const d = call('ai.assist', { text: 'Angebot prüfen morgen @anna 2h. Ich bin übermorgen im Urlaub' });
  assert.strictEqual(d.source, 'rules');
  assert.strictEqual(d.items.length, 2);
  assert.strictEqual(d.items[0].type, 'task');
  assert.strictEqual(d.items[0].assignees[0], 'anna.schmidt@firma.de');
  assert.strictEqual(d.items[0].estimate, 2);
  assert.strictEqual(d.items[1].type, 'absence');
  assert.strictEqual(d.items[1].email, ME);
  assert.ok(fails('ai.assist', { text: '  ' }), 'empty text is rejected');

  ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'test-key');
  ctx.__GAS_FETCH__ = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [
      { type: 'task', title: 'Angebot prüfen', assignees: ['anna.schmidt@firma.de', 'fremd@evil.com'], estimate: 2 },
      { type: 'event', title: 'Review', startDate: '2026-11-02', eventType: 'meeting' },
      { type: 'absence', startDate: 'kaputt' },
    ] }) }] } }] }),
  });
  const a = call('ai.assist', { text: 'egal' });
  assert.strictEqual(a.source, 'ai');
  assert.strictEqual(a.items.length, 2, 'invalid absence is dropped');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.items[0].assignees)), ['anna.schmidt@firma.de'], 'unknown people are dropped');
  assert.strictEqual(a.items[1].endDate, '2026-11-02');
  ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'PLATZHALTER_VERTEX_AI_API_KEY');
  ctx.__GAS_FETCH__ = null;
});

test('AI uses Vertex when a key is configured', () => {
  as(ME);
  ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'test-key');
  let seen = null;
  ctx.__GAS_FETCH__ = (url, opts) => {
    seen = { url, opts };
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"subtasks":[{"title":"Schritt 1","estimate":2}]}' }] } }] }),
    };
  };
  const res = call('ai.breakdown', { id: call('tasks.list')[0].id });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.subtasks)), [{ title: 'Schritt 1', estimate: 2 }]);
  assert.ok(seen.url.indexOf('aiplatform.googleapis.com') > 0);
  assert.strictEqual(seen.opts.headers['x-goog-api-key'], 'test-key');
  assert.ok(seen.url.indexOf('test-key') < 0, 'key is not put into the URL');
  ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'PLATZHALTER_VERTEX_AI_API_KEY');
  ctx.__GAS_FETCH__ = null;
});

test('errors are returned, not thrown', () => {
  as('');
  assert.ok(fails('bootstrap'));
  as(ME);
  assert.ok(fails('nope'));
  assert.ok(fails('tasks.save', { title: 'x', status: 'invalid' }));
});


test('team availability warns at 50 % absence (holidays + vacation)', () => {
  as(ME);
  const marketing = call('bootstrap').teams.find(t => t.name === 'Marketing'); // Chris (DE), Sofia (IT), Lea (AT)
  const a = call('availability', { teamId: marketing.id, from: '2026-12-07', weeks: 1 });
  assert.strictEqual(a.threshold, 50);
  const dec8 = a.team.find(d => d.date === '2026-12-08'); // IT + AT holiday
  assert.strictEqual(dec8.absent, 2);
  assert.strictEqual(dec8.total, 3);
  assert.strictEqual(dec8.warn, true);
  assert.strictEqual(a.team.find(d => d.date === '2026-12-09').warn, false);
  assert.strictEqual(a.members.find(m => m.email === 'lea.huber@firma.de').cells['2026-12-11'].works, false, 'Lea works Mon-Thu');
  as('lea.huber@firma.de');
  const first = call('absences.save', { startDate: '2026-12-10', endDate: '2026-12-10', type: 'training' });
  assert.strictEqual(first.warnings.length, 0, '1 of 3 is below 50 %');
  as(ME);
  const res = call('absences.save', { startDate: '2026-12-10', endDate: '2026-12-10', type: 'vacation' });
  assert.ok(res.absence.id);
  assert.ok(res.warnings.some(w => w.teamId === marketing.id && w.date === '2026-12-10' && w.absent === 2));
  const range = call('calendar.range', { from: '2026-12-01', to: '2026-12-31' });
  assert.ok(range.warnings.some(w => w.date === '2026-12-08' && w.teamId === marketing.id));
});

console.log('\n' + passed + ' Tests ' + (process.exitCode ? 'mit Fehlern' : 'bestanden'));
