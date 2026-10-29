/**
 * "Smart" features. Every feature works without AI using rules; when a
 * Vertex AI key is configured (Script Property VERTEX_API_KEY) Gemini on
 * Vertex AI takes over or enriches the result.
 *
 * Configure in Apps Script: Project Settings -> Script Properties
 *   VERTEX_API_KEY     API key (Gemini Enterprise Agent Platform, formerly Vertex AI; express mode or a
 *                      standard Google Cloud key restricted to the Agent Platform API). Placeholder until set.
 *   VERTEX_MODEL       default gemini-2.5-flash (any model the key may use)
 *   VERTEX_PROJECT_ID  optional: GCP project to call a regional endpoint
 *   VERTEX_LOCATION    optional, default "global"
 *   VERTEX_ENDPOINT    optional: the whole address with {model}, e.g.
 *                      https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
 *   VERTEX_KEY_IN      "header" (x-goog-api-key, default) or "query" (?key=)
 * The key never leaves the server; the browser only learns whether AI is on.
 */
const Ai = {
  LIMIT: 'Tageslimit für KI erreicht.',
  enabled() {
    const key = Config.get('VERTEX_API_KEY');
    return !!key && key.indexOf('PLATZHALTER') !== 0;
  },

  status() {
    return {
      enabled: Ai.enabled(),
      model: Config.get('VERTEX_MODEL'),
      assistant: Assistant.on(),
      callsToday: Assistant.callsToday(),
      hint: Ai.enabled()
        ? 'Vertex AI ist verbunden.'
        : 'Regelbasierter Modus. Für KI-Funktionen in den Skripteigenschaften VERTEX_API_KEY setzen.',
    };
  },

  /** Admins: one short call to Gemini; the answer, or what went wrong (no key, Google's reason, external calls blocked). */
  test() {
    if (!Auth.isAdmin(Auth.currentUser())) throw new Error('Keine Berechtigung.');
    const model = Config.get('VERTEX_MODEL');
    if (!Ai.enabled()) return { ok: false, model: model, error: 'Kein Schlüssel hinterlegt: in den Skripteigenschaften VERTEX_API_KEY setzen.' };
    const start = Date.now();
    try {
      const answer = String(Ai.generate_('Antworte nur mit dem Wort OK.', false)).trim().slice(0, 200);
      return { ok: true, model: model, ms: Date.now() - start, answer: answer, url: Ai.url_().replace(/key=[^&]+/, 'key=…') };
    } catch (e) {
      return { ok: false, model: model, ms: Date.now() - start, error: String(e.message || e).slice(0, 500), url: Ai.url_().replace(/key=[^&]+/, 'key=…') };
    }
  },

  /** Natural-language quick add. Client parses locally; this refines with Gemini. */
  parse(p) {
    const me = Auth.currentUser();
    const ctx = Ai.parseContext_(me);
    const base = Shared.parse(p.text, ctx);
    if (!Ai.enabled()) return Object.assign(base, { source: 'rules' });
    try {
      const res = Ai.generate_([
        'Extrahiere aus der Eingabe eine Aufgabe für ein Task-Management-Tool.',
        'Heute ist ' + ctx.today + ' (' + ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][Shared.weekday(ctx.today)] + ').',
        'Personen: ' + JSON.stringify(ctx.users),
        'Teams: ' + JSON.stringify(ctx.teams),
        'Projekte: ' + JSON.stringify(ctx.projects),
        'Antworte als JSON: {"title":string,"dueDate":"yyyy-MM-dd"|"","startDate":"yyyy-MM-dd"|"",' +
          '"assignees":[email],"teams":[teamId],"projectId":string,"tags":[string],' +
          '"priority":"urgent"|"high"|"medium"|"low"|"","estimate":Stunden als Zahl,' +
          '"recurrence":"daily"|"weekdays"|"weekly"|"monthly"|""}',
        'Ein Regel-Parser hat bereits erkannt: ' + JSON.stringify(base),
        'Eingabe: ' + p.text,
      ].join('\n'), true);
      return Object.assign(base, Ai.validateParsed_(res, ctx), { source: 'ai' });
    } catch (e) {
      return Object.assign(base, { source: 'rules', warning: e.message });
    }
  },

  /**
   * Assistant: turns free text ("Anna morgen Angebot prüfen 2h, ich bin Mo–Mi im Urlaub") into
   * previews of tasks, events and absences. Nothing is saved here; the client shows the cards
   * and creates what the user keeps. Without a key a rule-based dummy suggests one task per sentence.
   */
  assist(p) {
    const me = Auth.currentUser();
    const ctx = Ai.parseContext_(me);
    const text = String((p && p.text) || '').slice(0, 4000);
    if (!text.trim()) throw new Error('Bitte beschreibe, was angelegt werden soll.');
    if (!Ai.enabled()) return { source: 'rules', items: Ai.assistRules_(text, ctx) };
    try {
      const res = Ai.generate_([
        'Du bist der Assistent eines Team-Task-Managers. Zerlege die Eingabe in einzelne Einträge zum Anlegen.',
        'Heute ist ' + ctx.today + ' (' + ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][Shared.weekday(ctx.today)] + '). Ich bin ' + ctx.me + '.',
        'Personen: ' + JSON.stringify(ctx.users),
        'Teams: ' + JSON.stringify(ctx.teams),
        'Projekte: ' + JSON.stringify(ctx.projects),
        'Antworte als JSON: {"items":[' +
          '{"type":"task","title":string,"dueDate":"yyyy-MM-dd"|"","assignees":[email],"projectId":string,"priority":"urgent"|"high"|"medium"|"low"|"","estimate":Stunden,"recurrence":"daily"|"weekdays"|"weekly"|"monthly"|""}' +
          ' | {"type":"event","title":string,"eventType":"meeting"|"milestone"|"deadline"|"offsite","startDate":"yyyy-MM-dd","endDate":"yyyy-MM-dd","teamId":string}' +
          ' | {"type":"absence","absenceType":"vacation"|"sick"|"training"|"other","startDate":"yyyy-MM-dd","endDate":"yyyy-MM-dd","email":email}]}',
        'Nur Personen, Teams und Projekte aus den Listen verwenden. Keine Einträge erfinden, die nicht in der Eingabe stehen.',
        'Eingabe: ' + text,
      ].join('\n'), true);
      const items = Ai.validateAssist_(res, ctx);
      return items.length ? { source: 'ai', items: items } : { source: 'rules', items: Ai.assistRules_(text, ctx) };
    } catch (e) {
      return { source: 'rules', warning: e.message, items: Ai.assistRules_(text, ctx) };
    }
  },

  /** Dummy without AI: one entry per line or sentence, using the quick-add parser. */
  assistRules_(text, ctx) {
    return text.split(/\n|;|(?:\.\s+)|\s+und dann\s+/i).map(s => s.trim()).filter(s => s.length > 2).slice(0, 15).map(s => {
      const parsed = Shared.parse(s, ctx);
      if (/\b(urlaub|abwesend|krank|fortbildung)\b/i.test(s)) {
        const start = parsed.startDate || parsed.dueDate || ctx.today;
        return { type: 'absence', absenceType: /krank/i.test(s) ? 'sick' : /fortbildung/i.test(s) ? 'training' : 'vacation',
          startDate: start, endDate: parsed.dueDate && parsed.dueDate >= start ? parsed.dueDate : start, email: ctx.me };
      }
      return Object.assign({ type: 'task' }, Ai.validateParsed_(parsed, ctx), { title: parsed.title || s.slice(0, 200) });
    });
  },

  validateAssist_(r, ctx) {
    const list = r && Array.isArray(r.items) ? r.items.slice(0, 20) : [];
    return list.map(it => {
      if (!it || typeof it !== 'object') return null;
      if (it.type === 'event') {
        if (!it.title || !Shared.isDate(it.startDate)) return null;
        return { type: 'event', title: String(it.title).slice(0, 200), startDate: it.startDate,
          endDate: Shared.isDate(it.endDate) && it.endDate >= it.startDate ? it.endDate : it.startDate,
          eventType: Shared.EVENT_TYPES.some(x => x.key === it.eventType) ? it.eventType : 'meeting',
          teamId: ctx.teams.some(t => t.id === it.teamId) ? it.teamId : '' };
      }
      if (it.type === 'absence') {
        if (!Shared.isDate(it.startDate)) return null;
        return { type: 'absence', startDate: it.startDate,
          endDate: Shared.isDate(it.endDate) && it.endDate >= it.startDate ? it.endDate : it.startDate,
          absenceType: Shared.ABSENCE_TYPES.some(x => x.key === it.absenceType) ? it.absenceType : 'vacation',
          email: ctx.users.some(u => u.email === it.email) ? it.email : ctx.me };
      }
      const task = Ai.validateParsed_(it, ctx);
      return task.title ? Object.assign({ type: 'task' }, task) : null;
    }).filter(Boolean);
  },

  parseContext_(me) {
    const ctx = Access.context(me);
    return {
      today: Util.today(),
      me: me.email,
      users: Users.list().map(u => ({ email: u.email, name: u.name })),
      // only teams and projects the person belongs to: the model gets no others, proposals cannot point elsewhere
      teams: Db.all('Teams').filter(t => ctx.admin || ctx.teamIds[t.id]).map(t => ({ id: t.id, name: t.name })),
      projects: Db.all('Projects').filter(x => (ctx.admin || ctx.projectIds[x.id]) && Access.canManageProject(x, ctx)).map(x => ({ id: x.id, name: x.name })),
    };
  },

  validateParsed_(r, ctx) {
    const out = {};
    if (!r || typeof r !== 'object') return out;
    if (r.title) out.title = String(r.title).slice(0, 300);
    ['dueDate', 'startDate'].forEach(k => { if (Shared.isDate(r[k])) out[k] = r[k]; });
    if (Array.isArray(r.assignees)) out.assignees = r.assignees.filter(e => ctx.users.some(u => u.email === e));
    if (Array.isArray(r.teams)) out.teams = r.teams.filter(id => ctx.teams.some(t => t.id === id));
    if (r.projectId && ctx.projects.some(x => x.id === r.projectId)) out.projectId = r.projectId;
    if (Array.isArray(r.tags)) out.tags = r.tags.map(String).slice(0, 10);
    if (Shared.PRIORITIES.some(x => x.key === r.priority)) out.priority = r.priority;
    if (Number(r.estimate) > 0) out.estimate = Number(r.estimate);
    if (Shared.RECURRENCES.some(x => x.key === r.recurrence)) out.recurrence = r.recurrence;
    return out;
  },

  /**
   * Ranks possible assignees by free capacity in the week the task is due.
   * People who are absent or on holiday on the due date are pushed down.
   */
  suggestAssignee(p) {
    const me = Auth.currentUser();
    const L = (de, e) => (p && p.lang === 'en' ? e : de);
    const task = p.id ? Db.get('Tasks', p.id) : p;
    if (!task || (p.id && !Access.canSeeTask(task, Access.context(me)))) throw new Error('Aufgabe nicht gefunden.');
    let emails = [];
    const project = task.projectId && Db.get('Projects', task.projectId);
    if (project && project.members && project.members.length) emails = project.members.slice();
    const teamIds = (task.teams || []).concat(project ? [project.teamId] : []);
    teamIds.forEach(id => {
      const t = Db.get('Teams', id);
      if (t) emails = emails.concat(Teams.people_(t));
    });
    let users = Users.list();
    if (emails.length) users = users.filter(u => emails.indexOf(u.email) >= 0);
    const due = Shared.isDate(task.dueDate) ? task.dueDate : Util.today();
    const week = Shared.mondayOf(due < Util.today() ? Util.today() : due);
    const cap = Capacity.compute_(users, week, 1);
    const ranked = cap.members.map(m => {
      const w = m.weeks[0];
      const free = Math.round((w.available - w.planned) * 10) / 10;
      const reasons = [L(w.planned + ' von ' + w.available + ' h in KW ' + Shared.isoWeek(week) + ' verplant',
        w.planned + ' of ' + w.available + ' h planned in week ' + Shared.isoWeek(week))];
      w.holidays.forEach(h => reasons.push(L('Feiertag ', 'Holiday: ') + Holidays.label(h, p && p.lang)));
      if (w.absentDays) reasons.push(L(w.absentDays + ' Tag(e) abwesend', w.absentDays + ' day(s) away'));
      const blocked = Db.all('Absences').some(a => a.email === m.email && a.startDate <= due && a.endDate >= due) ||
        w.holidays.some(h => h.date === due);
      if (blocked) reasons.push(L('am Fälligkeitstag nicht da', 'away on the due date'));
      return { email: m.email, name: m.name, free: free, utilization: w.utilization, blocked: blocked, reasons: reasons };
    }).sort((a, b) => (a.blocked - b.blocked) || (b.free - a.free));
    return { week: week, candidates: ranked.slice(0, 6), source: 'rules', me: me.email };
  },

  /** Splits a task into sub-tasks. Needs Vertex AI. */
  breakdown(p) {
    const me = Auth.currentUser();
    const t = Db.get('Tasks', p.id);
    if (!t || !Access.canSeeTask(t, Access.context(me))) throw new Error('Aufgabe nicht gefunden.');
    const en = !!(p && p.lang === 'en');
    if (!Ai.enabled()) return Ai.dummyBreakdown_(t, en);
    const res = Ai.generate_([
      'Zerlege die folgende Aufgabe in 3 bis 7 konkrete, umsetzbare Teilaufgaben ' + (en ? 'auf Englisch (Titel in English).' : 'auf Deutsch.'),
      'Schätze für jede Teilaufgabe den Aufwand in Stunden.',
      'Antworte als JSON: {"subtasks":[{"title":string,"estimate":number}]}',
      'Titel: ' + t.title,
      'Beschreibung: ' + (t.description || '–'),
    ].join('\n'), true);
    const subtasks = ((res && res.subtasks) || []).slice(0, 10).map(s => ({
      title: String(s.title || '').slice(0, 200), estimate: Math.max(0, Number(s.estimate) || 0),
    })).filter(s => s.title);
    return { configured: true, subtasks: subtasks };
  },

  /** Without a key: a fixed, clearly marked example split so the flow can be tried end to end. */
  dummyBreakdown_(t, en) {
    const total = Number(t.estimate) || 4;
    const part = share => Math.max(0.25, Math.round(total * share * 4) / 4);
    const L = (de, e) => (en ? e : de);
    return {
      configured: false, dummy: true,
      hint: L('Beispielvorschlag ohne KI (Platzhalter-Schlüssel). Mit hinterlegtem VERTEX_API_KEY schlägt Gemini passende Teilaufgaben vor.',
        'Example split without AI (placeholder key). With a VERTEX_API_KEY set, Gemini suggests fitting sub-tasks.'),
      subtasks: [
        { title: L('Ziel und Anforderungen klären: ', 'Clarify goal and requirements: ') + t.title, estimate: part(0.15) },
        { title: L('Umsetzung vorbereiten', 'Prepare the work'), estimate: part(0.25) },
        { title: L('Umsetzen', 'Do the work'), estimate: part(0.4) },
        { title: L('Prüfen und Feedback einholen', 'Review and get feedback'), estimate: part(0.15) },
        { title: L('Abschließen und dokumentieren', 'Wrap up and document'), estimate: part(0.05) },
      ].map(x => ({ title: x.title.slice(0, 200), estimate: x.estimate })),
    };
  },

  /** Short personal briefing for the home page. */
  /**
   * Quick report for a day, week or month: key numbers, a few bullets and actions that jump to the
   * right view. Gemini words the summary when a key is set; the numbers always come from the data.
   * Cached for 5 minutes per person, range and language so the dashboard opens fast.
   */
  report(p) {
    const me = Auth.currentUser();
    const range = ['day', 'week', 'month'].indexOf(p && p.range) >= 0 ? p.range : 'week';
    const en = !!(p && p.lang === 'en');
    const cacheKey = 'rep:' + Util.today() + ':' + me.email + ':' + range + ':' + (en ? 'en' : 'de');
    const cache = CacheService.getScriptCache();
    if (!(p && p.fresh)) {
      const hit = cache.get(cacheKey);
      if (hit) return JSON.parse(hit);
    }
    const ctx = Access.context(me);
    const today = Util.today();
    const from = range === 'day' ? today : range === 'week' ? Shared.mondayOf(today) : today.slice(0, 8) + '01';
    const to = range === 'day' ? today : range === 'week' ? Shared.addDays(from, 6) : Shared.endOfMonth(from);
    const visible = Db.all('Tasks').filter(t => Access.canSeeTask(t, ctx));
    const mineAll = visible.filter(t => (t.assignees || []).indexOf(me.email) >= 0);
    const open = mineAll.filter(t => t.status !== 'done');
    const inRange = d => d && d >= from && d <= to;
    const done = mineAll.filter(t => t.status === 'done' && inRange(String(t.completedAt || '').slice(0, 10)));
    const created = mineAll.filter(t => inRange(String(t.createdAt || '').slice(0, 10)));
    const overdue = open.filter(t => t.dueDate && t.dueDate < today);
    const due = open.filter(t => inRange(t.dueDate) && t.dueDate >= today);
    const noEstimate = open.filter(t => (inRange(t.dueDate) || (t.dueDate && t.dueDate < today)) && !Number(t.estimate));
    const weeks = Math.max(1, Math.ceil((Shared.diffDays(Shared.mondayOf(from), to) + 1) / 7));
    const cap = Capacity.compute_([me], Shared.mondayOf(from), weeks).members[0].weeks;
    const planned = cap.reduce((s, w) => s + w.planned, 0), available = cap.reduce((s, w) => s + w.available, 0);
    const utilization = available ? Math.round(planned / available * 100) : 0;
    const teamIds = Object.keys(ctx.teamIds);
    const warnings = Availability.warnings(from > today ? from : today, to < today ? today : to, teamIds, { email: me.email, admin: false })
      .map(w => ({ teamId: w.teamId, teamName: w.teamName, date: w.date, absent: w.absent, total: w.total }));
    const people = {};
    teamIds.forEach(id => Calendar.people_(id).forEach(u => { people[u.email] = u; }));
    people[me.email] = me;
    const absences = Db.all('Absences').filter(a => people[a.email] && a.startDate <= to && a.endDate >= from)
      .map(a => ({ name: people[a.email].name, from: a.startDate, to: a.endDate, type: Availability.visibleType(a.type, a.email, { email: me.email, admin: false }) }));
    const holidays = Holidays.inRange(Object.keys(people).map(e => people[e].country), from, to)
      .filter(h => Object.keys(people).some(e => Holidays.appliesTo(h, people[e])))
      .map(h => ({ date: h.date, name: Holidays.label(h, en ? 'en' : 'de'), country: h.country }));
    const kpis = { done: done.length, created: created.length, overdue: overdue.length, due: due.length, utilization: utilization };
    const news = Ai.news_(me, ctx, visible, teamIds, en);
    const L = (de, e) => (en ? e : de);
    const bullets = [];
    const actions = [];
    if (overdue.length) {
      bullets.push(L(overdue.length + ' überfällige Aufgabe(n), älteste seit ' + overdue.map(t => t.dueDate).sort()[0] + '.',
        overdue.length + ' overdue task(s), oldest since ' + overdue.map(t => t.dueDate).sort()[0] + '.'));
      actions.push({ label: L('Überfällige neu planen', 'Re-plan overdue tasks'), view: 'home', quick: 'overdue' });
    }
    if (due.length) bullets.push(L(due.length + ' Aufgabe(n) im Zeitraum noch fällig.', due.length + ' task(s) still due in this period.'));
    if (done.length) bullets.push(L(done.length + ' erledigt, ' + created.length + ' neu angelegt.', done.length + ' done, ' + created.length + ' created.'));
    if (available) {
      bullets.push(L('Auslastung ' + utilization + ' % (' + Math.round(planned * 10) / 10 + ' von ' + Math.round(available * 10) / 10 + ' h).',
        'Workload ' + utilization + ' % (' + Math.round(planned * 10) / 10 + ' of ' + Math.round(available * 10) / 10 + ' h).'));
      if (utilization > 100) actions.push({ label: L('Arbeit verteilen', 'Spread the work'), view: 'capacity' });
    }
    if (noEstimate.length) {
      bullets.push(L(noEstimate.length + ' Aufgabe(n) ohne Aufwand – die Auslastung ist dadurch zu niedrig.', noEstimate.length + ' task(s) without an estimate – workload looks lower than it is.'));
      actions.push({ label: L('Aufwand eintragen', 'Add estimates'), view: 'home', quick: 'open' });
    }
    if (warnings.length) {
      const w = warnings[0];
      bullets.push(L('Achtung: ' + w.date + ' sind in ' + w.teamName + ' ' + w.absent + ' von ' + w.total + ' abwesend.',
        'Heads up: on ' + w.date + ', ' + w.absent + ' of ' + w.total + ' in ' + w.teamName + ' are away.'));
      actions.push({ label: L('Verfügbarkeit prüfen', 'Check availability'), view: 'capacity' });
    }
    if (holidays.length) bullets.push(L('Feiertage: ', 'Holidays: ') + holidays.slice(0, 3).map(h => h.name + ' (' + h.country + ', ' + h.date + ')').join(', ') + '.');
    if (absences.length) bullets.push(L('Abwesend: ', 'Away: ') + absences.slice(0, 4).map(a => a.name + ' ' + a.from + (a.to !== a.from ? '–' + a.to : '')).join(', ') + '.');
    if (due.length || overdue.length) actions.push({ label: L('Im Kalender planen', 'Plan in the calendar'), view: 'calendar' });

    const label = L({ day: 'heute', week: 'diese Woche', month: 'diesen Monat' }[range], { day: 'today', week: 'this week', month: 'this month' }[range]);
    // The report is about the team, projects and changes; tasks have their own card ("Heute im Fokus").
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = d => (en ? MON[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8)) : Number(d.slice(8)) + '.' + Number(d.slice(5, 7)) + '.');
    const first = n => n.split(' ')[0];
    const projects = Db.all('Projects').filter(x => ctx.teamIds[x.teamId] && x.status !== 'done' && Shared.isDate(x.endDate) && x.endDate >= today && x.endDate <= Shared.addDays(to, 7))
      .map(x => {
        const ts = visible.filter(t => t.projectId === x.id && !t.parentId);
        return { name: x.name, end: x.endDate, done: ts.filter(t => t.status === 'done').length, total: ts.length };
      }).sort((a, b) => a.end.localeCompare(b.end));
    const team = {
      away: absences.filter(a => a.name !== me.name).map(a => first(a.name) + ' ' + day(a.from) + (a.to !== a.from ? '–' + day(a.to) : '')),
      holidays: holidays.slice(0, 3).map(h => h.name + ' (' + h.country + ', ' + day(h.date) + ')'),
      warnings: warnings.slice(0, 3).map(w => w.teamName + ' ' + day(w.date) + ': ' + w.absent + '/' + w.total),
      projects: projects.slice(0, 3).map(x => x.name + L(' endet ', ' ends ') + day(x.end) + ' (' + x.done + '/' + x.total + ')'),
      utilization: available ? utilization : null,
    };
    // Everything the person can see goes in; the summary picks what matters (importance, urgency, news).
    // Tasks due today are already on the focus card, so they are only named when they are really at risk.
    const age = d => Shared.diffDays(d, today);
    const risky = overdue.filter(t => age(t.dueDate) >= 3 || t.priority === 'urgent')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3)
      .map(t => ({ id: t.id, title: t.title, overdueDays: age(t.dueDate), priority: t.priority }));
    const projectsById = {};
    Db.all('Projects').forEach(x => { projectsById[x.id] = x; });
    const jf = Ai.jfWeek_(ctx, from, to);
    const context = {
      jourFixe: jf,
      period: label, today: today,
      tasks: { open: open.length, overdue: overdue.length, dueInPeriod: due.length, doneInPeriod: done.length, withoutEstimate: noEstimate.length, risky: risky },
      projects: projects.slice(0, 5).map(x => ({ name: x.name, ends: x.end, done: x.done, total: x.total })),
      team: team,
      news: news.items.map(n => n.text),
    };
    const VALID = ['home', 'calendar', 'capacity', 'all'];
    const cleanPoints = list => (Array.isArray(list) ? list : []).slice(0, 4).map(p => {
      const link = String((p && p.link) || '');
      const task = /^task:/.test(link) && visible.some(t => t.id === link.slice(5)) ? link.slice(5) : '';
      return { text: String((p && p.text) || '').slice(0, 200), view: VALID.indexOf(link) >= 0 ? link : '', taskId: task };
    }).filter(p => p.text);
    let text = '', points = [], source = 'rules';
    if (Ai.enabled()) {
      try {
        const res = Ai.generate_([
          L('Du bist der Assistent eines Team-Task-Managers. Lies den gesamten Kontext von ' + me.name + ' für ' + label +
            ' und entscheide selbst, was wirklich wichtig ist (Wichtigkeit, Dringlichkeit, Neuigkeit).',
          'You are the assistant of a team task manager. Read all of ' + me.name + '’s context for ' + label +
            ' and decide what really matters (importance, urgency, novelty).'),
          L('Schreibe ein Fazit in 1–2 Sätzen (duzen) und höchstens 4 knappe Punkte. Einzelne Aufgaben nur nennen, wenn sie riskant sind (lange überfällig oder dringend) – die heutige Aufgabenliste sieht die Person schon woanders.',
            'Write a 1–2 sentence conclusion (informal) and at most 4 short points. Name single tasks only when they are at risk (long overdue or urgent) – today’s task list is shown elsewhere.'),
          L('Links: "home", "calendar", "capacity", "all" oder "task:<id>" aus risky.', 'Links: "home", "calendar", "capacity", "all" or "task:<id>" from risky.'),
          'Kontext: ' + JSON.stringify(context),
          'Antworte nur als JSON: {"text": string, "points": [{"text": string, "link": string}]}',
        ].join('\n'), true);
        if (res && res.text) { text = String(res.text).slice(0, 500); points = cleanPoints(res.points); source = 'ai'; }
      } catch (e) { /* rules below */ }
    }
    if (!text) {
      const parts = [];
      if (team.warnings.length) parts.push(L('im Team wird es eng (', 'the team gets thin (') + team.warnings[0] + ')');
      if (risky.length) parts.push(risky.length + L(' Aufgabe(n) brauchen dringend Aufmerksamkeit', ' task(s) need attention urgently'));
      if (team.away.length) parts.push(team.away.length + L(' Person(en) im Team abwesend', ' teammate(s) away'));
      if (team.projects.length) parts.push(L('Projekt ', 'project ') + team.projects[0]);
      text = parts.length ? L('Wichtig ' + label + ': ', 'Important ' + label + ': ') + parts.join(', ') + '.'
        : L('Für ' + label + ' gibt es nichts Kritisches – Team vollständig, keine Engpässe.', 'Nothing critical ' + label + ' – team complete, no bottlenecks.');
      risky.slice(0, 2).forEach(t => points.push({ text: t.title + L(' – seit ' + t.overdueDays + ' Tagen überfällig', ' – overdue for ' + t.overdueDays + ' days'), taskId: t.id }));
      if (jf.length) points.push(Ai.jfPoint_(jf, day, en));
      if (team.away.length) points.push({ text: L('Abwesend: ', 'Away: ') + team.away.slice(0, 3).join(', '), view: 'capacity' });
      if (team.holidays.length) points.push({ text: L('Feiertag: ', 'Holiday: ') + team.holidays[0], view: 'calendar' });
      if (team.utilization !== null && team.utilization > 100) points.push({ text: L('Deine Auslastung liegt bei ', 'Your workload is ') + team.utilization + ' %', view: 'capacity' });
      else if (team.projects.length > 1) points.push({ text: L('Projekt ', 'Project ') + team.projects[1], view: 'all' });
      points = points.slice(0, 4);
    }
    const quietActions = [];
    if (warnings.length || absences.length) quietActions.push({ label: L('Verfügbarkeit ansehen', 'View availability'), view: 'capacity' });
    else if (utilization > 100) quietActions.push({ label: L('Arbeit verteilen', 'Spread the work'), view: 'capacity' });
    const out = { range: range, from: from, to: to, kpis: kpis, bullets: bullets.slice(0, 5), actions: quietActions, points: points,
      news: news.items, since: news.since, warnings: warnings.slice(0, 5), jf: jf, text: text, source: source, at: new Date().toISOString() };
    cache.put(cacheKey, JSON.stringify(out), 21600);
    return out;
  },

  /**
   * What changed since the person's last visit: new tasks for them from others, comments from others
   * on their tasks, new absences and projects in their teams, holidays in the next 7 days.
   * "Last visit" is kept per person in the script properties; a visit lasts until 30 minutes of quiet,
   * so reloading the dashboard keeps showing the same news.
   */
  news_(me, ctx, visible, teamIds, en) {
    const L = (de, e) => (en ? e : de);
    const props = PropertiesService.getScriptProperties();
    const keyCur = 'seen_cur_' + me.email, keyPrev = 'seen_prev_' + me.email;
    const now = new Date().toISOString();
    const cur = props.getProperty(keyCur);
    let prev = props.getProperty(keyPrev);
    if (!cur || Date.now() - new Date(cur).getTime() > 30 * 60 * 1000) {
      prev = cur || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      props.setProperty(keyPrev, prev);
      props.setProperty(keyCur, now);
    } else {
      props.setProperty(keyCur, now);
    }
    const since = prev || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const users = {};
    Users.list().forEach(u => { users[u.email] = u; });
    const name = e => (users[e] ? users[e].name.split(' ')[0] : e);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = d => (en ? MON[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8)) : Number(d.slice(8)) + '.' + Number(d.slice(5, 7)) + '.');
    const items = [];
    // tasks are on the focus card; here only a count of what others gave you
    const given = visible.filter(t => (t.assignees || []).indexOf(me.email) >= 0 && t.createdBy !== me.email && String(t.createdAt) > since);
    if (given.length) {
      const who = given.map(t => name(t.createdBy)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2).join(L(' und ', ' and '));
      items.push({ kind: 'task', view: 'home', text: given.length + L(' neue Aufgabe(n) an dich von ', ' new task(s) for you from ') + who });
    }
    const mine = {};
    visible.forEach(t => { if ((t.assignees || []).indexOf(me.email) >= 0 || t.createdBy === me.email) mine[t.id] = t; });
    Db.all('Comments').filter(c => mine[c.taskId] && c.author !== me.email && String(c.createdAt) > since).slice(-3)
      .forEach(c => items.push({ kind: 'comment', taskId: c.taskId, text: L(name(c.author) + ' kommentiert „', name(c.author) + ' commented on “') + mine[c.taskId].title + L('“', '”') }));
    const teamPeople = {};
    teamIds.forEach(id => Calendar.people_(id).forEach(u => { teamPeople[u.email] = 1; }));
    Db.all('Absences').filter(a => teamPeople[a.email] && a.email !== me.email && String(a.createdAt) > since).slice(0, 3)
      .forEach(a => items.push({ kind: 'absence', text: L(name(a.email) + ' ist ', name(a.email) + ' is away ') + day(a.startDate) + (a.endDate !== a.startDate ? '–' + day(a.endDate) : '') + L(' abwesend', '') }));
    Db.all('Projects').filter(x => ctx.teamIds[x.teamId] && x.createdBy !== me.email && String(x.createdAt) > since).slice(0, 2)
      .forEach(x => items.push({ kind: 'project', text: L('Neues Projekt: ', 'New project: ') + x.name }));
    const today = Util.today();
    const soon = Holidays.inRange(Object.keys(teamPeople).concat([me.email]).map(e => (users[e] || me).country), today, Shared.addDays(today, 7))
      .filter(h => Holidays.appliesTo(h, me) || Object.keys(teamPeople).some(e => users[e] && Holidays.appliesTo(h, users[e])));
    if (soon.length) items.push({ kind: 'holiday', text: L('Feiertag bald: ', 'Holiday soon: ') + soon[0].name + ' (' + soon[0].country + ', ' + day(soon[0].date) + ')' });
    return { since: since, items: items.slice(0, 5) };
  },

  briefing(p) {
    const en = !!(p && p.lang === 'en');
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    const today = Util.today();
    const weekEnd = Shared.addDays(Shared.mondayOf(today), 6);
    const mine = Db.all('Tasks').filter(t => Access.canSeeTask(t, ctx) && t.status !== 'done' &&
      ((t.assignees || []).indexOf(me.email) >= 0 || (!(t.assignees || []).length && t.createdBy === me.email)));
    const overdue = mine.filter(t => t.dueDate && t.dueDate < today);
    const dueToday = mine.filter(t => t.dueDate === today);
    const thisWeek = mine.filter(t => t.dueDate > today && t.dueDate <= weekEnd);
    const cap = Capacity.compute_([me], Shared.mondayOf(today), 2);
    const week = cap.members[0].weeks[0];
    const upcoming = Holidays.inRange([me.country], today, Shared.addDays(today, 21))
      .filter(h => Holidays.appliesTo(h, me));
    const rank = t => (Shared.PRIORITIES.find(x => x.key === t.priority) || { rank: 9 }).rank;
    const focus = overdue.concat(dueToday, thisWeek)
      .sort((a, b) => rank(a) - rank(b) || (a.dueDate < b.dueDate ? -1 : 1)).slice(0, 3);

    const facts = {
      overdue: overdue.length, today: dueToday.length, week: thisWeek.length,
      utilization: week.utilization, available: week.available, planned: week.planned,
      holidays: upcoming.slice(0, 3).map(h => ({ date: h.date, name: Holidays.label(h, en ? 'en' : 'de') })),
      focus: focus.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority })),
      teamWarnings: Availability.warnings(today, Shared.addDays(today, 27), Object.keys(ctx.teamIds), { email: me.email, admin: false })
        .map(w => ({ teamId: w.teamId, teamName: w.teamName, date: w.date, absent: w.absent, total: w.total })),
    };

    let text = '';
    let source = 'rules';
    if (Ai.enabled()) {
      try {
        const res = Ai.generate_([
          'Du bist ein freundlicher Assistent in einem Team-Task-Manager. Schreibe für ' + me.name +
            (en ? ' a short daily briefing in English (max. 3 sentences, informal, no list).' : ' ein kurzes Tagesbriefing auf Deutsch (max. 3 Sätze, duzen, keine Aufzählung).'),
          'Heute: ' + today + '. Daten: ' + JSON.stringify(facts),
          'Antworte als JSON: {"text": string}',
        ].join('\n'), true);
        if (res && res.text) { text = String(res.text).slice(0, 800); source = 'ai'; }
      } catch (e) { /* fall back to rules */ }
    }
    if (!text && en) {
      const parts = [];
      if (overdue.length) parts.push(overdue.length + ' overdue task' + (overdue.length > 1 ? 's' : ''));
      if (dueToday.length) parts.push(dueToday.length + ' due today');
      if (thisWeek.length) parts.push(thisWeek.length + ' more this week');
      text = parts.length ? 'You have ' + parts.join(', ') + '.' : 'No urgent deadlines – a good moment for deep work.';
      if (week.available) {
        text += ' Your workload this week is ' + week.utilization + ' % (' + week.planned + ' of ' + week.available + ' h).';
        if (week.utilization > 100) text += ' Consider handing something off or moving it.';
      }
      if (facts.teamWarnings.length) {
        const w = facts.teamWarnings[0];
        text += ' Heads up: on ' + w.date + ', ' + w.absent + ' of ' + w.total + ' people in ' + w.teamName + ' are away.';
      }
      if (upcoming.length) text += ' Next holiday: ' + Holidays.label(upcoming[0], 'en') + ' on ' + upcoming[0].date + '.';
    }
    if (!text) {
      const parts = [];
      if (overdue.length) parts.push(overdue.length + ' überfällige Aufgabe' + (overdue.length > 1 ? 'n' : ''));
      if (dueToday.length) parts.push(dueToday.length + ' heute fällig');
      if (thisWeek.length) parts.push(thisWeek.length + ' weitere diese Woche');
      text = parts.length ? 'Du hast ' + parts.join(', ') + '.' : 'Keine dringenden Fristen – guter Moment für Tiefenarbeit.';
      if (week.available) {
        text += ' Deine Auslastung diese Woche liegt bei ' + week.utilization + ' % (' + week.planned + ' von ' + week.available + ' h).';
        if (week.utilization > 100) text += ' Überleg, ob du etwas abgeben oder verschieben kannst.';
      }
      if (facts.teamWarnings.length) {
        const w = facts.teamWarnings[0];
        text += ' Achtung: Am ' + w.date.split('-').reverse().join('.') + ' sind in ' + w.teamName + ' ' + w.absent + ' von ' + w.total + ' Personen abwesend.';
      }
      if (upcoming.length) text += ' Nächster Feiertag: ' + upcoming[0].name + ' am ' + upcoming[0].date.split('-').reverse().join('.') + '.';
    }
    return Object.assign(facts, { text: text, source: source });
  },

  jfPoint_(jf, day, en) {
    const open = j => (j.open ? (en ? ' (' + j.open + ' open)' : ' (' + j.open + ' offen)') : '');
    return { text: 'Jour Fixe: ' + jf.slice(0, 3).map(j => j.title + ' ' + day(j.date) + open(j)).join(', '), view: 'all' };
  },
  /** Jour fixe meetings of the period in the person's projects, with open and anchored items. */
  jfWeek_(ctx, from, to) {
    const o = Jf.overview_(ctx, '');
    const out = [];
    o.series.forEach(s => Shared.jfDates(s, from, to).forEach(d => {
      const m = o.minutes.find(x => x.seriesId === s.id && x.date === d);
      out.push({ title: s.title, date: d, time: s.time || '', open: m ? m.openCount : s.carry.open.length, pinned: m ? m.pinnedCount : s.carry.pinned.length, done: !!m });
    }));
    return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

  /** Calls Gemini on Vertex AI. Returns parsed JSON when json = true. */
  /** The address of generateContent: VERTEX_ENDPOINT, a project endpoint, or the global one (express mode). */
  url_() {
    const model = encodeURIComponent(Config.get('VERTEX_MODEL'));
    const project = Config.get('VERTEX_PROJECT_ID');
    const location = Config.get('VERTEX_LOCATION') || 'global';
    const host = location === 'global' ? 'aiplatform.googleapis.com' : location + '-aiplatform.googleapis.com';
    const own = Config.get('VERTEX_ENDPOINT');
    const url = /^https:\/\/[a-z0-9.-]+\.googleapis\.com\//i.test(own) ? own.replace('{model}', model)
      : project ? 'https://' + host + '/v1/projects/' + encodeURIComponent(project) + '/locations/' + encodeURIComponent(location) + '/publishers/google/models/' + model + ':generateContent'
        : 'https://aiplatform.googleapis.com/v1/publishers/google/models/' + model + ':generateContent';
    return Config.get('VERTEX_KEY_IN') === 'query' ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'key=' + encodeURIComponent(Config.get('VERTEX_API_KEY')) : url;
  },
  generate_(prompt, json) {
    if (!Assistant.budget_(Auth.email(), String(prompt).length)) throw new Error(Ai.LIMIT);
    const key = Config.get('VERTEX_API_KEY');
    const res = UrlFetchApp.fetch(Ai.url_(), {
      method: 'post',
      contentType: 'application/json',
      headers: Config.get('VERTEX_KEY_IN') === 'query' ? {} : { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: Object.assign({ temperature: 0.2 }, json ? { responseMimeType: 'application/json' } : {}),
      }),
    });
    if (res.getResponseCode() !== 200) {
      let why = '';
      try { why = JSON.parse(res.getContentText()).error.message; } catch (e) { why = ''; }
      throw new Error('Vertex AI antwortet mit ' + res.getResponseCode() + (why ? ': ' + String(why).slice(0, 300) : ''));
    }
    const body = JSON.parse(res.getContentText());
    const text = (((body.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('');
    return json ? JSON.parse(text) : text;
  },
};
