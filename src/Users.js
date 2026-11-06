/** People directory: everyone who opened the app or was invited by name. */
const USER_COLORS = ['#e16b5c', '#e5894a', '#d9a72a', '#5aa36b', '#3e8ed0', '#7a6ad8', '#c45fa0', '#4aa8a8', '#8a7a6a'];

const Users = {
  /** Active people; a profile without a country counts as DEFAULT_COUNTRY (for holidays and capacity). */
  list() {
    const fallback = Config.get('DEFAULT_COUNTRY');
    return Db.all('Users').filter(u => u.active !== false && u.active !== 'false')
      .map(u => (u.country ? u : Object.assign({}, u, { country: fallback })));
  },

  create_(email, extra) {
    email = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ungültige E-Mail-Adresse: ' + email);
    const existing = Db.get('Users', email);
    if (existing) return existing;
    const local = email.split('@')[0];
    const name = local.split(/[._-]+/).filter(Boolean)
      .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
    return Db.insert('Users', Object.assign({
      email: email,
      name: name,
      color: USER_COLORS[hash % USER_COLORS.length],
      country: Config.get('DEFAULT_COUNTRY'),
      region: '',
      hoursPerWeek: Number(Config.get('DEFAULT_HOURS_PER_WEEK')) || 40,
      workDays: '1,2,3,4,5',
      role: 'member',
      active: true,
      createdAt: new Date().toISOString(),
    }, extra || {}));
  },

  /** Makes sure every e-mail exists in the directory (e.g. invited team members). */
  ensure(emails) {
    (emails || []).forEach(e => Users.create_(e));
  },

  save(p) {
    const me = Auth.currentUser();
    const admin = Auth.isAdmin(me);
    const email = String(p.email || me.email).toLowerCase();
    if (email !== me.email && !admin) throw new Error('Nur Admins können andere Profile bearbeiten.');
    const patch = {};
    if (p.name !== undefined) patch.name = String(p.name).trim().slice(0, 80) || email.split('@')[0];
    if (p.color !== undefined && /^#[0-9a-f]{6}$/i.test(p.color)) patch.color = p.color;
    if (p.country !== undefined) patch.country = String(p.country).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    if (p.region !== undefined) patch.region = String(p.region).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
    if (p.hoursPerWeek !== undefined) patch.hoursPerWeek = Math.max(0, Math.min(80, Number(p.hoursPerWeek) || 0));
    if (p.workDays !== undefined) {
      const days = (Array.isArray(p.workDays) ? p.workDays : String(p.workDays).split(','))
        .map(Number).filter(n => n >= 0 && n <= 6);
      patch.workDays = days.filter((d, i) => days.indexOf(d) === i).sort().join(',');
    }
    if (admin && p.role !== undefined) patch.role = p.role === 'admin' ? 'admin' : 'member';
    if (admin && p.active !== undefined && email !== me.email) patch.active = !!p.active;
    return Db.tx(() => {
      if (!Db.get('Users', email)) {
        if (!admin) throw new Error('Person nicht gefunden.');
        Users.create_(email);
      }
      return Db.update('Users', email, patch);
    });
  },
};
