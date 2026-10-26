# LidlFlow – task management and team calendar on Google Apps Script

Task management and a team calendar for companies on Google Workspace. Sign-in with Google SSO, data in a Google Sheet, a calm interface with pages, lists, board and calendar. The interface is German and English (switch in the top bar).

For moving the app into a company Workspace, see **[MIGRATION.md](MIGRATION.md)**. For the development workflow and the quality gate, see **[WORKFLOW.md](WORKFLOW.md)**.

## Features

**Tasks**
- Tasks for yourself, one person, several people or whole teams
- Teams with a lead and members, projects inside teams
- Projects with their own member list: the whole team or a mix of people from several teams
- Views: **list**, **table** (sortable, inline editing, progress bars, paging), **board** (drag & drop, grouping by status/priority/person/project, collapsible columns), **calendar** and **Gantt** (drag bars to move, drag the right edge to change the due date, zoom week/month/quarter); saved views per page (in the browser)
- Task as side panel or full page: status, assignees, priority, start/due, project, teams, effort, tags, recurrence, description, sub-tasks, comments, progress (manual or automatic), time tracking with a timer
- Recurring tasks (daily, weekdays, weekly, monthly)
- Command palette (`Ctrl+K`) with natural-language quick add, the syntax is highlighted:
  `Angebot senden morgen @anna #website !hoch 2h` → title, due date, person, project, priority and effort are recognised
- **Overview** (start page): greeting, AI summary, key numbers, project card, "up today", week at a glance, workload, done per week
- **Project page** with overview (status distribution, quick stats, progress in detail), tasks and members
- **Calendar** with week, day (time grid with drag & drop), month, agenda and heatmap; vacations, holidays and the team warning in every view
- **People manager**: one dialog wherever people are added (search, invite by e-mail, remove with undo)

