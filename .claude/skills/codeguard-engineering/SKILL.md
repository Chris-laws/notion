---
name: codeguard-engineering
description: Use for ANY software change (feature, bugfix, refactor, UI tweak) in any project, before writing code. The full engineering pipeline: requirement → plan → TDD → implementation → verification → code review → debugging → branch finish/deploy, each stage driven by a superpowers skill and closed only by automated codeguard checks (tests, mocks, coverage, mutation, lint/clean code, security, XSS, secrets, i18n, contrast, a11y, consistency, load, performance budget, licences). Also use when asked to "validate everything", set up a codeguard, or add checks to a project.
---

# Codeguard Engineering

Every change runs through the same pipeline. A **superpowers skill** decides *how* to work in each stage. **Codeguard checks** prove *that* it works. A stage is only done when its checks are green, and "done" is never claimed without the guard output as evidence.

```
Requirement ─▶ Plan ─▶ TDD ─▶ Implementation ─▶ Verification ─▶ Code review ─▶ Finish/Deploy
                        ▲                              │
                        └──── Debugging on failure ◀───┘
```

## The pipeline

| # | Stage | Skill (invoke it) | Guard checks | Exit criterion |
|---|---|---|---|---|
| 1 | Requirement | `superpowers:brainstorming` | – | Goal, limits and success criterion fixed in one sentence each; open questions answered. |
| 2 | Plan | `superpowers:writing-plans` (+ `superpowers:using-git-worktrees` for isolation) | – | Plan in `docs/superpowers/plans/` with files, interfaces, tests per task, "Review Focus". |
| 3 | TDD | `superpowers:test-driven-development` | `tests`, `mutation` | Every new behaviour had a **red** test first; all green; coverage and mutation score at or above their ratchet. |
| 4 | Implementation | `superpowers:executing-plans` or `superpowers:subagent-driven-development` (parallel: `superpowers:dispatching-parallel-agents`) | `lint` | Smallest code for the test; 0 lint errors; warnings not above the ratchet. |
| 5 | Verification | `superpowers:verification-before-completion` | all runtime checks | Full guard green; output quoted in the report. |
| 6 | Code review | `superpowers:requesting-code-review` / `superpowers:receiving-code-review` (or `/code-review`) | all | Findings checked on the merits, every real one gets a failing test, back to stage 3. |
| 7 | Debugging | `superpowers:systematic-debugging` | failed check, then `tests` | Root cause proven, a test reproduces it, green after the fix. |
| 8 | Finish / Deploy | `superpowers:finishing-a-development-branch` | `license` + full guard | Guard green, commit with reasons, push; deploy only if runtime code changed. |

If a superpowers skill is not available in the session, follow its principle anyway and say so in the report.

## The codeguard (what "validate everything" means)

One command (`npm run guard` or the project's equivalent) runs a **registry of checks**. Each entry has an `id`, `name`, `purpose`, `limit`, `stage` and `cmd`, and the command exits with 1 on a violation. The guard prints a summary and exits 1 if any check fails. The same command runs in CI on every push and pull request. A new check is one registry entry.

| id | What it validates | Typical threshold |
|---|---|---|
| `lint` | ESLint + clean-code rules (sonarjs): bugs, unsafe code, function length, complexity, cognitive complexity, duplicate strings, identical functions, unused code, duplicate keys | 0 errors; warnings ≤ ratchet |
| `tests` | Unit tests (one behaviour each, fresh fixture per test, Arrange-Act-Assert), **test doubles** for every external service (error, timeout, broken payload, empty answer), integration suite; coverage | all green; lines/functions ≥ 90 %, branches ≥ 75 % |
| `mutation` | Flip operators (`<`↔`<=`, `===`↔`!==`, `&&`↔`||`, `+1`↔`-1`) in the core domain file, run its tests per mutant; run **all** mutants (no sample) | score ≥ ratchet (e.g. 85 %) |
| `platform` | Runtime readiness for the target platform (e.g. Apps Script syntax, routes, manifest) | 0 errors |
| `security` | Rights matrix: **every** API route has a rule in the test (a new route without a rule fails); foreign domain refused; outsiders cannot change others' data; private fields stay private | 0 open routes |
| `xss` | Attack strings in every kind of user data, rendered through a tour of every view and dialog; seeding verified (else the check proves nothing) | 0 injected elements/attributes |
| `secrets` | API keys, private keys, tokens in the repo (self-test with a fake key) | 0 hits |
| `i18n` | Render every page/dialog/server error in the second language, report leftover words of the first | 0 leftovers |
| `contrast` | WCAG contrast of the design tokens, light **and** dark, following `var()` chains | text ≥ 4.5:1, secondary/UI ≥ 3:1 |
| `a11y` | alt texts, accessible names, labels, dialogs (`role`, `aria-modal`, name), no positive tabindex, unique ids, `prefers-reduced-motion`, skeleton per route; rules themselves unit-tested against broken markup | 0 violations |
| `consistency` | Many writes on the real code with out-of-band disturbance (e.g. rows shuffled by hand) | 0 lost updates, 0 duplicates |
| `load` | Load simulation **never against production**: profile each request on the real code (count reads/writes/cache/locks), latency model, real platform limits (concurrency cap, global lock), ramp-up + polling + writes, Erlang B as cross-check | budget for a small team profile |
| `budget` | Page size (raw + gzip), first-response size, modelled time per request type | at today's values + headroom |
| `license` | Licences of all packages (exceptions with reason), allowed external hosts only, no other vendors' product names in code/docs, licence/brand section in the README | 0 hits |

## Rules that make it trustworthy

- **Red first.** A check or test that never failed proves nothing: watch it fail (or give it a known-bad input) before trusting green.
- **Ratchets, never loosen.** Lint warnings, coverage, mutation score and budgets sit at today's value. When things improve, tighten them.
- **Test real behaviour, not mocks.** Doubles only at the system edge (network, clock, platform services). Assert what the app does with the answer.
- **No load against production.** Platform quotas can lock the account. Simulate with the real code and the real limits instead.
- **Every finding becomes a test** before the fix, including review findings and anything a check discovers.
- **Report with evidence:** numbers before → after, the guard summary, what was found, and what is deliberately *not* automatable (real platform latency, visual taste, real screen readers, user-chosen colours, SSO/permissions, legal judgement, content of AI answers).
- **Deploy only when runtime code changed**, after a green guard; keep a tag as a rollback point before big UI changes.

## Setting it up in a new project

1. `npm i -D c8 eslint @eslint/js globals eslint-plugin-sonarjs@1 eslint-plugin-html jsdom` (sonarjs v1 avoids the TypeScript peer chain).
2. Tests with `node:test` in `test/`, helpers that give each test a fresh app and a `measure()` meter for platform calls.
3. `dev/checks/index.js` registry + `dev/guard.js` runner (`--list`, `--only a,b`) + CI workflow running `npm run guard`.
4. Add the checks above in the order: tests → lint → security → i18n/a11y/contrast/xss → consistency/load/budget → mutation → license.
5. Write `WORKFLOW.md` in the repo: the stage table above with the project's check ids.

Reference implementation: LidlFlow (Google Apps Script), `C:\Users\IT-Admin\Neuer Ordner\notion` — `dev/checks/`, `dev/guard.js`, `WORKFLOW.md`, `test/`.
