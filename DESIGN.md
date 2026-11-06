# LidlFlow – design language

All values live as CSS variables (design tokens) in `src/Styles.html`. Change them here first, then in the tokens. Contrast of the tokens is checked on every guard run (`contrast`, WCAG 2.2).

## Attitude

A calm, light interface: soft canvas, white cards with generous rounding, few lines, a clear hierarchy. Colour always means something; it is never decoration.

- **Blue** (`--accent` `#012e90`) is the accent: selection, links, primary action, progress, events.
- **Yellow** (`--yellow` `#fcc702`) only as a small marker: logo, active navigation bar, today.
- **Red** (`--danger` `#dc1a1e`) means action needed: overdue, urgent, team below the staffing threshold, errors.
- Everything else is ink and cool grey on a light ground.

## Semantic colours

| Meaning | Token(s) | Used for |
|---|---|---|
| Done / success | `--success`, `--success-soft` | done status, "all teams well staffed", progress of finished work |
| Attention / due soon | `--warning`, `--warning-soft`, `--warning-strong` | due within days, public holidays, warning toasts, medium priority |
| Error / overdue | `--danger`, `--danger-soft` | overdue, urgent priority, understaffed days, errors |
| Info / in progress | `--accent`, `--accent-soft`, `--st-doing` | in progress, events, links |
| AI | `--ai`, `--ai-soft`, `--ai-text` | everything the AI produces |
| Neutral | `--text-3`, `--bg-hover`, `--st-backlog` | backlog, absences, low priority |

Status (`--st-*`): backlog grey (dashed circle), open slate (empty circle), in progress blue (half circle), review purple, done green (check). Priority (`--prio-*`): urgent red, high orange, medium amber, low grey. Dark mode uses the same tokens with their own values.

Text on light surfaces uses `--danger-text`, `--warning-text`, `--success-text` and `--prio-high-text`: the same tones a shade darker so small text reaches 4.5:1. Dots, bars, icons and fills keep the brand tones.

Projects show their own colour (`--c-*`, 12 colours: `Shared.PROJECT_PALETTE`) on tiles, pills and banners. Within a team every project has a different colour: the picker crosses out colours of the team's other projects, new projects get the first free one, the server refuses duplicates, and older duplicates are re-coloured on the next start (the oldest project keeps its colour). Only when all 12 are used do colours repeat. The team appears as a small dot in the tile's corner. Letters on light colours (yellow, orange, teal, grey) are dark, on the others white.

## Typography

Inter (Google Fonts, loaded asynchronously), falling back to the operating system's UI font (Segoe UI, San Francisco, Roboto …). Hierarchy through size and weight, no all-caps labels except small section headings.

## Shape

Cards with 14–20 px radius and a soft shadow, dialogs and the command palette 20 px. Separation by surface and spacing rather than hard lines. Tabs as segmented controls.

## Layout

- Sidebar: navigation (overview, my tasks, all tasks, calendar, availability), then teams with their projects; the active page is soft blue with a yellow bar.
- Overview: greeting, AI summary, key numbers, project card, "up today", week at a glance, workload, done per week, on a 12-column grid.
- Top bar: central search (opens the palette), help, theme and language switch.
- Task pages: filter bar and view switch (list, table, board, calendar, Gantt) plus saved views.
- Task detail: side panel or full page with property cards, description, sub-tasks, time tracking, AI helpers and comments.
- Project page: colour banner with tabs overview, tasks, members.
- Calendar: header card with title, team scope, layers and view switch (week, day, month, agenda, heatmap).
- Loading: skeleton placeholders in the shape of the page; animations respect `prefers-reduced-motion`.
- Responsive breakpoints at 1180 px, 900 px and 600 px; dialogs become bottom sheets on phones.
