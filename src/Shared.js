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

  // ---------------------------------------------------------------- dates
  function isDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
        return d;
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

  return {
    STATUSES, PRIORITIES, RECURRENCES, ABSENCE_TYPES, EVENT_TYPES, PROJECT_STATUSES,
    isDate, parseDate, fmt, addDays, addMonths, weekday, mondayOf, diffDays, isoWeek,
    endOfMonth, nextOccurrence, parse, norm,
  };
}

const Shared = SharedFactory();
