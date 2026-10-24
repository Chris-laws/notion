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

/** Used by the HTML templates: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
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
  'ai.parse': p => Ai.parse(p),
  'ai.assist': p => Ai.assist(p),
  'ai.report': p => Ai.report(p),
  'ai.suggestAssignee': p => Ai.suggestAssignee(p),
  'ai.breakdown': p => Ai.breakdown(p),
  'ai.briefing': p => Ai.briefing(p),
};

function api(method, payload) {
  const t0 = Date.now();
  try {
    Db.reset();
    const route = ROUTES[method];
    if (!route) throw new Error('Unbekannte Aktion: ' + method);
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
    const list = Tasks.list({ ver: '' });
    const ctx = Access.context(me);
    return {
      tasksVer: list.ver,
      appName: Config.get('APP_NAME'),
      today: Util.today(),
      me: Object.assign({}, me, { admin: ctx.admin }),
      users: Users.list(),
      teams: Db.all('Teams'),
      projects: Db.all('Projects'),
      tasks: list.tasks,
      companyHolidays: Db.all('CompanyHolidays'),
      ai: Ai.status(),
    };
  },
};
