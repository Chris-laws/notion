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

/** Who may see and change what. */
const Access = {
  context(user) {
    const email = user.email;
    const teamIds = {};
    Db.all('Teams').forEach(t => {
      if (t.lead === email || (t.members || []).indexOf(email) >= 0) teamIds[t.id] = true;
    });
    const projectIds = {};
    Db.all('Projects').forEach(p => {
      if (teamIds[p.teamId] || (p.members || []).indexOf(email) >= 0) projectIds[p.id] = true;
    });
    return { email: email, admin: Auth.isAdmin(user), teamIds: teamIds, projectIds: projectIds };
  },

  canSeeTask(t, ctx) {
    if (ctx.admin || t.createdBy === ctx.email) return true;
    if ((t.assignees || []).indexOf(ctx.email) >= 0) return true;
    if ((t.teams || []).some(id => ctx.teamIds[id])) return true;
    return !!(t.projectId && ctx.projectIds[t.projectId]);
  },

  canDeleteTask(t, ctx) {
    if (ctx.admin || t.createdBy === ctx.email) return true;
    const project = t.projectId && Db.get('Projects', t.projectId);
    const teamIds = (t.teams || []).concat(project ? [project.teamId] : []);
    return teamIds.some(id => {
      const team = Db.get('Teams', id);
      return team && team.lead === ctx.email;
    });
  },

  canManageTeam(team, ctx) {
    return ctx.admin || team.lead === ctx.email || team.createdBy === ctx.email;
  },

  canManageProject(project, ctx) {
    if (ctx.admin || project.createdBy === ctx.email || ctx.teamIds[project.teamId]) return true;
    return (project.members || []).indexOf(ctx.email) >= 0;
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
