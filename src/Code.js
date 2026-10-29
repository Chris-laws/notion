/**
 * Entry points of the web app.
 * The browser talks to the server through a single function, api(), which
 * dispatches to the route table below and always returns a JSON string.
 */
function doGet() {
  const user = Auth.currentUser();
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appName = Config.get('APP_NAME');
  tpl.userEmail = user.email;
  return tpl.evaluate()
    .setTitle(Config.get('APP_NAME'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Parts of the page loaded when first used (they do not slow down the start). */
const Ui = {
  CHUNKS: ['Assistant', 'JfTasks', 'Images'],
  chunk(p) {
    if (Ui.CHUNKS.indexOf(p && p.name) < 0) throw new Error('Unbekannter Teil.');
    return { name: p.name, html: include(p.name + 'Ui') };
  },
};

/** Used by the HTML templates: <?!= include('Styles') ?> */
function include(name) {
  return stripComments_(HtmlService.createHtmlOutputFromFile(name).getContent());
}
/**
 * The page without comments that stand on lines of their own (they stay in the code; the browser does not
 * need them). A block comment is only removed up to its own end, never across code.
 */
function stripComments_(s) {
  return String(s).replace(/^[ \t]*\/\*(?:(?!\*\/)[\s\S])*\*\/[ \t]*\r?\n/gm, '').replace(/^[ \t]*\/\/.*\r?\n/gm, '');
}

/** Shared constants and the quick-add parser, injected into the page. */
function clientLib() {
  return 'var Shared = (' + SharedFactory.toString() + ')();';
}

const ROUTES = {
  'bootstrap': () => App.bootstrap(),
  'tasks.list': p => Tasks.list(p),
  'tasks.save': p => Tasks.save(p),
  'tasks.move': p => Tasks.move(p),
  'tasks.remove': p => Tasks.remove(p.id),
  'comments.list': p => Tasks.comments(p.taskId),
  'comments.add': p => Tasks.addComment(p),
  'teams.save': p => Teams.save(p),
  'teams.remove': p => Teams.remove(p.id),
  'teams.setRole': p => Teams.setRole(p),
  'projects.setRole': p => Projects.setRole(p),
  'projects.setLinks': p => Projects.setLinks(p),
  'projects.save': p => Projects.save(p),
  'projects.remove': p => Projects.remove(p.id),
  'users.save': p => Users.save(p),
  'calendar.range': p => Calendar.range(p),
  'events.save': p => Calendar.saveEvent(p),
  'events.remove': p => Calendar.removeEvent(p.id),
  'absences.save': p => Calendar.saveAbsence(p),
  'absences.remove': p => Calendar.removeAbsence(p.id),
  'companyHolidays.save': p => Calendar.saveCompanyHoliday(p),
  'companyHolidays.remove': p => Calendar.removeCompanyHoliday(p.id),
  'capacity': p => Capacity.forTeam(p),
  'availability': p => Availability.forTeam(p),
  'ai.status': () => Ai.status(),
  'ai.test': () => Ai.test(),
  'ai.ask': p => Assistant.ask(p),
  'ai.apply': p => Assistant.apply(p),
  'ai.setAssistant': p => Assistant.setOn(p),
  'ui.chunk': p => Ui.chunk(p),
  'files.upload': p => Files.upload(p),
  'files.get': p => Files.get(p),
  'ai.parse': p => Ai.parse(p),
  'ai.assist': p => Ai.assist(p),
  'ai.report': p => Ai.report(p),
  'ai.suggestAssignee': p => Ai.suggestAssignee(p),
  'ai.breakdown': p => Ai.breakdown(p),
  'ai.briefing': p => Ai.briefing(p),
  'docs.get': p => Docs.get(p),
  'docs.save': p => Docs.save(p),
  'docs.versions': p => Docs.versions(p),
  'docs.version': p => Docs.version(p),
  'docs.restore': p => Docs.restore(p),
  'docs.lock': p => Docs.lock(p),
  'docs.unlock': p => Docs.unlock(p),
  'docs.remove': p => Docs.remove(p),
  'jf.list': p => Jf.list(p),
  'jf.saveSeries': p => Jf.saveSeries(p),
  'jf.removeSeries': p => Jf.removeSeries(p),
  'jf.meeting': p => Jf.meeting(p),
  'jf.makeTasks': p => Jf.makeTasks(p),
  'docs.flush': p => Docs.flush(p),
  'storage.links': () => Store.adminLinks(),
  'backup.status': () => Backup.status(),
  'backup.run': () => Backup.runNow(),
};

function api(method, payload) {
  const t0 = Date.now();
  try {
    Db.reset();
    const route = ROUTES[method];
    if (!route) throw new Error('Unbekannte Aktion: ' + method);
    // every route needs a signed-in person of the company domain, before anything else runs
    Auth.currentUser();
    const data = route(payload ? JSON.parse(payload) : {});
    const ms = Date.now() - t0;
    console.log('api ' + method + ' ' + ms + ' ms, ' + Db.reads() + ' Tabellen gelesen');
    return JSON.stringify({ ok: true, data: data === undefined ? null : data, ms: ms, reads: Db.reads() });
  } catch (e) {
    console.error(method, e && e.stack);
    return JSON.stringify({ ok: false, error: (e && e.message) || String(e), ms: Date.now() - t0 });
  }
}

const App = {
  bootstrap() {
    const me = Auth.currentUser();
    Teams.fixColors_();
    Projects.fixColors_();
    const list = Tasks.list({ ver: '' });
    const ctx = Access.context(me);
    return {
      tasksVer: list.ver,
      appName: Config.get('APP_NAME'),
      today: Util.today(),
      me: Object.assign({}, me, { admin: ctx.admin }),
      users: Users.list(),
      teams: Teams.list_(),
      projects: Projects.list_(),
      tasks: list.tasks,
      companyHolidays: Db.all('CompanyHolidays'),
      jf: Jf.overview_(ctx, ''),
      ai: Ai.status(),
    };
  },
};
