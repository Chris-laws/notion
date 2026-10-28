/** Teams (team spaces) and the projects inside them. */
const Teams = {
  save(p) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    const name = String(p.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Bitte einen Teamnamen angeben.');
    const members = cleanEmails_(p.members);
    const lead = p.lead ? String(p.lead).toLowerCase() : me.email;
    if (members.indexOf(lead) < 0) members.unshift(lead);
    const data = {
      name: name,
      icon: String(p.icon || '').slice(0, 8),
      color: String(p.color || ''),
      description: String(p.description || '').slice(0, 2000),
      lead: lead,
      members: members,
    };
    return Db.tx(() => {
      // leads stay members: leaving someone out of the list does not drop a lead (demote first)
      const old = p.id ? Db.get('Teams', p.id) : null;
      const leads = old ? Shared.teamLeads(old) : [lead];
      leads.forEach(e => { if (members.indexOf(e) < 0) members.push(e); });
      data.leads = leads;
      data.lead = leads[0];
      // at most 8 teams per person
      const others = Db.all('Teams').filter(t => t.id !== p.id);
      members.forEach(e => {
        const n = others.filter(t => Teams.people_(t).indexOf(e) >= 0).length;
        if (n >= Shared.MAX_TEAMS) {
          const u = Db.get('Users', e);
          throw new Error((u && u.name ? u.name : e) + ' ist schon in ' + Shared.MAX_TEAMS + ' Teams. Mehr geht nicht: bitte erst aus einem anderen Team entfernen.');
        }
      });
      // teams that share people never share a colour
      const taken = Teams.takenColors_(members, p.id);
      if (!data.color) data.color = Shared.TEAM_COLORS.find(c => !taken[c]) || 'blue';
      if (Shared.TEAM_COLORS.indexOf(data.color) < 0) throw new Error('Unbekannte Teamfarbe.');
      if (taken[data.color]) throw new Error('Diese Farbe hat schon das Team „' + taken[data.color] + '“. Bitte eine andere wählen.');
      if (p.id) {
        const team = Db.get('Teams', p.id);
        if (!team) throw new Error('Team nicht gefunden.');
        if (!Access.canManageTeam(team, ctx)) throw new Error('Nur Team-Lead oder Admins können das Team bearbeiten.');
        // the dialog has no icon field: keep the icon unless one is sent
        if (p.icon === undefined) delete data.icon;
        Users.ensure(members);
        if (team.name !== data.name) Store.rename('team:' + p.id, data.name);
        return Teams.out_(Db.update('Teams', p.id, data));
      }
      Users.ensure(members);
      return Teams.out_(Db.insert('Teams', Object.assign(data, {
        id: Util.uid('tm_'), createdBy: me.email, createdAt: new Date().toISOString(),
      })));
    });
  },

  /** A team for the client: always with its list of leads. */
  out_(t) {
    return Object.assign({}, t, { leads: Shared.teamLeads(t) });
  },
  list_() {
    return Db.all('Teams').map(Teams.out_);
  },

  /** Makes a member lead or takes the role away. Leads (and admins) only; one lead always stays. */
  setRole(p) {
    const ctx = Access.context(Auth.currentUser());
    const email = String(p.email || '').trim().toLowerCase();
    return Db.tx(() => {
      const team = Db.get('Teams', p.teamId);
      if (!team || !(ctx.admin || ctx.teamIds[team.id])) throw new Error('Team nicht gefunden.');
      if (!Access.canSetTeamRoles(team, ctx)) throw new Error('Nur ein Lead kann Leads ernennen oder die Rolle entziehen.');
      const leads = setLead_(Shared.teamLeads(team), email, !!p.lead, Teams.people_(team));
      return Teams.out_(Db.update('Teams', team.id, { leads: leads, lead: leads[0] }));
    });
  },

  people_(t) {
    return Shared.teamLeads(t).concat(t.members || []).filter(Boolean);
  },

  /** Colour -> team name, for teams (other than teamId) that share at least one person with `people`. */
  takenColors_(people, teamId) {
    const taken = {};
    Db.all('Teams').forEach(t => {
      if (t.id === teamId) return;
      if (Teams.people_(t).some(e => people.indexOf(e) >= 0)) taken[t.color] = t.name;
    });
    return taken;
  },

  /**
   * One-off clean-up for teams from before the colour rule: oldest team keeps its colour,
   * later teams that clash with an overlapping team (or use a retired colour) get the first free one.
   */
  fixColors_() {
    const teams = Db.all('Teams').slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const bad = teams.some((t, i) => Shared.TEAM_COLORS.indexOf(t.color) < 0 ||
      teams.slice(0, i).some(o => o.color === t.color && Teams.people_(o).some(e => Teams.people_(t).indexOf(e) >= 0)));
    if (!bad) return false;
    Db.tx(() => {
      const done = [];
      teams.forEach(t => {
        const clash = c => done.some(o => o.color === c && Teams.people_(o).some(e => Teams.people_(t).indexOf(e) >= 0));
        if (Shared.TEAM_COLORS.indexOf(t.color) < 0 || clash(t.color)) {
          const c = Shared.TEAM_COLORS.find(x => !clash(x)) || 'blue';
          Db.update('Teams', t.id, { color: c });
          t.color = c;
        }
        done.push(t);
      });
    });
    return true;
  },

  remove(id) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    return Db.tx(() => {
      const team = Db.get('Teams', id);
      if (!team) return false;
      if (!Access.canManageTeam(team, ctx)) throw new Error('Keine Berechtigung.');
      Db.all('Projects').filter(p => p.teamId === id).forEach(p => Projects.removeInternal_(p.id));
      Db.all('Tasks').filter(t => (t.teams || []).indexOf(id) >= 0).forEach(t => {
        Db.update('Tasks', t.id, { teams: t.teams.filter(x => x !== id) });
      });
      Db.all('Events').filter(e => e.teamId === id).forEach(e => Db.update('Events', e.id, { teamId: '' }));
      return Db.remove('Teams', id);
    });
  },
};

