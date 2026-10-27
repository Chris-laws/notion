/**
 * Folders in the owner's Drive (scope drive.file: the app only sees what it created itself).
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
const Store = {
  ROOT_NAME: 'LidlFlow',

  root() {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('DRIVE_ROOT_FOLDER_ID');
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (e) { /* removed: make a new one */ }
    }
    const folder = DriveApp.createFolder(Store.ROOT_NAME);
    props.setProperty('DRIVE_ROOT_FOLDER_ID', folder.getId());
    return folder;
  },

  /** Sub-folder by name; created when missing. */
  child_(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  },

  /** Folder remembered under key (e.g. "project:<id>"); made inside parent() when missing. */
  folder_(key, parent, name) {
    const row = Db.get('Folders', key);
    if (row) {
      try {
        const f = DriveApp.getFolderById(row.folderId);
        if (!f.isTrashed()) return f;
      } catch (e) { /* gone: make it again */ }
    }
    const f = Store.child_(parent(), name);
    if (row) Db.update('Folders', key, { folderId: f.getId() });
    else Db.insert('Folders', { key: key, folderId: f.getId() });
    return f;
  },

  team_(team) {
    return Store.folder_('team:' + team.id, () => Store.child_(Store.root(), 'Projects'), Shared.safeName(team.name));
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
    try { DriveApp.getFolderById(row.folderId).setName(Shared.safeName(name)); } catch (e) { console.warn('rename folder ' + key + ': ' + e.message); }
  },

  read(fileId) {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString();
  },

  /** Moves a file to the Drive trash (never deleted for good: it can be restored from there for 30 days). */
  trash(fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.warn('trash ' + fileId + ': ' + e.message); }
  },

  /** Links for the admin page: the Drive folder, the database and the backups. */
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
