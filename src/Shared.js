/**
 * Code shared between the Apps Script server and the browser client.
 *
 * The factory is serialised with Function#toString() and injected into the
 * web page (see clientLib() in Code.js), so it must not use any Apps Script
 * service. Dates are always plain 'yyyy-MM-dd' strings, calculated in UTC so
 * results never depend on the time zone of the machine running the code.
 */
function SharedFactory() {
  const STATUSES = [
    { key: 'backlog', label: 'Backlog', color: 'gray' },
    { key: 'todo', label: 'Offen', color: 'default' },
    { key: 'doing', label: 'In Arbeit', color: 'blue' },
    { key: 'review', label: 'Review', color: 'purple' },
    { key: 'done', label: 'Erledigt', color: 'green' },
  ];
  const PRIORITIES = [
    { key: 'urgent', label: 'Dringend', color: 'red', rank: 0 },
    { key: 'high', label: 'Hoch', color: 'orange', rank: 1 },
    { key: 'medium', label: 'Mittel', color: 'yellow', rank: 2 },
    { key: 'low', label: 'Niedrig', color: 'gray', rank: 3 },
  ];
  const RECURRENCES = [
    { key: '', label: 'Keine' },
    { key: 'daily', label: 'Täglich' },
    { key: 'weekdays', label: 'Werktags' },
    { key: 'weekly', label: 'Wöchentlich' },
    { key: 'monthly', label: 'Monatlich' },
  ];
  const ABSENCE_TYPES = [
    { key: 'vacation', label: 'Urlaub', color: 'green' },
    { key: 'sick', label: 'Krank', color: 'red' },
    { key: 'training', label: 'Fortbildung', color: 'blue' },
    { key: 'other', label: 'Abwesend', color: 'gray' },
  ];
  const EVENT_TYPES = [
    { key: 'meeting', label: 'Termin', color: 'blue' },
    { key: 'milestone', label: 'Meilenstein', color: 'purple' },
    { key: 'deadline', label: 'Deadline', color: 'red' },
    { key: 'offsite', label: 'Offsite / Event', color: 'orange' },
  ];
  const PROJECT_STATUSES = [
    { key: 'planned', label: 'Geplant', color: 'gray' },
    { key: 'active', label: 'Aktiv', color: 'blue' },
    { key: 'paused', label: 'Pausiert', color: 'yellow' },
    { key: 'done', label: 'Abgeschlossen', color: 'green' },
  ];
  /** Eight team colours: everyone is in at most 8 teams, and teams that share people never share a colour. */
  const TEAM_COLORS = ['blue', 'orange', 'green', 'purple', 'pink', 'red', 'yellow', 'teal'];
  const MAX_TEAMS = 8;

  // ---------------------------------------------------------------- dates
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    // a real calendar day: 2026-02-30 is not one
    const p = s.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function parseDate(s) {
    const p = s.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function fmt(d) {
    return d.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmt(d);
  }
  function addMonths(s, n) {
    const d = parseDate(s);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return fmt(d);
  }
  /** 0 = Sunday ... 6 = Saturday */
  function weekday(s) {
    return parseDate(s).getUTCDay();
  }
  function mondayOf(s) {
    const wd = weekday(s);
    return addDays(s, wd === 0 ? -6 : 1 - wd);
  }
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function isoWeek(s) {
    const d = parseDate(s);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }
  function endOfMonth(s) {
    const d = parseDate(s);
    return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  function nextOccurrence(s, recurrence) {
    if (!isDate(s)) return '';
    switch (recurrence) {
      case 'daily': return addDays(s, 1);
      case 'weekdays': {
        let n = addDays(s, 1);
        while (weekday(n) === 0 || weekday(n) === 6) n = addDays(n, 1);
        return n;
      }
      case 'weekly': return addDays(s, 7);
      case 'monthly': return addMonths(s, 1);
      default: return '';
    }
  }

  // ------------------------------------------------- natural language parser
  const WEEKDAY_WORDS = {
    montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3,
    donnerstag: 4, thursday: 4, freitag: 5, friday: 5, samstag: 6, saturday: 6,
    sonntag: 0, sunday: 0,
  };
  const WD = Object.keys(WEEKDAY_WORDS).join('|');
  const PRIORITY_WORDS = {
    dringend: 'urgent', urgent: 'urgent', hoch: 'high', high: 'high',
    mittel: 'medium', medium: 'medium', niedrig: 'low', low: 'low',
  };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  }
  function nextWeekday(today, wd, includeToday) {
    let d = includeToday ? today : addDays(today, 1);
    while (weekday(d) !== wd) d = addDays(d, 1);
    return d;
  }
  function matchBy(list, query, keysFn) {
    const q = norm(query);
    if (!q) return null;
    let hit = list.find(item => keysFn(item).some(k => k === q));
    if (!hit) hit = list.find(item => keysFn(item).some(k => k.indexOf(q) === 0));
    return hit || null;
  }

  /**
   * Turns "Angebot schicken morgen @anna #website !hoch 2h" into task fields.
   * ctx: { today, me, users:[{email,name}], teams:[{id,name}], projects:[{id,name}] }
   */
  function parse(input, ctx) {
    ctx = ctx || {};
    const today = ctx.today;
    const users = ctx.users || [];
    const teams = ctx.teams || [];
    const projects = ctx.projects || [];
    const out = {
      title: '', dueDate: '', startDate: '', assignees: [], teams: [], projectId: '',
      tags: [], priority: '', estimate: 0, recurrence: '', tokens: [],
    };
    let text = ' ' + String(input || '') + ' ';
    const take = (re, fn) => {
      text = text.replace(re, function () {
        const r = fn.apply(null, arguments);
        return r === false ? arguments[0] : ' ';
      });
    };
    const setDate = (prefix, date) => {
      const p = String(prefix || '').trim().toLowerCase();
      const isStart = ['ab', 'from', 'start', 'von', 'starting'].indexOf(p) >= 0;
      if (isStart || (out.dueDate && !p)) {
        out.startDate = date;
        out.tokens.push({ type: 'start', value: date });
      } else {
        out.dueDate = date;
        out.tokens.push({ type: 'due', value: date });
      }
    };
    const userKeys = u => {
      const name = String(u.name || '');
      const parts = name.split(/\s+/).filter(Boolean).map(norm);
      return [norm(u.email.split('@')[0]), norm(name)].concat(parts);
    };

    // People: @anna, @ich
    take(/(\s)@([A-Za-zÀ-ÿ0-9._-]+)/g, (m, sp, q) => {
      let email = '';
      if (['ich', 'me', 'mir', 'mich'].indexOf(q.toLowerCase()) >= 0 && ctx.me) email = ctx.me;
      else {
        const u = matchBy(users, q, userKeys);
        if (u) email = u.email;
      }
      if (!email) return false;
      if (out.assignees.indexOf(email) < 0) out.assignees.push(email);
      out.tokens.push({ type: 'assignee', value: email });
    });
    // Teams: +marketing
    take(/(\s)\+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9._-]*)/g, (m, sp, q) => {
      const t = matchBy(teams, q, x => [norm(x.name)]);
      if (!t) return false;
      if (out.teams.indexOf(t.id) < 0) out.teams.push(t.id);
      out.tokens.push({ type: 'team', value: t.id });
    });
    // Projects or tags: #website
    take(/(\s)#([A-Za-zÀ-ÿ0-9._-]+)/g, (m, sp, q) => {
      const p = !out.projectId && matchBy(projects, q, x => [norm(x.name)]);
      if (p) {
        out.projectId = p.id;
        out.tokens.push({ type: 'project', value: p.id });
      } else if (out.tags.indexOf(q) < 0) {
        out.tags.push(q);
        out.tokens.push({ type: 'tag', value: q });
      }
    });
    // Priority: !, !!, !hoch, p1
    take(/(\s)(!{1,3})([A-Za-z]+)?(?=\s)/g, (m, sp, bangs, word) => {
      const w = word && PRIORITY_WORDS[word.toLowerCase()];
      if (word && !w) return false;
      out.priority = w || (bangs.length >= 2 ? 'urgent' : 'high');
      out.tokens.push({ type: 'priority', value: out.priority });
    });
    take(/(\s)p([1-4])(?=\s)/gi, (m, sp, n) => {
      out.priority = ['urgent', 'high', 'medium', 'low'][Number(n) - 1];
      out.tokens.push({ type: 'priority', value: out.priority });
    });
    // Estimate: 2h, 1,5 std, 30min
    take(/(\s)~?(\d+(?:[.,]\d+)?)\s?(h|std\.?|stunden?|hours?)(?=\s)/gi, (m, sp, n) => {
      out.estimate += Number(n.replace(',', '.'));
      out.tokens.push({ type: 'estimate', value: out.estimate });
    });
    take(/(\s)~?(\d+)\s?(m|min|minuten|minutes)(?=\s)/gi, (m, sp, n) => {
      out.estimate = Math.round((out.estimate + Number(n) / 60) * 100) / 100;
      out.tokens.push({ type: 'estimate', value: out.estimate });
    });

    if (!today) {
      out.title = text.replace(/\s+/g, ' ').trim();
      return out;
    }

    // Recurrence
    const setRec = r => { out.recurrence = r; out.tokens.push({ type: 'recurrence', value: r }); };
    take(new RegExp('(\\s)(?:jeden|every)\\s+(' + WD + ')(?=\\s)', 'gi'), (m, sp, w) => {
      setRec('weekly');
      setDate('', nextWeekday(today, WEEKDAY_WORDS[w.toLowerCase()], true));
    });
    take(/(\s)(jeden werktag|werktags|weekdays|every weekday)(?=\s)/gi, () => setRec('weekdays'));
    take(/(\s)(jeden tag|täglich|taeglich|daily|every day)(?=\s)/gi, () => setRec('daily'));
    take(/(\s)(jede woche|wöchentlich|woechentlich|weekly|every week)(?=\s)/gi, () => setRec('weekly'));
    take(/(\s)(jeden monat|monatlich|monthly|every month)(?=\s)/gi, () => setRec('monthly'));

    // Dates
    const P = '(\\s)(?:(ab|from|start|von|bis|am|due|until|on|zum|by)\\s+)?';
    const rules = [
      [/(\d{4})-(\d{2})-(\d{2})/, m => m[0]],
      [/(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/, m => {
        const day = Number(m[1]), mon = Number(m[2]);
        if (day < 1 || day > 31 || mon < 1 || mon > 12) return '';
        let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
        if (year < 100) year += 2000;
        let d = year + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        if (!m[3] && d < today) d = (year + 1) + d.slice(4);
        return isDate(d) ? d : '';
      }],
      [/übermorgen|uebermorgen|day after tomorrow/, () => addDays(today, 2)],
      [/heute|today|tdy/, () => today],
      [/morgen|tomorrow|tmrw/, () => addDays(today, 1)],
      [/nächste woche|naechste woche|next week/, () => addDays(mondayOf(today), 7)],
      [/ende der woche|diese woche|end of week|this week|eow/, () => addDays(mondayOf(today), 4)],
      [/nächsten monat|naechsten monat|next month/, () => addMonths(today.slice(0, 8) + '01', 1)],
      [/ende des monats|monatsende|end of month|eom/, () => endOfMonth(today)],
      [/in (\d+) (tagen|tage|tag|days|day)/, m => addDays(today, Number(m[1]))],
      [/in (\d+) (wochen|woche|weeks|week)/, m => addDays(today, 7 * Number(m[1]))],
      [/in (\d+) (monaten|monat|months|month)/, m => addMonths(today, Number(m[1]))],
      [new RegExp('(?:nächsten |naechsten |next )?(' + WD + ')'), m => nextWeekday(today, WEEKDAY_WORDS[m[1].toLowerCase()], false)],
    ];
    rules.forEach(rule => {
      const re = new RegExp(P + '(' + rule[0].source + ')(?=[\\s,.;!?])', 'gi');
      take(re, function () {
        const args = Array.prototype.slice.call(arguments);
        const prefix = args[2];
        const inner = new RegExp(rule[0].source, 'i').exec(args[3]);
        const date = inner && rule[1](inner);
        if (!date) return false;
        setDate(prefix, date);
      });
    });

    out.title = text.replace(/\s+/g, ' ').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
    if (!out.title) out.title = String(input || '').trim();
    return out;
  }

  /**
   * One filter for every task list: tabs, status filter, "Erledigte", grouping and counts.
   * f: { search, people, prio, projects, statuses, showDone, quick }
   * c: { me, today, quickTabs (bool), includeSub (bool), allDone (bool: board shows done column) }
   * An explicit status filter wins over hiding done tasks; a quick tab only narrows by date.
   */
  const QUICK_TABS = ['open', 'today', 'upcoming', 'overdue', 'nodate', 'done'];
  function quickDate_(key, t, today) {
    if (key === 'today') return !!((t.dueDate && t.dueDate <= today) || t.planDate === today);
    if (key === 'upcoming') return !!(t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7));
    if (key === 'overdue') return !!(t.dueDate && t.dueDate < today);
    if (key === 'nodate') return !t.dueDate;
    return true;
  }
  function taskQuery(tasks, f, c) {
    f = f || {}; c = c || {};
    const arr = x => x || [];
    const q = String(f.search || '').trim().toLowerCase();
    const statuses = arr(f.statuses);
    const base = (tasks || []).filter(t => {
      if (!c.includeSub && t.parentId) return false;
      if (q && (t.title + ' ' + arr(t.tags).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      const who = arr(t.assignees);
      if (arr(f.people).length && !f.people.some(e => (e === '__none' ? !who.length : who.indexOf(e === '__me' ? c.me : e) >= 0))) return false;
      if (arr(f.prio).length && f.prio.indexOf(t.priority) < 0) return false;
      if (arr(f.projects).length && f.projects.indexOf(t.projectId || '') < 0) return false;
      if (statuses.length && statuses.indexOf(t.status) < 0) return false;
      return true;
    });
    const wantsDone = statuses.indexOf('done') >= 0;
    const doneRule = key => {
      const r = key ? (key === 'done' ? 'done' : 'open') : (f.showDone || c.allDone ? 'any' : 'open');
      return r === 'open' && wantsDone ? 'any' : r;
    };
    const pass = key => {
      const r = doneRule(key);
      return t => (r === 'any' || (r === 'done') === (t.status === 'done')) && quickDate_(key, t, c.today);
    };
    const quick = c.quickTabs ? (QUICK_TABS.indexOf(f.quick) >= 0 ? f.quick : 'open') : '';
    const list = base.filter(pass(quick));
    const counts = {};
    if (c.quickTabs) QUICK_TABS.forEach(k => { counts[k] = base.filter(pass(k)).length; });
    return { list, counts, quick, hidesDone: doneRule(quick) === 'open' };
  }

  /** Order for "today" lists: earlier due date first (no date last), then higher priority. */
  function focusOrder(a, b) {
    const da = a.dueDate || '9999-12-31', db = b.dueDate || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const rank = k => (PRIORITIES.find(p => p.key === k) || { rank: 9 }).rank;
    return rank(a.priority) - rank(b.priority);
  }

  /** Wait before retry n (0, 1, …): doubles each time, ±50 % random spread, at most 8 s. */
  function retryDelay(attempt, rand) {
    return Math.min(8000, Math.floor(500 * Math.pow(2, attempt) * (0.5 + rand)));
  }
  /** Next poll in ms: base ±25 % so clients drift apart, doubled per failed poll (up to 8x). */
  function pollDelay(baseSec, failures, rand) {
    return Math.floor(baseSec * 1000 * (0.75 + 0.5 * rand) * Math.pow(2, Math.min(failures, 3)));
  }

  /**
   * Adds minutes by hand. A running timer is folded into spent and restarted now,
   * so its time is never counted twice. Returns { spent (min), timerStart }.
   */
  function addTime(spentMin, timerStart, nowMs, addMin) {
    const running = timerStart ? Math.max(0, nowMs - Date.parse(timerStart)) / 60000 : 0;
    return { spent: Math.round((Number(spentMin) || 0) + running + addMin), timerStart: timerStart ? new Date(nowMs).toISOString() : '' };
  }

  /** Colours offered for projects, in the order new projects get them. */
  const PROJECT_PALETTE = ['blue', 'orange', 'green', 'purple', 'pink', 'red', 'yellow', 'teal', 'brown', 'indigo', 'lime', 'cyan'];
  /** Colours a project may have (anything else would end up in a style attribute); gray/default = none chosen. */
  const PROJECT_COLORS = ['default', 'gray'].concat(PROJECT_PALETTE);

  /** Colour -> project name for the projects of a team (except one), so no colour is used twice in a team. */
  function takenProjectColors(projects, teamId, exceptId) {
    const taken = {};
    projects.forEach(p => {
      if (p.teamId === teamId && p.id !== exceptId && PROJECT_PALETTE.indexOf(p.color) >= 0 && !taken[p.color]) taken[p.color] = p.name;
    });
    return taken;
  }
  /** First palette colour no other project of the team uses; when all are used, the least used one. */
  function freeProjectColor(projects, teamId, exceptId) {
    const taken = takenProjectColors(projects, teamId, exceptId);
    const free = PROJECT_PALETTE.find(c => !taken[c]);
    if (free) return free;
    const count = c => projects.filter(p => p.teamId === teamId && p.id !== exceptId && p.color === c).length;
    return PROJECT_PALETTE.reduce((best, c) => (count(c) < count(best) ? c : best), PROJECT_PALETTE[0]);
  }

  /**
   * Meeting dates of a jour fixe series between from and to: weekly, every two weeks (counted
   * from the first meeting) or monthly (same weekday in the same week of the month).
   * s: { rhythm, weekday, startDate, endDate? }
   */
  function jfDates(s, from, to) {
    const wd = Math.max(0, Math.min(6, Math.round(Number(s.weekday)) || 0));
    const first = nextWeekday(isDate(s.startDate) ? s.startDate : from, wd, true);
    const end = isDate(s.endDate) && s.endDate < to ? s.endDate : to;
    const out = [];
    if (s.rhythm === 'monthly') {
      const nth = Math.floor((Number(first.slice(8)) - 1) / 7);
      for (let m = first.slice(0, 8) + '01'; m <= end; m = addMonths(m, 1)) {
        const d = addDays(nextWeekday(m, wd, true), nth * 7);
        if (d.slice(0, 7) === m.slice(0, 7) && d >= from && d <= end) out.push(d);
      }
      return out;
    }
    const step = s.rhythm === 'biweekly' ? 14 : 7;
    let d = first;
    if (d < from) d = addDays(d, Math.ceil(diffDays(d, from) / step) * step);
    for (; d <= end && out.length < 400; d = addDays(d, step)) out.push(d);
    return out;
  }

  /**
   * An action item line of a document: "- [ ] text @person@firma.de !2026-11-03", optionally
   * followed by "⟶ #t_id" once it became a task. Other lines: null.
   */
  function parseActionItem(line) {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(String(line || ''));
    if (!m) return null;
    let rest = m[2];
    let taskId = '';
    const link = /\s*⟶\s*#(t_\w+)\s*$/.exec(rest);
    if (link) { taskId = link[1]; rest = rest.slice(0, link.index); }
    let due = '';
    rest = rest.replace(/(^|\s)!(\d{4}-\d{2}-\d{2})(?=\s|$)/, (x, sp, d) => { due = isDate(d) ? d : ''; return sp; });
    let assignee = '';
    rest = rest.replace(/(^|\s)@([^\s@]+@[^\s@]+\.[^\s@]+)(?=\s|$)/, (x, sp, e) => { assignee = e.toLowerCase(); return sp; });
    return { done: m[1] !== ' ', text: rest.replace(/\s+/g, ' ').trim(), assignee: assignee, due: due, taskId: taskId };
  }

  /** A name that is safe as a Drive file or folder name (no path characters, never empty or a dot name). */
  function safeName(s) {
    // control characters out (by char code: the page embeds this file, escapes would not survive)
    const visible = String(s || '').split('').filter(c => c.charCodeAt(0) >= 32).join('');
    const name = visible.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    return !name || /^\.+$/.test(name) ? '_' : name;
  }

  /* ---- jour fixe minutes: a structured form, stored as a Markdown table plus a data block ---- */
  const PROTO_TYPES = ['I', 'A', 'B', 'N']; // information, action, decision, note
  const PROTO_MARK = '<!-- lidlflow:protocol ';
  const cut = (s, n) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const mail = s => cut(s, 120).toLowerCase();
  const mails = list => (Array.isArray(list) ? list.map(mail).filter(Boolean) : []);
  const yes = v => v === true || String(v).toLowerCase() === 'true';

  /** A minutes model with only known fields, types and lengths. */
  function protoClean(m) {
    m = m && typeof m === 'object' ? m : {};
    // ids let two people's changes be merged topic by topic and line by line
    const id = x => (/^[A-Za-z0-9_-]{1,16}$/.test(x && x.id) ? x.id : '');
    const item = i => ({
      id: id(i),
      type: PROTO_TYPES.indexOf(i && i.type) >= 0 ? i.type : 'I',
      text: cut(i && i.text, 2000), owner: mail(i && i.owner), due: isDate(i && i.due) ? i.due : '',
      done: yes(i && i.done), taskId: /^t_\w+$/.test(i && i.taskId) ? i.taskId : '',
    });
    const topic = t => ({ id: id(t), title: cut(t && t.title, 200), owner: mail(t && t.owner), items: (t && Array.isArray(t.items) ? t.items : []).slice(0, 100).map(item) });
    return {
      title: cut(m.title, 120), date: isDate(m.date) ? m.date : '', minuteTaker: mail(m.minuteTaker),
      present: mails(m.present), absent: mails(m.absent),
      topics: (Array.isArray(m.topics) ? m.topics : []).slice(0, 100).map(topic),
    };
  }

  /** The minutes as a Markdown table (readable in Drive) with the model as a data block at the end. */
  function protoToText(m) {
    m = protoClean(m);
    const cell = s => String(s).replace(/\|/g, '\\|');
    const who = e => (e ? '@' + e : '');
    const lines = [
      '# ' + cell(m.title) + ' – ' + m.date,
      '',
      '**Protokoll:** ' + who(m.minuteTaker),
      '**Anwesend:** ' + m.present.map(who).join(', '),
      '**Abwesend:** ' + m.absent.map(who).join(', '),
      '',
      '| Nr. | Art | Thema | Verantwortlich | Termin |',
      '|---|---|---|---|---|',
    ];
    m.topics.forEach((t, k) => {
      lines.push('| ' + (k + 1) + '. | | **' + cell(t.title) + '** | ' + who(t.owner) + ' | |');
      t.items.forEach(i => lines.push('| | ' + i.type + ' | ' + cell(i.text) + (i.done ? ' ✓' : '') + ' | ' + who(i.owner) + ' | ' + i.due + ' |'));
    });
    // "--" would end the HTML comment: written as a JSON escape, read back unchanged
    lines.push('', PROTO_MARK + JSON.stringify(m).replace(/--/g, '-\\u002d') + ' -->');
    return lines.join('\n');
  }

  /** The model from a stored text; null when there is no (valid) data block. */
  function protoFromText(text) {
    const at = String(text || '').lastIndexOf(PROTO_MARK);
    if (at < 0) return null;
    const end = String(text).indexOf(' -->', at);
    try { return protoClean(JSON.parse(String(text).slice(at + PROTO_MARK.length, end < 0 ? undefined : end))); } catch (e) { return null; }
  }

  /** Action items still open (type A, not done): they move on to the next meeting. */
  function protoOpenActions(m) {
    const out = [];
    protoClean(m).topics.forEach(t => t.items.forEach(i => { if (i.type === 'A' && !i.done) out.push(i); }));
    return out;
  }

  /**
   * Three-way merge of minutes saved by two people at the same time: base = the version both started
   * from, mine = what I save, theirs = what was saved meanwhile. Topics and lines are matched by id;
   * new ones from both sides are kept, a deletion wins unless the other side changed the entry, and
   * fields merge one by one. Only a field both changed differently is a conflict (mine is kept).
   * Returns { model, conflicts: ['topics.<id>.title', ...] }.
   */
  function protoMerge(base, mine, theirs) {
    const b = protoClean(base);
    const m = protoClean(mine);
    const t = protoClean(theirs);
    const conflicts = [];
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const pick = (bv, mv, tv, path) => {
      if (same(mv, bv) || same(mv, tv)) return tv;
      if (same(tv, bv)) return mv;
      conflicts.push(path);
      return mv;
    };
    // people lists: what either side added stays, what either side removed goes
    const people = (bl, ml, tl) => tl.filter(x => ml.indexOf(x) >= 0 || bl.indexOf(x) < 0).concat(ml.filter(x => bl.indexOf(x) < 0 && tl.indexOf(x) < 0));
    const fields = (bx, mx, tx, keys, path) => {
      const out = { id: mx.id || tx.id };
      keys.forEach(k => { out[k] = pick(bx[k], mx[k], tx[k], path + '.' + k); });
      return out;
    };
    const list = (bl, ml, tl, merge, path) => {
      const key = (x, i) => x.id || '#' + i;
      const index = l => { const o = {}; l.forEach((x, i) => { o[key(x, i)] = x; }); return o; };
      const bi = index(bl), mi = index(ml), ti = index(tl);
      const out = [];
      tl.forEach((tx, i) => {
        const k = key(tx, i);
        const bx = bi[k], mx = mi[k];
        if (!mx) { if (!bx || !same(tx, bx)) out.push(tx); return; }
        if (bx) { out.push(merge(bx, mx, tx, path + '.' + k)); return; }
        if (!same(mx, tx)) conflicts.push(path + '.' + k);
        out.push(mx);
      });
      ml.forEach((mx, i) => {
        const k = key(mx, i);
        if (ti[k]) return;
        if (!bi[k] || !same(mx, bi[k])) out.push(mx);
      });
      return out;
    };
    const line = (bx, mx, tx, path) => fields(bx, mx, tx, ['type', 'text', 'owner', 'due', 'done', 'taskId'], path);
    const topic = (bx, mx, tx, path) => Object.assign(fields(bx, mx, tx, ['title', 'owner'], path), { items: list(bx.items, mx.items, tx.items, line, path + '.items') });
    const model = protoClean({
      title: pick(b.title, m.title, t.title, 'title'), date: pick(b.date, m.date, t.date, 'date'),
      minuteTaker: pick(b.minuteTaker, m.minuteTaker, t.minuteTaker, 'minuteTaker'),
      present: people(b.present, m.present, t.present), absent: people(b.absent, m.absent, t.absent),
      topics: list(b.topics, m.topics, t.topics, topic, 'topics'),
    });
    return { model: model, conflicts: conflicts };
  }

  return {
    jfDates, parseActionItem, safeName, PROTO_TYPES, protoClean, protoToText, protoFromText, protoOpenActions, protoMerge,
    QUICK_TABS, taskQuery, focusOrder, retryDelay, pollDelay, PROJECT_COLORS, PROJECT_PALETTE, takenProjectColors, freeProjectColor, addTime,
    STATUSES, PRIORITIES, RECURRENCES, ABSENCE_TYPES, EVENT_TYPES, PROJECT_STATUSES, TEAM_COLORS, MAX_TEAMS,
    isDate, parseDate, fmt, addDays, addMonths, weekday, mondayOf, diffDays, isoWeek,
    endOfMonth, nextOccurrence, parse, norm,
  };
}

const Shared = SharedFactory();
