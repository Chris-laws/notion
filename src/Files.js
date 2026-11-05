/**
 * Images in task descriptions and jour fixe minutes. The page shrinks them (at most about 1600 px) and sends
 * them here; they are stored in the owner's Drive next to the project (LidlFlow/Projects/<team>/<project>/Bilder,
 * tasks without a project in LidlFlow/Bilder). The database keeps only id and place (sheet Files); the text
 * holds a marker ![name](lf:<id>). People get an image only when they may see its task or project:
 * the files are not shared in Drive, the app hands them out.
 */
const Files = {
  MAX: 3 * 1024 * 1024,
  // no SVG: it can carry script
  TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  // attachments of a jour fixe topic (v62): documents next to the images; the first bytes must fit, never HTML or script
  DOC_TYPES: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
    'text/plain': 'text', 'text/csv': 'text',
  },

  upload(p) {
    const ctx = Access.context(Auth.currentUser());
    const mime = String((p && p.mime) || '');
    const doc = !!p && p.attach === true && Object.prototype.hasOwnProperty.call(Files.DOC_TYPES, mime);
    const bytes = Files.decode_(p, mime, doc);
    const name = Shared.safeName(String(p.name || 'Bild').slice(0, 80)) || 'Bild';
    const place = Db.tx(() => Files.place_(p, ctx));
    Files.quota_(ctx.email, bytes.length);
    // Drive outside the lock; the row afterwards (if that fails, the file goes to the trash)
    const driveId = Gdrive.createBlob(place.folder, name, Utilities.newBlob(bytes, mime, name));
    try {
      const row = Db.insert('Files', { id: Util.uid('fl_'), driveId: driveId, kind: place.kind, taskId: place.taskId, projectId: place.projectId,
        name: name, mime: mime, size: bytes.length, createdBy: ctx.email, createdAt: new Date().toISOString() });
      return { id: row.id, name: name, mime: mime, size: bytes.length, token: '![' + name.replace(/[[\]()]/g, '') + '](lf:' + row.id + ')' };
    } catch (e) {
      try { Store.trash(driveId); } catch (x) { /* best effort */ }
      throw e;
    }
  },

  /** The bytes of an upload, after checking type, size and content (too long is refused before decoding). */
  decode_(p, mime, doc) {
    if (Files.TYPES.indexOf(mime) < 0 && !doc) throw new Error(p.attach === true ? 'Dieser Dateityp ist nicht erlaubt (Bilder, PDF, Word, Excel, PowerPoint, Text).' : 'Nur Bilder (JPEG, PNG, GIF oder WebP).');
    if (String(p.data || '').length > Math.ceil(Files.MAX * 4 / 3) + 4) throw new Error('Die Datei ist zu groß (höchstens 3 MB).');
    const bytes = Utilities.base64Decode(String(p.data || ''));
    if (!bytes.length || bytes.length > Files.MAX) throw new Error('Die Datei ist zu groß (höchstens 3 MB).');
    if (!Files.looksLike_(bytes, mime)) throw new Error(doc ? 'Der Inhalt passt nicht zum Dateityp.' : 'Das ist kein gültiges Bild.');
    return bytes;
  },

  /** Per person and day at most FILES_USER_DAILY images (default 50) and FILES_USER_DAILY_MB megabytes (default 100). */
  quota_(email, size) {
    const c = CacheService.getScriptCache();
    const key = 'flq:' + Util.today() + ':' + email;
    const used = JSON.parse(c.get(key) || '{"n":0,"b":0}');
    if (used.n >= Number(Config.get('FILES_USER_DAILY') || 50) || used.b + size > Number(Config.get('FILES_USER_DAILY_MB') || 100) * 1024 * 1024) {
      throw new Error('Heute wurden schon sehr viele Bilder hochgeladen. Bitte morgen weiter.');
    }
    c.put(key, JSON.stringify({ n: used.n + 1, b: used.b + size }), 86400);
  },
  /** Images of deleted tasks go to the Drive trash (restorable there for 30 days). */
  dropForTasks_(taskIds) {
    const rows = Db.all('Files').filter(r => r.kind === 'task' && taskIds.indexOf(r.taskId) >= 0);
    if (!rows.length) return;
    Db.removeMany('Files', rows.map(r => r.id));
    rows.forEach(r => { try { Store.trash(r.driveId); } catch (e) { console.error('trash image: ' + e.message); } });
  },

  /** Where an image belongs and may go: a task the person sees, or a project they may write in (minutes). */
  place_(p, ctx) {
    if (p.kind === 'task') {
      const task = Db.get('Tasks', p.taskId);
      if (!task || !Access.canSeeTask(task, ctx)) throw new Error('Aufgabe nicht gefunden.');
      const project = task.projectId ? Db.get('Projects', task.projectId) : null;
      return { kind: 'task', taskId: task.id, projectId: project ? project.id : '', folder: Files.folder_(project) };
    }
    const project = Docs.project_(p.projectId, ctx, true);
    return { kind: 'project', taskId: '', projectId: project.id, folder: Files.folder_(project) };
  },
  folder_(project) {
    return project ? Store.folder_('images:' + project.id, () => Store.project(project), 'Bilder') : Store.folder_('images:none', () => Store.root(), 'Bilder');
  },

  /** The first bytes say what a file really is (the browser's type alone is not trusted). */
  looksLike_(bytes, mime) {
    const b = i => (bytes[i] + 256) % 256;
    const text = (from, s) => s.split('').every((c, i) => b(from + i) === c.charCodeAt(0));
    const kind = Files.DOC_TYPES[mime];
    if (kind === 'text') return !Array.prototype.slice.call(bytes, 0, 4000).some(x => x === 0);
    const heads = { 'image/jpeg': () => b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff, 'image/png': () => b(0) === 0x89 && text(1, 'PNG'), 'image/gif': () => text(0, 'GIF8'),
      pdf: () => text(0, '%PDF'), zip: () => b(0) === 0x50 && b(1) === 0x4b && b(2) === 3 && b(3) === 4 };
    return heads[kind || mime] ? heads[kind || mime]() : text(0, 'RIFF') && text(8, 'WEBP');
  },


  /** The image, for people who see its task (or, the task gone, its project). */
  get(p) {
    const ctx = Access.context(Auth.currentUser());
    const row = Db.get('Files', p && p.id);
    if (!row || !Files.mayRead_(row, ctx)) throw new Error('Bild nicht gefunden.');
    return { id: row.id, name: row.name, mime: row.mime, data: Utilities.base64Encode(Gdrive.readBytes(row.driveId)) };
  },
  mayRead_(row, ctx) {
    if (ctx.admin) return true;
    const task = row.taskId ? Db.get('Tasks', row.taskId) : null;
    if (task) return Access.canSeeTask(task, ctx);
    return !!row.projectId && Docs.sees_(row.projectId, ctx);
  },
};
