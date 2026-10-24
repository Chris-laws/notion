# Taskraum – Notion-artiges Teamtool in Google Apps Script

Task-Management und Teamkalender für Unternehmen, die mit Google Workspace arbeiten.
Anmeldung per Google SSO, Daten in einem Google Sheet, Oberfläche im Stil von Notion.

## Funktionen

**Aufgaben**
- Aufgaben für sich selbst, eine Person, mehrere Personen oder ganze Teams
- Teams (wie Notion-Teamspaces) mit Lead und Mitgliedern, darin Projekte
- Projekte mit eigenem Mitgliederkreis: ganzes Team oder gemischt aus verschiedenen Teams
- Ansichten: **Liste**, **Tabelle** (sortierbar, Inline-Bearbeitung, Fortschrittsbalken, Seitenzahl), **Board** (Drag & Drop, Gruppierung nach Status/Priorität/Person/Projekt, Spalten einklappbar), **Kalender** und **Gantt** (Balken ziehen verschiebt, rechter Rand ändert das Fälligkeitsdatum, Zoom Woche/Monat/Quartal); gespeicherte Ansichten pro Seite (im Browser)
- Aufgabe als Seitenansicht oder Vollseite (Eigenschaftskarten, Fortschritt manuell oder automatisch, Zeiterfassung mit Timer, Unteraufgaben, Kommentare): Status, Zuweisung, Priorität, Start/Fällig, Projekt, Teams, Aufwand, Tags, Wiederholung, Beschreibung, Unteraufgaben, Kommentare
- Wiederkehrende Aufgaben (täglich, werktags, wöchentlich, monatlich)
- Befehlspalette (`Strg+K`) mit Quick-Add in natürlicher Sprache, die Syntax wird farbig markiert:
  `Angebot senden morgen @anna #website !hoch 2h` → Titel, Fälligkeit, Person, Projekt, Priorität und Aufwand werden erkannt
- **Übersicht** (Startseite): Begrüßung mit Tagesfortschritt, Tagesbriefing, vier Kennzahlen, Projektübersicht, „Heute im Fokus“, Teamabwesenheit, Agenda, Aktivitäts-Heatmap
- **Projektseite** mit Übersicht (Aufgabenverteilung, Kurzstatistik, Fortschritt im Detail), Aufgaben und Mitgliedern
- **Tagesplaner**: Aufgabenliste links, Zeitraster rechts. Aufgaben per Drag & Drop als Zeitblöcke legen (15-Minuten-Raster, Länge = Aufwandsschätzung); gespeichert als `planDate` und `planStart`
- **Kalender** mit sechs Ansichten (Tasten `1`–`6`): Agenda (Überfällig oben, Zeitraum Heute/Woche/Monat/90 Tage), Planer, Monat, Woche, Tag (Zeitraster mit Drag & Drop) und Heatmap erledigter Aufgaben; Urlaub, Feiertage und Teamwarnung ab 50 % in jeder Ansicht
- „Meine Aufgaben“ als Datenbank mit Liste, Board, Tabelle

