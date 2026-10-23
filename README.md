# Taskraum – Notion-artiges Teamtool in Google Apps Script

Task-Management und Teamkalender für Unternehmen, die mit Google Workspace arbeiten.
Anmeldung per Google SSO, Daten in einem Google Sheet, Oberfläche im Stil von Notion.

## Funktionen

**Aufgaben**
- Aufgaben für sich selbst, eine Person, mehrere Personen oder ganze Teams
- Teams (wie Notion-Teamspaces) mit Lead und Mitgliedern, darin Projekte
- Projekte mit eigenem Mitgliederkreis: ganzes Team oder gemischt aus verschiedenen Teams
- Ansichten wie in Notion: **Liste**, **Board** (Drag & Drop, Gruppierung nach Status/Priorität/Person/Projekt), **Tabelle** (sortierbar, Inline-Bearbeitung), **Kalender** (Drag & Drop auf neues Datum)
- Seitenansicht pro Aufgabe: Status, Zuweisung, Priorität, Start/Fällig, Projekt, Teams, Aufwand, Tags, Wiederholung, Beschreibung, Unteraufgaben, Kommentare
- Wiederkehrende Aufgaben (täglich, werktags, wöchentlich, monatlich)
- Befehlspalette (`Strg+K`) mit Quick-Add in natürlicher Sprache:
  `Angebot senden morgen @anna #website !hoch 2h` → Titel, Fälligkeit, Person, Projekt, Priorität und Aufwand werden erkannt
- „Meine Aufgaben“ mit Tagesbriefing, Überfälligem, Wochenauslastung

**Kalender, Urlaub und Verfügbarkeit**
- Teamkalender mit Aufgaben, Terminen/Meilensteinen, Abwesenheiten und **internationalen Feiertagen**
- Feiertage pro Person nach Land **und Region** (z. B. Allerheiligen nur für `DE-BY`, Thanksgiving nur für `US`)
- Quellen: [Nager.Date](https://date.nager.at) (≈120 Länder inkl. regionaler Feiertage), Fallback auf Googles Feiertagskalender und eine eingebaute Berechnung für DE, AT, CH, US, GB, FR, IT, ES, NL, PL; dazu eigene Firmen-Feiertage
- Urlaub wird direkt im Teamkalender gepflegt: mehrere Tage mit der Maus markieren oder „Urlaub eintragen“
- **Verfügbarkeit**: Tagesraster pro Team, wer wann weg ist (Urlaub, Krank, Fortbildung, Feiertag). Sind an einem Tag **mindestens 50 %** eines Teams abwesend, gibt es eine Warnung im Kalender, in der Verfügbarkeit, im Tagesbriefing und direkt beim Eintragen des Urlaubs. Feiertage zählen mit, je nach Land und Region der Person. Schwelle über `ABSENCE_WARN_PERCENT` anpassbar
- Aufwandsplanung pro Person und Woche (für „Wer hat Kapazität?“): Wochenstunden und Arbeitstage (Teilzeit), minus Feiertage und Abwesenheiten, verglichen mit dem geschätzten Aufwand offener Aufgaben (verteilt auf die Arbeitstage zwischen Start und Fälligkeit)

**Smarte Funktionen (Vertex AI vorbereitet)**
- Ohne KI-Schlüssel läuft alles regelbasiert: Quick-Add-Parser, „Wer hat Kapazität?“ (Vorschlag nach freier Kapazität, Feiertagen und Abwesenheiten), Tagesbriefing
- Mit Vertex-AI-Schlüssel übernimmt Gemini: verfeinertes Quick-Add, formuliertes Briefing, Zerlegen von Aufgaben in Teilaufgaben mit Aufwandsschätzung
- Der Schlüssel liegt nur serverseitig in den Skripteigenschaften und erreicht nie den Browser

## Einrichtung

Voraussetzung: Google-Workspace-Konto, Node.js.

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

Ohne `VERTEX_PROJECT_ID` wird der globale Endpunkt im Vertex-AI-Express-Modus genutzt. Der Schlüssel wird im Header `x-goog-api-key` gesendet, nicht in der URL.

## Entwicklung

```bash
npm test          # führt den echten Servercode gegen In-Memory-Nachbildungen der Apps-Script-Dienste aus
npm run preview   # baut dev/preview.html: komplette App mit Demodaten im Browser, ohne Google-Konto
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
