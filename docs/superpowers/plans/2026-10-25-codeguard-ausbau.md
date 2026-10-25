# Codeguard-Ausbau Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run guard` validiert die App möglichst vollständig über eine erweiterbare Liste von Checks, und WORKFLOW.md beschreibt die Entwicklungs-Pipeline mit superpowers-Skill und Guard-Check je Stufe.

**Architecture:** Jeder Check ist ein Eintrag `{ id, name, purpose, threshold, run }` in `dev/checks/index.js`; `dev/guard.js` führt die Liste aus. DOM-Checks (i18n, A11y, XSS) teilen sich ein jsdom-Harness `dev/checks/dom.js`, das die echte App aus `dev/preview.html` startet.

**Tech Stack:** Node 20, node:test, c8, ESLint 9 + sonarjs, jsdom.

**Spec:** Auftrag in der Projekt-Unterhaltung vom 2026-10-25 (Codeguard ausbauen, WORKFLOW.md).

## Global Constraints

- Keine Last gegen die Live-App; alles läuft lokal.
- Guard endet mit Exit-Code 1 bei jedem Verstoß.
- Neue Checks: ein Eintrag in `dev/checks/index.js`, sonst nichts.
- Schwellen werden als Ratsche auf den heutigen Stand gesetzt, nie darunter.

## Review Focus

- Kontrast-Check muss `var(--x)`-Verweise und die Dunkel-Overrides auflösen, sonst prüft er Phantasiewerte.
- XSS-Check muss Nutzertexte in **allen** Ansichten rendern (Liste, Board, Peek, Kalender, Dialoge), nicht nur einer.
- Rechte-Check muss **jede** Route aus `ROUTES` abdecken; eine neue Route ohne Eintrag lässt den Test fehlschlagen.
- Mutationstest darf nicht flaky sein (feste Mutantenliste, deterministisch).
- Performance-Budget misst die ausgelieferte Seite ohne Preview-Runtime.

---

### Task 1: Check-Registry und DOM-Harness
**Files:** Create `dev/checks/index.js`, `dev/checks/dom.js`; Modify `dev/guard.js`, `dev/i18n-audit.js`
- [ ] Registry mit den bestehenden 6 Checks; guard druckt Name, Zweck, Schwelle, Ergebnis.
- [ ] `dom.js`: `bootApp({ lang, user }) -> window`, `visit(w, js, ms)`.
- [ ] i18n-Audit nutzt `dom.js`; `npm run guard` grün.

### Task 2: Kontrast der Design-Tokens
**Files:** Create `dev/checks/contrast.js`, `test/contrast.test.js`
- [ ] Test: `contrastRatio('#000', '#fff') === 21`, Auflösung von `var()`.
- [ ] Paarliste (Text/Fläche, semantische Paare) für Hell und Dunkel; Schwelle 4,5:1 (Text), 3:1 (große/sekundäre Elemente).

### Task 3: Barrierefreiheit (A11y) und Skeletons
**Files:** Create `dev/checks/a11y.js`
- [ ] Je Seite/Dialog: Bilder mit alt, Buttons/Links mit zugänglichem Namen, Eingaben beschriftet, Dialoge `role=dialog` + `aria-modal`, kein positives tabindex, Checkboxen mit `aria-checked`.
- [ ] CSS: jede Animation durch `prefers-reduced-motion` abgedeckt; Skeleton je Route vorhanden.

### Task 4: Sicherheit
**Files:** Create `test/security.test.js`, `dev/checks/xss.js`
- [ ] Rechte-Matrix: jede Route aus `ROUTES` für Fremd-Domain abgelehnt; schreibende Routen für Außenstehende auf fremde Daten abgelehnt.
- [ ] XSS: Nutzertexte mit `<img onerror>`/`<script>` in allen Ansichten → 0 ausführbare Elemente.

### Task 5: Mutationstest (Shared.js)
**Files:** Create `dev/checks/mutation.js`
- [ ] Feste Mutanten (Vergleichs-/Logik-/Arithmetik-Operatoren) in `Shared.js`, je Mutant `test/shared.test.js` in-process; Score ≥ Schwelle.

### Task 6: Performance-Budget, Lizenzen/Marken
**Files:** Create `dev/checks/budget.js`, `dev/checks/license.js`
- [ ] Seitengröße ≤ Budget, Request-Kosten aus dem Lastprofil ≤ Budget, Bootstrap-Antwort normale Person ≤ Budget.
- [ ] Lizenzen aller Pakete in Erlaubt-Liste; keine fremden Marken im Code; Schriften/Logo dokumentiert.

### Task 7: WORKFLOW.md + README + Deploy
- [ ] Stufen mit superpowers-Skill und Guard-Check; README verweist darauf; guard grün; push; deploy nur bei geändertem Laufzeitcode.
