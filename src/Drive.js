/**
 * Folders and files in the owner's Drive. Scope drive.file: the app only sees the files and folders it
 * created itself (DriveApp would need access to the whole Drive, so it is not used). Two ways in, same
 * result: the built-in Drive service (Drive API v3, enabled in appsscript.json; needs no external
 * requests, so it works where an organisation blocks UrlFetchApp), else the REST API with the app's token.
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
    if (code >= 300) console.error('Drive ' + method + ' ' + url.split('?')[0] + ' -> ' + code + ': ' + res.getContentText().slice(0, 500));
    // 403 also means "too many requests" or "storage full": that is no missing permission
    if ((code === 403 || code === 429) && /rateLimit|userRateLimit|quotaExceeded|storageQuota/i.test(res.getContentText())) {
      throw new Error('Google Drive ist gerade ausgelastet oder der Speicher ist voll. Bitte gleich noch einmal versuchen.');
    }
    if (code === 401 || code === 403) {
      throw new Error('Die App darf noch nicht in Google Drive speichern. Bitte im Apps-Script-Editor einmal „setup“ ausführen und die Berechtigung zulassen.' + Gdrive.why_(code, res.getContentText()));
    }
    if (code === 404) throw new Error('Datei in Google Drive nicht gefunden.');
    if (code >= 300) throw new Error('Google Drive antwortet mit ' + code + '.' + Gdrive.why_(code, res.getContentText()));
    return res.getContentText();
  },
  /** The reason Google gave, short (e.g. "Drive API has not been used in project …"), for the message and the log. */
  why_(code, text) {
    let reason = '';
    try { reason = JSON.parse(text).error.message; } catch (e) { reason = String(text || ''); }
    return reason ? ' (Google ' + code + ': ' + String(reason).replace(/\s+/g, ' ').slice(0, 200) + ')' : '';
  },
  json_(method, url, body) {
    const text = Gdrive.call_(method, url, body === undefined ? undefined : JSON.stringify(body));
    return text ? JSON.parse(text) : {};
  },
  q_(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; },

  /** The built-in Drive service (Drive API v3) when it is switched on: works without external requests. */
  svc_() { return typeof Drive !== 'undefined' && Drive && Drive.Files ? Drive.Files : null; },
  /** Runs a call of the Drive service; its permission errors get the same message as the REST path. */
  run_(fn) {
    try { return fn(); } catch (e) {
      const msg = String(e && e.message);
      console.error('Drive service: ' + msg);
      const why = ' (Google: ' + msg.replace(/\s+/g, ' ').slice(0, 200) + ')';
      if (/not found/i.test(msg)) throw new Error('Datei in Google Drive nicht gefunden.');
      if (/rateLimit|quotaExceeded|storageQuota/i.test(msg)) throw new Error('Google Drive ist gerade ausgelastet oder der Speicher ist voll. Bitte gleich noch einmal versuchen.');
      if (/permission|insufficient|authoriz/i.test(msg)) throw new Error('Die App darf noch nicht in Google Drive speichern. Bitte im Apps-Script-Editor einmal „setup“ ausführen und die Berechtigung zulassen.' + why);
      throw e;
    }
  },
  blob_(content) { return Utilities.newBlob(String(content), 'text/plain'); },

  /** Folder `name` inside parentId (or at the top of My Drive): found or created. */
  folder(name, parentId) {
    const q = 'name = ' + Gdrive.q_(name) + " and mimeType = '" + Gdrive.FOLDER + "' and trashed = false" + (parentId ? ' and ' + Gdrive.q_(parentId) + ' in parents' : '');
    const meta = Object.assign({ name: name, mimeType: Gdrive.FOLDER }, parentId ? { parents: [parentId] } : {});
    const svc = Gdrive.svc_();
    if (svc) {
      return Gdrive.run_(() => {
        const found = svc.list({ q: q, fields: 'files(id)' }).files || [];
        return found.length ? found[0].id : svc.create(meta).id;
      });
    }
    const found = Gdrive.json_('get', Gdrive.API + '?fields=files(id)&q=' + encodeURIComponent(q)).files || [];
    if (found.length) return found[0].id;
    return Gdrive.json_('post', Gdrive.API + '?fields=id', meta).id;
  },
  exists(id) {
    try {
      const svc = Gdrive.svc_();
      const f = svc ? Gdrive.run_(() => svc.get(id, { fields: 'trashed' })) : Gdrive.json_('get', Gdrive.API + '/' + encodeURIComponent(id) + '?fields=trashed');
      return !f.trashed;
    } catch (e) {
      if (/nicht gefunden/.test(e.message)) return false;
      throw e;
    }
  },
  createFile(parentId, name, content) {
    const svc = Gdrive.svc_();
    if (svc) return Gdrive.run_(() => svc.create({ name: name, parents: [parentId], mimeType: 'text/plain' }, Gdrive.blob_(content)).id);
    const b = 'lidlflow' + Date.now().toString(36);
    const body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: name, parents: [parentId], mimeType: 'text/plain' }) +
      '\r\n--' + b + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + content + '\r\n--' + b + '--';
    return JSON.parse(Gdrive.call_('post', Gdrive.UPLOAD + '?uploadType=multipart&fields=id', body, 'multipart/related; boundary=' + b)).id;
  },
  read(id) {
    const svc = Gdrive.svc_();
    if (!svc) return Gdrive.call_('get', Gdrive.API + '/' + encodeURIComponent(id) + '?alt=media');
    const r = Gdrive.run_(() => svc.get(id, { alt: 'media' }));
    // the service hands back text, a blob or bytes depending on the runtime
    if (typeof r === 'string') return r;
    if (r && typeof r.getDataAsString === 'function') return r.getDataAsString();
    return Utilities.newBlob(r).getDataAsString();
  },
  write(id, content) {
    const svc = Gdrive.svc_();
    if (svc) { Gdrive.run_(() => svc.update({}, id, Gdrive.blob_(content))); return; }
    Gdrive.call_('patch', Gdrive.UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media', content, 'text/plain; charset=UTF-8');
  },
  patch_(id, meta) {
    const svc = Gdrive.svc_();
    if (svc) { Gdrive.run_(() => svc.update(meta, id)); return; }
    Gdrive.json_('patch', Gdrive.API + '/' + encodeURIComponent(id) + '?fields=id', meta);
  },
  /** An image (bytes) into a folder. Needs the built-in Drive service (enabled in appsscript.json). */
  createBlob(parentId, name, blob) {
    const svc = Gdrive.svc_();
    if (!svc) throw new Error('Für Bilder muss in Apps Script der Dienst „Drive API“ hinzugefügt sein (Dienste → Drive API).');
    return Gdrive.run_(() => svc.create({ name: name, parents: [parentId], mimeType: blob.getContentType() }, blob).id);
  },
  /** The bytes of a file (images). */
  readBytes(id) {
    const svc = Gdrive.svc_();
    if (!svc) throw new Error('Für Bilder muss in Apps Script der Dienst „Drive API“ hinzugefügt sein (Dienste → Drive API).');
    const r = Gdrive.run_(() => svc.get(id, { alt: 'media' }));
    if (r && typeof r.getBytes === 'function') return r.getBytes();
    return typeof r === 'string' ? Utilities.newBlob(r).getBytes() : r;
  },
  rename(id, name) { Gdrive.patch_(id, { name: name }); },
  /** To the Drive trash (restorable there for 30 days), never deleted for good. */
  trash(id) { Gdrive.patch_(id, { trashed: true }); },
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