**Calendar, absences and availability**
- Team calendar with tasks, events/milestones, absences and **international public holidays**
- Holidays per person by country **and region** (e.g. All Saints' Day only for `DE-BY`)
- Sources: [Nager.Date](https://date.nager.at) (about 120 countries incl. regional holidays), fallback to Google's holiday calendar and a built-in list for DE, AT, CH, US, GB, FR, IT, ES, NL, PL; plus company holidays maintained by admins
- Country and region come from each person's **profile** (settings; without a country `DEFAULT_COUNTRY` applies)
- Holidays are fetched live and cached per country and year for 30 days (script cache + sheet `HolidayCache`)
- **Availability**: day grid per team showing who is away. If **50 % or more** of a team is away on a day, the calendar, the availability page, the overview and the absence dialog warn. Threshold: `ABSENCE_WARN_PERCENT`
- **Privacy**: a sick leave is shown as "sick" only to the person and to admins; everyone else (and the AI summary) sees "away". Notes on absences are visible to the person and admins only
- Capacity per person and week: weekly hours and workdays (part time), minus holidays and absences, compared with the estimated effort of open tasks

**Smart functions (prepared for Vertex AI)**
- Without an AI key everything runs on rules: quick-add parser, "who has capacity?", summary
- With a Vertex AI key Gemini refines quick add, writes the summary and splits tasks into sub-tasks with effort estimates
- The key stays on the server in the script properties and never reaches the browser

## Performance

- **Table cache:** every table is also kept in the script cache (large tables gzipped and split into chunks). Each table has a version token that every write renews after `flush`; a cached copy is only used while its token is current. Writes use the version-checked copy, check the target row before writing and put the new state straight back into the cache.
- **Polling:** `tasks.list` gets the last seen version; while nothing changed the server only answers `{ same: true }`. Clients poll every 120 s ± 25 % and slow down after failures.
- **Start:** the bootstrap call starts while the page loads. The last state is kept in the browser (`localStorage`, same person only, at most 7 days, under 2 MB), so the app shows at once and then refreshes; until then skeleton placeholders in the shape of the page are shown.
- **Page size:** about 480 KB (140 KB gzipped); the logo is WebP; the Inter font loads asynchronously and never holds back the first paint.
- `?perf=1` on the app URL shows duration and sheet reads per call.

## Setup

Requirements: a Google Workspace account (Google SSO only returns the e-mail for accounts of the same Workspace domain) and Node.js 20.

```bash
npm install
npm run guard                      # all quality checks, see WORKFLOW.md
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json # then put the script id in
clasp push
```

Then in the Apps Script editor (`clasp open`):

1. Run **`setup`** and confirm the permissions. It creates the database spreadsheet and stores the default settings; the person running it becomes admin.
2. **Deploy → New deployment → Web app**: execute as **Me**, access **Anyone within your domain**.

For a new version: `clasp push`, run `setup()` again (adds new columns, data stays) and publish a new version under **Manage deployments**.

### Script properties

*Project settings → Script properties*. `setup()` creates them with default values.

| Property | Meaning |
|---|---|
| `SPREADSHEET_ID` | Database spreadsheet (set by `setup()`) |
| `APP_NAME` | Name in the interface, default `LidlFlow` |
| `ALLOWED_DOMAIN` | Only this e-mail domain may sign in (`setup()` sets the domain of the person running it) |
| `ADMIN_EMAILS` | Comma-separated admin addresses |
| `DEFAULT_COUNTRY` | Country for new people, default `DE` |
| `DEFAULT_HOURS_PER_WEEK` | Weekly hours for new people, default `40` |
| `ABSENCE_WARN_PERCENT` | Team warning threshold in percent, default `50` |
| `VERTEX_API_KEY` | Placeholder `PLATZHALTER_VERTEX_AI_API_KEY`; put the company's Vertex AI key here to switch AI on |
| `VERTEX_MODEL` | Default `gemini-2.5-flash` |
| `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` | Optional: GCP project and region for a regional endpoint (e.g. `europe-west3`) |
| `ALLOW_DEMO_DATA` | Only in test copies: `true` allows `seedDemoData()`; leave empty in production |

While the placeholder key is set, the AI features fall back to rules and "split into sub-tasks" shows a clearly marked example. The key is sent in the `x-goog-api-key` header, never in the URL.

## Development

```bash
npm test          # integration suite, unit tests, English check
npm run guard     # all 14 checks (see WORKFLOW.md); `npm run guard -- --list` shows them
npm run preview   # builds dev/preview.html: the whole app with demo data in the browser, no Google account
npm run load      # load simulation (never against the live app)
npm run push      # clasp push
```

`dev/preview.html?user=anna.schmidt@firma.de` shows the app as another person.

### Structure

```
src/
  appsscript.json   manifest (web app, scopes)
  Code.js           doGet, api() router, bootstrap
  Shared.js         constants, date logic, quick-add parser, task filter (server and browser)
  Db.js             table layer over Google Sheets (lock, versioned cache, formula guard)
  Auth.js           Google SSO, permissions, configuration
  Users.js, Teams.js, Tasks.js
  Calendar.js       events, absences, capacity
  Availability.js   who is away when, team warning, privacy of absence types
  Holidays.js       international holidays with cache and fallbacks
  Ai.js             smart functions, Vertex AI
  Setup.js          setup(), seedDemoData() (test copies only)
  Index.html        page skeleton
  Styles.html       design tokens and styles (light/dark, mobile)
  App.html          state, routing, sidebar, server calls
  Components.html   menus, property editors, dialogs, people manager, command palette
  Views.html        list, board, table, calendar, availability, teams, projects, settings
  Peek.html         task detail panel
  I18n.html         English translation of the interface
dev/                tests, local preview, quality checks (not uploaded)
test/               unit tests (node:test)
```

### Permissions

- Everyone sees teams, projects and the people directory.
- A task is visible to its creator, its assignees, members of an assigned team and members of its project (or the project's team). Admins see everything.
- Teams: lead, creator and admins edit. Projects: team members create; moving a project into another team needs membership there.
- Events: the creator and admins change and delete.
- Every API route requires a signed-in person of the allowed domain.

### Limits

With Google Sheets as the database and the web app running as the deploying account, about 1,000 people can work at the same time (all share 30 parallel executions; see the load simulation in WORKFLOW.md). Larger setups need the web app to run as the visiting person, tasks split per team, or `Db.js` swapped for Firestore or Cloud SQL without changing the other files.

## Licences and brands

- **Code:** proprietary, for internal use in the company. No third-party library is shipped; only `src/` is uploaded to Apps Script. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Font:** Inter (Google Fonts, SIL Open Font License), with the operating system's font as fallback.
- **Logo and colours:** the LidlFlow logo and the Lidl colours are for internal use in the company.
- **External services:** holidays from Nager.Date (date.nager.at; only country and year are sent), AI via Google Vertex AI (company key in the script properties; task data is sent only when a key is set).
- **Development tools** (`devDependencies`, not shipped): permissive licences; the one exception is `eslint-plugin-sonarjs` (LGPL-3.0, lint only).

## Design

Colours, typography, spacing and components are described in [DESIGN.md](DESIGN.md) and implemented as CSS variables in `src/Styles.html`.
