# FURPS-Durchgang (Stand 24.10.2026, Version 1.14)

Bewertet wurde die Web-App aus Sicht der Nutzer:innen, Schwerpunkt Usability. „Behoben“ heißt: in dieser Version umgesetzt und in der Vorschau geprüft.

## Functionality

| Befund | Status |
|---|---|
| Neue Aufgaben ohne zuständige Person landeten unklar in „Meine Aufgaben“; leere Aufgaben blieben liegen | behoben: Person ist Pflicht (Standard: Ersteller), leere neue Aufgaben werden beim Schließen verworfen |
| Suche fand keine Personen | behoben: Personen in der Suche, Treffer öffnet deren Aufgaben |
| Region passte nicht zum Land (nur deutsche Bundesländer) | behoben: Regionen je Land, Feld entfällt bei Ländern ohne regionale Feiertage |
| Feiertage-Panel in der Verfügbarkeit sah nur die Tabellenwochen statt 90 Tage | behoben |
| Rechte: Server prüft (Team-Lead/Admin), Meldungen sind deutsch und verständlich | geprüft, unverändert |
| Firmenverzeichnis (alle Kolleg:innen ohne Erst-Login suchbar) | offen: braucht Google-Workspace-Konto statt Gmail |

## Usability

| Befund | Status |
|---|---|
| Tastenkürzel-Symbol „⌘K“ unverständlich, Suchleiste zu kurz | behoben: Badge entfernt, Suchleiste über die volle Breite, Kürzel im Tooltip (Strg/Cmd + K) |
| Begriffe uneinheitlich („Kapazität“ vs. „Verfügbarkeit“) | behoben: überall „Verfügbarkeit“ |
| Löschen einer Aufgabe nur mit Bestätigungsdialog | behoben: sofort weg, 6 s „Rückgängig“ (inkl. Unteraufgaben) |
| Gespeicherte Ansichten nicht löschbar | behoben: Mülleimer mit „Rückgängig“ |
| Leerzustände verwiesen auf ⌘K | behoben: konkrete Handlungsaufforderung |
| Kein Einstieg bei leerer Datenbank | behoben: 3-Schritte-Hinweis auf der Übersicht, solange es kein Team gibt |
| Keine Hilfe / Tastenkürzel nicht auffindbar | behoben: „?“-Knopf oben rechts und Taste „?“: Kurzanleitung, Kürzel, Schnell-Eingabe, Version |
| Icon-Buttons ohne Beschriftung (Häkchen, Farben, Kalenderzellen) | behoben: Tooltips/ARIA-Labels; automatische Prüfung aller Seiten ohne Treffer |
| Kontrast Hilfstexte zu niedrig (ca. 2,9 : 1 hell) | behoben: hell 5,4 : 1, dunkel 5,6 : 1 (WCAG AA) |
| Touch-Ziele am Handy zu klein | behoben: mind. 40 px |
| Seiten scrollten wie eine Website, Dialoge zu lang | behoben (Version 1.11): feste Kopfbereiche, nur Boxen scrollen; Dialoge mit festem Kopf und Buttons |
| Sprache, Hell/Dunkel immer erreichbar | behoben: oben rechts |
| Nicht-sichtbarer Speicherstatus | behoben: Punkt neben dem App-Namen pulsiert beim Speichern; „Alle Änderungen gespeichert“ in der Aufgabe |

## Reliability

| Befund | Status |
|---|---|
| Technische Fehlermeldungen von Google (Lock, Timeout, Netzwerk) | behoben: verständliche Meldung mit Lösungshinweis |
| Kein Hinweis bei Verbindungsverlust | behoben: Offline-Banner, beim Wiederverbinden Abgleich |
| Formulareingaben gingen bei Hintergrund-Aktualisierung verloren | behoben (früher): Entwürfe bleiben, Neuaufbau nur bei echten Änderungen |
| Gelöschte Aufgabe bei sofortigem Seitenwechsel innerhalb der 6 s | behoben: wird beim Verlassen der Seite sofort gelöscht |
| Gleichzeitiges Speichern mehrerer Personen | geprüft: Server sperrt Schreibvorgänge (LockService) |
| Automatischer Wiederholversuch bei Serverfehler | offen: Meldung fordert zum erneuten Versuch auf |

## Performance

| Befund | Status |
|---|---|
| Ganze Seite wurde bei jeder Kleinigkeit neu aufgebaut, Animationen flackerten | behoben (1.3) |
| Neue Aufgabe wartete auf den Server | behoben (1.3): erscheint sofort |
| Tabellen werden pro Anfrage gecacht, Einstellungen einmal gelesen | behoben (1.3) |
| Lange Listen: Tabelle hat Seiten (25–200 Zeilen), Liste und Board nicht; bei mehreren Tausend Aufgaben prüfen | offen |

## Supportability

| Befund | Status |
|---|---|
| Keine Versionsangabe | behoben: in der Hilfe |
| Kein Feedback-Weg | behoben: Hinweis auf Admin-Person in der Hilfe (Platzhalter für ein Formular) |
| Tests und statische Apps-Script-Prüfung | vorhanden: `npm test`, `npm run check` |
| Übersetzungen zentral | vorhanden: `src/I18n.html` |
