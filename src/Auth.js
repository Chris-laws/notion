/**
 * Google SSO: the web app is deployed with "Execute as: Me" and
 * "Who has access: Anyone within <domain>". Google signs the user in and
 * Session.getActiveUser() returns their Workspace e-mail.
 */
const Auth = {
  email() {
    const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    if (!email) {
      throw new Error('Keine Google-Anmeldung erkannt. Die App muss für Nutzer deiner Google-Workspace-Domain freigegeben sein.');
    }
    const domain = Config.get('ALLOWED_DOMAIN');
    if (domain && email.split('@')[1] !== domain.toLowerCase()) {
      throw new Error('Diese App ist nur für @' + domain + ' freigegeben.');
    }
    return email;
  },

  /** Returns the signed-in user and registers them on first visit. */
  currentUser() {
    const email = Auth.email();
    let user = Db.get('Users', email);
    if (!user) {
      user = Users.create_(email, { role: Auth.isConfiguredAdmin_(email) || Db.all('Users').length === 0 ? 'admin' : 'member' });
    } else if (user.active === false || user.active === 'false') {
      throw new Error('Dein Zugang wurde deaktiviert. Bitte wende dich an eine Admin-Person.');
    }
    return user;
  },

  isAdmin(user) {
    return user && (user.role === 'admin' || Auth.isConfiguredAdmin_(user.email));
  },

  isConfiguredAdmin_(email) {
    return Config.list('ADMIN_EMAILS').indexOf(email) >= 0;
  },
};

/**
 * Who may see and change what.
 *
 * Confidential teams and projects (confidential = true) exist only for their listed members:
 * a confidential team for its lead and members, a confidential project for the people in its
 * own member list (no "whole team" rule). Nobody else sees them or anything in them, admins
 * included; context() lists them in hiddenTeams / hiddenProjects and every route filters by that.
 */
const Access = {
  isConfidential(x) { return !!x && (x.confidential === true || String(x.confidential).toLowerCase() === 'true'); },

  context(user) {
    const email = user.email;
    const teamIds = {};
    const hiddenTeams = {};
    Db.all('Teams').forEach(t => {
      const member = t.lead === email || (t.members || []).indexOf(email) >= 0;
      if (member) teamIds[t.id] = true;
      else if (Access.isConfidential(t)) hiddenTeams[t.id] = true;
    });
    const projectIds = {};
    const hiddenProjects = {};
    Db.all('Projects').forEach(p => {
      const listed = (p.members || []).indexOf(email) >= 0;
      if (hiddenTeams[p.teamId] || (Access.isConfidential(p) && !listed)) hiddenProjects[p.id] = true;
      else if (teamIds[p.teamId] || listed) projectIds[p.id] = true;
    });
    return { email: email, admin: Auth.isAdmin(user), teamIds: teamIds, projectIds: projectIds, hiddenTeams: hiddenTeams, hiddenProjects: hiddenProjects };
  },

  /** Context of the signed-in person (for routes that only need the hidden lists). */
  current() { return Access.context(Auth.currentUser()); },

  seesTeam(team, ctx) { return !!team && !ctx.hiddenTeams[team.id]; },
  seesProject(project, ctx) { return !!project && !ctx.hiddenProjects[project.id]; },

  /** Task inside a confidential area the person is not part of: invisible, whoever they are. */
  hiddenTask(t, ctx) {
    return !!(t.projectId && ctx.hiddenProjects[t.projectId]) || (t.teams || []).some(id => ctx.hiddenTeams[id]);
  },

  canSeeTask(t, ctx) {
    if (Access.hiddenTask(t, ctx)) return false;
    if (ctx.admin || t.createdBy === ctx.email) return true;
    if ((t.assignees || []).indexOf(ctx.email) >= 0) return true;
    if ((t.teams || []).some(id => ctx.teamIds[id])) return true;
    return !!(t.projectId && ctx.projectIds[t.projectId]);
  },

  canDeleteTask(t, ctx) {
    if (Access.hiddenTask(t, ctx)) return false;
    if (ctx.admin || t.createdBy === ctx.email) return true;
    const project = t.projectId && Db.get('Projects', t.projectId);
    const teamIds = (t.teams || []).concat(project ? [project.teamId] : []);
    return teamIds.some(id => {
      const team = Db.get('Teams', id);
      return team && team.lead === ctx.email;
    });
  },

  canManageTeam(team, ctx) {
    // a confidential team is managed by its members only (no admin, no creator outside it)
    if (Access.isConfidential(team)) return !!ctx.teamIds[team.id];
    return ctx.admin || team.lead === ctx.email || team.createdBy === ctx.email;
  },

  canManageProject(project, ctx) {
    if (ctx.hiddenProjects[project.id]) return false;
    if (Access.isConfidential(project)) return (project.members || []).indexOf(ctx.email) >= 0;
    if (ctx.admin || project.createdBy === ctx.email || ctx.teamIds[project.teamId]) return true;
    return (project.members || []).indexOf(ctx.email) >= 0;
  },
};

/** Changes to confidential objects: who, when, which id (never names or content). */
const Audit = {
  log(action, kind, ref) {
    Db.insert('Audit', { id: Util.uid('au_'), at: new Date().toISOString(), by: Auth.email(), action: action, kind: kind, ref: ref });
  },
};

/** Script properties with sensible defaults. */
const Config = {
  DEFAULTS: {
    APP_NAME: 'LidlFlow',
    DEFAULT_COUNTRY: 'DE',
    DEFAULT_HOURS_PER_WEEK: '40',
    ABSENCE_WARN_PERCENT: '50',
    ALLOWED_DOMAIN: '',
    ADMIN_EMAILS: '',
    VERTEX_API_KEY: 'PLATZHALTER_VERTEX_AI_API_KEY',
    VERTEX_MODEL: 'gemini-2.5-flash',
    VERTEX_PROJECT_ID: '',
    VERTEX_LOCATION: 'global',
    ALLOW_DEMO_DATA: '',
  },

  props_: null,

  /** Script properties are read once per request. */
  reset() { Config.props_ = null; },

  get(name) {
    if (!Config.props_) Config.props_ = PropertiesService.getScriptProperties().getProperties();
    let v = Config.props_[name];
    if (name === 'APP_NAME' && v === 'Taskraum') v = 'LidlFlow'; // the old default name, renamed
    return v === null || v === undefined ? (Config.DEFAULTS[name] || '') : v;
  },

  list(name) {
    return Config.get(name).split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  },
};
