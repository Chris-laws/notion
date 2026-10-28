/**
 * Folders and files in the owner's Drive, through the Drive REST API with the app's own token.
 * Scope drive.file: the app only sees the files and folders it created itself (DriveApp would need
 * access to the whole Drive, so it is not used).
 *
 *   LidlFlow/                        root, id in the script property DRIVE_ROOT_FOLDER_ID
 *     Projects/<team>/<project>/
 *       Documents/                   documents (Markdown files)
 *       Jour Fixe/<series>/          minutes of each meeting
 *       .versions/                   earlier versions of the files above
 *
 * Folder ids are kept in the Folders table, so renaming a team or project renames its folder
 * and files stay where they are. Names pass Shared.safeName (no path characters).
 * To move everything to a shared drive later: move the LidlFlow folder there; ids stay the same.
 */
const Gdrive = {
  API: 'https://www.googleapis.com/drive/v3/files',
  UPLOAD: 'https://www.googleapis.com/upload/drive/v3/files',
  FOLDER: 'application/vnd.google-apps.folder',

  call_(method, url, body, contentType) {
    const opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
    if (body !== undefined) { opts.payload = body; opts.contentType = contentType || 'application/json'; }
    const res = UrlFetchApp.fetch(url, opts);
    const code = res.getResponseCode();
    // 403 also means "too many requests" or "storage full": that is no missing permission
    if ((code === 403 || code === 429) && /rateLimit|userRateLimit|quotaExceeded|storageQuota/i.test(res.getContentText())) {
      throw new Error('Google Drive ist gerade ausgelastet oder der Speicher ist voll. Bitte gleich noch einmal versuchen.');
    }
    if (code === 401 || code === 403) {
      throw new Error('Die App darf noch nicht in Google Drive speichern. Bitte im Apps-Script-Editor einmal „setup“ ausführen und die Berechtigung zulassen.');
    }
    if (code === 404) throw new Error('Datei in Google Drive nicht gefunden.');
    if (code >= 300) throw new Error('Google Drive antwortet mit ' + code + '.');
    return res.getContentText();
  },
  json_(method, url, body) {
    const text = Gdrive.call_(method, url, body === undefined ? undefined : JSON.stringify(body));
    return text ? JSON.parse(text) : {};
  },
  q_(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; },

  /** Folder `name` inside parentId (or at the top of My Drive): found or created. */
  folder(name, parentId) {
    const q = 'name = ' + Gdrive.q_(name) + " and mimeType = '" + Gdrive.FOLDER + "' and trashed = false" + (parentId ? ' and ' + Gdrive.q_(parentId) + ' in parents' : '');
    const found = Gdrive.json_('get', Gdrive.API + '?fields=files(id)&q=' + encodeURIComponent(q)).files || [];
    if (found.length) return found[0].id;
    return Gdrive.json_('post', Gdrive.API + '?fields=id', Object.assign({ name: name, mimeType: Gdrive.FOLDER }, parentId ? { parents: [parentId] } : {})).id;
  },
  exists(id) {
    try { return !Gdrive.json_('get', Gdrive.API + '/' + encodeURIComponent(id) + '?fields=trashed').trashed; } catch (e) {
      if (/nicht gefunden/.test(e.message)) return false;
      throw e;
    }
  },
  createFile(parentId, name, content) {
    const b = 'lidlflow' + Date.now().toString(36);
    const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: name, parents: [parentId], mimeType: 'text/plain' }) +
      '\r\n--' + b + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + content + '\r\n--' + b + '--';
    return JSON.parse(Gdrive.call_('post', Gdrive.UPLOAD + '?uploadType=multipart&fields=id', body, 'multipart/related; boundary=' + b)).id;
  },
  read(id) { return Gdrive.call_('get', Gdrive.API + '/' + encodeURIComponent(id) + '?alt=media'); },
  write(id, content) { Gdrive.call_('patch', Gdrive.UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media', content, 'text/plain; charset=UTF-8'); },
  rename(id, name) { Gdrive.json_('patch', Gdrive.API + '/' + encodeURIComponent(id) + '?fields=id', { name: name }); },
  /** To the Drive trash (restorable there for 30 days), never deleted for good. */
  trash(id) { Gdrive.json_('patch', Gdrive.API + '/' + encodeURIComponent(id) + '?fields=id', { trashed: true }); },
};

const Store = {
  ROOT_NAME: 'LidlFlow',

  root() {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('DRIVE_ROOT_FOLDER_ID');
    if (id && Gdrive.exists(id)) return id;
    const made = Gdrive.folder(Store.ROOT_NAME, '');
    props.setProperty('DRIVE_ROOT_FOLDER_ID', made);
    return made;
  },

  /** Folder id remembered under key (e.g. "project:<id>"); made inside parent() when missing. */
  folder_(key, parent, name) {
    const row = Db.get('Folders', key);
    if (row && Gdrive.exists(row.folderId)) return row.folderId;
    const id = Gdrive.folder(name, parent());
    if (row) Db.update('Folders', key, { folderId: id });
    else Db.insert('Folders', { key: key, folderId: id });
    return id;
  },

  team_(team) {
    return Store.folder_('team:' + team.id, () => Gdrive.folder('Projects', Store.root()), Shared.safeName(team.name));
  },
  project(project) {
    const team = Db.get('Teams', project.teamId) || { id: 'none', name: 'Ohne Team' };
    return Store.folder_('project:' + project.id, () => Store.team_(team), Shared.safeName(project.name));
  },
  documents(project) {
    return Store.folder_('docs:' + project.id, () => Store.project(project), 'Documents');
  },
  series(series, project) {
    const jf = () => Store.folder_('jf:' + project.id, () => Store.project(project), 'Jour Fixe');
    return Store.folder_('series:' + series.id, jf, Shared.safeName(series.title));
  },
  versions(project) {
    return Store.folder_('versions:' + project.id, () => Store.project(project), '.versions');
  },

  /** Renames the folder of a team or project (best effort: the files keep working either way). */
  rename(key, name) {
    const row = Db.get('Folders', key);
    if (!row) return;
    try { Gdrive.rename(row.folderId, Shared.safeName(name)); } catch (e) { console.warn('rename folder ' + key + ': ' + e.message); }
  },

  read(fileId) { return Gdrive.read(fileId); },

  trash(fileId) {
    try { Gdrive.trash(fileId); } catch (e) { console.warn('trash ' + fileId + ': ' + e.message); }
  },

  /** Links for the admin page: the Drive folder, the database and the backups (admins only). */
  adminLinks() {
    if (!Auth.isAdmin(Auth.currentUser())) throw new Error('Nur Admins sehen die Ablage.');
    return Store.links();
  },
  links() {
    const props = PropertiesService.getScriptProperties();
    const sheet = id => (id ? 'https://docs.google.com/spreadsheets/d/' + id : '');
    const root = props.getProperty('DRIVE_ROOT_FOLDER_ID');
    return {
      drive: root ? 'https://drive.google.com/drive/folders/' + root : '',
      database: sheet(props.getProperty('SPREADSHEET_ID')),
      backups: sheet(props.getProperty('BACKUP_SPREADSHEET_ID')),
    };
  },
};
