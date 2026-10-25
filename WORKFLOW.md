# Entwicklungs-Workflow

Jede Änderung an LidlFlow läuft durch dieselbe Pipeline. Jede Stufe hat einen **superpowers-Skill**, der vorgibt, *wie* gearbeitet wird, und **Codeguard-Checks**, die automatisch prüfen, *ob* das Ergebnis stimmt. Eine Stufe ist erst fertig, wenn ihre Checks grün sind. `npm run guard` führt alle Checks aus und endet bei jedem Verstoß mit Exit-Code 1. `npm run guard -- --list` zeigt sie mit Zweck und Schwelle. Dieselbe Prüfung läuft als GitHub Action bei jedem Push und Pull Request.

Alle genannten Skills stammen aus dem Plugin **superpowers** und standen in der Entwicklungssitzung zur Verfügung.

Der ganze Ablauf ist zusätzlich als Claude-Code-Skill **`codeguard-engineering`** gespeichert (`.claude/skills/codeguard-engineering/SKILL.md`). Claude lädt ihn bei jeder Änderung und führt durch die Stufen, die passenden superpowers-Skills und den Guard.

```
Anforderung ─▶ Plan ─▶ TDD ─▶ Implementierung ─▶ Verifikation ─▶ Code-Review ─▶ Branch-Abschluss/Deploy
                        ▲                              │
                        └──── Debugging bei Fehlern ◀──┘
```

| # | Stufe | superpowers-Skill | Codeguard-Checks (`--only …`) | Fertig, wenn |
|---|---|---|---|---|
| 1 | Anforderung klären | `brainstorming` | – | Ziel, Grenzen und Erfolgskriterium stehen in einem Satz fest; offene Fragen sind beantwortet. |
| 2 | Plan | `writing-plans` (bei Bedarf `using-git-worktrees`) | – | Plan unter `docs/superpowers/plans/` mit Dateien, Schnittstellen, Tests je Aufgabe und „Review Focus“. |
| 3 | TDD | `test-driven-development` | `tests`, `mutation` | Für jedes neue Verhalten gab es zuerst einen **roten** Test. Danach ist alles grün, Coverage und Mutation-Score halten ihre Schwellen. |
| 4 | Implementierung | `executing-plans` oder `subagent-driven-development` (parallel: `dispatching-parallel-agents`) | `lint` | Kleinste Lösung für den Test, keine neuen Lint-Fehler, Warnungen nicht über der Ratsche. |
| 5 | Verifikation | `verification-before-completion` | `gas`, `security`, `xss`, `secrets`, `i18n`, `contrast`, `a11y`, `consistency`, `load`, `budget` | `npm run guard` ganz grün. Erst dann gilt etwas als „fertig“. Belege (Ausgabe) stehen im Bericht. |
| 6 | Code-Review | `requesting-code-review`, Antworten mit `receiving-code-review` | alle | Befunde geprüft (nicht blind übernommen). Jeder echte Befund bekommt einen Test, dann zurück zu Stufe 3. |
| 7 | Debugging bei Fehlern | `systematic-debugging` | der fehlgeschlagene Check, dann `tests` | Ursache gefunden und belegt, ein Test reproduziert den Fehler und ist nach dem Fix grün. |
| 8 | Branch-Abschluss / Deploy | `finishing-a-development-branch` | `license` + kompletter Guard | Guard grün, Commit mit Begründung, Push. **Deploy nur, wenn sich Laufzeitcode (`src/`) geändert hat**: `clasp push` + `clasp update-deployment`. |

## Die Checks

