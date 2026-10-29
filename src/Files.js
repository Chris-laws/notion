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

  upload(p) {
    const ctx = Access.context(Auth.currentUser());
    const mime = String((p && p.mime) || '');
    if (Files.TYPES.indexOf(mime) < 0) throw new Error('Nur Bilder (JPEG, PNG, GIF oder WebP).');
    // too long is refused before decoding (no work for oversized sends)
    if (String(p.data || '').length > Math.ceil(Files.MAX * 4 / 3) + 4) throw new Error('Das Bild ist zu groß (höchstens 3 MB).');
    const bytes = Utilities.base64Decode(String(p.data || ''));
    if (!bytes.length || bytes.length > Files.MAX) throw new Error('Das Bild ist zu groß (höchstens 3 MB).');
    if (!Files.looksLike_(bytes, mime)) throw new Error('Das ist kein gültiges Bild.');
    const name = Shared.safeName(String(p.name || 'Bild').slice(0, 80)) || 'Bild';
    const place = Db.tx(() => Files.place_(p, ctx));
    Files.quota_(ctx.email, bytes.length);
    // Drive outside the lock; the row afterwards (if that fails, the file goes to the trash)
    const driveId = Gdrive.createBlob(place.folder, name, Utilities.newBlob(bytes, mime, name));
    try {
      const row = Db.insert('Files', { id: Util.uid('fl_'), driveId: driveId, kind: place.kind, taskId: place.taskId, projectId: place.projectId,
        name: name, mime: mime, size: bytes.length, createdBy: ctx.email, createdAt: new Date().toISOString() });
      return { id: row.id, name: name, token: '![' + name.replace(/[[\]()]/g, '') + '](lf:' + row.id + ')' };
    } catch (e) {
      try { Store.trash(driveId); } catch (x) { /* best effort */ }
      throw e;
    }
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
    if (mime === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
    if (mime === 'image/png') return b(0) === 0x89 && text(1, 'PNG');
    if (mime === 'image/gif') return text(0, 'GIF8');
    return text(0, 'RIFF') && text(8, 'WEBP');
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
    return !!row.projectId && !!ctx.projectIds[row.projectId];
  },
};
