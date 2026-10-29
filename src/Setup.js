/**
 * One-time setup. Run setup() once from the Apps Script editor:
 * creates the data spreadsheet (or upgrades an existing one) and stores
 * default settings as Script Properties.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('LidlFlow – Database');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Db.ensureSchema(ss);

  // Only the owner may edit the tables by hand (the web app runs as the owner); protects again
  // if someone shares the spreadsheet by mistake.
  Object.keys(SCHEMA).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    const p = sh.protect().setDescription('LidlFlow: only change through the app');
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });

  // Remove the empty default sheet of a freshly created spreadsheet.
  ss.getSheets().forEach(sh => {
    if (!SCHEMA[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  const defaults = Object.assign({}, Config.DEFAULTS);
  const owner = Session.getEffectiveUser().getEmail();
  if (owner) defaults.ADMIN_EMAILS = owner.toLowerCase();
  if (owner && owner.indexOf('@gmail.com') < 0) defaults.ALLOWED_DOMAIN = owner.split('@')[1];
  Object.keys(defaults).forEach(k => {
    if (props.getProperty(k) === null) props.setProperty(k, defaults[k]);
  });
  // the Drive folder for documents and minutes; asks for the Drive permission while setup runs
  try { Logger.log('Drive-Ordner bereit: https://drive.google.com/drive/folders/' + Store.root()); } catch (e) { Logger.log('Drive: ' + e.message); }
  Logger.log('Datenbank bereit: ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * Optional: fills the app with an example team, projects and tasks. The made-up people get
 * addresses in the company domain, which could belong to real colleagues; so this only runs
 * when the script property ALLOW_DEMO_DATA is "true" (never on the production spreadsheet).
 */
