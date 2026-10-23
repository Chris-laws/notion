# Taskraum – Designsprache

> Vorläufig (Reifegrad L0): kein bestehendes Designsystem, alle Werte sind bewusst gesetzte Startwerte und stehen als CSS-Variablen in `src/Styles.html`. Änderungen hier zuerst, dann in den Tokens.

## Haltung

Kein Notion-Nachbau. Taskraum ist ein Leitstand für ein Team: Wer macht was, und wer ist wann da. Die Oberfläche sieht aus wie gut gesetzte Beschilderung im Markt: flach, kantig, Tinte auf Weiß, große Zahlen, klare Linien. Keine Schatten, keine Verläufe, keine runden Karten.

Farbe hat eine Aufgabe, nie Dekoration:

- **Lidl-Blau** (`#0050aa`) ist Struktur: Seitenleiste, Auswahl, Links, Blöcke für Urlaub.
- **Gelb** (`#ffe500`) markiert, wo man ist und was man tun kann: aktive Navigation, primäre Aktion, heutiger Tag, Feiertage, Auswahl.
- **Rot** (`#e60a14`) heißt Handlungsbedarf: überfällig, dringend, Team ab Schwelle abwesend.
- Alles andere ist Tinte (`#0b1d3a`) und kühles Grau.

## Farben

| Token | Hell | Dunkel | Einsatz |
|---|---|---|---|
| `--ink` / `--text` | `#0b1d3a` | `#eaf0fa` | Text, starke Linien |
| `--bg` | `#ffffff` | `#0d1626` | Inhaltsfläche |
| `--bg-subtle` | `#f3f6fa` | `#121d31` | Wochenenden, Fußzeilen |
| `--border` / `--border-strong` | `#dfe5ee` / `#b9c4d6` | `#1f2e49` / `#354867` | Haarlinien / Rahmen |
| `--accent` | `#0050aa` | `#5ca2ff` | Blau |
| `--yellow` | `#ffe500` | `#ffe500` | Marker |
| `--danger` | `#e60a14` | `#ff5560` | Rot |
| `--side-bg` | `#0050aa` | `#00346e` | Seitenleiste |

Abwesenheiten: Urlaub Blau, Krank Rot, Fortbildung Tinte, Sonstiges Grau, Feiertag Gelb.
Status als Quadrate: Backlog gestrichelt, Offen leer, In Arbeit halb gelb, Review halb blau, Erledigt blau mit Haken.

## Typografie

Inter (optische Größe automatisch) für Text, JetBrains Mono für alles, was Etikett oder Zahl ist.

| Rolle | Stil |
|---|---|
| Seitentitel | 32 px / 800, Laufweite −0.04em |
| Datum im Wochenplan | 26 px / 800 |
| Aufgabentitel | 14 px / 600, Laufweite −0.01em |
| Etiketten (Gruppenköpfe, Spalten, Eigenschaften) | Mono 10.5–11 px, Großbuchstaben, +0.08em |
| Daten, Dauer, Zähler | Mono 11.5 px |

## Form

Radius 3 px überall (Marken und Avatare sind Quadrate). Struktur durch Linien: 2 px Tinte oben an jeder Gruppe, Tabelle, Spalte und jedem Panel, 1 px Haarlinie zwischen Zeilen. Schwebende Ebenen (Menüs, Dialoge) bekommen 1,5 px Tintenrand und einen harten, versetzten Schatten, Dialoge zusätzlich 6 px gelben Kopfstreifen. Karten haben links einen 4 px Streifen nach Priorität: Rot dringend, Blau hoch.

## Layout

- Seitenleiste 232 px, blau, aktive Seite gelb hinterlegt.
- Kopfzeile 52 px: Pfad als Mono-Etikett links, „Neue Aufgabe“ (gelb) rechts.
- Seitenkopf: Titel 32 px, eine Zeile Kontext, darunter 2 px Tintenlinie. Dann Ansichts-Tabs (Woche, Liste, Board, Tabelle, Kalender) mit gelber Unterstreichung.
- Startseite „Meine Aufgaben“: Begrüßung, gelber Ticker mit Tageszusammenfassung und vier Zahlen, darunter der **Wochenplan** (Aufgaben nach Fälligkeitstag, Feiertage und Teamabwesenheit im Tageskopf, Warnung rot), rechts Warnungen, Abwesenheiten, Feiertage.
- Verfügbarkeit: Tagesraster, Abwesenheit als durchgehende Balken, Fußzeile mit Prozent, darunter Abwesenheiten und Feiertage des Zeitraums.

## Dichte

Keine leeren Flächen: Seitenspalten rechts auf Startseite und Kalender, Verfügbarkeit füllt die Breite, Board-Spalten teilen sich die Breite, Wochenenden erscheinen im Wochenplan nur, wenn dort etwas liegt.
