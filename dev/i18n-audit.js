/**
 * Renders the real app (dev/preview.html) in English inside jsdom, walks every page,
 * tab, layout and dialog and reports German text that was left untranslated:
 * text nodes plus title / placeholder / aria-label. User content (task titles,
 * names, project and team names …) is ignored.
 * Usage: npm run i18n   (exit code 1 when something German is left)
 */
const fs = require('fs');
const path = require('path');

const { bootApp, walk } = require('./checks/dom');

// German markers: umlauts/ß or frequent German words that never appear in the English UI
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|der|die|das|den|dem|des|nicht|kein|keine|keinen|noch|mit|für|von|bis|zu|zum|zur|ist|sind|wird|werden|ein|eine|einen|auf|aus|bei|nach|über|unter|alle|allen|heute|morgen|gestern|Woche|Wochen|Monat|Tag|Tage|Tagen|Aufgabe|Aufgaben|Projekt|Projekte|offen|offene|erledigt|fällig|Fällig|neue|neues|Neue|Neues|Termin|Termine|Urlaub|Krank|Feiertag|Feiertage|Abwesenheit|Abwesend|abwesend|Stunden|Std|Mitglied|Mitglieder|Einstellungen|Speichern|Abbrechen|Löschen|Bearbeiten|Hinzufügen|Suchen|Zurück|Weiter|Ansicht|Gruppe|Priorität|Zuständig|Fortschritt|Aufwand|Beschreibung|Kommentar|Kommentare|Hallo|Guten|Abend|Morgen|Uhr|Mo|Di|Mi|Fr|Sa|Mär|Mai|Okt|Dez)\b/;
// I18N_STRICT=1: also typical German endings and small words (more noise, for a manual review)
const STRICT = /\b[A-Za-zäöü]+(ung|ungen|keit|heit|lich|isch|chen|schaft)\b|\b(ich|du|wir|wenn|dann|auch|nur|schon|hier|jetzt|mehr|weniger|wer|was|wie|wo|ohne|gegen|seit|beim|vom|im|am|um)\b/;
const isGerman = s => GERMAN.test(s) || (!!process.env.I18N_STRICT && STRICT.test(s));
// accepted in English (names, brand, language codes, abbreviations that read the same)
const ALLOW = /^(LidlFlow|DE|EN|Gemini|Vertex AI|OK)$/;
// proper names that stay as they are (German federal states, Austrian/Swiss regions)
const PLACES = /Baden-Württemberg|Bayern|Berlin|Brandenburg|Bremen|Hamburg|Hessen|Mecklenburg-Vorpommern|Niedersachsen|Nordrhein-Westfalen|Rheinland-Pfalz|Saarland|Sachsen-Anhalt|Sachsen|Schleswig-Holstein|Thüringen|Kärnten|Niederösterreich|Oberösterreich|Salzburg|Steiermark|Tirol|Vorarlberg|Wien|Burgenland|Zürich|Graubünden|Genève|Neuchâtel|Bern|Luzern|Basel|Österreich|Deutschland|Schweiz/g;

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
  const w = await bootApp({ lang: 'en' });
  const found = {};
  await walk(w, (win, where) => scan(win, where, found), (where, e) => { found['error: ' + where + ' – ' + e.message] = where; });

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
