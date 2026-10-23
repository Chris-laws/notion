# Taskraum – Designsprache

> Vorläufig: entstanden ohne bestehendes Designsystem (Reifegrad L0). Alle Werte sind bewusst gesetzte Startwerte und als CSS-Variablen in `src/Styles.html` umgesetzt. Änderungen hier zuerst, dann in den Tokens.

## Haltung

Ruhig, dicht, werkzeughaft – näher an Linear/Notion als an einem Dashboard. Inhalte (Aufgaben, Personen, Tage) tragen Farbe, die Oberfläche bleibt grau. Dezente Lidl-Farbwelt: Blau (#0050aa) für Auswahl und primäre Aktion, Gelb nur als kleiner Marker, Rot nur für Fristen und Warnungen. Die Startseite hat einen blauen Hero mit gelb-roter Kante, sonst bleibt die Fläche weiß/grau. Keine Emojis in der Bedienoberfläche; Teams und Projekte bekommen farbige Kürzel-Quadrate.

## Farben

| Token | Hell | Dunkel | Einsatz |
|---|---|---|---|
| `--bg` | `#ffffff` | `#141417` | Inhaltsfläche |
| `--bg-subtle` | `#f8f8fa` | `#1a1a1e` | Seitenleiste, Spaltenhintergrund, Wochenenden |
| `--bg-hover` | `#f1f1f4` | `#232328` | Hover |
| `--bg-active` | `#ebebf0` | `#2a2a30` | Aktive Navigation |
| `--border` | `#ececf0` | `#26262c` | Trennlinien |
| `--border-strong` | `#dedee4` | `#33333a` | Eingabefelder, Karten |
| `--text` | `#1b1b1f` | `#ececf0` | Primärtext |
| `--text-2` | `#5f5f6b` | `#a0a0ab` | Sekundärtext, Labels |
| `--text-3` | `#9a9aa6` | `#6c6c76` | Metadaten, Platzhalter |
| `--accent` | `#0050aa` | `#4d94f0` | Primäraktion, Auswahl, Fokus (Lidl-Blau) |
| `--accent-soft` | `#e6eefa` | `#16294a` | Auswahl-Hintergrund |
| `--yellow` | `#ffe500` | `#ffe500` | Marker: Logo, aktive Navigation, heutiger Tag, Feiertage (als `--yellow-soft`) |
| `--danger` | `#e60a14` | `#ff5b63` | Überfällig, Warnung ≥ Schwelle |
| `--warning` | `#a86f00` | `#f5cf4d` | Feiertage, Teilabwesenheit |
| `--success` | `#30a46c` | `#3dd68c` | Erledigt |

Status-Glyphen statt bunter Pillen: Backlog (gestrichelter Kreis, grau), Offen (Kreis, grau), In Arbeit (halb gefüllt, gelb), Review (drei Viertel, indigo), Erledigt (gefüllt mit Haken, grün).

Abwesenheitsarten: Urlaub `#2fa56b`, Krank `#e60a14`, Fortbildung `#0050aa`, Sonstiges `#8b93a3`, Feiertag `#f2b600` – jeweils als 14 %-Tönung für Flächen.

## Typografie

Inter, Basisgröße 14 px, Zeilenhöhe 1.45.

| Rolle | Größe / Gewicht |
|---|---|
| Seitentitel | 22 px / 600, Laufweite −0.01em |
| Abschnitt | 13 px / 600 |
| Fließtext, Aufgabentitel | 14 px / 450–500 |
| UI, Buttons | 13 px / 500 |
| Metadaten | 12 px / 450, `--text-2` oder `--text-3` |
| Zahlen | `font-variant-numeric: tabular-nums` |

## Abstände und Formen

4-px-Raster: 4, 8, 12, 16, 24, 32, 48. Innerhalb von Gruppen eng (4–8), zwischen Gruppen weit (24–32).
Radien: 6 px (Steuerelemente), 8 px (Karten, Menüs), 12 px (Dialoge, Panels).
Schatten nur für schwebende Ebenen (Menüs, Dialoge, gezogene Karten); Karten liegen mit 1-px-Rand auf.
Zeilenhöhen: Navigation 28 px, Tabellenzeile 36 px, Listenzeile 40 px, Buttons 28 px (klein 24 px).

## Layout

Seitenleiste 244 px + Inhalt + optionale Detailansicht 520 px rechts (mobil Vollbild).
Kopfzeile 48 px: Pfad links, Suche und „Neue Aufgabe“ rechts.
Seitenkopf: Kürzel-Quadrat + Titel + eine Zeile Kontext, darunter Ansichts-Tabs und rechts die Werkzeuge (Filter, Gruppierung, Suche als Icon-Buttons).
Inhalt max. 1120 px für Lesen/Listen, volle Breite für Board, Kalender und Verfügbarkeit.

## Komponenten

- **Ansichts-Tabs**: Text + Icon, aktive Ansicht mit `--bg-active`-Fläche, kein Unterstrich.
- **Karte (Board)**: Titel 2 Zeilen max., darunter eine Metazeile (Priorität, Fälligkeit, Unteraufgaben), Avatare rechts unten. Projekt nur außerhalb der Projektansicht.
- **Eigenschaftszeile (Detail)**: Label 120 px in `--text-2`, Wert als Hover-Fläche.
- **Chip/Tag**: neutraler Rahmen, farbiger 6-px-Punkt.
- **Warnung**: rot getönter Hintergrund + Text „3/5 weg“, nie nur Farbe.
- **Kürzel-Quadrat**: 18/24/32 px, Teamfarbe, erster Buchstabe weiß.

## Dichte

Keine leeren Flächen: Startseite und Kalender haben rechts eine Seitenspalte (Warnungen, Abwesenheiten, Feiertage), Verfügbarkeit füllt die Breite und zeigt darunter Abwesenheiten und Feiertage des Zeitraums, Board-Spalten teilen sich die Breite. Seitenränder 28 px, Inhalt bis 1320 px.
