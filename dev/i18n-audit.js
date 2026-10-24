/**
 * Renders the real app (dev/preview.html) in English inside jsdom, walks every page,
 * tab, layout and dialog and reports German text that was left untranslated:
 * text nodes plus title / placeholder / aria-label. User content (task titles,
 * names, project and team names …) is ignored.
 * Usage: npm run i18n   (exit code 1 when something German is left)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

require('./build-preview');
const html = fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8');

// German markers: umlauts/ß or frequent German words that never appear in the English UI
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|der|die|das|den|dem|des|nicht|kein|keine|keinen|noch|mit|für|von|bis|zu|zum|zur|ist|sind|wird|werden|ein|eine|einen|auf|aus|bei|nach|über|unter|alle|allen|heute|morgen|gestern|Woche|Wochen|Monat|Tag|Tage|Tagen|Aufgabe|Aufgaben|Projekt|Projekte|offen|offene|erledigt|fällig|Fällig|neue|neues|Neue|Neues|Termin|Termine|Urlaub|Krank|Feiertag|Feiertage|Abwesenheit|Abwesend|abwesend|Stunden|Std|Mitglied|Mitglieder|Einstellungen|Speichern|Abbrechen|Löschen|Bearbeiten|Hinzufügen|Suchen|Zurück|Weiter|Ansicht|Gruppe|Priorität|Zuständig|Fortschritt|Aufwand|Beschreibung|Kommentar|Kommentare|Hallo|Guten|Abend|Morgen|Uhr|Mo|Di|Mi|Fr|Sa|Mär|Mai|Okt|Dez)\b/;
// I18N_STRICT=1: also typical German endings and small words (more noise, for a manual review)
const STRICT = /\b[A-Za-zäöü]+(ung|ungen|keit|heit|lich|isch|chen|schaft)\b|\b(ich|du|wir|wenn|dann|auch|nur|schon|hier|jetzt|mehr|weniger|wer|was|wie|wo|ohne|gegen|seit|beim|vom|im|am|um)\b/;
const isGerman = s => GERMAN.test(s) || (!!process.env.I18N_STRICT && STRICT.test(s));
// accepted in English (names, brand, language codes, abbreviations that read the same)
const ALLOW = /^(LidlFlow|DE|EN|Gemini|Vertex AI|OK)$/;
// proper names that stay as they are (German federal states, Austrian/Swiss regions)
const PLACES = /Baden-Württemberg|Bayern|Berlin|Brandenburg|Bremen|Hamburg|Hessen|Mecklenburg-Vorpommern|Niedersachsen|Nordrhein-Westfalen|Rheinland-Pfalz|Saarland|Sachsen-Anhalt|Sachsen|Schleswig-Holstein|Thüringen|Kärnten|Niederösterreich|Oberösterreich|Salzburg|Steiermark|Tirol|Vorarlberg|Wien|Burgenland|Zürich|Graubünden|Genève|Neuchâtel|Bern|Luzern|Basel|Österreich|Deutschland|Schweiz/g;

function boot() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/?user=chris@firma.de',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('tr:lang', JSON.stringify('en'));
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.Element.prototype.scrollTo = function () {};
      w.ResizeObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.console.error = () => {};
      w.console.log = () => {};
    },
  });
  return dom.window;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Strings that are data, not UI: never reported. */
function dataStrings(w) {
  const S = w.eval('S');
  const out = [];
  const add = v => { if (v && String(v).trim().length > 1) out.push(String(v).trim()); };
  (S.tasks || []).forEach(t => { add(t.title); add(t.description); (t.tags || []).forEach(add); });
  (S.projects || []).forEach(p => { add(p.name); add(p.description); });
  (S.teams || []).forEach(t => { add(t.name); add(t.description); });
  (S.users || []).forEach(u => { add(u.name); add(u.email); add(u.region); });
  Object.keys(S.cal && S.cal.cache || {}).forEach(k => {
    const d = S.cal.cache[k];
    if (d && typeof d === 'object') (d.events || []).forEach(e => { add(e.title); add(e.note); });
    if (d && typeof d === 'object') (d.absences || []).forEach(a => add(a.note));
  });
  return out.sort((a, b) => b.length - a.length);
}

