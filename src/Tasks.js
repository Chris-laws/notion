/** Tasks, sub-tasks and comments. */
const Tasks = {
  /**
   * With p.ver from the last call: { same: true } while nothing changed, so polling stays tiny.
   * Without a ver field (pages from before this version) the plain list as before.
   */
  list(p) {
    const me = Auth.currentUser();
    const ver = Tasks.version_();
    const versioned = !!p && Object.prototype.hasOwnProperty.call(p, 'ver');
    if (versioned && p.ver && p.ver === ver) return { ver: ver, same: true };
    const ctx = Access.context(me);
    const tasks = Db.all('Tasks').filter(t => Access.canSeeTask(t, ctx));
    if (!versioned) return tasks;
    // the background refresh (full) also brings teams, projects, people and jour fixe: new members see
    // their team without reloading; unchanged data still costs only the version check above
    return p.full ? { ver: ver, tasks: tasks, teams: Teams.list_(), projects: Projects.list_(), users: Users.list(), jf: Jf.overview_(ctx, '') }
      : { ver: ver, tasks: tasks };
  },
  /** Taken before reading, so a write that lands meanwhile shows up next time. */
  version_() { return Db.version(['Tasks', 'Teams', 'Projects', 'Users', 'JfSeries', 'Docs']); },

  /**
   * Creates or updates a task. Only the fields present in the payload are
   * changed. Returns every task that changed (a finished recurring task
   * creates its next occurrence).
   */
  save(p) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    const fields = Tasks.sanitize_(p);
    const now = new Date().toISOString();
    return Db.tx(() => {
      if (p.id) {
        const prev = Db.get('Tasks', p.id);
        if (!prev) throw new Error('Aufgabe nicht gefunden – evtl. wurde sie gelöscht.');
        if (!Access.canSeeTask(prev, ctx)) throw new Error('Keine Berechtigung für diese Aufgabe.');
        if (fields.parentId !== undefined) Tasks.checkParent_(fields.parentId, p.id);
        // new people only once the change is allowed
        Users.ensure(fields.assignees);
        fields.updatedAt = now;
        if (fields.assignees && !fields.assignees.length) fields.assignees = [prev.createdBy || me.email];
        if (fields.status && fields.status !== prev.status) {
          fields.completedAt = fields.status === 'done' ? now : '';
        }
        const next = Db.update('Tasks', p.id, fields);
        const changed = [next];
        if (prev.status !== 'done' && next.status === 'done' && next.recurrence) {
          changed.push(Tasks.spawnNext_(next, me.email));
        }
        return changed;
      }
      Tasks.checkParent_(fields.parentId, null);
      Users.ensure(fields.assignees);
      const task = Object.assign({
        id: Util.uid('t_'),
        title: 'Ohne Titel',
        description: '',
        status: 'todo',
        priority: '',
        projectId: '',
        teams: [],
        assignees: [],
        tags: [],
        links: [],
        startDate: '',
        dueDate: '',
        estimate: 0,
        parentId: '',
        recurrence: '',
        sort: Date.now(),
        createdBy: me.email,
        createdAt: now,
        updatedAt: now,
        completedAt: '',
        planDate: '',
        planStart: 0,
        progress: 0,
        spent: 0,
        timerStart: '',
      }, fields);
      if (!task.assignees.length) task.assignees = [me.email];
      if (task.status === 'done') task.completedAt = now;
      return [Db.insert('Tasks', task)];
    });
  },

  spawnNext_(t, email) {
    const due = Shared.nextOccurrence(t.dueDate || Util.today(), t.recurrence);
    const shift = t.dueDate ? Shared.diffDays(t.dueDate, due) : 0;
    const now = new Date().toISOString();
    return Db.insert('Tasks', Object.assign({}, t, {
      id: Util.uid('t_'),
      status: 'todo',
      dueDate: due,
      startDate: t.startDate ? Shared.addDays(t.startDate, shift) : '',
      createdBy: email,
      createdAt: now,
      updatedAt: now,
      completedAt: '',
      planDate: '',
      planStart: 0,
      progress: 0,
      spent: 0,
      timerStart: '',
      sort: Date.now(),
    }));
  },

  /** Board drag & drop: several tasks at once (new order / column). */
  move(p) {
    const items = (p.items || []).slice(0, 200);
    let changed = [];
    Db.tx(() => {
      items.forEach(item => { changed = changed.concat(Tasks.save(item)); });
    });
    return changed;
  },

  /** The parent must exist and must not be the task itself or one of its sub-tasks (no cycles). */
  checkParent_(parentId, taskId) {
    if (!parentId) return;
    let x = Db.get('Tasks', parentId);
    if (!x) throw new Error('Übergeordnete Aufgabe fehlt.');
    for (let depth = 0; x && depth < 100; depth++) {
      if (x.id === taskId) throw new Error('Eine Aufgabe kann nicht ihre eigene Unteraufgabe sein.');
      x = x.parentId ? Db.get('Tasks', x.parentId) : null;
    }
  },

  remove(id) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    return Db.tx(() => {
      const t = Db.get('Tasks', id);
      if (!t) return [];
      if (!Access.canDeleteTask(t, ctx)) throw new Error('Löschen dürfen nur die erstellende Person, Team-Leads und Admins.');
      // the task and all sub-tasks below it, then their comments: one pass per table
      const all = Db.all('Tasks');
      const ids = [id];
      for (let i = 0; i < ids.length; i++) all.forEach(c => { if (c.parentId === ids[i] && ids.indexOf(c.id) < 0) ids.push(c.id); });
      const comments = Db.all('Comments').filter(c => ids.indexOf(c.taskId) >= 0).map(c => c.id);
      Db.removeMany('Comments', comments);
      Db.removeMany('Tasks', ids);
      return ids;
    });
  },

  comments(taskId) {
    const me = Auth.currentUser();
    const t = Db.get('Tasks', taskId);
    if (!t || !Access.canSeeTask(t, Access.context(me))) throw new Error('Keine Berechtigung.');
    return Db.all('Comments').filter(c => c.taskId === taskId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  addComment(p) {
    const me = Auth.currentUser();
    const t = Db.get('Tasks', p.taskId);
    if (!t || !Access.canSeeTask(t, Access.context(me))) throw new Error('Keine Berechtigung.');
    const body = String(p.body || '').trim().slice(0, 5000);
    if (!body) throw new Error('Kommentar ist leer.');
    return Db.insert('Comments', {
      id: Util.uid('c_'), taskId: t.id, author: me.email, body: body, createdAt: new Date().toISOString(),
    });
  },

  sanitize_(p) {
    const f = {};
    const has = k => Object.prototype.hasOwnProperty.call(p, k);
    if (has('title')) f.title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Ohne Titel';
    if (has('description')) f.description = String(p.description || '').slice(0, 20000);
    if (has('links')) f.links = Shared.cleanLinks(p.links);
    if (has('status')) {
      if (!Shared.STATUSES.some(s => s.key === p.status)) throw new Error('Unbekannter Status.');
      f.status = p.status;
    }
    if (has('priority')) f.priority = Shared.PRIORITIES.some(s => s.key === p.priority) ? p.priority : '';
    if (has('projectId')) {
      if (p.projectId && !Db.get('Projects', p.projectId)) throw new Error('Projekt nicht gefunden.');
      f.projectId = p.projectId || '';
    }
    if (has('teams')) {
      f.teams = (p.teams || []).filter((id, i, a) => a.indexOf(id) === i && Db.get('Teams', id));
    }
    if (has('assignees')) f.assignees = cleanEmails_(p.assignees);
    if (has('tags')) {
      f.tags = (p.tags || []).map(s => String(s).trim().slice(0, 30)).filter(Boolean)
        .filter((s, i, a) => a.indexOf(s) === i).slice(0, 20);
    }
    ['startDate', 'dueDate'].forEach(k => {
      if (has(k)) f[k] = Shared.isDate(p[k]) ? p[k] : '';
    });
    // Day planner: the time block of a task (date + start in minutes since midnight, 5-minute steps).
    if (has('planDate')) f.planDate = Shared.isDate(p.planDate) ? p.planDate : '';
    if (has('planStart')) f.planStart = Math.max(0, Math.min(1435, Math.round((Number(p.planStart) || 0) / 5) * 5));
    if (f.planDate === '') f.planStart = 0;
    // Progress: 0 = automatic (derived from status and sub-tasks), 1-100 = set by hand.
    if (has('progress')) f.progress = Math.max(0, Math.min(100, Math.round(Number(p.progress) || 0)));
    // Time tracking: minutes spent, and the start of a running timer.
    if (has('spent')) f.spent = Math.max(0, Math.min(100000, Math.round(Number(p.spent) || 0)));
    if (has('timerStart')) f.timerStart = p.timerStart && !isNaN(new Date(p.timerStart).getTime()) ? new Date(p.timerStart).toISOString() : '';
    if (has('estimate')) f.estimate = Math.max(0, Math.min(1000, Math.round((Number(p.estimate) || 0) * 100) / 100));
    if (has('parentId')) f.parentId = p.parentId || '';
    if (has('recurrence')) f.recurrence = Shared.RECURRENCES.some(r => r.key === p.recurrence) ? p.recurrence : '';
    if (has('sort')) f.sort = Number(p.sort) || 0;
    if (f.parentId && f.parentId === p.id) throw new Error('Eine Aufgabe kann nicht ihre eigene Unteraufgabe sein.');
    return f;
  },
};

const Util = {
  uid(prefix) {
    return (prefix || '') + Utilities.getUuid().replace(/-/g, '').slice(0, 14);
  },
  today() {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },
};
