/**
 * Google Calendar link per person (read-only). Everybody connects their own calendar once (OAuth with the
 * company's own OAuth client): their entries then show in the LidlFlow calendar (for them only), and
 * "out of office" entries become absences, which the team capacity already counts.
 * The web app runs as the deploying user, so every person needs a token of their own; the refresh token
 * is kept in the protected sheet GoogleLinks and never leaves the server.
 */
const Gcal = {
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

  /** What the settings page shows. Admins also get the redirect address to enter at Google. */
  status() {
    const me = Auth.currentUser();
    const row = Db.get('GoogleLinks', me.email);
    return {
      configured: Gcal.configured_(),
      connected: !!row,
      lastSync: row ? row.lastSync || '' : '',
      lastError: row ? row.lastError || '' : '',
      redirectUri: Auth.isAdmin(me) ? Gcal.redirectUri_() : '',
    };
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
      Db.tx(() => { if (Db.get('GoogleLinks', me.email)) Db.update('GoogleLinks', me.email, row); else Db.insert('GoogleLinks', row); });
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
    if (o && o.payload) opts.payload = o.payload;
    const res = UrlFetchApp.fetch(url, opts);
    let json = {};
    try { json = JSON.parse(res.getContentText() || '{}') || {}; } catch (e) { json = {}; }
    return { code: res.getResponseCode(), json: json };
  },

  /** A valid access token of the person (kept 50 minutes in the cache). */
  token_(email) {
    const cache = Gcal.cache_();
    const hit = cache.get('gcal_at_' + email);
    if (hit) return hit;
    const row = Db.get('GoogleLinks', email);
    if (!row) throw new Error('Google Kalender ist nicht verbunden.');
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
    try { Db.tx(() => { if (Db.get('GoogleLinks', email)) Db.update('GoogleLinks', email, { lastError: msg }); }); } catch (e) { /* only a hint */ }
  },

  /** The entries of the primary calendar between two days, as LidlFlow calendar items. */
  fetch_(email, from, to) {
    const token = Gcal.token_(email);
    const out = [];
    let page = '';
    for (let i = 0; i < 6; i++) {
      const q = 'singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + encodeURIComponent(Shared.addDays(from, -1) + 'T00:00:00Z') +
        '&timeMax=' + encodeURIComponent(Shared.addDays(to, 1) + 'T00:00:00Z') + (page ? '&pageToken=' + encodeURIComponent(page) : '');
      const r = Gcal.http_('get', Gcal.API + '/calendars/primary/events?' + q, { token: token });
      if (r.code === 401) Gcal.cache_().remove('gcal_at_' + email);
      if (r.code !== 200) {
        const msg = 'Google Kalender nicht lesbar (' + ((r.json.error && (r.json.error.message || r.json.error)) || r.code) + ').';
        Gcal.note_(email, msg);
        throw new Error(msg);
      }
      (r.json.items || []).forEach(it => { const e = Gcal.item_(it, email); if (e) out.push(e); });
      page = r.json.nextPageToken || '';
      if (!page) break;
    }
    return out;
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
    if (!Db.get('GoogleLinks', email)) return [];
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
      if (Db.get('GoogleLinks', email)) Db.update('GoogleLinks', email, { lastSync: new Date().toISOString(), lastError: '' });
      return { added: added, removed: removed };
    });
    return { events: list.length, absences: ooo.length, added: done.added, removed: done.removed };
  },

  sync() {
    const me = Auth.currentUser();
    if (!Db.get('GoogleLinks', me.email)) throw new Error('Google Kalender ist nicht verbunden.');
    const r = Gcal.sync_(me.email);
    const cache = Gcal.cache_();
    cache.remove('gcal_ev_' + me.email + '_' + Shared.addDays(Util.today(), -7) + '_' + Shared.addDays(Util.today(), 35));
    return Object.assign(r, { status: Gcal.status() });
  },

  /** Ends the link: Google is told to drop the token, the imported absences go. */
  disconnect() {
    const me = Auth.currentUser();
    const row = Db.get('GoogleLinks', me.email);
    if (!row) return Gcal.status();
    try { Gcal.http_('post', Gcal.REVOKE_URL, { payload: { token: row.refreshToken } }); } catch (e) { /* the link is removed here anyway */ }
    Db.tx(() => {
      Db.all('Absences').filter(a => a.email === me.email && a.source === 'google').forEach(a => Db.remove('Absences', a.id));
      Db.remove('GoogleLinks', me.email);
    });
    Gcal.cache_().remove('gcal_at_' + me.email);
    return Gcal.status();
  },

  /** For the time trigger: everybody who is connected, as far as the time allows. */
  syncAll() {
    const t0 = Date.now();
    let n = 0;
    Db.all('GoogleLinks').forEach(r => {
      if (Date.now() - t0 > 240000) return;
      try { Gcal.sync_(r.email); n++; } catch (e) { /* noted in the row */ }
    });
    return n;
  },
};

/** Time trigger target (setup installs it hourly). */
function gcalSyncAll() { Db.reset(); return Gcal.syncAll(); }