function scan(w, where, found) {
  const data = dataStrings(w);
  const check = (s, kind) => {
    let t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    data.forEach(d => { if (t.indexOf(d) >= 0) t = t.split(d).join(' '); });
    t = t.replace(/[\w.+-]+@[\w.-]+\.\w+/g, ' ').replace(PLACES, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (!t || ALLOW.test(t) || !isGerman(t)) return;
    const key = kind + ': ' + t;
    if (!found[key]) found[key] = where;
  };
  const walk = n => {
    if (n.nodeType === 3) { check(n.nodeValue, 'text'); return; }
    if (n.nodeType !== 1) return;
    if (/^(SCRIPT|STYLE|TEXTAREA|svg)$/i.test(n.nodeName) || n.getAttribute('translate') === 'no' || n.hidden) return;
    ['title', 'placeholder', 'aria-label'].forEach(a => { if (n.hasAttribute(a)) check(n.getAttribute(a), a); });
    if (n.nodeName === 'INPUT') return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(w.document.body);
}

async function main() {
  const w = boot();
  for (let i = 0; i < 100 && !w.eval("typeof S !== 'undefined' && S.me && S.tasks && S.tasks.length"); i++) await wait(50);
  if (!w.eval('S.me')) throw new Error('App did not start');
  const found = {};
  const run = async (where, js, ms) => {
    try { w.eval(js); } catch (e) { found['error: ' + where + ' – ' + e.message] = where; }
    await wait(ms || 250);
    scan(w, where, found);
  };
  const S = w.eval('S');
  const proj = S.projects[0], tm = S.teams[0], task = S.tasks.find(t => t.assignees.length && t.projectId) || S.tasks[0];
  await run('dashboard', "go('dash')", 600);
  for (const q of ['open', 'today', 'upcoming', 'overdue', 'nodate', 'done']) await run('my tasks/' + q, "go('home'); setPrefs({ quick: '" + q + "' })");
  for (const l of ['list', 'table', 'board', 'gantt', 'calendar']) await run('all tasks/' + l, "go('tasks'); setPrefs({ layout: '" + l + "' })", 400);
  for (const g of ['due', 'status', 'priority', 'project']) await run('list group ' + g, "go('tasks'); setPrefs({ layout: 'list', listGroup: '" + g + "' })");
  for (const m of ['week', 'day', 'month', 'agenda', 'heatmap']) await run('calendar/' + m, "S.cal.mode = '" + m + "'; go('calendar')", 500);
  await run('availability', "S.cap.teamId = '" + tm.id + "'; S.cap.data = null; go('capacity')", 600);
  for (const tab of ['tasks', 'projects', 'members']) await run('team/' + tab, "S.teamTab = '" + tab + "'; go('team', '" + tm.id + "')");
  for (const tab of ['overview', 'tasks', 'members']) await run('project/' + tab, "S.projTab = '" + tab + "'; go('project', '" + proj.id + "')");
  await run('settings', "go('settings')", 400);
  await run('admin', "go('admin')", 400);
  await run('not found', "go('nope')");
  await run('task peek', "go('home'); openPeek('" + task.id + "')", 500);
  await run('new task dialog', "closePeek(); A['new-task']()");
  await run('people manager', "A['pp-add'] || 0; document.querySelector('#modal-root [data-nt-add]').click()");
  await run('people search', "const i = document.querySelector('#people-root input'); i.value = 'zz@neu.de'; i.dispatchEvent(new Event('input'))");
  await run('team dialog', "closePeopleModal(); closeModal(); teamModal(S.teams[0])");
  await run('project dialog', "closeModal(); projectModal(S.projects[0])");
  await run('event dialog', "closeModal(); eventModal()");
  await run('absence dialog', "closeModal(); absenceModal()");
  await run('help', "closeModal(); A.help()");
  await run('palette', "closeModal(); openPalette()");
  await run('assistant', "closePalette(); A['ai-assistant'] ? A['ai-assistant']() : 0", 400);
  await run('toast', "closeModal(); toast('Aufgabe gelöscht', { action: { label: 'Rückgängig', fn() {} } })");

  await run('ai suggest', "closePeek(); openPeek('" + task.id + "'); A['ai-suggest'] && A['ai-suggest']()", 500);
  await run('ai breakdown', "A['ai-breakdown'] && A['ai-breakdown']()", 500);
  await run('empty list', "closePeek(); go('home'); setPrefs({ quick: 'done', search: 'zzzz-nichts' })");
  await run('dashboard again', "setPrefs({ search: '', quick: 'open' }); S.report.data = {}; go('dash')", 700);
  await run('dashboard (new layout)', "store.set('dashLayout', 'new'); go('home'); go('dash')", 700);
  await run('dashboard back to classic', "store.set('dashLayout', 'classic'); go('home'); go('dash')", 500);

  // messages the server can send back (shown as toasts): each needs an English version
  const src = path.join(__dirname, '..', 'src');
  fs.readdirSync(src).filter(f => f.endsWith('.js')).forEach(f => {
    const code = fs.readFileSync(path.join(src, f), 'utf8');
    const re = /new Error\('((?:[^'\\]|\\.)+)'\)/g;
    let m;
    while ((m = re.exec(code))) {
      const msg = m[1].replace(/\\'/g, "'");
      const out = w.eval('trText(' + JSON.stringify(msg) + ')');
      if (isGerman(out)) found['server: ' + out] = f;
    }
  });

  const keys = Object.keys(found);
  keys.forEach(k => console.log('  ' + found[k].padEnd(22) + ' ' + k));
  console.log(keys.length ? '\n' + keys.length + ' deutsche Reste im englischen Modus' : 'Englisch vollständig: keine deutschen Reste gefunden');
  w.close();
  process.exit(keys.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
