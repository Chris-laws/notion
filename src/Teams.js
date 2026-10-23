/** Teams (like Notion teamspaces) and the projects inside them. */
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
      color: String(p.color || 'blue').slice(0, 12),
      description: String(p.description || '').slice(0, 2000),
      lead: lead,
      members: members,
    };
    return Db.tx(() => {
      Users.ensure(members);
      if (p.id) {
        const team = Db.get('Teams', p.id);
        if (!team) throw new Error('Team nicht gefunden.');
        if (!Access.canManageTeam(team, ctx)) throw new Error('Nur Team-Lead oder Admins können das Team bearbeiten.');
        return Db.update('Teams', p.id, data);
      }
      return Db.insert('Teams', Object.assign(data, {
        id: Util.uid('tm_'), createdBy: me.email, createdAt: new Date().toISOString(),
      }));
    });
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
      color: String(p.color || 'gray').slice(0, 12),
      description: String(p.description || '').slice(0, 5000),
      status: Shared.PROJECT_STATUSES.some(s => s.key === p.status) ? p.status : 'active',
      // Empty list = the whole team works on the project.
      members: cleanEmails_(p.members),
      startDate: Shared.isDate(p.startDate) ? p.startDate : '',
      endDate: Shared.isDate(p.endDate) ? p.endDate : '',
    };
    return Db.tx(() => {
      Users.ensure(data.members);
      if (p.id) {
        const project = Db.get('Projects', p.id);
        if (!project) throw new Error('Projekt nicht gefunden.');
        if (!Access.canManageProject(project, ctx)) throw new Error('Keine Berechtigung für dieses Projekt.');
        return Db.update('Projects', p.id, data);
      }
      if (!ctx.admin && !ctx.teamIds[team.id]) throw new Error('Nur Mitglieder von „' + team.name + '“ können dort Projekte anlegen.');
      return Db.insert('Projects', Object.assign(data, {
        id: Util.uid('pr_'), createdBy: me.email, createdAt: new Date().toISOString(),
      }));
    });
  },

  remove(id) {
    const me = Auth.currentUser();
    const ctx = Access.context(me);
    return Db.tx(() => {
      const project = Db.get('Projects', id);
      if (!project) return false;
      const team = Db.get('Teams', project.teamId);
      if (!(ctx.admin || project.createdBy === me.email || (team && team.lead === me.email))) {
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

function cleanEmails_(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[,;\s]+/);
  const out = [];
  arr.forEach(e => {
    const v = String(e || '').trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && out.indexOf(v) < 0) out.push(v);
  });
  return out;
}
