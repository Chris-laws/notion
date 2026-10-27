/**
 * Documents and jour fixe minutes of a project. People write them in the app; the text is stored
 * as a Markdown file in the owner's Drive (see Store), the database keeps the metadata.
 *
 * - Everyone who sees the project reads; whoever may change the project writes.
 * - Every save names the version it started from. If someone saved in between, nothing is written
 *   and the current text comes back ({ conflict: true, current }), so nobody overwrites anybody.
 * - The last KEEP versions stay as files in .versions and can be restored.
 * - Deleting moves the files to the Drive trash.
 */
const Docs = {
  MAX: 300000,
  KEEP: 10,
  LOCK_MIN: 5,

  /** The project of a document or list, checked for the signed-in person. */
  project_(projectId, ctx, write) {
    const project = Db.get('Projects', projectId);
    if (!project || !(ctx.admin || ctx.projectIds[project.id])) throw new Error('Projekt nicht gefunden.');
    if (write && !Access.canManageProject(project, ctx)) throw new Error('Keine Berechtigung für dieses Projekt.');
    return project;
  },
  doc_(id, ctx, write) {
    const doc = Db.get('Docs', id);
    if (!doc) throw new Error('Dokument nicht gefunden.');
    try { return { doc: doc, project: Docs.project_(doc.projectId, ctx, write) }; } catch (e) {
      throw new Error(/Berechtigung/.test(e.message) ? e.message : 'Dokument nicht gefunden.');
    }
  },
  ctx_() { return Access.context(Auth.currentUser()); },

  /** What lists show: no content, the lock only while it lasts. */
  meta_(d) {
    const locked = d.lockBy && String(d.lockUntil) > new Date().toISOString();
    return Object.assign({}, d, { lockBy: locked ? d.lockBy : '', lockUntil: locked ? d.lockUntil : '' });
  },
  preview_(text) {
    return String(text).replace(/[#*_>`|[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
  },
  fileName_(title, date) {
    return (date ? date + ' ' : '') + Shared.safeName(title) + '.md';
  },
  check_(title, content) {
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) throw new Error('Bitte einen Titel angeben.');
    const c = String(content === undefined || content === null ? '' : content);
    if (c.length > Docs.MAX) throw new Error('Das Dokument ist zu lang (höchstens 300.000 Zeichen).');
    return { title: t, content: c };
  },

  list(p) {
    const ctx = Docs.ctx_();
    const project = Docs.project_(p.projectId, ctx, false);
    return Db.all('Docs').filter(d => d.projectId === project.id && d.kind !== 'jf').map(Docs.meta_)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  get(p) {
    const x = Docs.doc_(p.id, Docs.ctx_(), false);
    return Object.assign(Docs.meta_(x.doc), { content: Store.read(x.doc.fileId), canWrite: Access.canManageProject(x.project, Docs.ctx_()) });
  },

  save(p) {
    const ctx = Docs.ctx_();
    const v = Docs.check_(p.title, p.content);
    return Db.tx(() => {
      if (p.id) return Docs.update_(Docs.doc_(p.id, ctx, true), v, Number(p.baseVersion));
      const project = Docs.project_(p.projectId, ctx, true);
      return Docs.create_(project, v, { kind: 'doc' }, Store.documents(project));
    });
  },

  /** New document file plus its row (inside a transaction); fileTitle: name of the file if not the title. */
  create_(project, v, extra, folder, fileTitle) {
    const file = folder.createFile(Docs.fileName_(fileTitle || v.title, extra.date), v.content, 'text/markdown');
    const now = new Date().toISOString();
    const me = Auth.email();
    return Db.insert('Docs', Object.assign({
      id: Util.uid('dc_'), projectId: project.id, kind: 'doc', seriesId: '', date: '', title: v.title, fileId: file.getId(),
      version: 1, size: v.content.length, preview: Docs.preview_(v.content), updatedAt: now, updatedBy: me, createdBy: me, createdAt: now,
      lockBy: '', lockUntil: '',
    }, extra));
  },

  /** Writes a new version unless someone saved after `base` (inside a transaction). */
  update_(x, v, base) {
    const doc = x.doc;
    const file = DriveApp.getFileById(doc.fileId);
    const before = file.getBlob().getDataAsString();
    if (base !== Number(doc.version)) {
      return { conflict: true, current: Object.assign(Docs.meta_(doc), { content: before }) };
    }
    Docs.keepVersion_(doc, before, x.project);
    file.setContent(v.content);
    try {
      if (v.title !== doc.title && doc.kind !== 'jf') file.setName(Docs.fileName_(v.title, doc.date));
      const me = Auth.email();
      return Db.update('Docs', doc.id, {
        title: v.title, version: Number(doc.version) + 1, size: v.content.length, preview: Docs.preview_(v.content),
        updatedAt: new Date().toISOString(), updatedBy: me, lockBy: doc.lockBy === me ? '' : doc.lockBy, lockUntil: doc.lockBy === me ? '' : doc.lockUntil,
      });
    } catch (e) {
      // the database did not take the new version: the file goes back to what it was
      file.setContent(before);
      throw e;
    }
  },

  /** Keeps the text of the current version as a file; only the last KEEP stay, older ones go to the trash. */
  keepVersion_(doc, text, project) {
    const f = Store.versions(project).createFile(doc.id + '-v' + doc.version + '.md', text, 'text/markdown');
    Db.insert('DocVersions', { id: Util.uid('dv_'), docId: doc.id, version: Number(doc.version), fileId: f.getId(), at: doc.updatedAt, by: doc.updatedBy });
    const all = Db.all('DocVersions').filter(r => r.docId === doc.id).sort((a, b) => b.version - a.version);
    all.slice(Docs.KEEP).forEach(r => { Store.trash(r.fileId); Db.remove('DocVersions', r.id); });
  },

  versions(p) {
    Docs.doc_(p.id, Docs.ctx_(), false);
    return Db.all('DocVersions').filter(r => r.docId === p.id).sort((a, b) => b.version - a.version)
      .map(r => ({ version: r.version, at: r.at, by: r.by }));
  },

  /** Brings back an earlier version as the newest one. */
  restore(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.id, ctx, true);
      const row = Db.all('DocVersions').find(r => r.docId === p.id && Number(r.version) === Number(p.version));
      if (!row) throw new Error('Diese Version gibt es nicht mehr.');
      return Docs.update_(x, { title: x.doc.title, content: Store.read(row.fileId) }, Number(x.doc.version));
    });
  },

  /** "Wird gerade von X bearbeitet": shown to others for LOCK_MIN minutes, renewed while typing. */
  lock(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.id, ctx, true);
      const until = new Date(Date.now() + Docs.LOCK_MIN * 60000).toISOString();
      return Docs.meta_(Db.update('Docs', x.doc.id, { lockBy: ctx.email, lockUntil: until }));
    });
  },
  unlock(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.id, ctx, true);
      if (x.doc.lockBy !== ctx.email) return Docs.meta_(x.doc);
      return Docs.meta_(Db.update('Docs', x.doc.id, { lockBy: '', lockUntil: '' }));
    });
  },

  remove(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.id, ctx, true);
      const versions = Db.all('DocVersions').filter(r => r.docId === x.doc.id);
      Db.removeMany('DocVersions', versions.map(r => r.id));
      Db.remove('Docs', x.doc.id);
      Store.trash(x.doc.fileId);
      versions.forEach(r => Store.trash(r.fileId));
      return true;
    });
  },
};

