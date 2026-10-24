/** Team calendar: events, absences, holidays and capacity planning. */
const Calendar = {
  /** Everything the calendar needs for one visible range. */
  range(p) {
    const me = Auth.currentUser();
    const admin = Auth.isAdmin(me);
    const from = Shared.isDate(p.from) ? p.from : Shared.addDays(Util.today(), -7);
    const to = Shared.isDate(p.to) ? p.to : Shared.addDays(from, 42);
    if (Shared.diffDays(from, to) > 400) throw new Error('Zeitraum zu groß.');
    const people = Calendar.people_(p.teamId);
    const emails = people.map(u => u.email);
    const events = Db.all('Events').filter(e =>
      e.startDate <= to && (e.endDate || e.startDate) >= from && (!p.teamId || !e.teamId || e.teamId === p.teamId));
    const absences = Db.all('Absences')
      .filter(a => a.startDate <= to && a.endDate >= from && emails.indexOf(a.email) >= 0)
      .map(a => (admin || a.email === me.email ? a : Object.assign({}, a, { note: '' })));
    const holidays = Holidays.inRange(people.map(u => u.country), from, to).map(h =>
      Object.assign({}, h, { affects: people.filter(u => Holidays.appliesTo(h, u)).map(u => u.email) }));
    const teamIds = p.teamId ? [p.teamId] : null;
    return {
      from: from, to: to, events: events, absences: absences, holidays: holidays,
      warnings: Availability.warnings(from, to, teamIds), threshold: Availability.threshold(),
    };
  },

  people_(teamId) {
    if (!teamId) return Users.list();
    const team = Db.get('Teams', teamId);
    if (!team) throw new Error('Team nicht gefunden.');
    const emails = [team.lead].concat(team.members || []);
    return Users.list().filter(u => emails.indexOf(u.email) >= 0);
  },

  saveEvent(p) {
    const me = Auth.currentUser();
    const title = String(p.title || '').trim().slice(0, 200);
    if (!title) throw new Error('Bitte einen Titel angeben.');
    if (!Shared.isDate(p.startDate)) throw new Error('Bitte ein Startdatum angeben.');
    const end = Shared.isDate(p.endDate) && p.endDate >= p.startDate ? p.endDate : p.startDate;
    const data = {
      title: title,
      type: Shared.EVENT_TYPES.some(t => t.key === p.type) ? p.type : 'meeting',
      startDate: p.startDate,
      endDate: end,
      teamId: p.teamId && Db.get('Teams', p.teamId) ? p.teamId : '',
      attendees: cleanEmails_(p.attendees),
      note: String(p.note || '').slice(0, 2000),
    };
    return Db.tx(() => {
      if (p.id) {
        const ev = Db.get('Events', p.id);
        if (!ev) throw new Error('Termin nicht gefunden.');
        return Db.update('Events', p.id, data);
      }
      return Db.insert('Events', Object.assign(data, {
        id: Util.uid('ev_'), createdBy: me.email, createdAt: new Date().toISOString(),
      }));
    });
  },

  removeEvent(id) {
    const me = Auth.currentUser();
    return Db.tx(() => {
      const ev = Db.get('Events', id);
      if (!ev) return false;
      if (ev.createdBy !== me.email && !Auth.isAdmin(me)) throw new Error('Nur die erstellende Person oder Admins können den Termin löschen.');
      return Db.remove('Events', id);
    });
  },

  saveAbsence(p) {
    const me = Auth.currentUser();
    const email = String(p.email || me.email).toLowerCase();
    if (email !== me.email && !Auth.isAdmin(me)) throw new Error('Abwesenheiten anderer dürfen nur Admins eintragen.');
    if (!Shared.isDate(p.startDate)) throw new Error('Bitte ein Startdatum angeben.');
    const end = Shared.isDate(p.endDate) && p.endDate >= p.startDate ? p.endDate : p.startDate;
    const data = {
      email: email,
      startDate: p.startDate,
      endDate: end,
      type: Shared.ABSENCE_TYPES.some(t => t.key === p.type) ? p.type : 'vacation',
      note: String(p.note || '').slice(0, 500),
    };
    return Db.tx(() => {
      let saved;
      if (p.id) {
        const a = Db.get('Absences', p.id);
        if (!a || (a.email !== me.email && !Auth.isAdmin(me))) throw new Error('Keine Berechtigung.');
        saved = Db.update('Absences', p.id, data);
      } else {
        saved = Db.insert('Absences', Object.assign(data, { id: Util.uid('ab_'), createdAt: new Date().toISOString() }));
      }
      // Tell the person right away if their absence pushes a team to the warning level.
      const teamIds = Db.all('Teams').filter(t => t.lead === email || (t.members || []).indexOf(email) >= 0).map(t => t.id);
      const warnings = teamIds.length
        ? Availability.warnings(saved.startDate, saved.endDate, teamIds).filter(w => w.people.some(x => x.email === email))
        : [];
      return { absence: saved, warnings: warnings, threshold: Availability.threshold() };
    });
  },

  removeAbsence(id) {
    const me = Auth.currentUser();
    return Db.tx(() => {
      const a = Db.get('Absences', id);
      if (!a) return false;
      if (a.email !== me.email && !Auth.isAdmin(me)) throw new Error('Keine Berechtigung.');
      return Db.remove('Absences', id);
    });
  },

  saveCompanyHoliday(p) {
    const me = Auth.currentUser();
    if (!Auth.isAdmin(me)) throw new Error('Nur Admins können Firmen-Feiertage pflegen.');
    if (!Shared.isDate(p.date)) throw new Error('Bitte ein Datum angeben.');
    const name = String(p.name || '').trim().slice(0, 120);
    if (!name) throw new Error('Bitte einen Namen angeben.');
    const countries = (p.countries || []).map(c => String(c).toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c));
    return Db.insert('CompanyHolidays', { id: Util.uid('ch_'), date: p.date, name: name, countries: countries });
  },

  removeCompanyHoliday(id) {
    const me = Auth.currentUser();
    if (!Auth.isAdmin(me)) throw new Error('Nur Admins können Firmen-Feiertage pflegen.');
    return Db.remove('CompanyHolidays', id);
  },
};