const Projects = {
  save(p) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    const name = String(p.name || '').trim().slice(0, 120);
    if (!name) throw new Error('Bitte einen Projektnamen angeben.');
    const team = Db.get('Teams', p.teamId);
    if (!team) throw new Error('Bitte ein Team für das Projekt wählen.');
    const data = {
      teamId: team.id,
      name: name,
      icon: String(p.icon || '').slice(0, 8),
      description: String(p.description || '').slice(0, 5000),
      status: Shared.PROJECT_STATUSES.some(s => s.key === p.status) ? p.status : 'active',
      // Empty list = the whole team works on the project.
      members: cleanEmails_(p.members),
      startDate: Shared.isDate(p.startDate) ? p.startDate : '',
      endDate: Shared.isDate(p.endDate) ? p.endDate : '',
    };
    return Db.tx(() => {
      const mayUseTeam = ctx.admin || ctx.teamIds[team.id];
      if (p.id) {
        const project = Db.get('Projects', p.id);
        if (!project) throw new Error('Projekt nicht gefunden.');
        if (!Access.canManageProject(project, ctx)) throw new Error('Keine Berechtigung für dieses Projekt.');
        // moving it into another team needs membership there, like creating it there
        if (project.teamId !== team.id && !mayUseTeam) throw new Error('Nur Mitglieder von „' + team.name + '“ können dort Projekte anlegen.');
        if (p.icon === undefined) delete data.icon;
        data.color = Projects.color_(p.color === undefined ? project.color : p.color, team.id, p.id);
        // a project with its own people keeps its leads among them
        if (data.members.length) Shared.projectLeads(project).forEach(e => { if (data.members.indexOf(e) < 0) data.members.push(e); });
        Users.ensure(data.members);
        if (project.name !== data.name) Store.rename('project:' + p.id, data.name);
        return Projects.out_(Db.update('Projects', p.id, data));
      }
      if (!mayUseTeam) throw new Error('Nur Mitglieder von „' + team.name + '“ können dort Projekte anlegen.');
      data.color = Projects.color_(p.color, team.id, '');
      data.leads = [me.email];
      if (data.members.length && data.members.indexOf(me.email) < 0) data.members.push(me.email);
      Users.ensure(data.members);
      return Projects.out_(Db.insert('Projects', Object.assign(data, {
        id: Util.uid('pr_'), createdBy: me.email, createdAt: new Date().toISOString(),
      })));
    });
  },

  out_(p) {
    return Object.assign({}, p, { leads: Shared.projectLeads(p) });
  },
  list_() {
    return Db.all('Projects').map(Projects.out_);
  },

  /** The links in the project banner (Databricks, Snowflake, Drive …): everybody who may change the project. */
  setLinks(p) {
    const ctx = Access.context(Auth.currentUser());
    return Db.tx(() => {
      const project = Db.get('Projects', p.projectId);
      if (!project || !(ctx.admin || ctx.projectIds[project.id])) throw new Error('Projekt nicht gefunden.');
      if (!Access.canManageProject(project, ctx)) throw new Error('Keine Berechtigung für dieses Projekt.');
      return Projects.out_(Db.update('Projects', project.id, { links: Shared.cleanLinks(p.links) }));
    });
  },

  /** Project leads, team leads and admins appoint and demote project leads; one lead always stays. */
  setRole(p) {
    const ctx = Access.context(Auth.currentUser());
    const email = String(p.email || '').trim().toLowerCase();
    return Db.tx(() => {
      const project = Db.get('Projects', p.projectId);
      if (!project || !(ctx.admin || ctx.projectIds[project.id])) throw new Error('Projekt nicht gefunden.');
      if (!Access.canSetProjectRoles(project, ctx)) throw new Error('Nur ein Lead kann Leads ernennen oder die Rolle entziehen.');
      const team = Db.get('Teams', project.teamId);
      const people = project.members && project.members.length ? project.members : team ? Teams.people_(team) : [];
      const leads = setLead_(Shared.projectLeads(project), email, !!p.lead, people);
      return Projects.out_(Db.update('Projects', project.id, { leads: leads }));
    });
  },

  /**
   * The colour a project of team `teamId` may get (inside the lock): none chosen -> the first free one;
   * a colour another project of the team has -> refused, unless the whole palette is in use.
   */
  color_(wanted, teamId, exceptId) {
    const all = Db.all('Projects');
    if (Shared.PROJECT_PALETTE.indexOf(wanted) < 0) return Shared.freeProjectColor(all, teamId, exceptId);
    const taken = Shared.takenProjectColors(all, teamId, exceptId);
    const full = Shared.PROJECT_PALETTE.every(c => taken[c]);
    if (taken[wanted] && !full) throw new Error('Diese Farbe hat im Team schon das Projekt „' + taken[wanted] + '“. Bitte eine andere wählen.');
    return wanted;
  },

  /**
   * Clean-up for projects from before the colour rule: per team the oldest project keeps its colour,
   * later ones with a colour already used (or none) get the next free one. Writes only when needed.
   */
  fixColors_() {
    const sorted = Db.all('Projects').slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const needsFix = (p, i) => Shared.PROJECT_PALETTE.indexOf(p.color) < 0 ||
      sorted.slice(0, i).some(o => o.teamId === p.teamId && o.color === p.color);
    if (!sorted.some(needsFix)) return false;
    Db.tx(() => {
      const done = [];
      Db.all('Projects').slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach(p => {
        const clash = Shared.PROJECT_PALETTE.indexOf(p.color) < 0 || done.some(o => o.teamId === p.teamId && o.color === p.color);
        if (clash) {
          const c = Shared.freeProjectColor(done, p.teamId, p.id);
          Db.update('Projects', p.id, { color: c });
          p = Object.assign({}, p, { color: c });
        }
        done.push(p);
      });
    });
    return true;
  },

  remove(id) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    return Db.tx(() => {
      const project = Db.get('Projects', id);
      if (!project) return false;
      const team = Db.get('Teams', project.teamId);
      if (!(ctx.admin || project.createdBy === me.email || (team && Shared.teamLeads(team).indexOf(me.email) >= 0))) {
        throw new Error('Nur die Person, die das Projekt angelegt hat, Team-Leads oder Admins können es löschen.');
      }
      return Projects.removeInternal_(id);
    });
  },

  /** Tasks survive the project; they just lose the link. */
  removeInternal_(id) {
    Db.all('Tasks').filter(t => t.projectId === id).forEach(t => Db.update('Tasks', t.id, { projectId: '' }));
    return Db.remove('Projects', id);
  },
};

/** The new list of leads: only members become lead, the last lead stays. */
function setLead_(leads, email, lead, people) {
  if (lead) {
    if (people.indexOf(email) < 0) throw new Error('Nur Mitglieder können Lead werden.');
    return leads.indexOf(email) >= 0 ? leads : leads.concat([email]);
  }
  const rest = leads.filter(e => e !== email);
  if (!rest.length) throw new Error('Es muss mindestens ein Lead bleiben. Ernenne zuerst eine andere Person zum Lead.');
  return rest;
}

function cleanEmails_(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/);
  const out = [];
  arr.forEach(e => {
    const v = String(e || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && out.indexOf(v) < 0) out.push(v);
  });
  return out;
}
