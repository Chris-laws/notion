# Third-party notices

## Deployed application (`src/`)

The deployed Apps Script project contains only the company's own code. It loads no third-party libraries or scripts from external hosts; the only external asset is the Inter web font. It uses these external services:

| Service | Purpose | Data sent |
|---|---|---|
| Google Apps Script, Google Sheets | runtime and data storage in the company's Google Workspace | all app data stays in the company Workspace |
| [Google Fonts](https://fonts.google.com) | the Inter font (SIL Open Font License 1.1), loaded asynchronously | the browser's request for the font files (IP address, user agent) |
| [Nager.Date](https://date.nager.at) public holiday API | public holidays per country | country code and year only |
| Google Vertex AI (optional) | AI summary, quick add, task breakdown | task titles/descriptions and names in the request; only when `VERTEX_API_KEY` is set |

## Development tools (`devDependencies`, not deployed)

Used only to test and check the code locally and in CI. Versions as installed with `npm ci` from `package-lock.json`; their transitive dependencies are checked by `npm run guard` (`license`).

| Package | Version | Licence | Note |
|---|---|---|---|
| `@eslint/js` | 9.39.5 | MIT | |
| `c8` | 10.1.3 | ISC | |
| `eslint` | 9.39.5 | MIT | |
| `eslint-plugin-html` | 8.2.1 | ISC | |
| `eslint-plugin-sonarjs` | 1.0.4 | LGPL-3.0-only | lint rules only, never distributed |
| `globals` | 15.15.0 | MIT | |
| `jsdom` | 24.1.3 | MIT | |