/**
 * Capacity = working hours per person and week, minus holidays of their
 * country/region and absences. Load = estimated hours of open tasks, split
 * between assignees and spread over the working days from start to due date.
 */
const Capacity = {
  forTeam(p) {
    Auth.currentUser();
    const from = Shared.mondayOf(Shared.isDate(p.from) ? p.from : Util.today());
    const weeks = Math.max(1, Math.min(26, Number(p.weeks) || 8));
    return Capacity.compute_(Calendar.people_(p.teamId), from, weeks);
  },

  compute_(users, from, weeks) {
    const S = Shared;
    const to = S.addDays(from, weeks * 7 - 1);
    const today = Util.today();
    const holidays = Holidays.inRange(users.map(u => u.country), from, to);
    const absences = Db.all('Absences').filter(a => a.endDate >= from && a.startDate <= to);
    const tasks = Db.all('Tasks').filter(t => t.status !== 'done' && Number(t.estimate) > 0 && (t.assignees || []).length);
    const weekStarts = [];
    for (let i = 0; i < weeks; i++) weekStarts.push(S.addDays(from, i * 7));

    const members = users.map(u => {
      const workDays = String(u.workDays || '1,2,3,4,5').split(',').filter(x => x !== '').map(Number);
      const perDay = workDays.length ? (Number(u.hoursPerWeek) || 0) / workDays.length : 0;
      const myHolidays = holidays.filter(h => Holidays.appliesTo(h, u));
      const myAbsences = absences.filter(a => a.email === u.email);
      const availOn = d => {
        if (workDays.indexOf(S.weekday(d)) < 0) return 0;
        if (myHolidays.some(h => h.date === d)) return 0;
        if (myAbsences.some(a => a.startDate <= d && a.endDate >= d)) return 0;
        return perDay;
      };

      const planned = {};
      let unscheduled = 0;
      let overdue = 0;
      tasks.filter(t => t.assignees.indexOf(u.email) >= 0).forEach(t => {
        const share = Number(t.estimate) / t.assignees.length;
        if (!t.dueDate) { unscheduled += share; return; }
        if (t.dueDate < today) { overdue += share; return; }
        let start = t.startDate && t.startDate <= t.dueDate ? t.startDate : t.dueDate;
        if (start < today) start = today;
        const span = [];
        for (let d = start; d <= t.dueDate && span.length < 370; d = S.addDays(d, 1)) span.push(d);
        let days = span.filter(d => availOn(d) > 0);
        if (!days.length) days = [t.dueDate];
        days.forEach(d => { planned[d] = (planned[d] || 0) + share / days.length; });
      });
      // Overdue work lands in the current week, so it is not silently lost.
      if (overdue && from <= today && today <= to) {
        planned[today] = (planned[today] || 0) + overdue;
      }

      const wk = weekStarts.map(start => {
        let available = 0, load = 0, absent = 0;
        const hol = [];
        for (let i = 0; i < 7; i++) {
          const d = S.addDays(start, i);
          available += availOn(d);
          load += planned[d] || 0;
          if (workDays.indexOf(S.weekday(d)) >= 0) {
            const h = myHolidays.find(x => x.date === d);
            if (h) hol.push({ date: d, name: h.name, nameEn: h.nameEn || h.name });
            else if (myAbsences.some(a => a.startDate <= d && a.endDate >= d)) absent++;
          }
        }
        const round = n => Math.round(n * 10) / 10;
        return {
          start: start, available: round(available), planned: round(load),
          utilization: available ? Math.round((load / available) * 100) : (load ? 999 : 0),
          holidays: hol, absentDays: absent,
        };
      });
      return {
        email: u.email, name: u.name, color: u.color, country: u.country, region: u.region,
        hoursPerWeek: Number(u.hoursPerWeek) || 0, weeks: wk,
        unscheduled: Math.round(unscheduled * 10) / 10, overdue: Math.round(overdue * 10) / 10,
      };
    });

    const totals = weekStarts.map((start, i) => {
      const available = members.reduce((s, m) => s + m.weeks[i].available, 0);
      const planned = members.reduce((s, m) => s + m.weeks[i].planned, 0);
      return {
        start: start, available: Math.round(available * 10) / 10, planned: Math.round(planned * 10) / 10,
        utilization: available ? Math.round((planned / available) * 100) : 0,
      };
    });
    return {
      from: from, to: to,
      weeks: weekStarts.map(s => ({ start: s, end: S.addDays(s, 6), kw: S.isoWeek(s) })),
      members: members, totals: totals,
      holidays: holidays.map(h => Object.assign({}, h, {
        affects: users.filter(u => Holidays.appliesTo(h, u)).map(u => u.email),
      })).filter(h => h.affects.length),
    };
  },
};
