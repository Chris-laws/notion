/**
 * International public holidays.
 *
 * Source order: script cache -> HolidayCache sheet -> Nager.Date API
 * (https://date.nager.at, ~120 countries incl. regional holidays) ->
 * Google's public holiday calendars -> a built-in calculation for common
 * European countries and the US. Company holidays from the
 * CompanyHolidays sheet are always added on top.
 *
 * A holiday looks like:
 * { date, name, country, counties: null | ['DE-BY', ...], source }
 * counties === null means the holiday applies to the whole country.
 */
const Holidays = {
  CACHE_DAYS: 30,

  forCountry(country, year) {
    country = String(country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return [];
    const key = country + '-' + year;
    const cache = CacheService.getScriptCache();
    const hit = cache.get('hol:' + key);
    if (hit) return JSON.parse(hit);

    let list = null;
    const stored = Db.get('HolidayCache', key);
    if (stored && stored.fetchedAt && Shared.diffDays(stored.fetchedAt.slice(0, 10), Util.today()) < Holidays.CACHE_DAYS) {
      try { list = JSON.parse(stored.json); } catch (e) { list = null; }
    }
    if (!list) {
      list = Holidays.fetchNager_(country, year)
        || Holidays.fetchGoogle_(country, year)
        || Holidays.builtin_(country, year);
      if (list.length && list[0].source !== 'builtin') {
        Db.tx(() => {
          const row = { key: key, json: JSON.stringify(list), fetchedAt: new Date().toISOString() };
          if (Db.get('HolidayCache', key)) Db.update('HolidayCache', key, row);
          else Db.insert('HolidayCache', row);
        });
      }
    }
    cache.put('hol:' + key, JSON.stringify(list), 21600);
    return list;
  },

  /** All holidays (official + company) for the given countries between two dates. */
  inRange(countries, from, to) {
    const years = [];
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
    let out = [];
    countries.filter((c, i, a) => c && a.indexOf(c) === i).forEach(c => {
      years.forEach(y => { out = out.concat(Holidays.forCountry(c, y)); });
    });
    Db.all('CompanyHolidays').forEach(h => {
      const cs = h.countries && h.countries.length ? h.countries : ['*'];
      cs.forEach(c => out.push({ date: h.date, name: h.name, country: c, counties: null, source: 'company', id: h.id }));
    });
    return out.filter(h => h.date >= from && h.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },

  /** Does the holiday give this person a day off? */
  appliesTo(h, user) {
    if (h.country === '*') return true;
    if (h.country !== String(user.country || '').toUpperCase()) return false;
    if (!h.counties || !h.counties.length) return true;
    return !!user.region && h.counties.indexOf(user.region) >= 0;
  },

  fetchNager_(country, year) {
    try {
      const res = UrlFetchApp.fetch('https://date.nager.at/api/v3/PublicHolidays/' + year + '/' + country, {
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) return null;
      const data = JSON.parse(res.getContentText());
      if (!Array.isArray(data)) return null;
      return data
        .filter(h => !h.types || h.types.indexOf('Public') >= 0)
        .map(h => ({ date: h.date, name: h.localName || h.name, country: country, counties: h.counties || null, source: 'nager' }));
    } catch (e) {
      return null;
    }
  },

  fetchGoogle_(country, year) {
    try {
      const cal = CalendarApp.getCalendarById('en.' + country.toLowerCase() + '#holiday@group.v.calendar.google.com');
      if (!cal) return null;
      const events = cal.getEvents(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)));
      const list = events.map(ev => ({
        date: Utilities.formatDate(ev.getAllDayStartDate ? ev.getAllDayStartDate() : ev.getStartTime(), 'UTC', 'yyyy-MM-dd'),
        name: ev.getTitle(), country: country, counties: null, source: 'google',
      }));
      return list.length ? list : null;
    } catch (e) {
      return null;
    }
  },

  /** Offline fallback with the most common countries. */
  builtin_(country, year) {
    const S = Shared;
    const pad = n => String(n).padStart(2, '0');
    const d = (m, day) => year + '-' + pad(m) + '-' + pad(day);
    const easter = (() => {
      const a = year % 19, b = Math.floor(year / 100), c = year % 100, dd = Math.floor(b / 4), e = b % 4;
      const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
      return d(month, day);
    })();
    const E = n => S.addDays(easter, n);
    const nth = (month, wd, n) => { // n-th weekday of month, n = -1 for last
      if (n > 0) {
        let x = d(month, 1);
        while (S.weekday(x) !== wd) x = S.addDays(x, 1);
        return S.addDays(x, 7 * (n - 1));
      }
      let x = S.endOfMonth(d(month, 1));
      while (S.weekday(x) !== wd) x = S.addDays(x, -1);
      return x;
    };
    // Wednesday before 23 November
    let bussUndBettag = d(11, 22);
    while (S.weekday(bussUndBettag) !== 3) bussUndBettag = S.addDays(bussUndBettag, -1);
    const R = (date, name, counties) => ({ date: date, name: name, country: country, counties: counties || null, source: 'builtin' });
    const T = {
      DE: [R(d(1, 1), 'Neujahr'), R(d(1, 6), 'Heilige Drei Könige', ['DE-BW', 'DE-BY', 'DE-ST']),
        R(d(3, 8), 'Internationaler Frauentag', ['DE-BE', 'DE-MV']), R(E(-2), 'Karfreitag'), R(E(1), 'Ostermontag'),
        R(d(5, 1), 'Tag der Arbeit'), R(E(39), 'Christi Himmelfahrt'), R(E(50), 'Pfingstmontag'),
        R(E(60), 'Fronleichnam', ['DE-BW', 'DE-BY', 'DE-HE', 'DE-NW', 'DE-RP', 'DE-SL']),
        R(d(8, 15), 'Mariä Himmelfahrt', ['DE-SL']), R(d(9, 20), 'Weltkindertag', ['DE-TH']),
        R(d(10, 3), 'Tag der Deutschen Einheit'),
        R(d(10, 31), 'Reformationstag', ['DE-BB', 'DE-HB', 'DE-HH', 'DE-MV', 'DE-NI', 'DE-SN', 'DE-ST', 'DE-SH', 'DE-TH']),
        R(d(11, 1), 'Allerheiligen', ['DE-BW', 'DE-BY', 'DE-NW', 'DE-RP', 'DE-SL']),
        R(bussUndBettag, 'Buß- und Bettag', ['DE-SN']),
        R(d(12, 25), '1. Weihnachtstag'), R(d(12, 26), '2. Weihnachtstag')],
      AT: [R(d(1, 1), 'Neujahr'), R(d(1, 6), 'Heilige Drei Könige'), R(E(1), 'Ostermontag'), R(d(5, 1), 'Staatsfeiertag'),
        R(E(39), 'Christi Himmelfahrt'), R(E(50), 'Pfingstmontag'), R(E(60), 'Fronleichnam'),
        R(d(8, 15), 'Mariä Himmelfahrt'), R(d(10, 26), 'Nationalfeiertag'), R(d(11, 1), 'Allerheiligen'),
        R(d(12, 8), 'Mariä Empfängnis'), R(d(12, 25), 'Christtag'), R(d(12, 26), 'Stefanitag')],
      CH: [R(d(1, 1), 'Neujahr'), R(E(-2), 'Karfreitag'), R(E(1), 'Ostermontag'), R(E(39), 'Auffahrt'),
        R(E(50), 'Pfingstmontag'), R(d(8, 1), 'Bundesfeier'), R(d(12, 25), 'Weihnachten'), R(d(12, 26), 'Stephanstag')],
      US: [R(d(1, 1), "New Year's Day"), R(nth(1, 1, 3), 'Martin Luther King, Jr. Day'), R(nth(2, 1, 3), "Presidents' Day"),
        R(nth(5, 1, -1), 'Memorial Day'), R(d(6, 19), 'Juneteenth'), R(d(7, 4), 'Independence Day'),
        R(nth(9, 1, 1), 'Labor Day'), R(nth(10, 1, 2), 'Columbus Day'), R(d(11, 11), 'Veterans Day'),
        R(nth(11, 4, 4), 'Thanksgiving Day'), R(d(12, 25), 'Christmas Day')],
      GB: [R(d(1, 1), "New Year's Day"), R(E(-2), 'Good Friday'), R(E(1), 'Easter Monday'),
        R(nth(5, 1, 1), 'Early May Bank Holiday'), R(nth(5, 1, -1), 'Spring Bank Holiday'),
        R(nth(8, 1, -1), 'Summer Bank Holiday'), R(d(12, 25), 'Christmas Day'), R(d(12, 26), 'Boxing Day')],
      FR: [R(d(1, 1), "Jour de l'an"), R(E(1), 'Lundi de Pâques'), R(d(5, 1), 'Fête du Travail'), R(d(5, 8), 'Victoire 1945'),
        R(E(39), 'Ascension'), R(E(50), 'Lundi de Pentecôte'), R(d(7, 14), 'Fête nationale'), R(d(8, 15), 'Assomption'),
        R(d(11, 1), 'Toussaint'), R(d(11, 11), 'Armistice 1918'), R(d(12, 25), 'Noël')],
      IT: [R(d(1, 1), 'Capodanno'), R(d(1, 6), 'Epifania'), R(E(1), "Lunedì dell'Angelo"), R(d(4, 25), 'Festa della Liberazione'),
        R(d(5, 1), 'Festa del Lavoro'), R(d(6, 2), 'Festa della Repubblica'), R(d(8, 15), 'Ferragosto'),
        R(d(11, 1), 'Ognissanti'), R(d(12, 8), 'Immacolata Concezione'), R(d(12, 25), 'Natale'), R(d(12, 26), 'Santo Stefano')],
      ES: [R(d(1, 1), 'Año Nuevo'), R(d(1, 6), 'Epifanía del Señor'), R(E(-2), 'Viernes Santo'), R(d(5, 1), 'Fiesta del Trabajo'),
        R(d(8, 15), 'Asunción'), R(d(10, 12), 'Fiesta Nacional de España'), R(d(11, 1), 'Todos los Santos'),
        R(d(12, 6), 'Día de la Constitución'), R(d(12, 8), 'Inmaculada Concepción'), R(d(12, 25), 'Navidad')],
      NL: [R(d(1, 1), 'Nieuwjaarsdag'), R(E(1), 'Tweede paasdag'),
        R(S.weekday(d(4, 27)) === 0 ? d(4, 26) : d(4, 27), 'Koningsdag'), R(E(39), 'Hemelvaartsdag'),
        R(E(50), 'Tweede pinksterdag'), R(d(12, 25), 'Eerste kerstdag'), R(d(12, 26), 'Tweede kerstdag')],
      PL: [R(d(1, 1), 'Nowy Rok'), R(d(1, 6), 'Trzech Króli'), R(E(1), 'Poniedziałek Wielkanocny'), R(d(5, 1), 'Święto Pracy'),
        R(d(5, 3), 'Święto Konstytucji 3 Maja'), R(E(60), 'Boże Ciało'), R(d(8, 15), 'Wniebowzięcie NMP'),
        R(d(11, 1), 'Wszystkich Świętych'), R(d(11, 11), 'Święto Niepodległości'),
        R(d(12, 25), 'Boże Narodzenie'), R(d(12, 26), 'Drugi dzień Bożego Narodzenia')],
    };
    if (country === 'PL' && year >= 2025) T.PL.push(R(d(12, 24), 'Wigilia'));
    return (T[country] || []).sort((a, b) => (a.date < b.date ? -1 : 1));
  },
};
