# Codeguard extension – implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run guard` validates the app as completely as possible through an extensible list of checks, and WORKFLOW.md describes the development pipeline with a superpowers skill and guard checks per stage.

**Architecture:** every check is an entry `{ id, name, purpose, limit, stage, cmd }` in `dev/checks/index.js`; `dev/guard.js` runs the list. DOM checks (i18n, a11y, XSS) share a jsdom harness `dev/checks/dom.js` that starts the real app from `dev/preview.html`.

**Tech stack:** Node 20, node:test, c8, ESLint 9 + sonarjs, jsdom.

## Global constraints

- No load against the live app; everything runs locally.
- The guard exits with code 1 on any violation.
- A new check is one entry in `dev/checks/index.js`, nothing else.
- Thresholds are ratchets set to today's state, never lower.

## Review focus

- The contrast check must follow `var(--x)` references and the dark overrides, otherwise it checks made-up values.
- The XSS check must render user text in **all** views (list, board, panel, calendar, dialogs), not just one.
- The rights check must cover **every** route in `ROUTES`; a new route without an entry fails the test.
- The mutation test must not be flaky (fixed list of mutants, deterministic).
- The performance budget measures the delivered page without the preview runtime.

---

### Task 1: Check registry and DOM harness
**Files:** create `dev/checks/index.js`, `dev/checks/dom.js`; modify `dev/guard.js`, `dev/i18n-audit.js`
- [x] Registry with the existing checks; the guard prints name, purpose, threshold, result.
- [x] `dom.js`: `bootApp({ lang, user }) -> window`, `walk(window, inspect, onError)`.
- [x] The i18n audit uses `dom.js`; `npm run guard` green.

### Task 2: Contrast of the design tokens
**Files:** create `dev/checks/contrast.js`, `test/contrast.test.js`
- [x] Test: `contrastRatio('#000', '#fff') === 21`, resolving `var()`.
- [x] Pair list (text/surface, semantic pairs) for light and dark; 4.5:1 for text, 3:1 for secondary/large elements.

### Task 3: Accessibility and skeletons
**Files:** create `dev/checks/a11y.js`, `test/a11y.test.js`
- [x] Per page/dialog: images with alt, buttons/links with a name, labelled inputs, dialogs with `role=dialog` + `aria-modal`, no positive tabindex, checkboxes with `aria-checked`.
- [x] CSS: every animation covered by `prefers-reduced-motion`; a skeleton per route.

### Task 4: Security
**Files:** create `test/security.test.js`, `dev/checks/xss.js`
- [x] Rights matrix: every route refuses a foreign domain; changing routes refuse outsiders on others' data.
- [x] XSS: user text with `<img onerror>` / `<script>` in all views → 0 executable elements.

### Task 5: Mutation test (Shared.js)
**Files:** create `dev/checks/mutation.js`
- [x] All mutants (comparison, logical, arithmetic operators) in `Shared.js`, `test/shared.test.js` per mutant; score ≥ threshold.

### Task 6: Performance budget, licences
**Files:** create `dev/checks/budget.js`, `dev/checks/license.js`
- [x] Page size ≤ budget, request costs from the load profile ≤ budget, first response for a regular person ≤ budget.
- [x] Licences of all packages on the allow list; only allowed hosts; README licence section present.

### Task 7: WORKFLOW.md, README, deploy
- [x] Stages with superpowers skill and guard checks; README points to it; guard green; push; deploy only when runtime code changed.
