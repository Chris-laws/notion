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
| `ALLOWED_DOMAIN` | the company's e-mail domain (set by `setup()` from the running account; check it) |
| `ADMIN_EMAILS` | comma-separated admin addresses of the responsible team |
| `APP_NAME` | `LidlFlow` |
| `DEFAULT_COUNTRY`, `DEFAULT_HOURS_PER_WEEK`, `ABSENCE_WARN_PERCENT` | company defaults |
| `VERTEX_API_KEY` | keep the placeholder until AI use is approved; then create a **new** key in the company's Google Cloud project and enter it here |
| `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` | company GCP project and an EU region (e.g. `europe-west3`) |
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
| `userinfo.email` | identify the signed-in person (Google SSO) |

No access to Gmail, Drive files or contacts is requested, and nothing is written to any calendar.

**Approval:** if the Workspace admin restricts third-party or internal apps (Admin console → Security → Access and data control → API controls), they must mark the Apps Script project as trusted or allow these scopes for it. **When the scopes change** (for example after an update that adds one), the deploying account must authorise once more: open the Apps Script editor, run any function (e.g. `setup`) and confirm the consent screen; users of the web app see a new consent screen on their next visit.

## 6. Data protection and security notes

- **Storage:** all data lives in the database spreadsheet in the company Workspace.
- **External calls:** Nager.Date receives only country code and year. Google's public holiday calendars are only read, never written. Vertex AI (optional) receives task texts and names for the AI functions; switch it on only after approval by data protection.
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

**Backups.** Before bigger updates make a copy of the database spreadsheet (**File → Make a copy**). Google Sheets also keeps a version history (**File → Version history**). Never share the spreadsheet with users: the web app runs as the deploying account and checks every permission on the server; users only need the web app URL.

**Transactions.** Every write runs in `Db.tx()`:

- *Isolation*: one script-wide lock, so writes happen strictly one after another (waits up to 20 s, then the request is refused and the client retries).
- *Consistency*: all rules are checked on the server before the first write.
- *Atomicity*: before each write the transaction notes how to undo it. An error anywhere in the transaction undoes all its writes in reverse order (all or nothing).
- *Recovery*: from the second write of a transaction on, the undo steps are written ahead to the `Journal` sheet and the script property `DB_JOURNAL` is set. If the script dies before it can undo (for example at the execution time limit), the next transaction replays that journal under the lock before it does anything else. The `Journal` sheet is empty whenever no transaction is in flight; do not edit it by hand.
- *Durability*: every write goes straight to the spreadsheet and is flushed before the lock is released.