| id | Was | Schwelle |
|---|---|---|
| `lint` | ESLint + Sonar-Regeln: Bugs, unsicherer Code, Funktionslänge, Komplexität, Duplikate, ungenutzter Code | 0 Fehler, Warnungen ≤ Ratsche (heute 78) |
| `tests` | Unit-Tests (`test/`), Mock-Tests externer Dienste (Nager.Date, Vertex/Gemini: Fehler, Timeout, kaputtes JSON), Integrationssuite (`dev/test.js`), Coverage über `src/` | alle grün, Zeilen/Funktionen ≥ 90 %, Zweige ≥ 75 % |
| `mutation` | Mutationstest der Domänenlogik (`Shared.js`): veränderte Operatoren müssen von den Tests erkannt werden | Score ≥ 85 % |
| `gas` | Apps-Script-Bereitschaft: Syntax, Routen, Dateien wie nach `clasp push` | 0 Fehler |
| `security` | Rechte pro API-Methode: jede Route aus `ROUTES` hat eine Regel. Fremde Domain wird abgewiesen, Außenstehende ändern keine fremden Daten, private Felder bleiben privat | 0 offene Routen |
| `xss` | 5 Angriffsmuster in 7 Datenarten (Aufgabe, Projekt, Team, Kommentar, Termin, Tag, Name), Rundgang durch alle Ansichten | 0 eingeschleuste Elemente/Attribute |
| `secrets` | Schlüssel, Tokens, private Keys im Repository | 0 Funde |
| `i18n` | Jede Seite, jeder Dialog, jede Server-Fehlermeldung auf Englisch | 0 deutsche Reste |
| `contrast` | WCAG-Kontrast der semantischen Farb-Tokens in Hell und Dunkel | Text ≥ 4,5:1, Sekundärtext/Symbole ≥ 3:1 |
| `a11y` | Alt-Texte, zugängliche Namen, Beschriftungen, Dialoge (`role`, `aria-modal`), kein positiver `tabindex`, eindeutige IDs, `prefers-reduced-motion`, Skeleton je Seite | 0 Verstöße |
| `consistency` | 1500 Schreibvorgänge auf dem echten Code, Zeilen zwischendurch von Hand vertauscht | 0 verlorene Updates, 0 doppelte IDs |
| `load` | Lastsimulation (Kurzprofil) mit den echten Grenzen: 30 parallele Ausführungen, globales Lock | 200 Aktive: ≤ 1 % abgelehnt, p95 ≤ 3 s |
| `budget` | Seitengröße, Start-Antwort, Dauer je Request-Typ bei 1000 Personen | Seite ≤ 520 KB (gzip ≤ 150), Request-Budgets |
| `license` | Lizenzen aller Pakete, nur erlaubte externe Hosts, keine Produktnamen anderer Hersteller, Lizenzhinweise in der README | 0 Funde |

**Einen Check ergänzen:** ein Skript, das bei Verstoß mit Exit-Code 1 endet, plus ein Eintrag in `dev/checks/index.js` (`id`, `name`, `purpose`, `limit`, `stage`, `cmd`). Mehr braucht es nicht. Der Guard, `--list` und die GitHub Action übernehmen ihn automatisch.

**Ratschen:** Lint-Warnungen, Coverage, Mutation-Score und Performance-Budget stehen auf dem heutigen Stand. Wird etwas besser, wird die Schwelle nachgezogen, nie gelockert.

## Was der Guard bewusst nicht automatisch prüft

- **Echtes Lastverhalten bei Google:** Die Simulation arbeitet mit einem Latenzmodell. Echte Zeiten liefert `?perf=1` in der Live-App. Lasttests gegen die Live-App sind gesperrt (Quoten, Kontosperre).
- **Optik und Verständlichkeit:** ob etwas schön, ruhig und verständlich wirkt. Das bleibt Sichtprüfung mit Screenshots in Hell, Dunkel und auf dem Handy.
- **Echte Screenreader und Tastaturbedienung im Browser:** Der A11y-Check prüft das Markup. Ein Durchgang mit Screenreader bleibt manuell.
- **Kontrast von Farben außerhalb der Tokens:** z. B. Avatar- und Projektfarben, die Nutzer wählen.
- **Google-SSO, Freigaben und Domain-Einstellungen:** nur in der echten Umgebung prüfbar.
- **Rechtliche Bewertung:** Markennutzung und Lizenzen werden technisch erkannt, rechtlich bewertet werden sie nicht.
- **Inhalt der KI-Antworten:** Der Guard prüft Format, Fallback und Links, nicht, ob Gemini inhaltlich Sinnvolles sagt.
