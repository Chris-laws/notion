/**
 * Google Calendar link per person (read-only). Everybody connects their own calendar once (OAuth with the
 * company's own OAuth client): their entries then show in the LidlFlow calendar (for them only), and
 * "out of office" entries become absences, which the team capacity already counts.
 * The web app runs as the deploying user, so every person needs a token of their own; the refresh token
 * is kept in the protected sheet GoogleLinks and never leaves the server.
 */
const Gcal = {
  T: 'GoogleLinks', // the table
  MIDNIGHT: 'T00:00:00Z',
  SCOPE: 'https://www.googleapis.com/auth/calendar.readonly',
  AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
  API: 'https://www.googleapis.com/calendar/v3',
  BEFORE: 30, // days before today that a sync reads
  AFTER: 180, // and after
  STALE_MIN: 30, // the page asks for a new sync after this many minutes

  configured_() { return !!(Config.get('GOOGLE_CLIENT_ID') && Config.get('GOOGLE_CLIENT_SECRET')); },
  redirectUri_() { return ScriptApp.getService().getUrl(); },
  cache_() { return CacheService.getScriptCache(); },

  /** Google's reason of a refused call, in words the person can act on (the share hint only when the calendar is really not shared). */
  refused_(r, own) {
    const e = (r.json && r.json.error) || {};
    const why = String((e.errors && e.errors[0] && e.errors[0].reason) || e.status || '');
    const text = String(e.message || r.code);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(why + ' ' + text)) return 'Die Google Calendar API ist im Cloud-Projekt der App nicht aktiv. In der Cloud Console unter „APIs & Dienste“ die Google Calendar API aktivieren (' + text.slice(0, 160) + ').';
    if (/serviceusage|service usage|required permission to use project/i.test(text)) return 'Dein Konto darf das Cloud-Projekt nicht als abrechnendes Projekt nutzen (' + text.slice(0, 120) + '). Entweder die Rolle „Service Usage Consumer“ im Projekt geben, oder die Google Calendar API im Projekt des Apps-Script-Skripts aktivieren.';
    if (/insufficient|ACCESS_TOKEN_SCOPE|scope/i.test(why + ' ' + text)) return 'Der App fehlt die Berechtigung „Kalender lesen“. Im Apps-Script-Editor die Funktion setup ausführen und die Berechtigung bestätigen, danach eine neue Version bereitstellen.';
    if (own || r.code === 429 || r.code >= 500) return 'Google Kalender nicht lesbar (' + r.code + ': ' + text.slice(0, 160) + ').';
    return Gcal.shareHint_();
  },

  /** What the settings page shows. Admins also get the redirect address to enter at Google. */
  status() {
    const me = Auth.currentUser();
    const row = Db.get(Gcal.T, me.email);
    return {
      configured: Gcal.configured_(),
      connected: !!row,
      lastSync: row ? row.lastSync || '' : '',
      lastError: row ? row.lastError || '' : '',
      redirectUri: Auth.isAdmin(me) ? Gcal.redirectUri_() : '',
      owner: Gcal.owner_(),
      mode: row ? row.mode || 'oauth' : '',
    };
  },

  /** Who the app reads calendars as: the person who deployed it. */
  owner_() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); },

  shareHint_() {
    return 'Dein Kalender ist für LidlFlow nicht freigegeben. Öffne Google Kalender → Einstellungen → dein Kalender → „Für bestimmte Personen oder Gruppen freigeben“ → ' +
      Gcal.owner_() + ' hinzufügen mit „Alle Termindetails anzeigen“, dann hier noch einmal verbinden.';
  },

  /**
   * Connect without a Google sign-in of their own: the app reads the calendar as its owner, which works once the person
   * shared the calendar with the owner (read only) in Google Calendar. No cloud settings are needed.
   */
  connectDirect() {
    const me = Auth.currentUser();
    const probe = Gcal.own_(Gcal.API + '/calendars/' + encodeURIComponent(me.email) + '/events?maxResults=1&singleEvents=true&timeMin=' +
      encodeURIComponent(Util.today() + Gcal.MIDNIGHT), ScriptApp.getOAuthToken());
    if (probe.code !== 200 && !Gcal.noProject_(probe)) throw new Error(Gcal.refused_(probe, me.email === Gcal.owner_()));
    // the account may not use the cloud project behind the script: the built-in calendar service needs none
    if (probe.code !== 200 && !Gcal.calendarOf_(me.email)) throw new Error(Gcal.shareHint_());
    const row = { email: me.email, refreshToken: '', scope: Gcal.SCOPE, connectedAt: new Date().toISOString(), lastSync: '', lastError: '', mode: 'direct' };
    Db.tx(() => { if (Db.get(Gcal.T, me.email)) Db.update(Gcal.T, me.email, row); else Db.insert(Gcal.T, row); });
    try { Gcal.sync_(me.email); } catch (e) { /* the settings show the error */ }
    return Gcal.status();
  },

  /** Admin: client id and secret of the OAuth client (the secret is never sent back). */
  setup(p) {
    const me = Auth.currentUser();
    if (!Auth.isAdmin(me)) throw new Error('Nur Admins können die Google-Anbindung einrichten.');
    const id = String(p.clientId || '').trim();
    const secret = String(p.clientSecret || '').trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('Die Client-ID sieht anders aus (…apps.googleusercontent.com).');
    const props = PropertiesService.getScriptProperties();
    props.setProperty('GOOGLE_CLIENT_ID', id);
    // an empty secret field keeps the stored one (the page never shows it)
    if (secret) props.setProperty('GOOGLE_CLIENT_SECRET', secret);
    Config.reset();
    if (!Gcal.configured_()) throw new Error('Bitte auch das Client-Secret eintragen.');
    return Gcal.status();
  },

  /** The address the person opens at Google to allow read access. */
  connect() {
    const me = Auth.currentUser();
    if (!Gcal.configured_()) throw new Error('Die Google-Anbindung ist noch nicht eingerichtet. Bitte eine Admin-Person fragen.');
    const nonce = Utilities.getUuid();
    Gcal.cache_().put('gcal_s_' + nonce, me.email, 600);
    const q = {
      client_id: Config.get('GOOGLE_CLIENT_ID'), redirect_uri: Gcal.redirectUri_(), response_type: 'code', scope: Gcal.SCOPE,
      access_type: 'offline', prompt: 'consent', state: nonce, login_hint: me.email,
    };
    return { url: Gcal.AUTH_URL + '?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&') };
  },

  /** Google sends the person back to the web app with ?code=…&state=…; the answer is a small page. */
  callback(p) {
    const me = Auth.currentUser();
    const page = (ok, text) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LidlFlow</title>' +
      '<body style="font-family:system-ui,sans-serif;max-width:460px;margin:12vh auto;padding:0 20px;text-align:center"><h2>' + (ok ? 'Google Kalender verbunden' : 'Verbindung nicht möglich') + '</h2><p>' +
      String(text).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) + '</p><p><a target="_top" href="' + Gcal.redirectUri_() + '">Zurück zu LidlFlow</a></p></body>';
    try {
      if (p.error) throw new Error('Google hat die Freigabe nicht erteilt (' + p.error + ').');
      const cache = Gcal.cache_();
      const owner = cache.get('gcal_s_' + p.state);
      cache.remove('gcal_s_' + p.state);
      if (!p.state || owner !== me.email) throw new Error('Die Anfrage ist abgelaufen oder gehört zu einer anderen Person. Bitte in LidlFlow noch einmal auf „Verbinden“ klicken.');
      const tok = Gcal.http_('post', Gcal.TOKEN_URL, {
        payload: { code: p.code, client_id: Config.get('GOOGLE_CLIENT_ID'), client_secret: Config.get('GOOGLE_CLIENT_SECRET'), redirect_uri: Gcal.redirectUri_(), grant_type: 'authorization_code' },
      });
      if (tok.code !== 200 || !tok.json.access_token) throw new Error('Google hat den Code nicht angenommen' + (tok.json.error ? ' (' + tok.json.error + ')' : '') + '.');
      if (!tok.json.refresh_token) throw new Error('Google hat keine dauerhafte Freigabe geschickt. Bitte unter myaccount.google.com/permissions den Zugriff von LidlFlow entfernen und neu verbinden.');
      const cal = Gcal.http_('get', Gcal.API + '/calendars/primary?fields=id', { token: tok.json.access_token });
      const account = String(cal.json.id || '').toLowerCase();
      if (cal.code !== 200 || account !== me.email) throw new Error('Bitte mit dem Konto ' + me.email + ' verbinden' + (account ? ' (gewählt war ' + account + ')' : '') + '.');
      const row = { email: me.email, refreshToken: tok.json.refresh_token, scope: Gcal.SCOPE, connectedAt: new Date().toISOString(), lastSync: '', lastError: '' };
      Db.tx(() => { if (Db.get(Gcal.T, me.email)) Db.update(Gcal.T, me.email, row); else Db.insert(Gcal.T, row); });
      cache.put('gcal_at_' + me.email, tok.json.access_token, Math.max(60, Math.min(3000, (tok.json.expires_in || 3600) - 120)));
      try { Gcal.sync_(me.email); } catch (e) { /* the page shows the error with the next sync */ }
      return page(true, 'Deine Termine erscheinen jetzt in LidlFlow, Abwesenheiten aus Google („Abwesend“) zählen für die Teamplanung.');
    } catch (e) {
      return page(false, e.message);
    }
  },

  /** One call to Google: { code, json }. A broken answer gives an empty object. */
  http_(method, url, o) {
    const opts = { method: method, muteHttpExceptions: true };
    if (o && o.token) opts.headers = { Authorization: 'Bearer ' + o.token };
    // the app's own token bills the cloud project of the script; like for the AI, the project of the company is named (when set)
    if (o && o.project && Config.get('VERTEX_PROJECT_ID')) opts.headers['x-goog-user-project'] = Config.get('VERTEX_PROJECT_ID');
    if (o && o.payload) opts.payload = o.payload;
    const res = UrlFetchApp.fetch(url, opts);
    let json = {};
    try { json = JSON.parse(res.getContentText() || '{}') || {}; } catch (e) { json = {}; }
    return { code: res.getResponseCode(), json: json };
  },

  /**
   * Reads with the app's own token. Without a billing project first (works when the Calendar API is on in the script's
   * own project); only when Google says the API is off there, once more with the company project named (like the AI).
   */
  own_(url, token) {
    const r = Gcal.http_('get', url, { token: token });
    if (r.code === 403 && Config.get('VERTEX_PROJECT_ID') && /accessNotConfigured|SERVICE_DISABLED|has not been used/i.test(JSON.stringify(r.json))) {
      return Gcal.http_('get', url, { token: token, project: true });
    }
    return r;
  },

  /** A valid access token of the person (kept 50 minutes in the cache). */
  token_(email) {
    const cache = Gcal.cache_();
    const hit = cache.get('gcal_at_' + email);
    if (hit) return hit;
    const row = Db.get(Gcal.T, email);
    if (!row) throw new Error('Google Kalender ist nicht verbunden.');
    if (row.mode === 'direct') return ScriptApp.getOAuthToken();
    const r = Gcal.http_('post', Gcal.TOKEN_URL, {
      payload: { client_id: Config.get('GOOGLE_CLIENT_ID'), client_secret: Config.get('GOOGLE_CLIENT_SECRET'), refresh_token: row.refreshToken, grant_type: 'refresh_token' },
    });
    if (r.code !== 200 || !r.json.access_token) {
      const gone = r.json.error === 'invalid_grant';
      const msg = gone ? 'Die Freigabe bei Google ist abgelaufen. Bitte neu verbinden.' : 'Google antwortet gerade nicht (' + (r.json.error || r.code) + ').';
      Gcal.note_(email, msg);
      throw new Error(msg);
    }
    cache.put('gcal_at_' + email, r.json.access_token, Math.max(60, Math.min(3000, (r.json.expires_in || 3600) - 120)));
    return r.json.access_token;
  },

  note_(email, msg) {
    try { Db.tx(() => { if (Db.get(Gcal.T, email)) Db.update(Gcal.T, email, { lastError: msg }); }); } catch (e) { /* only a hint */ }
  },

  /** The entries of the primary calendar between two days, as LidlFlow calendar items. */
  fetch_(email, from, to) {
    const link = Db.get(Gcal.T, email);
    if (link && link.mode === 'direct') {
      try { return Gcal.fetchRest_(email, from, to); } catch (e) { if (!e.noProject) throw e; }
      return Gcal.fetchBuiltin_(email, from, to);
    }
    return Gcal.fetchRest_(email, from, to);
  },

  /** True when Google refuses because the account may not use the cloud project of the script. */
  noProject_(r) { return r.code === 403 && /serviceusage|service usage|required permission to use project/i.test(JSON.stringify(r.json)); },

  /** The calendar through the built-in service (subscribing is needed for calendars shared by others); null when not readable. */
  calendarOf_(email) {
    try {
      let c = CalendarApp.getCalendarById(email);
      if (!c && email !== Gcal.owner_()) c = CalendarApp.subscribeToCalendar(email);
      return c || null;
    } catch (e) { return null; }
  },

  /**
   * Same entries through the built-in calendar service (no cloud project, no API quota). It cannot tell "out of office"
   * from other entries, so all-day entries called vacation/absent/out of office count as that.
   */
  fetchBuiltin_(email, from, to) {
    const cal = Gcal.calendarOf_(email);
    if (!cal) { const msg = Gcal.shareHint_(); Gcal.note_(email, msg); throw new Error(msg); }
    const tz = Session.getScriptTimeZone();
    const day = d => Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const clock = d => Utilities.formatDate(d, tz, 'HH:mm');
    const out = [];
    cal.getEvents(new Date(Shared.addDays(from, -1) + Gcal.MIDNIGHT), new Date(Shared.addDays(to, 1) + Gcal.MIDNIGHT)).forEach(e => {
      const allDay = e.isAllDayEvent();
      const title = String(e.getTitle() || '(ohne Titel)').slice(0, 200);
      const startDate = allDay ? day(e.getAllDayStartDate()) : day(e.getStartTime());
      let endDate = allDay ? Shared.addDays(day(e.getAllDayEndDate()), -1) : day(e.getEndTime());
      if (endDate < startDate) endDate = startDate;
      out.push({
        id: 'g_' + String(e.getId()).slice(0, 80) + '_' + startDate, type: 'google', source: 'google', readOnly: true, title: title, startDate: startDate, endDate: endDate, allDay: allDay,
        time: allDay ? '' : clock(e.getStartTime()), endTime: allDay ? '' : clock(e.getEndTime()), link: '', meetLink: '',
        ooo: allDay && /urlaub|abwesen|out of office|\booo\b|vacation|holiday/i.test(title), attendees: [email], teamId: '',
      });
    });
    return out;
  },

  fetchRest_(email, from, to) {
    const token = Gcal.token_(email);
    const link = Db.get(Gcal.T, email);
    const cal = link && link.mode === 'direct' ? encodeURIComponent(email) : 'primary';
    const out = [];
    let page = '';
    for (let i = 0; i < 6; i++) {
      const q = 'singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + encodeURIComponent(Shared.addDays(from, -1) + Gcal.MIDNIGHT) +
        '&timeMax=' + encodeURIComponent(Shared.addDays(to, 1) + Gcal.MIDNIGHT) + (page ? '&pageToken=' + encodeURIComponent(page) : '');
      const url = Gcal.API + '/calendars/' + cal + '/events?' + q;
      const r = cal === 'primary' ? Gcal.http_('get', url, { token: token }) : Gcal.own_(url, token);
      if (r.code === 401) Gcal.cache_().remove('gcal_at_' + email);
      if (r.code !== 200) Gcal.fail_(email, r, cal !== 'primary');
      (r.json.items || []).forEach(it => { const e = Gcal.item_(it, email); if (e) out.push(e); });
      page = r.json.nextPageToken || '';
      if (!page) break;
    }
    return out;
  },

  /** Notes and throws the reason of a refused read. */
  fail_(email, r, direct) {
    if (direct && Gcal.noProject_(r)) { const e = new Error(Gcal.refused_(r, true)); e.noProject = true; throw e; }
    const msg = direct ? Gcal.refused_(r, email === Gcal.owner_()) : 'Google Kalender nicht lesbar (' + ((r.json.error && (r.json.error.message || r.json.error)) || r.code) + ').';
    Gcal.note_(email, msg);
    throw new Error(msg);
  },

  /** Start day, end day and clock times of a Google entry (all-day entries end the day before Google's end date). */
  span_(it) {
    const allDay = !!it.start.date;
    const clock = x => (x && x.dateTime ? { d: String(x.dateTime).slice(0, 10), t: String(x.dateTime).slice(11, 16) } : { d: '', t: '' });
    const s = allDay ? { d: it.start.date, t: '' } : clock(it.start);
    const e = allDay ? { d: it.end && it.end.date ? Shared.addDays(it.end.date, -1) : s.d, t: '' } : clock(it.end);
    return { allDay: allDay, startDate: s.d, endDate: e.d && e.d >= s.d ? e.d : s.d, time: s.t, endTime: e.t };
  },

  /** One Google entry as calendar item (null for cancelled or declined ones). */
  item_(it, email) {
    if (!it || it.status === 'cancelled' || !it.start) return null;
    const self = (it.attendees || []).find(a => a.self);
    if (self && self.responseStatus === 'declined') return null;
    const sp = Gcal.span_(it);
    const hidden = it.visibility === 'private' || it.visibility === 'confidential';
    return Object.assign(sp, {
      id: 'g_' + it.id + '_' + sp.startDate, type: 'google', source: 'google', readOnly: true,
      title: hidden ? 'Privater Termin' : String(it.summary || '(ohne Titel)').slice(0, 200),
      link: hidden ? '' : String(it.htmlLink || ''), meetLink: hidden ? '' : String(it.hangoutLink || ''),
      ooo: it.eventType === 'outOfOffice', attendees: [email], teamId: '',
    });
  },

  /** My Google entries for the calendar: only mine, kept five minutes. A problem never breaks the calendar. */
  events_(email, from, to) {
    if (!Db.get(Gcal.T, email)) return [];
    const key = 'gcal_ev_' + email + '_' + from + '_' + to;
    const cache = Gcal.cache_();
    const hit = cache.get(key);
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
    let list = [];
    try { list = Gcal.fetch_(email, from, to); } catch (e) { return []; }
    try { cache.put(key, JSON.stringify(list), 300); } catch (e) { /* too big for the cache: read again next time */ }
    return list;
  },

  /** Reads the next months and turns "out of office" into absences; returns what was done. */
  sync_(email) {
    const from = Shared.addDays(Util.today(), -Gcal.BEFORE);
    const to = Shared.addDays(Util.today(), Gcal.AFTER);
    const list = Gcal.fetch_(email, from, to);
    const ooo = list.filter(e => e.ooo);
    const done = Db.tx(() => {
      const mine = Db.all('Absences').filter(a => a.email === email);
      const byExt = {};
      mine.forEach(a => { if (a.extId) byExt[a.extId] = a; });
      let added = 0;
      ooo.forEach(e => {
        const ext = e.id;
        const data = { startDate: e.startDate, endDate: e.endDate, note: e.title === 'Privater Termin' ? '' : e.title.slice(0, 200) };
        const have = byExt[ext];
        if (have) { if (have.source === 'google' && (have.startDate !== data.startDate || have.endDate !== data.endDate)) Db.update('Absences', have.id, data); return; }
        // somebody already entered the same days by hand: no second entry
        if (mine.some(a => !a.source && a.startDate === data.startDate && a.endDate === data.endDate)) return;
        Db.insert('Absences', Object.assign(data, { id: Util.uid('ab_'), email: email, type: 'vacation', createdAt: new Date().toISOString(), source: 'google', extId: ext }));
        added++;
      });
      // gone from Google (deleted or moved out of the window): gone here too
      const keep = {};
      ooo.forEach(e => { keep[e.id] = true; });
      let removed = 0;
      mine.forEach(a => { if (a.source === 'google' && a.endDate >= from && a.startDate <= to && !keep[a.extId]) { Db.remove('Absences', a.id); removed++; } });
      if (Db.get(Gcal.T, email)) Db.update(Gcal.T, email, { lastSync: new Date().toISOString(), lastError: '' });
      return { added: added, removed: removed };
    });
    return { events: list.length, absences: ooo.length, added: done.added, removed: done.removed };
  },

  sync() {
    const me = Auth.currentUser();
    if (!Db.get(Gcal.T, me.email)) throw new Error('Google Kalender ist nicht verbunden.');
    const r = Gcal.sync_(me.email);
    const cache = Gcal.cache_();
    cache.remove('gcal_ev_' + me.email + '_' + Shared.addDays(Util.today(), -7) + '_' + Shared.addDays(Util.today(), 35));
    return Object.assign(r, { status: Gcal.status() });
  },

  /** Ends the link: Google is told to drop the token, the imported absences go. */
  disconnect() {
    const me = Auth.currentUser();
    const row = Db.get(Gcal.T, me.email);
    if (!row) return Gcal.status();
    try { if (row.refreshToken) Gcal.http_('post', Gcal.REVOKE_URL, { payload: { token: row.refreshToken } }); } catch (e) { /* the link is removed here anyway */ }
    Db.tx(() => {
      Db.all('Absences').filter(a => a.email === me.email && a.source === 'google').forEach(a => Db.remove('Absences', a.id));
      Db.remove(Gcal.T, me.email);
    });
    Gcal.cache_().remove('gcal_at_' + me.email);
    return Gcal.status();
  },

  /** For the time trigger: everybody who is connected, as far as the time allows. */
  syncAll() {
    const t0 = Date.now();
    let n = 0;
    Db.all(Gcal.T).forEach(r => {
      if (Date.now() - t0 > 240000) return;
      try { Gcal.sync_(r.email); n++; } catch (e) { /* noted in the row */ }
    });
    return n;
  },
};

/** Time trigger target (setup installs it hourly). */
function gcalSyncAll() { Db.reset(); return Gcal.syncAll(); }
