# Development workflow

Every change to LidlFlow runs through the same pipeline. Each stage has a **superpowers skill** that sets *how* to work and **codeguard checks** that prove automatically *that* the result is right. A stage is only done when its checks are green. `npm run guard` runs all checks and exits with code 1 on any violation; `npm run guard -- --list` shows them with purpose and threshold; `npm run guard -- --only lint,tests` runs a subset. The same command runs as a GitHub Action on every push and pull request.

The skills come from the Claude Code plugin **superpowers**. The whole pipeline is also stored as the Claude Code skill **`codeguard-engineering`** (`.claude/skills/codeguard-engineering/SKILL.md`), which guides through the stages, the matching skills and the guard.

```
Requirement ─▶ Plan ─▶ TDD ─▶ Implementation ─▶ Verification ─▶ Code review ─▶ Finish/Deploy
                        ▲                              │
                        └──── Debugging on failure ◀───┘
```

| # | Stage | superpowers skill | Guard checks (`--only …`) | Done when |
|---|---|---|---|---|
| 1 | Requirement | `brainstorming` | – | Goal, limits and success criterion are fixed in one sentence each; open questions are answered. |
| 2 | Plan | `writing-plans` (if needed `using-git-worktrees`) | – | A plan in `docs/plans/` with files, interfaces, tests per task and a "review focus". |
| 3 | TDD | `test-driven-development` | `tests`, `mutation` | Every new behaviour had a **red** test first; afterwards everything is green, coverage and mutation score hold their thresholds. |
| 4 | Implementation | `executing-plans` or `subagent-driven-development` (parallel: `dispatching-parallel-agents`) | `lint` | Smallest solution for the test, no new lint errors, warnings not above the ratchet. |
| 5 | Verification | `verification-before-completion` | `gas`, `security`, `xss`, `secrets`, `i18n`, `contrast`, `a11y`, `consistency`, `load`, `budget` | `npm run guard` fully green; only then is something "done". The output is quoted as evidence. |
| 6 | Code review | `requesting-code-review`, answers with `receiving-code-review` | all | Findings checked on their merits; every real finding gets a test, then back to stage 3. |
| 7 | Debugging | `systematic-debugging` | the failed check, then `tests` | Root cause found and proven; a test reproduces the bug and is green after the fix. |
| 8 | Finish / deploy | `finishing-a-development-branch` | `license`, `migration` + full guard | Guard green, commit with reasons, push. **Deploy only when runtime code (`src/`) changed**: `clasp push` + `clasp update-deployment`. |

## The checks

| id | What | Threshold |
|---|---|---|
| `lint` | ESLint + sonarjs rules: bugs, unsafe code, function length, complexity, duplicates, unused code | 0 errors, warnings ≤ ratchet |
| `tests` | Unit tests (`test/`), test doubles for external services (Nager.Date, Vertex/Gemini: error, timeout, broken JSON, empty answer), integration suite (`dev/test.js`), coverage of `src/` | all green, lines/functions ≥ 90 %, branches ≥ 75 % |
| `mutation` | Mutation test of the domain logic (`Shared.js`): changed operators must be caught by the tests | score ≥ 85 % |
| `gas` | Apps Script readiness: syntax, routes, files as after `clasp push` | 0 errors |
| `security` | Rights per API method: every route in `ROUTES` has a rule; a foreign domain is refused; outsiders change no one else's data; private fields stay private | 0 open routes |
| `xss` | 5 attack strings in 7 kinds of data (task, project, team, comment, event, tag, name), tour through all views | 0 injected elements/attributes |
| `secrets` | Keys, tokens, private keys in the repository | 0 hits |
| `i18n` | Every page, dialog and server message in English | 0 German leftovers |
| `contrast` | WCAG contrast of the semantic colour tokens, light and dark | text ≥ 4.5:1, secondary text/icons ≥ 3:1 |
| `a11y` | Alt texts, accessible names, labels, dialogs (`role`, `aria-modal`), no positive `tabindex`, unique ids, `prefers-reduced-motion`, a skeleton per page | 0 violations |
| `consistency` | 1,500 writes on the real code while rows are shuffled by hand in between | 0 lost updates, 0 duplicate ids |
| `load` | Load simulation (short profile) with the real limits: 30 parallel executions, global lock | 200 active: ≤ 1 % refused, p95 ≤ 3 s |
| `budget` | Page size, first response, duration per request type at 1,000 people | page ≤ 560 KB (gzip ≤ 165), request budgets |
| `license` | Licences of all packages, only allowed external hosts, licence section in the README | 0 hits |
| `migration` | Ready to hand over: no personal or environment-specific data (addresses, ids, URLs, local paths), documentation in English, required files present | 0 hits |