function seedDemoData() {
  if (Config.get('ALLOW_DEMO_DATA') !== 'true') {
    throw new Error('Demo-Daten sind ausgeschaltet. Nur in Testkopien die Skripteigenschaft ALLOW_DEMO_DATA auf "true" setzen.');
  }
  Db.reset();
  const me = Auth.currentUser();
  const today = Util.today();
  const S = Shared;
  const domain = me.email.split('@')[1];
  const people = [
    { email: 'anna.schmidt@' + domain, country: 'DE', region: 'DE-BY' },
    { email: 'lukas.meyer@' + domain, country: 'DE', region: 'DE-BE' },
    { email: 'sofia.rossi@' + domain, country: 'IT', region: '' },
    { email: 'james.carter@' + domain, country: 'US', region: '' },
    { email: 'lea.huber@' + domain, country: 'AT', region: '', hoursPerWeek: 30, workDays: '1,2,3,4' },
  ];
  people.forEach(p => {
    Users.create_(p.email);
    Db.update('Users', p.email, p);
  });
  const product = Teams.save({ name: 'Produkt', icon: '🚀', color: 'blue', description: 'Roadmap, Design und Entwicklung.',
    members: [me.email].concat(people.slice(0, 4).map(p => p.email)) });
  const marketing = Teams.save({ name: 'Marketing', icon: '📣', color: 'pink', description: 'Kampagnen, Content und Events.',
    members: [me.email, people[2].email, people[4].email], lead: people[4].email });
  const web = Projects.save({ teamId: product.id, name: 'Website Relaunch', icon: '🌐', status: 'active',
    startDate: S.addDays(today, -14), endDate: S.addDays(today, 45), description: 'Neue Website mit Headless CMS.' });
  const app = Projects.save({ teamId: product.id, name: 'Mobile App 2.0', icon: '📱', status: 'planned',
    members: [me.email, people[0].email, people[3].email], startDate: S.addDays(today, 7), endDate: S.addDays(today, 90) });
  const launch = Projects.save({ teamId: marketing.id, name: 'Q4 Kampagne', icon: '🎯', status: 'active',
    members: [people[4].email, people[2].email, people[1].email] });

  const t = (title, f) => Tasks.save(Object.assign({ title: title }, f))[0];
  t('Wireframes für Startseite', { projectId: web.id, assignees: [people[0].email], status: 'done', priority: 'high', startDate: S.addDays(today, -12), dueDate: S.addDays(today, -5), estimate: 6, tags: ['Design'] });
  const cms = t('CMS evaluieren und entscheiden', { projectId: web.id, assignees: [me.email, people[1].email], status: 'doing', priority: 'urgent', startDate: S.addDays(today, -2), dueDate: S.addDays(today, 2), estimate: 10, description: 'Contentful, Sanity und Storyblok vergleichen.\nKriterien: Preis, Editor-Erlebnis, i18n.' });
  t('Preise und Lizenzen vergleichen', { projectId: web.id, parentId: cms.id, assignees: [me.email], dueDate: S.addDays(today, 1), estimate: 2 });
  t('Demo-Termin mit Anbietern', { projectId: web.id, parentId: cms.id, assignees: [people[1].email], dueDate: S.addDays(today, 2), estimate: 2, status: 'done' });
  t('Design-System in Figma anlegen', { projectId: web.id, assignees: [people[0].email], status: 'review', priority: 'medium', startDate: S.addDays(today, -3), dueDate: S.addDays(today, 4), estimate: 12, tags: ['Design'] });
  t('SEO-Audit der alten Seite', { projectId: web.id, assignees: [people[2].email], status: 'todo', priority: 'low', startDate: S.addDays(today, 4), dueDate: S.addDays(today, 9), estimate: 5 });
  t('Hosting & Domains umziehen', { projectId: web.id, teams: [product.id], status: 'backlog', priority: 'medium', estimate: 8 });
  t('Push-Benachrichtigungen konzipieren', { projectId: app.id, assignees: [people[3].email], status: 'todo', priority: 'high', startDate: S.addDays(today, 5), dueDate: S.addDays(today, 12), estimate: 16 });
  t('User-Interviews auswerten', { projectId: app.id, assignees: [me.email, people[0].email], status: 'todo', priority: 'medium', startDate: S.addDays(today, 1), dueDate: S.addDays(today, 6), estimate: 6, tags: ['Research'] });
  t('Kampagnen-Briefing schreiben', { projectId: launch.id, assignees: [people[4].email], status: 'doing', priority: 'high', startDate: S.addDays(today, -1), dueDate: S.addDays(today, 3), estimate: 4, progress: 60 });
  t('Social-Media-Plan November', { projectId: launch.id, teams: [marketing.id], assignees: [people[2].email, people[4].email], status: 'todo', startDate: S.addDays(today, 2), dueDate: S.addDays(today, 8), estimate: 10, tags: ['Social'] });
  t('Weekly Team-Sync vorbereiten', { assignees: [me.email], recurrence: 'weekly', dueDate: S.addDays(S.mondayOf(today), 7), estimate: 0.5, priority: 'low' });
  t('Angebot für Mobile App freigeben', { projectId: app.id, assignees: [me.email, people[3].email], status: 'doing', priority: 'high', startDate: S.addDays(today, -10), dueDate: S.addDays(today, -4), estimate: 3, tags: ['Research'], progress: 70 });
  t('Reisekosten abrechnen', { assignees: [me.email], dueDate: S.addDays(today, -1), estimate: 1 });
  t('Onboarding-Doku aktualisieren', { teams: [product.id], status: 'backlog', estimate: 3 });

  Calendar.saveEvent({ title: 'Sprint Review', type: 'meeting', startDate: S.addDays(today, 3), teamId: product.id });
  Calendar.saveEvent({ title: 'Go-Live Website', type: 'milestone', startDate: S.addDays(today, 45), teamId: product.id });
  Calendar.saveEvent({ title: 'Team-Offsite', type: 'offsite', startDate: S.addDays(today, 18), endDate: S.addDays(today, 19) });
  Db.insert('Absences', { id: Util.uid('ab_'), email: people[1].email, startDate: S.addDays(today, 5), endDate: S.addDays(today, 11), type: 'vacation', note: '', createdAt: new Date().toISOString() });
  Db.insert('Absences', { id: Util.uid('ab_'), email: people[3].email, startDate: S.addDays(today, 1), endDate: S.addDays(today, 1), type: 'training', note: '', createdAt: new Date().toISOString() });
  Logger.log('Demo-Daten angelegt.');
}
