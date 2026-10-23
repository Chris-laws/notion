# Taskraum – Designsprache

> Vorläufig (Reifegrad L0): kein bestehendes Designsystem. Alle Werte sind bewusst gesetzte Startwerte und stehen als CSS-Variablen in `src/Styles.html`. Änderungen hier zuerst, dann in den Tokens.

## Haltung

Ruhige, helle Oberfläche in der Art moderner Planungs-Apps: weiche Arbeitsfläche, weiße Karten mit großzügigen Rundungen, wenig Linien, klare Hierarchie. Aufbau und Muster (Übersicht, Kanban-Board, Aufgabendetail, Tagesplaner mit Zeitblöcken, Agenda) folgen allgemein üblichen Layoutideen. Alle Farben, Formen, Texte und Icons sind eigenständig gestaltet; es wurden keine fremden Assets, Icons, Texte oder Screenshots übernommen.

Lidl-Anmutung dezent: Farbe hat eine Aufgabe, nie Dekoration.

- **Blau** (`#0050aa`) ist der Akzent: Auswahl, Links, primäre Aktion, Fortschritt.
- **Gelb** (`#ffe500`) nur als kleine Markierung: Logo-Punkt, aktiver Navigationsbalken, heutiger Tag, Feiertage.
- **Rot** (`#e60a14`) heißt Handlungsbedarf: überfällig, dringend, Team ab Schwelle abwesend.
- Alles andere ist Tinte und kühles Grau auf hellem Grund.

## Farben

| Token | Hell | Einsatz |
|---|---|---|
| Text | dunkles Blaugrau | Text |
| Hintergrund | sehr helles Grau | Arbeitsfläche |
| Karte | Weiß | Karten, Seitenleiste |
| Akzent | `#0050aa` | Blau |
| Marker | `#ffe500` | Gelb |
| Gefahr | `#e60a14` | Rot |

Dunkelmodus ist über dieselben Tokens hinterlegt. Abwesenheiten: Urlaub Blau, Krank Rot, Fortbildung Tinte, Sonstiges Grau, Feiertag Gelb. Status als Kreise: Backlog gestrichelt, Offen leer, In Arbeit gelb, Review blau, Erledigt grün mit Haken.

## Typografie

Nur Inter (optische Größe automatisch). Hierarchie über Größe und Gewicht, keine Großbuchstaben-Etiketten.

## Form

Karten mit 14–20 px Radius und sanftem Schatten, Dialoge und Palette 20 px. Trennung durch Fläche und Abstand statt harter Linien. Tabs als Segmentschalter.

## Layout

- Seitenleiste (weiß): Übersicht, Meine Aufgaben, Alle Aufgaben, Tagesplaner, Kalender & Agenda, Verfügbarkeit; aktive Seite sanft blau mit gelbem Balken.
- Übersicht: Begrüßung mit Quick-Add, Briefing, vier Kennzahlen, Widgets in 12er-Raster.
- Board: Spalten als Karten, Aufgabenkarten mit Priorität und Fälligkeit.
- Tagesplaner: Liste ungeplanter Aufgaben links, Zeitraster 06–20 Uhr rechts, Blöcke per Drag & Drop in 15-Minuten-Schritten.
- Agenda: Tage als Zeilen mit Datumskreis, Feiertage und Abwesenheiten inklusive.
- Detail: Seitenpanel mit weicher Eigenschaftskarte, KI-Vorschlägen, Unteraufgaben, Kommentaren.
- Responsiv ab 1180 px und 860 px.
