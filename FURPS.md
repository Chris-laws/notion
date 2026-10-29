# Quality characteristics (FURPS)

Current state of the web app from the users' point of view. Each item is backed by an automated check where possible (see [WORKFLOW.md](WORKFLOW.md)); the check id is given in brackets.

## Functionality

- Tasks, sub-tasks, recurrence, projects, teams, events, absences, company holidays, capacity and availability (`tests`).
- Every task has at least one responsible person (default: the creator); empty new tasks are discarded when the dialog closes.
- Search covers tasks, projects and people.
- Regions follow the selected country; the field is hidden for countries without regional holidays.
- Permissions are enforced on the server for every API route (`security`).
- Open: a full company directory (all colleagues searchable before their first sign-in) needs the Workspace directory API.

## Usability

- One people manager wherever people are added: search, invite by e-mail, remove with undo.
- Deleting a task takes effect at once with a 6-second undo (sub-tasks included); saved views can be deleted with undo.
- Empty states say what to do next; an empty database shows a three-step start.
- Help ("?" button and key) with short guide, shortcuts and quick-add syntax; shortcuts work regardless of Shift/Caps Lock and keyboard layout.
- Icon buttons have tooltips and ARIA labels; dialogs keep focus and return it; clicking next to a dialog only closes it when nothing was typed (`a11y`).
- Contrast meets WCAG AA in light and dark mode (`contrast`); touch targets are at least 40 px on phones.
- Fixed headers, only content boxes scroll; language and theme switch always in the top bar.
- Complete English translation, including server messages (`i18n`).

## Reliability

- Google errors (lock, timeout, network) are shown as understandable messages with a hint.
- Offline banner; on reconnect the data is synced.
- Drafts survive background refreshes; the view is only rebuilt on real changes.
- Writes are serialised with a script lock; the target row is verified before every write (`consistency`).
- Refused calls ("too many at once") are retried with growing, randomised delays; reads also on transient errors.
- XSS: user text never turns into markup in any view (`xss`).

## Performance

- Page about 480 KB (140 KB gzipped); budgets per request type (`budget`).
- Versioned, compressed table cache; polling answers "same" while nothing changed; start from the last state in the browser with skeletons until fresh data arrives.
- About 1,000 people can work at the same time with the default deployment (`load`; details in the README and WORKFLOW.md).
- `?perf=1` on the app URL shows duration, server time, sheet reads and size per call; every call also logs `api <route> <ms> ms` in the Apps Script executions.

## Supportability

- Version shown in the help; feedback hint pointing to the admin.
- Quality gate `npm run guard` with 14 checks, also in CI.
- Translations in one place: `src/I18n.html`.
- Migration guide: [MIGRATION.md](MIGRATION.md).
