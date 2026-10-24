/**
 * "Smart" features. Every feature works without AI using rules; when a
 * Vertex AI key is configured (Script Property VERTEX_API_KEY) Gemini on
 * Vertex AI takes over or enriches the result.
 *
 * Configure in Apps Script: Project Settings -> Script Properties
 *   VERTEX_API_KEY     API key (Vertex AI express mode). Placeholder until set.
 *   VERTEX_MODEL       default gemini-2.5-flash
 *   VERTEX_PROJECT_ID  optional: GCP project to call a regional endpoint
 *   VERTEX_LOCATION    optional, default "global"
 * The key never leaves the server; the browser only learns whether AI is on.
 */
const Ai = {
  enabled() {
    const key = Config.get('VERTEX_API_KEY');
    return !!key && key.indexOf('PLATZHALTER') !== 0;
  },

  status() {
    return {
      enabled: Ai.enabled(),
      model: Config.get('VERTEX_MODEL'),
      hint: Ai.enabled()
        ? 'Vertex AI ist verbunden.'
        : 'Regelbasierter Modus. Für KI-Funktionen in den Skripteigenschaften VERTEX_API_KEY setzen.',
    };
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
    return {
      today: Util.today(),
      me: me.email,
      users: Users.list().map(u => ({ email: u.email, name: u.name })),
      teams: Db.all('Teams').map(t => ({ id: t.id, name: t.name })),
      projects: Db.all('Projects').map(x => ({ id: x.id, name: x.name })),
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
    const task = p.id ? Db.get('Tasks', p.id) : p;
    if (!task) throw new Error('Aufgabe nicht gefunden.');
    let emails = [];
    const project = task.projectId && Db.get('Projects', task.projectId);
    if (project && project.members && project.members.length) emails = project.members.slice();
    const teamIds = (task.teams || []).concat(project ? [project.teamId] : []);
    teamIds.forEach(id => {
      const t = Db.get('Teams', id);
      if (t) emails = emails.concat([t.lead], t.members || []);
    });
    let users = Users.list();
    if (emails.length) users = users.filter(u => emails.indexOf(u.email) >= 0);
    const due = Shared.isDate(task.dueDate) ? task.dueDate : Util.today();
    const week = Shared.mondayOf(due < Util.today() ? Util.today() : due);
    const cap = Capacity.compute_(users, week, 1);
    const ranked = cap.members.map(m => {
      const w = m.weeks[0];
      const free = Math.round((w.available - w.planned) * 10) / 10;
      const reasons = [w.planned + ' von ' + w.available + ' h in KW ' + Shared.isoWeek(week) + ' verplant'];
      w.holidays.forEach(h => reasons.push('Feiertag ' + h.name));
      if (w.absentDays) reasons.push(w.absentDays + ' Tag(e) abwesend');
      const blocked = Db.all('Absences').some(a => a.email === m.email && a.startDate <= due && a.endDate >= due) ||
        w.holidays.some(h => h.date === due);
      if (blocked) reasons.push('am Fälligkeitstag nicht da');
      return { email: m.email, name: m.name, free: free, utilization: w.utilization, blocked: blocked, reasons: reasons };
    }).sort((a, b) => (a.blocked - b.blocked) || (b.free - a.free));
    return { week: week, candidates: ranked.slice(0, 6), source: 'rules', me: me.email };
  },

  /** Splits a task into sub-tasks. Needs Vertex AI. */
  breakdown(p) {
    const me = Auth.currentUser();
    const t = Db.get('Tasks', p.id);
    if (!t || !Access.canSeeTask(t, Access.context(me))) throw new Error('Aufgabe nicht gefunden.');
    if (!Ai.enabled()) return Ai.dummyBreakdown_(t);
    const res = Ai.generate_([
      'Zerlege die folgende Aufgabe in 3 bis 7 konkrete, umsetzbare Teilaufgaben auf Deutsch.',
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
  dummyBreakdown_(t) {
    const total = Number(t.estimate) || 4;
    const part = share => Math.max(0.25, Math.round(total * share * 4) / 4);
    return {
      configured: false, dummy: true,
      hint: 'Beispielvorschlag ohne KI (Platzhalter-Schlüssel). Mit hinterlegtem VERTEX_API_KEY schlägt Gemini passende Teilaufgaben vor.',
      subtasks: [
        { title: 'Ziel und Anforderungen klären: ' + t.title, estimate: part(0.15) },
        { title: 'Umsetzung vorbereiten', estimate: part(0.25) },
        { title: 'Umsetzen', estimate: part(0.4) },
        { title: 'Prüfen und Feedback einholen', estimate: part(0.15) },
        { title: 'Abschließen und dokumentieren', estimate: part(0.05) },
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
    const cacheKey = 'rep:' + me.email + ':' + range + ':' + (en ? 'en' : 'de');
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
    const warnings = Availability.warnings(from > today ? from : today, to < today ? today : to, teamIds)
      .map(w => ({ teamId: w.teamId, teamName: w.teamName, date: w.date, absent: w.absent, total: w.total }));
    const people = {};
    teamIds.forEach(id => Calendar.people_(id).forEach(u => { people[u.email] = u; }));
    people[me.email] = me;
    const absences = Db.all('Absences').filter(a => people[a.email] && a.startDate <= to && a.endDate >= from)
      .map(a => ({ name: people[a.email].name, from: a.startDate, to: a.endDate, type: a.type }));
    const holidays = Holidays.inRange(Object.keys(people).map(e => people[e].country), from, to)
      .filter(h => Object.keys(people).some(e => Holidays.appliesTo(h, people[e])))
      .map(h => ({ date: h.date, name: h.name, country: h.country }));
    const kpis = { done: done.length, created: created.length, overdue: overdue.length, due: due.length, utilization: utilization };
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
    let text = '', source = 'rules';
    if (Ai.enabled()) {
      try {
        const res = Ai.generate_([
          L('Fasse für ' + me.name + ' den Stand für ' + label + ' in 2 Sätzen zusammen (duzen, konkret, keine Aufzählung).',
            'Summarise the state for ' + me.name + ' for ' + label + ' in 2 sentences (informal, concrete, no list).'),
          'Daten: ' + JSON.stringify({ kpis: kpis, overdue: overdue.slice(0, 5).map(t => t.title), due: due.slice(0, 5).map(t => t.title), warnings: warnings.slice(0, 3), holidays: holidays.slice(0, 3), absences: absences.slice(0, 4) }),
          'Antworte als JSON: {"text": string}',
        ].join('\n'), true);
        if (res && res.text) { text = String(res.text).slice(0, 600); source = 'ai'; }
      } catch (e) { /* rules below */ }
    }
    if (!text) {
      text = overdue.length
        ? L('Für ' + label + ': ' + overdue.length + ' überfällig und ' + due.length + ' noch fällig – zuerst das Überfällige klären.',
          'For ' + label + ': ' + overdue.length + ' overdue and ' + due.length + ' still due – sort out the overdue ones first.')
        : due.length
          ? L('Für ' + label + ' stehen ' + due.length + ' Aufgabe(n) an, nichts ist überfällig.', due.length + ' task(s) due ' + label + ', nothing is overdue.')
          : L('Für ' + label + ' ist nichts fällig – Zeit für Planung oder Tiefenarbeit.', 'Nothing due ' + label + ' – time for planning or deep work.');
    }
    const out = { range: range, from: from, to: to, kpis: kpis, bullets: bullets.slice(0, 5), actions: actions.slice(0, 3),
      warnings: warnings.slice(0, 5), text: text, source: source, at: new Date().toISOString() };
    cache.put(cacheKey, JSON.stringify(out), 300);
    return out;
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
      holidays: upcoming.slice(0, 3).map(h => ({ date: h.date, name: h.name })),
      focus: focus.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority })),
      teamWarnings: Availability.warnings(today, Shared.addDays(today, 27), Object.keys(ctx.teamIds))
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
      if (upcoming.length) text += ' Next holiday: ' + upcoming[0].name + ' on ' + upcoming[0].date + '.';
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

  /** Calls Gemini on Vertex AI. Returns parsed JSON when json = true. */
  generate_(prompt, json) {
    const key = Config.get('VERTEX_API_KEY');
    const model = Config.get('VERTEX_MODEL');
    const project = Config.get('VERTEX_PROJECT_ID');
    const location = Config.get('VERTEX_LOCATION') || 'global';
    const host = location === 'global' ? 'aiplatform.googleapis.com' : location + '-aiplatform.googleapis.com';
    const url = project
      ? 'https://' + host + '/v1/projects/' + project + '/locations/' + location + '/publishers/google/models/' + model + ':generateContent'
      : 'https://aiplatform.googleapis.com/v1/publishers/google/models/' + model + ':generateContent';
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: Object.assign({ temperature: 0.2 }, json ? { responseMimeType: 'application/json' } : {}),
      }),
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('Vertex AI antwortet mit ' + res.getResponseCode());
    }
    const body = JSON.parse(res.getContentText());
    const text = (((body.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('');
    return json ? JSON.parse(text) : text;
  },
};
