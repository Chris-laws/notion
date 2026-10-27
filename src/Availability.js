/**
 * Team availability: who is away on which working day (vacation, sickness,
 * training or a public holiday in their country/region) and when a team
 * drops to the warning level (default: 50 % or more of the team absent).
 * Threshold: Script Property ABSENCE_WARN_PERCENT.
 */
const Availability = {
  threshold() {
    const n = Number(Config.get('ABSENCE_WARN_PERCENT'));
    return n > 0 && n <= 100 ? n : 50;
  },

  /** Page data: one row per member, one cell per day, plus the team line. */
  forTeam(p) {
    const viewer = Availability.viewer_();
    const from = Shared.mondayOf(Shared.isDate(p.from) ? p.from : Util.today());
    const weeks = Math.max(1, Math.min(13, Number(p.weeks) || 6));
    const to = Shared.addDays(from, weeks * 7 - 1);
    const users = Calendar.people_(p.teamId);
    const grid = Availability.grid_(users, from, to, viewer);
    return {
      from: from, to: to, threshold: Availability.threshold(),
      teamId: p.teamId || '',
      days: grid.days,
      members: users.map(u => ({
        email: u.email, name: u.name, color: u.color, country: u.country, region: u.region,
        cells: grid.cells[u.email],
        awayDays: grid.days.filter(d => grid.cells[u.email][d].away).length,
      })),
      team: grid.team,
    };
  },

  /** Warning days of every team (or of the given teams) in a range. */
  warnings(from, to, teamIds, viewer) {
    const out = [];
    const ctx = Access.current();
    Db.all('Teams').filter(t => Access.seesTeam(t, ctx) && (!teamIds || teamIds.indexOf(t.id) >= 0)).forEach(t => {
      const users = Calendar.people_(t.id);
      if (users.length < 2) return;
      Availability.grid_(users, from, to, viewer).team.filter(d => d.warn).forEach(d => {
        out.push({ teamId: t.id, teamName: t.name, date: d.date, absent: d.absent, total: d.total, ratio: d.ratio, people: d.people });
      });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },

  /**
   * Health data stays private: a sick leave is "sick" only for the person and admins,
   * everybody else sees "other" (away). viewer: { email, admin }; without a viewer: masked.
   */
  visibleType(type, owner, viewer) {
    return type === 'sick' && !(viewer && (viewer.admin || viewer.email === owner)) ? 'other' : type;
  },
  viewer_() {
    const me = Auth.currentUser();
    return { email: me.email, admin: Auth.isAdmin(me) };
  },

  grid_(users, from, to, viewer) {
    const S = Shared;
    const threshold = Availability.threshold();
    const holidays = Holidays.inRange(users.map(u => u.country), from, to);
    const absences = Db.all('Absences').filter(a => a.endDate >= from && a.startDate <= to);
    const days = [];
    for (let d = from; d <= to; d = S.addDays(d, 1)) days.push(d);
    const cells = {};
    users.forEach(u => {
      const workDays = String(u.workDays || '1,2,3,4,5').split(',').filter(x => x !== '').map(Number);
      cells[u.email] = {};
      days.forEach(d => {
        const cell = { works: workDays.indexOf(S.weekday(d)) >= 0, away: false, kind: '', label: '' };
        if (cell.works) {
          const abs = absences.find(a => a.email === u.email && a.startDate <= d && a.endDate >= d);
          const hol = holidays.find(h => h.date === d && Holidays.appliesTo(h, u));
          if (abs) {
            cell.away = true;
            cell.kind = Availability.visibleType(abs.type, u.email, viewer);
            cell.label = (S.ABSENCE_TYPES.find(x => x.key === cell.kind) || {}).label || '';
          }
          else if (hol) { cell.away = true; cell.kind = 'holiday'; cell.label = hol.name; cell.labelEn = hol.nameEn || hol.name; }
        }
        cells[u.email][d] = cell;
      });
    });
    const team = days.map(d => {
      const working = users.filter(u => cells[u.email][d].works);
      const away = working.filter(u => cells[u.email][d].away);
      const ratio = working.length ? Math.round((away.length / working.length) * 100) : 0;
      return {
        date: d, total: working.length, absent: away.length, ratio: ratio,
        warn: working.length > 0 && away.length > 0 && ratio >= threshold,
        people: away.map(u => ({ email: u.email, kind: cells[u.email][d].kind, label: cells[u.email][d].label, labelEn: cells[u.email][d].labelEn })),
      };
    });
    return { days: days, cells: cells, team: team };
  },
};
