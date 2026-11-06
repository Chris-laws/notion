# LidlFlow – manual test plan for the team

Goal: walk through every function as a team. Test in pairs or threes so that collaboration (same task, team calendar) is really covered. Note each issue briefly: what was clicked, what was expected, what happened, which browser.

The automated quality gate (`npm run guard`, see [WORKFLOW.md](WORKFLOW.md)) covers logic, permissions, security, translation, contrast and accessibility rules. This plan covers what only people can judge: flow, wording and look. Without a Vertex AI key the AI features show rule-based results and a marked example.

## 1. Sign-in and start
- [ ] Open the link; sign-in works without an extra login
- [ ] Your name is shown bottom left, the overview with "Heute dran" / "Up today" opens
- [ ] Switch light/dark and German/English

## 2. Create and edit tasks (each person)
- [ ] Quick add with Ctrl/Cmd+K, e.g. `Angebot prüfen morgen !hoch #Projekt @Name 2h`; preview and colours fit
- [ ] Open a task (side panel) and the full detail page
- [ ] Change status, priority, start, due, assignees (people manager), tags, progress
- [ ] Format the description, add and tick a sub-task
- [ ] Write a comment (the second person sees it)
- [ ] Time tracking: start/stop the timer, add time by hand while it runs
- [ ] Complete a recurring task: the next one appears
- [ ] Delete a task and undo

## 3. Views
- [ ] Table: columns, sorting, filters, grouping, paging
- [ ] Board: drag cards between columns, collapse columns
- [ ] List and Gantt: move bars, drag the length, jump to today, zoom
- [ ] Save a view and load it again (only in your own browser)

## 4. Teams and projects
- [ ] Create a team, add members with the people manager
- [ ] Create a project; project page with overview, tasks, members ("whole team" vs. selected people)
- [ ] A person outside the team does not see its tasks

## 5. Teamwork
- [ ] Person A assigns a task to person B; B sees it under "my tasks"
- [ ] A and B change different tasks at the same time; nothing is lost
- [ ] Exchange comments on a shared task

## 6. Calendar
- [ ] Week, day, month, agenda, heatmap (keys 1–5, T, arrows)
- [ ] Create an event (meeting, milestone)
- [ ] Drag a task onto a time slot in the week/day grid
- [ ] Holidays of your own country and of colleagues' countries are visible

## 7. Absence and capacity
- [ ] Enter a vacation (range, type); visible in the team calendar
- [ ] Change and delete an absence
- [ ] The team warning appears from 50 % absence (holidays count)
- [ ] A colleague's sick leave appears to others only as "away"

## 8. AI (without key: rules)
- [ ] "Split into sub-tasks" shows a marked example; sub-tasks can be taken over
- [ ] "Who has capacity?" gives plausible suggestions

## 9. Phone
- [ ] Navigation, creating a task, calendar readable; dialogs open as bottom sheets