**Kalender, Urlaub und Verfügbarkeit**
- Teamkalender mit Aufgaben, Terminen/Meilensteinen, Abwesenheiten und **internationalen Feiertagen**
- Feiertage pro Person nach Land **und Region** (z. B. Allerheiligen nur für `DE-BY`, Thanksgiving nur für `US`)
- Quellen: [Nager.Date](https://date.nager.at) (≈120 Länder inkl. regionaler Feiertage), Fallback auf Googles Feiertagskalender und eine eingebaute Berechnung für DE, AT, CH, US, GB, FR, IT, ES, NL, PL; dazu eigene Firmen-Feiertage
- Woher die Daten kommen: Land und Region stehen im **Profil** jeder Person (Einstellungen; ohne Land gilt `DEFAULT_COUNTRY`). Für jedes Team werden die Länder aller Mitglieder zusammengezogen, jeder Feiertag zeigt, **wen** er betrifft; regionale Feiertage gelten nur bei passender Region. „Persönlich“ im Kalender nutzt nur das eigene Land und die eigene Region.
- Feiertage werden **nicht** in die Tabelle eingetragen, sondern live geholt und pro Land und Jahr 30 Tage zwischengespeichert (Script-Cache + Tabelle `HolidayCache`). Eine Änderung von Land/Region im Profil wirkt sofort. Firmen-Feiertage pflegen Admins separat unter Einstellungen.
- Urlaub wird direkt im Teamkalender gepflegt: mehrere Tage mit der Maus markieren oder „Urlaub eintragen“
- **Verfügbarkeit**: Tagesraster pro Team, wer wann weg ist (Urlaub, Krank, Fortbildung, Feiertag). Sind an einem Tag **mindestens 50 %** eines Teams abwesend, gibt es eine Warnung im Kalender, in der Verfügbarkeit, im Tagesbriefing und direkt beim Eintragen des Urlaubs. Feiertage zählen mit, je nach Land und Region der Person. Schwelle über `ABSENCE_WARN_PERCENT` anpassbar
- Aufwandsplanung pro Person und Woche (für „Wer hat Kapazität?“): Wochenstunden und Arbeitstage (Teilzeit), minus Feiertage und Abwesenheiten, verglichen mit dem geschätzten Aufwand offener Aufgaben (verteilt auf die Arbeitstage zwischen Start und Fälligkeit)

**Smarte Funktionen (Vertex AI vorbereitet)**
- Ohne KI-Schlüssel läuft alles regelbasiert: Quick-Add-Parser, „Wer hat Kapazität?“ (Vorschlag nach freier Kapazität, Feiertagen und Abwesenheiten), Tagesbriefing
- Mit Vertex-AI-Schlüssel übernimmt Gemini: verfeinertes Quick-Add, formuliertes Briefing, Zerlegen von Aufgaben in Teilaufgaben mit Aufwandsschätzung
- Der Schlüssel liegt nur serverseitig in den Skripteigenschaften und erreicht nie den Browser

## Einrichtung

Voraussetzung: Google-Workspace-Konto (die Anmeldung per Google SSO liefert die E-Mail nur für Konten derselben Workspace-Domain, private Gmail-Konten werden nicht erkannt), Node.js.

Vor dem Upload: `npm test` und `npm run check` (prüft Manifest, `include()`-Ziele, Syntax und Routen) laufen lassen.

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "Taskraum" --rootDir src   # legt .clasp.json an
clasp push
```

Danach im Apps-Script-Editor (`clasp open`):

1. Funktion **`setup`** ausführen und Berechtigungen bestätigen. Das legt die Datenbank-Tabelle an und speichert die Grundeinstellungen. Die ausführende Person wird Admin.
2. Optional **`seedDemoData`** ausführen, um ein Beispielteam mit Projekten und Aufgaben zu bekommen.
3. **Bereitstellen → Neue Bereitstellung → Web-App**
   - Ausführen als: **Ich**
   - Zugriff: **Jeder in &lt;deiner Domain&gt;**

Bei einer neuen Version: `clasp push`, dann `setup()` erneut ausführen (ergänzt neue Spalten, vorhandene Daten bleiben) und unter **Bereitstellungen verwalten** eine neue Version veröffentlichen.

Die Web-App-URL ist der Link für alle Kolleg:innen. Google meldet sie automatisch an; beim ersten Besuch werden sie im Personenverzeichnis angelegt.

### Skripteigenschaften

*Projekteinstellungen → Skripteigenschaften*. `setup()` legt alle mit Standardwerten an.

| Eigenschaft | Bedeutung |
|---|---|
| `SPREADSHEET_ID` | Datenbank-Tabelle (wird von `setup()` gesetzt) |
| `APP_NAME` | Name in der Oberfläche, Standard `Taskraum` |
| `ALLOWED_DOMAIN` | Nur diese E-Mail-Domain darf rein (setzt `setup()` auf deine Domain) |
| `ADMIN_EMAILS` | Kommagetrennte Admin-Adressen |
| `DEFAULT_COUNTRY` | Land für neue Personen, Standard `DE` |
| `DEFAULT_HOURS_PER_WEEK` | Wochenstunden für neue Personen, Standard `40` |
| `ABSENCE_WARN_PERCENT` | Ab wie viel Prozent Abwesenheit ein Team gewarnt wird, Standard `50` |
| `VERTEX_API_KEY` | **Platzhalter** `PLATZHALTER_VERTEX_AI_API_KEY` – hier später den Vertex-AI-Schlüssel eintragen |
| `VERTEX_MODEL` | Standard `gemini-2.5-flash` |
| `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` | Optional: GCP-Projekt und Region für einen regionalen Endpunkt (z. B. `europe-west3`) |

**KI-Funktionen sind vorerst Dummy:** Solange der Platzhalter-Schlüssel steht, liefert „Aufgabe zerlegen“ einen Beispielvorschlag (mit Hinweis in der Oberfläche) und die übrigen smarten Helfer arbeiten regelbasiert. Sobald ein echter Schlüssel in `VERTEX_API_KEY` steht, ist keine Codeänderung nötig.

Gespeicherte Ansichten (Filter/Sortierung) liegen im Browser der jeweiligen Person, nicht in der Tabelle.

Ohne `VERTEX_PROJECT_ID` wird der globale Endpunkt im Vertex-AI-Express-Modus genutzt. Der Schlüssel wird im Header `x-goog-api-key` gesendet, nicht in der URL.

## Entwicklung

```bash
npm test          # führt den echten Servercode gegen In-Memory-Nachbildungen der Apps-Script-Dienste aus
npm run preview   # baut dev/preview.html: komplette App mit Demodaten im Browser, ohne Google-Konto
npm run check     # statische Prüfung für Apps Script
npm run push      # clasp push
```

`dev/preview.html?user=anna.schmidt@firma.de` zeigt die App aus Sicht einer anderen Person.

### Aufbau

```
src/
  appsscript.json   Manifest (Web-App, Scopes)
  Code.js           doGet, api()-Router, Bootstrap
  Shared.js         Konstanten, Datumslogik, Quick-Add-Parser (Server und Browser)
  Db.js             Tabellen-Schicht über Google Sheets (Lock, Formel-Schutz)
  Auth.js           Google SSO, Berechtigungen, Konfiguration
  Users.js, Teams.js, Tasks.js
  Calendar.js       Termine, Abwesenheiten, Kapazitätsberechnung
  Availability.js   Wer ist wann weg, Team-Warnung ab Schwelle
  Holidays.js       Internationale Feiertage mit Cache und Fallbacks
  Ai.js             Smarte Funktionen, Vertex-AI-Anbindung
  Setup.js          setup(), seedDemoData()
  Index.html        Seitengerüst
  Styles.html       Design (hell/dunkel, mobil)
  App.html          Zustand, Routing, Seitenleiste
  Components.html   Menüs, Eigenschafts-Editoren, Dialoge, Befehlspalette
  Views.html        Liste, Board, Tabelle, Kalender, Verfügbarkeit, Teams, Projekte, Einstellungen
  Peek.html         Aufgaben-Detailansicht
dev/                Tests und lokale Vorschau (wird nicht hochgeladen)
```

### Berechtigungen

- Alle sehen Teams, Projekte und das Personenverzeichnis.
- Aufgaben sieht, wer sie erstellt hat, wem sie zugewiesen sind, wer in einem zugewiesenen Team ist oder wer zum Projekt bzw. dessen Team gehört. Admins sehen alles.
- Teams bearbeiten: Lead, erstellende Person, Admins. Projekte anlegen: Mitglieder des Teams.
- Notizen bei Abwesenheiten sehen nur die Person selbst und Admins.

### Grenzen

Google Sheets als Datenbank passt für Teams bis in den niedrigen vierstelligen Bereich an Aufgaben. Schreibzugriffe laufen über eine Sperre (`LockService`), damit gleichzeitige Änderungen sich nicht überschreiben. Für deutlich größere Datenmengen lässt sich `Db.js` gegen Firestore oder Cloud SQL tauschen, ohne die übrigen Dateien zu ändern.

## Design

Die Designsprache (Farben, Typografie, Abstände, Komponenten) steht in [DESIGN.md](DESIGN.md) und ist als CSS-Variablen in `src/Styles.html` umgesetzt.
