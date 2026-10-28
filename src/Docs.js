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
    let people = { present: [], absent: [] };
    try { if (d.people) people = typeof d.people === 'string' ? JSON.parse(d.people) : d.people; } catch (e) { /* older rows */ }
    return Object.assign({}, d, { lockBy: locked ? d.lockBy : '', lockUntil: locked ? d.lockUntil : '', people: people });
  },
  /** For minutes: attendance and open action items, kept in the row (lists and the next meeting read no file). */
  summary_(content) {
    const m = Shared.protoFromText(content);
    return m ? { people: JSON.stringify({ present: m.present, absent: m.absent }), openItems: Shared.protoOpenActions(m) } : {};
  },
  /** File text, from the script cache while the version is unchanged (saves a Drive call per open). */
  read_(doc) {
    const key = 'docv:' + doc.id + ':' + doc.version;
    const c = CacheService.getScriptCache();
    const hit = Docs.safeGet_(c, key);
    if (hit !== null) return hit;
    const text = Store.read(doc.fileId);
    Docs.remember_(doc, text);
    return text;
  },
  remember_(doc, text) {
    // the cache holds at most 100 KB per value; longer texts are simply read from Drive
    if (text.length < 90000) { try { CacheService.getScriptCache().put('docv:' + doc.id + ':' + doc.version, text, 21600); } catch (e) { /* optional */ } }
  },
  safeGet_(c, key) { try { return c.get(key); } catch (e) { return null; } },
  preview_(text) {
    const minutes = Shared.protoFromText(text);
    if (minutes) return minutes.topics.map(t => t.title).filter(Boolean).join(' · ').slice(0, 280);
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

  get(p) {
    const x = Docs.doc_(p.id, Docs.ctx_(), false);
    return Object.assign(Docs.meta_(x.doc), { content: Docs.read_(x.doc), canWrite: Access.canManageProject(x.project, Docs.ctx_()) });
  },

  save(p) {
    const ctx = Docs.ctx_();
    const v = Docs.check_(p.title, p.content);
    return Db.tx(() => {
      if (p.id) return Docs.update_(Docs.doc_(p.id, ctx, true), v, Number(p.baseVersion), p.baseContent);
      if (p.seriesId) return Jf.createMinutes_(p, v, ctx);
      const project = Docs.project_(p.projectId, ctx, true);
      return Docs.create_(project, v, { kind: 'doc' }, Store.documents(project));
    });
  },

  /** New document file plus its row (inside a transaction); fileTitle: name of the file if not the title. */
  create_(project, v, extra, folderId, fileTitle) {
    const fileId = Gdrive.createFile(folderId, Docs.fileName_(fileTitle || v.title, extra.date), v.content);
    const now = new Date().toISOString();
    const me = Auth.email();
    const row = Db.insert('Docs', Object.assign({
      id: Util.uid('dc_'), projectId: project.id, kind: 'doc', seriesId: '', date: '', title: v.title, fileId: fileId,
      version: 1, size: v.content.length, preview: Docs.preview_(v.content), updatedAt: now, updatedBy: me, createdBy: me, createdAt: now,
      lockBy: '', lockUntil: '', people: '', openItems: [],
    }, Docs.summary_(v.content), extra));
    Docs.remember_(row, v.content);
    return row;
  },

  /** Writes a new version unless someone saved after `base` (inside a transaction). */
  update_(x, v, base, baseContent) {
    const doc = x.doc;
    const before = Docs.read_(doc);
    let merged = false;
    if (base !== Number(doc.version)) {
      // minutes saved by someone else meanwhile: merge topic by topic and line by line when nobody
      // changed the same field; otherwise both versions go back to the person (conflict dialog)
      const r = Docs.merge_(baseContent, v.content, before);
      if (!r || r.conflicts.length) return { conflict: true, conflicts: r ? r.conflicts : [], current: Object.assign(Docs.meta_(doc), { content: before }) };
      v = { title: v.title, content: Shared.protoToText(r.model) };
      merged = true;
    }
    Docs.keepVersion_(doc, before, x.project);
    Gdrive.write(doc.fileId, v.content);
    try {
      if (v.title !== doc.title && doc.kind !== 'jf') Gdrive.rename(doc.fileId, Docs.fileName_(v.title, doc.date));
      const me = Auth.email();
      const row = Db.update('Docs', doc.id, Object.assign({
        title: v.title, version: Number(doc.version) + 1, size: v.content.length, preview: Docs.preview_(v.content),
        updatedAt: new Date().toISOString(), updatedBy: me, lockBy: doc.lockBy === me ? '' : doc.lockBy, lockUntil: doc.lockBy === me ? '' : doc.lockUntil,
      }, Docs.summary_(v.content)));
      Docs.remember_(row, v.content);
      return merged ? Object.assign(Docs.meta_(row), { merged: true, mergedWith: doc.updatedBy, content: v.content }) : Docs.meta_(row);
    } catch (e) {
      // the database did not take the new version: the file goes back to what it was
      Gdrive.write(doc.fileId, before);
      throw e;
    }
  },

  /** Three-way merge of minutes (null when one of the texts is not minutes). */
  merge_(baseText, mineText, theirsText) {
    const parts = [baseText, mineText, theirsText].map(t => (typeof t === 'string' ? Shared.protoFromText(t) : null));
    return parts.every(Boolean) ? Shared.protoMerge(parts[0], parts[1], parts[2]) : null;
  },

  /** Keeps the text of the current version as a file; only the last KEEP stay, older ones go to the trash. */
  keepVersion_(doc, text, project) {
    const fileId = Gdrive.createFile(Store.versions(project), doc.id + '-v' + doc.version + '.md', text);
    Db.insert('DocVersions', { id: Util.uid('dv_'), docId: doc.id, version: Number(doc.version), fileId: fileId, at: doc.updatedAt, by: doc.updatedBy });
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

/**
 * Jour fixe: recurring meetings of a project. Each meeting has structured minutes (header,
 * numbered topics, lines of type I/A/B/N) stored like a document (see Shared.protoToText).
 * Opening a meeting writes nothing: the file is created with the first "Übernehmen".
 */
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
  active_(s) { return s.active === true || String(s.active).toLowerCase() === 'true'; },

  /** Series and minutes (metadata only, no Drive call) of one project or of all projects the person sees. */
  list(p) {
    const ctx = Docs.ctx_();
    const one = p && p.projectId ? Docs.project_(p.projectId, ctx, false).id : '';
    return Jf.overview_(ctx, one);
  },
  overview_(ctx, projectId) {
    const sees = pid => (projectId ? pid === projectId : ctx.admin || ctx.projectIds[pid]);
    return {
      series: Db.all('JfSeries').filter(s => Jf.active_(s) && sees(s.projectId)),
      minutes: Db.all('Docs').filter(d => d.kind === 'jf' && sees(d.projectId)).map(d => {
        const m = Docs.meta_(d);
        return { id: m.id, projectId: m.projectId, seriesId: m.seriesId, date: m.date, title: m.title, version: m.version,
          updatedAt: m.updatedAt, updatedBy: m.updatedBy, lockBy: m.lockBy, people: m.people, openCount: (d.openItems || []).length };
      }).sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  },

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

  /**
   * One meeting, ready to show in a single call: the saved minutes with their text, or (not saved yet)
   * a draft from the template with the open action items of the last meeting. Writes nothing.
   */
  meeting(p) {
    const ctx = Docs.ctx_();
    if (!Shared.isDate(p.date)) throw new Error('Bitte ein Datum angeben.');
    const x = Jf.series_(p.seriesId, ctx, false);
    const canWrite = Access.canManageProject(x.project, ctx);
    const found = Db.all('Docs').find(d => d.seriesId === x.series.id && d.date === p.date);
    if (found) return Object.assign(Docs.meta_(found), { content: Docs.read_(found), canWrite: canWrite });
    const prev = Db.all('Docs').filter(d => d.seriesId === x.series.id && d.date < p.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return {
      id: '', draft: true, kind: 'jf', projectId: x.project.id, seriesId: x.series.id, date: p.date, version: 0,
      title: Jf.title_(x.series, p.date), canWrite: canWrite,
      content: Jf.template_(x.series, p.date, prev ? prev.openItems || [] : [], ctx.email),
    };
  },
  title_(s, date) { return s.title + ' · ' + date; },

  /** Minutes template: header from the series; open action items of the last meeting as the first topic. */
  template_(s, date, open, me) {
    return Shared.protoToText({
      title: s.title, date: date, minuteTaker: me, present: s.attendees || [], absent: [],
      topics: open.length ? [{ id: 'carry', title: 'Offene Punkte aus dem letzten Jour Fixe', owner: '', items: open }] : [],
    });
  },

  /** First save of a meeting's minutes: the file in Jour Fixe/<series> and the row (inside the transaction of Docs.save). */
  createMinutes_(p, v, ctx) {
    const x = Jf.series_(p.seriesId, ctx, true);
    if (!Shared.isDate(p.date)) throw new Error('Bitte ein Datum angeben.');
    const found = Db.all('Docs').find(d => d.seriesId === x.series.id && d.date === p.date);
    // saved by someone else in the meantime: never a second file, show theirs instead
    if (found) return { conflict: true, current: Object.assign(Docs.meta_(found), { content: Docs.read_(found) }) };
    return Docs.create_(x.project, { title: Jf.title_(x.series, p.date), content: v.content },
      { kind: 'jf', seriesId: x.series.id, date: p.date }, Store.series(x.series, x.project), x.series.title);
  },

  /** Turns an action line (topic t, line i) of saved minutes into a project task and links the line to it. */
  actionToTask(p) {
    const ctx = Docs.ctx_();
    return Db.tx(() => {
      const x = Docs.doc_(p.docId, ctx, true);
      const model = Shared.protoFromText(Docs.read_(x.doc));
      const topic = model && model.topics[Number(p.topic)];
      const line = topic && topic.items[Number(p.item)];
      if (!line || line.type !== 'A' || line.taskId) throw new Error('Punkt nicht gefunden oder schon als Aufgabe angelegt.');
      const task = Tasks.save({ title: line.text || topic.title, projectId: x.project.id, assignees: line.owner ? [line.owner] : [ctx.email], dueDate: line.due })[0];
      line.taskId = task.id;
      const doc = Docs.update_(x, { title: x.doc.title, content: Shared.protoToText(model) }, Number(x.doc.version));
      return { task: task, doc: doc };
    });
  },
};
