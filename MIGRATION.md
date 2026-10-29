# Migration to the company Workspace

How to set LidlFlow up in the company's Google Workspace from this export. The export contains source code, tests and documentation only: no version history, no `.clasp.json`, no data, no keys.

## 1. Repository

1. Create a **new repository** in the company's code hosting and add the files of this export as the first commit (fresh history).
2. Keep the GitHub Actions workflow (`.github/workflows/guard.yml`) or port it to the company CI: it runs `npm ci` and `npm run guard` on every push and pull request.
3. Check locally (Node.js 20):
   ```bash
   npm ci
   npm run guard
   ```
   All 15 checks must be green before anything is uploaded.

## 2. Apps Script project

Everything below is done with a **company account** (ideally a dedicated technical account or one owned by the team responsible for the app; not a personal account).

1. Create a new standalone Apps Script project, e.g. on a shared drive of the team:
   ```bash
   npm install -g @google/clasp
   clasp login                                  # with the company account
   clasp create --type standalone --title "LidlFlow" --rootDir src
   ```
   or copy `.clasp.json.example` to `.clasp.json` and enter the id of a project created in the editor. `.clasp.json` stays local (it is git-ignored).
2. Upload the code: `clasp push`.
3. In the Apps Script editor run **`setup`** once and confirm the permissions. It creates a **new, empty** database spreadsheet ("LidlFlow – Database") in the drive of the account running it and stores the default script properties. The person running `setup` becomes admin.
4. Do **not** copy data from any earlier spreadsheet; the company instance starts empty. Teams, projects and tasks are created in the app.
5. Leave `seedDemoData()` alone in production. It only runs when the script property `ALLOW_DEMO_DATA` is `true` and is meant for separate test copies (its made-up people get addresses in the company domain).

## 3. Script properties

*Project settings → Script properties* (created by `setup()`; adjust):