**Adding a check:** a script that exits with code 1 on a violation plus one entry in `dev/checks/index.js` (`id`, `name`, `purpose`, `limit`, `stage`, `cmd`). The guard, `--list` and the GitHub Action pick it up automatically. Checks that need local, non-versioned settings read them from git-ignored files under `dev/local/`.

**Ratchets:** lint warnings, coverage, mutation score and performance budget sit at today's values. When things improve the threshold is tightened, never loosened.

## Load simulation

`npm run load` simulates up to 10,000 people **without touching the live app** (platform quotas could lock the account):

1. **Profile:** every request type runs once through the real server code in Node (Apps Script shims). A meter counts what it costs: sheet reads and rows, writes, cache calls, compression, lock.
2. **Latency model** per Apps Script operation (assumptions in `dev/load-sim.js`, e.g. sheet read 120 ms + 0.004 ms per cell, cache 15 ms, 250 ms overhead per call).
3. **Event simulation** of 15 minutes peak load: login wave, polling, a write about every 10 minutes per person (60 % change, 25 % create, 15 % comment), with the real limits: at most **30 parallel executions** (the app runs as the deploying account, everyone shares that quota; above it a call is refused at once) and **one script lock** for all writes (aborts after 20 s).
4. **Erlang B** (loss system with 30 servers) as a theoretical cross-check.
5. **Consistency:** 1,500 writes on the real code while rows are shuffled by hand.

Result (3 tasks per person, before → after the cache and retry work):

| Active at the same time | p95 | refused | lock wait p95 |
|---|---|---|---|
| 250 | 1.4 s → 0.8 s | 0 % → 0 % | 0.8 s → 0.2 s |
| 500 | 2.3 s → 0.9 s | 0 % → 0 % | 5.2 s → 0.4 s |
| 1,000 | 18.2 s → 1.1 s | 25 % → 0 % | 20.6 s → 1.7 s |
| 2,500 | 9.9 s → 15.9 s | 76 % → 74 % | limit reached |
| 10,000 | – | 95 % → 92 % | limit reached |

Limits of the architecture: about **1,000 people at the same time** work well. Running the web app as the visiting person (`executeAs: USER_ACCESSING`) lifts the 30-execution limit (10,000 people: 0 % refused, p95 1.6 s) but every person then needs access to the spreadsheet. The global write lock manages about 0.6 writes/s at 30,000 tasks; beyond that tasks need to be split per team or `Db.js` moved to a real database.

## What the guard deliberately does not check

- **Real latency at Google:** the simulation uses a latency model; real times come from `?perf=1` in the live app.
- **Look and clarity:** whether something looks calm and is understandable stays a visual review in light, dark and on a phone (see [TESTPLAN.md](TESTPLAN.md)).
- **Real screen readers and keyboard use in the browser:** the a11y check covers the markup; a screen-reader pass stays manual.
- **Contrast of user-chosen colours** (avatars, projects).
- **Google SSO, sharing and domain settings:** only testable in the real environment.
- **Legal assessment** of brands and licences.
- **Content of AI answers:** the guard checks format, fallback and links, not whether Gemini says something useful.
