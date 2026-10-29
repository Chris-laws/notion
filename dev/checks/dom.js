/**
 * Shared harness for the DOM checks (i18n, accessibility, XSS): starts the real app from
 * dev/preview.html in jsdom and walks a fixed tour of every page, layout, tab and dialog.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const wait = ms => new Promise(r => setTimeout(r, ms));

/** The app in jsdom. opts: { lang: 'de'|'en', user, beforeStart(window) } */
async function bootApp(opts) {
  opts = opts || {};
  require('../build-preview');
  const html = fs.readFileSync(path.join(__dirname, '..', 'preview.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/?user=' + encodeURIComponent(opts.user || 'demo.user@firma.de'),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('tr:lang', JSON.stringify(opts.lang || 'de'));
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.Element.prototype.scrollTo = function () {};
      w.ResizeObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.console.error = () => {};
      w.console.log = () => {};
      w.alert = () => { w.__alerts = (w.__alerts || 0) + 1; };
      if (opts.beforeStart) opts.beforeStart(w);
    },
  });
  const w = dom.window;
  for (let i = 0; i < 100 && !w.eval("typeof S !== 'undefined' && S.me && S.tasks && S.tasks.length"); i++) await wait(50);
  if (!w.eval('S.me')) throw new Error('App did not start');
  return w;
}

/** Every page, layout, tab and dialog: [name, code to run, ms to wait]. */
function tour(w) {
  const S = w.eval('S');
  const proj = S.projects[0], tm = S.teams[0];
  const task = S.tasks.find(t => t.assignees.length && t.projectId) || S.tasks[0];
  const steps = [['dashboard', "go('dash')", 600]];
  ['open', 'today', 'upcoming', 'overdue', 'nodate', 'done'].forEach(q => steps.push(['my tasks/' + q, "go('home'); setPrefs({ quick: '" + q + "' })"]));
  ['list', 'table', 'board', 'gantt', 'calendar'].forEach(l => steps.push(['all tasks/' + l, "go('tasks'); setPrefs({ layout: '" + l + "' })", 400]));
  ['due', 'status', 'priority', 'project'].forEach(g => steps.push(['list group ' + g, "go('tasks'); setPrefs({ layout: 'list', listGroup: '" + g + "' })"]));
  ['week', 'day', 'month', 'agenda', 'heatmap'].forEach(m => steps.push(['calendar/' + m, "S.cal.mode = '" + m + "'; go('calendar')", 500]));
  steps.push(['availability', "S.cap.teamId = '" + tm.id + "'; S.cap.data = null; go('capacity')", 600]);
  ['tasks', 'projects', 'members'].forEach(tab => steps.push(['team/' + tab, "S.teamTab = '" + tab + "'; go('team', '" + tm.id + "')"]));
  ['overview', 'tasks', 'members'].forEach(tab => steps.push(['project/' + tab, "S.projTab = '" + tab + "'; go('project', '" + proj.id + "')"]));
  steps.push(
    ['settings', "go('settings')", 400],
    ['admin', "go('admin')", 400],
    ['not found', "go('nope')"],
    ['task peek', "go('home'); openPeek('" + task.id + "')", 500],
    ['new task dialog', "closePeek(); A['new-task']()"],
    ['people manager', "document.querySelector('#modal-root [data-nt-add]').click()"],
    ['people search', "const i = document.querySelector('#people-root input'); i.value = 'zz@neu.de'; i.dispatchEvent(new Event('input'))"],
    ['team dialog', 'closePeopleModal(); closeModal(); teamModal(S.teams[0])'],
    ['project dialog', 'closeModal(); projectModal(S.projects[0])'],
    ['event dialog', 'closeModal(); eventModal()'],
    ['absence dialog', 'closeModal(); absenceModal()'],
    ['help', 'closeModal(); A.help()'],
    ['palette', 'closeModal(); openPalette()'],
    ['assistant', "closePalette(); A['ai-assistant'] ? A['ai-assistant']() : 0", 400],
    ['toast', "closeModal(); toast('Aufgabe gelöscht', { action: { label: 'Rückgängig', fn() {} } })"],
    ['ai suggest', "closePeek(); openPeek('" + task.id + "'); A['ai-suggest'] && A['ai-suggest']()", 500],
    ['ai breakdown', "A['ai-breakdown'] && A['ai-breakdown']()", 500],
    // jour fixe: the tab with a series, the minutes form, the task form, the series form, the team tab
    ['jour fixe tab', "closePeek(); call('jf.saveSeries', { projectId: '" + proj.id + "', title: 'Tour-JF', rhythm: 'weekly', weekday: 1, time: '09:00', duration: 30, startDate: TODAY(), attendees: [S.me.email], meetLink: 'https://meet.google.com/abc-defg-hij' })" +
      ".then(() => call('jf.list', {})).then(j => { S.jf = j; S.doc = null; S.projTab = 'jf'; go('project', '" + proj.id + "'); })", 600],
    ['jour fixe minutes form', "jfOpen(jfData().series[0].id, Shared.jfDates(jfData().series[0], TODAY(), Shared.addDays(TODAY(), 30))[0])", 400],
    ['jour fixe task form', "A['proto-add-topic'](); jfTasks(() => jfTaskMask(true, S.protoEdit.model.topics.length - 1))", 500],
    ['jour fixe series form', "closeModal(); jfModal(jfData().series[0], '" + proj.id + "', '" + proj.teamId + "')", 300],
    ['team/jour fixe', "closeModal(); A['proto-discard'](); S.teamTab = 'jf'; go('team', '" + proj.teamId + "')", 300],
    // the assistant (loaded on first use): panel, an answer, proposals in the confirmation form
    ['assistant', 'A.asst()', 700],
    ['assistant answer', 'asstAsk(ASST_QUICK()[0])', 500],
    ['assistant proposals', "asstClose(); assistWith([{ type: 'task', title: 'Vorschlag' }])", 300],
    ['empty list', "closeModal(); closePeek(); go('home'); setPrefs({ quick: 'done', search: 'zzzz-nichts' })"],
    ['dashboard again', "setPrefs({ search: '', quick: 'open' }); S.report.data = {}; go('dash')", 700],
  );
  return steps;
}

/** Runs the tour; after each step inspect(window, stepName). Script errors are reported as findings. */
async function walk(w, inspect, onError) {
  for (const [name, js, ms] of tour(w)) {
    try { w.eval(js); } catch (e) { onError(name, e); }
    await wait(ms || 250);
    inspect(w, name);
  }
}

module.exports = { bootApp, tour, walk, wait };