| Property | Set to |
|---|---|
| `ALLOWED_DOMAIN` | who may sign in: one e-mail domain, a list (`lidl.com, lidl.it`) or a pattern for all country domains (`lidl.*`); empty = no check in the app (the deployment's "anyone in the organisation" still applies). `setup()` fills in the running account's domain only when the property is empty |
| `ADMIN_EMAILS` | comma-separated admin addresses of the responsible team |
| `APP_NAME` | `LidlFlow` |
| `DEFAULT_COUNTRY`, `DEFAULT_HOURS_PER_WEEK`, `ABSENCE_WARN_PERCENT` | company defaults |
| `VERTEX_API_KEY` | keep the placeholder until AI use is approved; then a Google Cloud API key (starts with `AIza`) of the company project. Sent in the `x-goog-api-key` header. It must be allowed for the API of the chosen way (see `VERTEX_API_STYLE`) |
| `VERTEX_API_STYLE` | `auto` (default): Agent Platform / Vertex AI in express mode first; when Google answers that it takes no API keys there (401), the Gemini API (`generativelanguage.googleapis.com`) is used and kept for the day. `vertex` or `gemini` fixes the way. For the Gemini API the key must allow the **Generative Language API** and it must be enabled in the project |
| `VERTEX_MODEL` | the Gemini model the key may use (default `gemini-2.5-flash`; see *Agent Platform → Models* in the Cloud console) |
| `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` | **do not set** with an API key: addresses with a project or region take no API keys (Google answers 401 "API keys are not supported"); they would need an OAuth login (scope `cloud-platform`), which the app does not request |
| `VERTEX_ENDPOINT` | optional: the full address with `{model}`, e.g. `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent` (only `*.googleapis.com` is accepted) |
| `VERTEX_KEY_IN` | `header` (default) or `query` (`?key=`) |
| `AI_ASSISTANT` | `on` (default) or `off`: the assistant panel for everybody (admins also switch it in *Einstellungen*) |
| `AI_USER_DAILY` | AI answers per person and day (default `40`); above it the assistant answers with rules |
| `AI_DAILY_CHARS` | characters sent to the model per day for everybody (default `2000000`); only counts are kept |
| `FILES_USER_DAILY`, `FILES_USER_DAILY_MB` | images a person may upload per day (default `50`, `100` MB) |
| `ALLOW_DEMO_DATA` | empty |

Keys are never put into code; the `secrets` check fails if one appears in the repository.

## 4. Deployment

**Deploy → New deployment → Web app**

- **Execute as: Me** (the company account that owns the project). The app reads and writes the database spreadsheet with this account; users do not need access to the spreadsheet.
- **Who has access: Anyone within the company domain** (the manifest sets `"access": "DOMAIN"`; the `migration` check enforces it).

Load note: with "execute as me" all users share the 30 parallel executions of that account; this covers about 1,000 people working at the same time (see WORKFLOW.md). "Execute as the user accessing the web app" lifts that limit but then every user needs access to the spreadsheet; decide this together with IT security.

New version later: `npm run guard`, `clasp push`, run `setup()` again (adds new columns, keeps data), then **Manage deployments → Edit → New version**.

## 5. Permissions requested (OAuth scopes)

| Scope | Why |
|---|---|
| `spreadsheets` | read and write the database spreadsheet |
| `script.external_request` | public holidays from Nager.Date; Vertex AI when a key is set |
| `calendar.readonly` | read Google's public holiday calendars (`en.<country>#holiday@group.v.calendar.google.com`) when Nager.Date does not answer; no personal calendars are read or written |
| `drive.file` | documents and jour fixe minutes as Markdown files in the app's own Drive folder `LidlFlow`; the app can only see files it created itself, nothing else in Drive. The app talks to the Drive REST API with its own token (`ScriptApp.getOAuthToken`, through `UrlFetchApp`), because the built-in `DriveApp` service would require access to the whole Drive |
| `userinfo.email` | identify the signed-in person (Google SSO) |

No access to Gmail, contacts or other Drive files is requested, and nothing is written to any calendar. The AI (assistant, quick report, quick add) needs `script.external_request` for the Agent Platform API; if the organisation blocks external requests for Apps Script, the app keeps working with rules and *Verbindung testen* names the reason.

**Jour fixe.** The project tab *Jour Fixe* holds the meeting series (on top, with their next meeting) and an archive of all minutes (newest first). Minutes are a form like a classic minutes sheet: date, minute taker, present and absent people, numbered topics with a responsible person, and lines of type I (information), A (action, with responsible and due date, can become a project task), B (decision) and N (note); open A lines move on to the next meeting. A meeting's minutes file is only created with the first save. Several people can write the same minutes: saving names the version it started from, and when someone saved in between, the app merges both topic by topic and line by line; only when both changed the same field does it show both versions. The last 50 versions of each minutes are kept (who, when, what changed) and can be viewed and restored. The file holds the minutes as a Markdown table plus the form data in an HTML comment at the end, so it reads well in Drive and opens unchanged in the app. The minutes are stored as `.md` files in the Drive of the deploying account: `LidlFlow/Projects/<team>/<project>/Jour Fixe/<series>/<date> <series>.md`; earlier versions in `…/<project>/.versions`. The database keeps the metadata (sheets `Docs`, `DocVersions`, `JfSeries`, `Folders`). Markdown files were chosen over Google Docs because the app writes exactly what people typed (no formatting lost on each save) and no `documents` scope is needed. Users never need access to the files: the app reads and writes them as the owner and shows them to project members only. Nothing is ever deleted for good: older versions and removed files go to the Drive trash. Deleting moves files to the Drive trash. The root folder id is the script property `DRIVE_ROOT_FOLDER_ID`; to move everything to a shared drive later, move the `LidlFlow` folder there (ids stay the same).

**Approval:** if the Workspace admin restricts third-party or internal apps (Admin console → Security → Access and data control → API controls), they must mark the Apps Script project as trusted or allow these scopes for it. **When the scopes change** (for example after an update that adds one), the deploying account must authorise once more: open the Apps Script editor, run any function (e.g. `setup`) and confirm the consent screen; users of the web app see a new consent screen on their next visit.

## 6. Data protection and security notes

- **Storage:** all data lives in the database spreadsheet in the company Workspace.
- **External calls:** Nager.Date receives only country code and year. Google's public holiday calendars are only read, never written. Vertex AI (optional) receives task texts and names for the AI functions; switch it on only after approval by data protection.
- **Images:** pictures pasted or dropped into a task description or a line of minutes are made smaller in the browser (at most about 1600 px), checked on the server (only JPEG, PNG, GIF, WebP by their first bytes, at most 3 MB; no SVG) and stored in the deploying account's Drive under `LidlFlow/Projects/<team>/<project>/Bilder` (sheet `Files` keeps id and place). They are not shared in Drive: the app hands an image only to people who may see its task or project. Deleting a task moves its images to the Drive trash. Images need the built-in Drive service (already in `appsscript.json`).
- **Which Gemini:** the Gemini API (`generativelanguage.googleapis.com`) is Google's developer interface, not the Agent Platform (Vertex AI) of the company project; its terms, data handling and region differ (no choice of an EU region). Check with data protection which of the two is approved before entering a key. In Apps Script nothing has to be added under *Services* for the AI: the calls go through `UrlFetchApp` (scope `script.external_request`).
- **Assistant:** answers from what the asking person may see only (built on the server from the same permission checks as the rest of the app; at most 60 entries per question). It never changes anything itself: proposals open the confirmation form and are created together or not at all, through the normal permission checks. Texts from tasks and minutes reach the model fenced as data, never as instructions; the model's answer is checked (citations must be entries the person sees, proposals pass the quick-add checks) and shown as plain text. Without a key, or when the limit is reached or the call fails, rules answer. Usage is kept as counts per day only, no questions or answers. *Settings → Verbindung testen* (admins) shows model, response time and Google's own error message.
- **No external scripts:** all code is inline. The Inter font comes from Google Fonts (asynchronous, with the system font as fallback); if the company does not allow Google Fonts, remove the four font lines at the top of `src/Index.html`.
- **Browser storage:** each browser keeps the last loaded state of the signed-in person (tasks and people they may see) in `localStorage` for at most 7 days to start quickly, plus view settings. It is bound to that person and replaced on the next start.
- **Health data:** a sick leave is shown as "sick" only to the person and to admins; everyone else sees "away". Absence notes are visible to the person and admins only.
- **Logs:** the Apps Script execution log contains route names and timings, no content.
- **Permissions:** every API route requires a signed-in person of `ALLOWED_DOMAIN`; rights are checked on the server (`security` check).

## 7. Roles

| Role | Who | Can |
|---|---|---|
| Admin | the person running `setup()` and everyone in `ADMIN_EMAILS` | see everything, maintain company holidays, enter absences for others, manage all teams |
| Team lead | set per team | edit the team, delete tasks of the team |
| Member | everyone of the domain | use the app; sees tasks they created, are assigned to, or that belong to their teams/projects |

## 8. Test before go-live

1. `npm run guard` green in the new repository.
2. Open the web app with two or three colleagues and walk through [TESTPLAN.md](TESTPLAN.md).
3. Check real response times with `?perf=1` on the web app URL.
4. Start with a pilot group, then share the URL with everyone.

## 9. Updates and data safety

Code and data are separate: all data lives in the database spreadsheet, the code in the Apps Script project. A code update never touches the data, and users keep working on the deployed version until a new one is released.

**Update without clasp (copy in the editor)**

1. Each release lists the changed files. Open each one in the Apps Script editor, select all, paste the new content, save. Server files are `.gs`, interface files `.html`; names must match exactly.
2. Test: **Deploy → Test deployments** opens the `/dev` URL, which always runs the newest saved code (for the editors only, on the real data).
3. If the release adds columns or tables: run `setup()` once. It only adds what is missing and keeps all rows.
4. Release: **Deploy → Manage deployments → edit (pencil) the existing deployment → Version: New version → Deploy.** Always edit the existing deployment; a new deployment gets a new URL.
5. Rollback: same dialog, choose the previous version number. Data is not affected.

With clasp the same flow starts with `clasp push --force` instead of step 1.

**Backups.** `backupDatabase()` (src/Backup.js) copies every table into a second spreadsheet, **LidlFlow – Backups** (created on the first run; id in the script property `BACKUP_SPREADSHEET_ID`), one sheet per table named `<date> <table>`, and lists each backup in its sheet `Backups`. The last 8 dates are kept. It needs no permission beyond the spreadsheets scope the app already has.

- **Weekly:** in the Apps Script editor, **Triggers → Add trigger → function `backupDatabase` → event source Time-driven → Week timer** (e.g. Sunday, 2–3 am) → Save. A trigger created in the editor needs no extra OAuth scope.
- **By hand:** admins find **Settings → Backups** with the last backup, a link to the backup spreadsheet and **Back up now**; the page reminds them to set up the trigger when the last backup is older than 8 days.
- **Restore:** in the editor run `restoreBackup('YYYY-MM-DD')`. It first backs up the current state (under today's date), then writes the tables of that date back under the write lock; the app sees the restored data on the next load. To restore single rows instead, open the backup spreadsheet and copy them over by hand.
- Before bigger updates an extra copy does not hurt (**File → Make a copy**); Google Sheets also keeps a version history (**File → Version history**).

**Protection.** `setup()` protects every table sheet so that only the owner can edit it (the web app runs as the owner, so it is not affected). Never share the spreadsheet with users: the web app checks every permission on the server, users only need the web app URL. For long-term operation move the database and backup spreadsheets into a **shared drive** of the team (the ids stay the same), and give a second person edit rights on the Apps Script project, so the data does not depend on one account.

**Transactions.** Every write runs in `Db.tx()`:

- *Isolation*: one script-wide lock, so writes happen strictly one after another (waits up to 20 s, then the request is refused and the client retries).
- *Consistency*: all rules are checked on the server before the first write.
- *Atomicity*: before each write the transaction notes how to undo it. An error anywhere in the transaction undoes all its writes in reverse order (all or nothing).
- *Recovery*: from the second write of a transaction on, the undo steps are written ahead to the `Journal` sheet and the script property `DB_JOURNAL` is set. If the script dies before it can undo (for example at the execution time limit), the next transaction replays that journal under the lock before it does anything else. The `Journal` sheet is empty whenever no transaction is in flight; do not edit it by hand.
- *Durability*: every write goes straight to the spreadsheet and is flushed before the lock is released.