/** Jour fixe: recurring meetings of a project with minutes from a template. */
const Jf = {
  RHYTHMS: ['weekly', 'biweekly', 'monthly'],

  series_(id, ctx, write) {
    const s = Db.get('JfSeries', id);
    if (!s) throw new Error('Jour Fixe nicht gefunden.');
    let project;
    try { project = Docs.project_(s.projectId, ctx, write); } catch (e) {
      throw new Error(/Berechtigung/.test(e.message) ? e.message : 'Jour Fixe nicht gefunden.');
    }
    return { series: s, project: project };
  },

  list(p) {
    const ctx = Docs.ctx_();
    const project = Docs.project_(p.projectId, ctx, false);
    return {
      series: Db.all('JfSeries').filter(s => s.projectId === project.id && Jf.active_(s)),
      meetings: Db.all('Docs').filter(d => d.projectId === project.id && d.kind === 'jf').map(Docs.meta_)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  },
  active_(s) { return s.active === true || String(s.active).toLowerCase() === 'true'; },

  saveSeries(p) {
    const ctx = Docs.ctx_();
    const title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title) throw new Error('Bitte einen Titel angeben.');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(p.time) ? p.time : '09:00';
    const data = {
      title: title,
      rhythm: Jf.RHYTHMS.indexOf(p.rhythm) >= 0 ? p.rhythm : 'weekly',
      weekday: Math.max(0, Math.min(6, Math.round(Number(p.weekday)) || 0)),
      time: time,
      duration: Math.max(15, Math.min(480, Math.round(Number(p.duration) || 30))),
      startDate: Shared.isDate(p.startDate) ? p.startDate : Util.today(),
      endDate: Shared.isDate(p.endDate) ? p.endDate : '',
      attendees: cleanEmails_(p.attendees),
      // only real meeting links, nothing that could run script
      meetLink: /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,40}$/i.test(String(p.meetLink || '').trim()) ? String(p.meetLink).trim() : '',
    };
    return Db.tx(() => {
      if (p.id) {
        const x = Jf.series_(p.id, ctx, true);
        return Db.update('JfSeries', x.series.id, data);
      }
      const project = Docs.project_(p.projectId, ctx, true);
      Users.ensure(data.attendees);
      return Db.insert('JfSeries', Object.assign(data, {
        id: Util.uid('jf_'), projectId: project.id, active: true, createdBy: ctx.email, createdAt: new Date().toISOString(),
      }));
    });
  },

  /** Ends a series: no more meetings in the calendar; all minutes stay. */
  removeSeries(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => Db.update('JfSeries', Jf.series_(p.id, ctx, true).series.id, { active: false }));
  },

  /** Meetings in a date range of the series the person can see (for the calendar). */
  events(from, to, ctx) {
    const out = [];
    Db.all('JfSeries').filter(s => Jf.active_(s) && (ctx.admin || ctx.projectIds[s.projectId])).forEach(s => {
      Shared.jfDates(s, from, to).forEach(d => out.push({
        id: 'jf_' + s.id + '_' + d, type: 'jf', title: s.title, startDate: d, endDate: d, time: s.time, duration: s.duration,
        seriesId: s.id, projectId: s.projectId, attendees: s.attendees || [], teamId: '', note: '',
      }));
    });
    return out;
  },

  /** The minutes of one meeting: opened when they exist, otherwise made from the template (needs write rights). */
  meeting(p) {
    const ctx = Docs.ctx_();
    if (!Shared.isDate(p.date)) throw new Error('Bitte ein Datum angeben.');
    return Db.tx(() => {
      const x = Jf.series_(p.seriesId, ctx, false);
      const found = Db.all('Docs').find(d => d.seriesId === x.series.id && d.date === p.date);
      if (found) return Docs.meta_(found);
      Jf.series_(p.seriesId, ctx, true);
      const prev = Db.all('Docs').filter(d => d.seriesId === x.series.id && d.date < p.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const content = Jf.template_(x.series, p.date, prev ? Store.read(prev.fileId) : '', p.lang === 'en');
      const v = { title: x.series.title + ' · ' + p.date, content: content };
      return Docs.create_(x.project, v, { kind: 'jf', seriesId: x.series.id, date: p.date }, Store.series(x.series, x.project), x.series.title);
    });
  },

  /** Minutes template; open action items of the last meeting are carried over. */
  template_(s, date, prevText, en) {
    const L = (de, e) => (en ? e : de);
    const open = String(prevText).split('\n').filter(line => {
      const a = Shared.parseActionItem(line);
      return a && !a.done && a.text;
    }).map(line => line.trim().replace(/^\*/, '-'));
    const lines = [
      '# ' + s.title + ' – ' + date,
      '',
      '**' + L('Zeit', 'Time') + ':** ' + s.time + ' (' + s.duration + ' ' + L('Min.', 'min') + ')' + (s.meetLink ? ' · **Meet:** ' + s.meetLink : ''),
      '',
      '## ' + L('Teilnehmende', 'Attendees'),
    ].concat((s.attendees || []).map(e => '- @' + e), [
      '',
      '## Agenda',
      '- ',
      '',
    ]);
    if (open.length) lines.push('## ' + L('Offene Punkte vom letzten Jour Fixe', 'Open items from the last meeting'), ...open, '');
    return lines.concat([
      '## ' + L('Notizen', 'Notes'), '', '',
      '## ' + L('Beschlüsse', 'Decisions'), '- ', '',
      '## Action Items', '- [ ] ', '',
    ]).join('\n');
  },

  /** Turns one open action item of a document into a project task and links the line to it. */
  actionToTask(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.docId, ctx, true);
      const text = Store.read(x.doc.fileId);
      const lines = text.split('\n');
      const i = lines.findIndex(line => {
        const a = Shared.parseActionItem(line);
        return a && !a.taskId && a.text === String(p.text || '').trim();
      });
      if (i < 0) throw new Error('Punkt nicht gefunden oder schon als Aufgabe angelegt.');
      const a = Shared.parseActionItem(lines[i]);
      const task = Tasks.save({ title: a.text, projectId: x.project.id, assignees: a.assignee ? [a.assignee] : [ctx.email], dueDate: a.due })[0];
      lines[i] = lines[i].replace(/\s+$/, '') + ' ⟶ #' + task.id;
      const doc = Docs.update_(x, { title: x.doc.title, content: lines.join('\n') }, Number(x.doc.version));
      return { task: task, doc: doc };
    });
  },
};
