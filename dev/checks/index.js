/**
 * The codeguard's list of checks. A new check = one entry here:
 *   id       short name for `npm run guard -- --only <id>`
 *   name     what is checked
 *   purpose  why (one line)
 *   limit    the threshold that makes it fail
 *   stage    the workflow stage it belongs to (see WORKFLOW.md)
 *   cmd      command; exit code 0 = passed
 */
module.exports = [
  { id: 'lint', stage: 'Implementierung', name: 'Lint + Clean-Code-Regeln', cmd: 'npx eslint . --max-warnings 78',
    purpose: 'Bugs, unsicherer Code, Funktionslänge, Komplexität, Duplikate, ungenutzter Code',
    limit: '0 Fehler; ≤ 78 Warnungen (Ratsche)' },
  { id: 'tests', stage: 'TDD', name: 'Unit-, Mock- und Integrationstests + Coverage',
    cmd: 'npx c8 --check-coverage --lines 90 --functions 90 --branches 75 --reporter=text-summary node --test test/ dev/test.js',
    purpose: 'Domänenlogik, Rechte, Cache, externe Dienste (Test-Doubles), API-Abläufe',
    limit: 'alle grün; Coverage Zeilen ≥ 90 %, Funktionen ≥ 90 %, Zweige ≥ 75 %' },
  { id: 'mutation', stage: 'TDD', name: 'Mutationstest (Shared.js)', cmd: 'node dev/checks/mutation.js --min 85',
    purpose: 'Prüft die Tests selbst: veränderte Operatoren müssen auffallen',
    limit: 'Mutation-Score ≥ 85 %' },
  { id: 'gas', stage: 'Verifikation', name: 'Apps-Script-Bereitschaft', cmd: 'node dev/check-gas.js',
    purpose: 'Syntax, Routen und Dateien so, wie clasp sie nach Apps Script schiebt',
    limit: 'keine Fehler' },
  { id: 'security', stage: 'Verifikation', name: 'Rechte pro API-Methode', cmd: 'node --test test/security.test.js',
    purpose: 'Jede Route weist fremde Domains ab; Außenstehende ändern keine fremden Daten',
    limit: 'jede Route abgedeckt, 0 offene Routen' },
  { id: 'xss', stage: 'Verifikation', name: 'XSS / Escaping', cmd: 'node dev/checks/xss.js',
    purpose: 'Angriffsmuster in allen Datenarten werden in keiner Ansicht zu Markup',
    limit: '0 eingeschleuste Elemente oder Attribute' },
  { id: 'secrets', stage: 'Verifikation', name: 'Secret-Scan', cmd: 'node dev/secret-scan.js',
    purpose: 'Keine Schlüssel, Tokens oder privaten Keys im Repository',
    limit: '0 Funde' },
  { id: 'i18n', stage: 'Verifikation', name: 'Englisch vollständig', cmd: 'node dev/i18n-audit.js',
    purpose: 'Jede Seite, jeder Dialog, jede Fehlermeldung im englischen Modus',
    limit: '0 deutsche Reste' },
  { id: 'contrast', stage: 'Verifikation', name: 'Kontrast der Farb-Tokens', cmd: 'node dev/checks/contrast.js',
    purpose: 'Semantische Farben in Hell und Dunkel lesbar (WCAG 2.2)',
    limit: 'Text ≥ 4,5:1, Sekundärtext/Symbole ≥ 3:1' },
  { id: 'a11y', stage: 'Verifikation', name: 'Barrierefreiheit + Skeletons', cmd: 'node dev/checks/a11y.js',
    purpose: 'Alt-Texte, Namen, Beschriftungen, Dialoge, Tastatur, reduzierte Bewegung, Skeleton je Seite',
    limit: '0 Verstöße' },
  { id: 'consistency', stage: 'Verifikation', name: 'Daten-Konsistenz', cmd: 'node dev/load-sim.js --consistency',
    purpose: '1500 Schreibvorgänge auf echtem Code, Zeilen zwischendurch von Hand vertauscht',
    limit: '0 verlorene Updates, 0 doppelte IDs' },
  { id: 'load', stage: 'Verifikation', name: 'Lasttest (Kurzprofil)', cmd: 'node dev/load-sim.js --quick',
    purpose: 'Echte Grenzen von Apps Script: 30 parallele Ausführungen, globales Lock',
    limit: '200 gleichzeitig Aktive: ≤ 1 % abgelehnt, p95 ≤ 3 s' },
  { id: 'budget', stage: 'Verifikation', name: 'Performance-Budget', cmd: 'node dev/checks/budget.js',
    purpose: 'Seitengröße, Start-Antwort, Dauer je Request bei 1000 Personen',
    limit: 'Seite ≤ 520 KB (gzip ≤ 150), Request-Dauern je Budget' },
  { id: 'license', stage: 'Branch-Abschluss', name: 'Lizenzen und Marken', cmd: 'node dev/checks/license.js',
    purpose: 'Freie Lizenzen, nur erlaubte Hosts, keine fremden Produktnamen, Doku vollständig',
    limit: '0 Funde' },
];
