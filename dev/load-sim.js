/**
 * Load simulation for the web app WITHOUT touching the live deployment.
 *
 * 1. Profile: every request type runs once through the real server code (in a VM with the
 *    service shims). The shim meter counts what it costs: sheet reads (+rows), writes, flushes,
 *    cache calls, locks. Data is scaled to the scenario (users, tasks).
 * 2. Latency model per Apps Script operation (assumptions below, typical observed values).
 * 3. Discrete-event simulation of N users: login wave, polling, writes. Real limits:
 *    - at most 30 simultaneous executions (the web app runs as the deploying account, so all
 *      users share one quota); above that a call is refused at once,
 *    - one script lock for all writes (waitLock 20 s, then the call fails),
 *    - the table cache is valid until the next write (version token), big tables do not fit.
 * 4. Erlang B (loss system with 30 servers) as the theoretical check.
 *
 * Usage: node dev/load-sim.js [--users 10000] [--quick] [--compare]
 */
const { freshApp } = require('../test/helpers');
const vm = require('vm');

/* ---------------- assumptions (ms) ---------------- */
const COST = {
  overhead: 250,          // google.script.run round trip + V8 start of one execution
  sheetRead: 120,         // one getValues() call
  perCell: 0.004,         // per cell read
  sheetWrite: 120,        // setValues / deleteRow
  flush: 80,
  cacheCall: 15,          // get/put/getAll/putAll
  lock: 10,               // uncontended lock
  props: 15,              // script properties (once per request)
  perKB: 0.25,            // JSON out of the server and over the wire
  zipPerKB: 0.05,         // gzip/gunzip plus JSON stringify/parse of a cached table, per KB of JSON
};
const LIMITS = { concurrent: 30, lockWait: 20000, cacheTableMax: 80 * 30000 };

/* ---------------- 1. profile with the real code ---------------- */
function scaledApp(users, tasks) {
  const app = freshApp({ demo: true });
  const ctx = app.ctx;
  const schema = vm.runInContext('SCHEMA', ctx);
  const put = (table, obj) => app.sheet(table).data.push(schema[table].cols.map(c => {
    const v = obj[c];
    return Array.isArray(v) ? JSON.stringify(v) : v === undefined ? '' : v;
  }));
  const teams = app.call('bootstrap').teams.map(t => t.id);
  for (let i = 0; i < users; i++) put('Users', { email: 'u' + i + '@firma.de', name: 'User ' + i, country: 'DE', hoursPerWeek: 40, workDays: '1,2,3,4,5', role: 'member', active: true, createdAt: '2026-01-01' });
  for (let i = 0; i < tasks; i++) {
    put('Tasks', { id: 'tk_load_' + i, title: 'Aufgabe ' + i, status: i % 5 ? 'todo' : 'done', priority: '', teams: [teams[i % teams.length]],
      assignees: ['u' + (i % Math.max(1, users)) + '@firma.de'], tags: [], dueDate: '2026-11-' + String(1 + (i % 28)).padStart(2, '0'), createdBy: 'demo.user@firma.de', createdAt: '2026-01-01', sort: i });
  }
  // the sheet changed outside Db: drop every cached copy
  ctx.CacheService.getScriptCache().removeAll(Object.keys(schema).map(t => 'ver_' + t));
  app.x.Db.reset();
  return app;
}

/** Cost (ms) of one request from the meter; bytes = response size. */
function costOf(m, bytes) {
  return COST.overhead + COST.props +
    (m.sheetRead || 0) * COST.sheetRead + (m.rowsRead || 0) * 24 * COST.perCell +
    (m.sheetWrite || 0) * COST.sheetWrite + (m.flush || 0) * COST.flush +
    (m.cacheCall || 0) * COST.cacheCall + (m.lock || 0) * COST.lock + bytes / 1024 * COST.perKB + (m.zipKB || 0) * COST.zipPerKB;
}

/** Profiles every request type warm (table copy in the cache) and cold (cache empty: whole sheet read, like the old code under writes). */
function profile(users, tasks) {
  const app = scaledApp(users, tasks);
  // a regular person (not admin): sees their own and their teams' tasks
  app.as('u1@firma.de');
  const someTask = app.call('tasks.list', { ver: '' }).tasks[0];
  let ver = '';
  const kinds = {
    bootstrap: () => app.raw('bootstrap'),
    poll: () => app.raw('tasks.list', { ver: 'old' }),
    pollSame: () => app.raw('tasks.list', { ver: ver }),
    calendar: () => app.raw('calendar.range', { from: '2026-10-19', to: '2026-11-30' }),
    report: () => app.raw('ai.report', { range: 'week' }),
    update: () => app.raw('tasks.save', { id: someTask.id, title: 'x' + Math.random() }),
    create: () => app.raw('tasks.save', { title: 'neu', assignees: ['u1@firma.de'] }),
    comment: () => app.raw('comments.add', { taskId: someTask.id, body: 'ok' }),
  };
  const out = {};
  Object.keys(kinds).forEach(k => {
    const run = () => { let bytes = 0; const m = app.measure(() => { bytes = JSON.stringify(kinds[k]()).length; }); return { m, ms: costOf(m, bytes), bytes }; };
    kinds[k](); // warm: tables cached
    ver = app.call('tasks.list', { ver: '' }).ver;
    const warm = run();
    // cold: no table in the cache at all, every table comes from the sheet
    app.ctx.CacheService.getScriptCache().removeAll(['ver_Tasks', 'ver_Users', 'ver_Teams', 'ver_Projects', 'ver_Comments', 'ver_Events', 'ver_Absences', 'ver_CompanyHolidays']);
    app.x.Db.reset();
    const cold = run();
    const w = /update|create|comment/.test(k);
    out[k] = { warm: warm.ms, cold: cold.ms, bytes: warm.bytes, lockWarm: w ? txPart(warm.m) : 0, lockCold: w ? txPart(cold.m) : 0, meter: cold.m, meterWarm: warm.m };
  });
  return out;
}
/** Time spent inside the lock: reads after the lock plus writes, flush and version bump. */
function txPart(m) {
  return COST.lock + (m.sheetWrite || 0) * COST.sheetWrite + (m.flush || 0) * COST.flush + 2 * COST.cacheCall +
    (m.sheetRead || 0) * COST.sheetRead + (m.rowsRead || 0) * 24 * COST.perCell + (m.zipKB || 0) * COST.zipPerKB;
}

/* ---------------- 2. event simulation ---------------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const expo = (r, mean) => -Math.log(1 - r()) * mean;

/**
 * cfg: { users, minutes, pollSec, pollJitter, writeEveryMin, retry: 'none'|'reads'|'all', jitter, cacheInTx }
 * Returns latency percentiles, error rate, lock waits, cache hit rate.
 */
function simulate(prof, cfg) {
  const r = rng(42);
  const events = [];
  const push = (t, ev) => { ev.t = t; events.push(ev); };
  const end = cfg.minutes * 60000;
  for (let u = 0; u < cfg.users; u++) {
    // login wave: 70 % in the first 5 minutes, the rest spread over the window
    const t0 = r() < 0.7 ? r() * 300000 : r() * end;
    push(t0, { u, kind: 'bootstrap', first: true });
  }
  events.sort((a, b) => a.t - b.t);
  const queue = new Heap((a, b) => a.t - b.t);
  events.forEach(e => queue.push(e));
  let running = 0, lockFreeAt = 0;
  let cacheValid = true; // table cache of Tasks
  let lastWrite = -1;
  const lastPoll = {};
  const S = prof.shared;
  const lat = [], res = { ok: 0, refused: 0, lockTimeout: 0, retries: 0, lockWait: [], cacheHits: 0, cacheMiss: 0, byKind: {} };
  const tasksFit = (cfg.zip ? prof.tasksZipBytes : prof.tasksBytes) < LIMITS.cacheTableMax;
  while (queue.size()) {
    const ev = queue.pop();
    if (ev.t > end) break;
    if (ev.done) { running--; continue; }
    if (running >= (cfg.concurrent || LIMITS.concurrent)) {
      res.refused++;
      const retryable = cfg.retry === 'all' || (cfg.retry === 'reads' && !/update|create|comment/.test(ev.kind));
      if (retryable && (ev.tries || 0) < 3) {
        res.retries++;
        const wait = cfg.jitter ? S.retryDelay(ev.tries || 0, r()) : 600 * Math.pow(3, ev.tries || 0);
        queue.push(Object.assign({}, ev, { t: ev.t + wait, tries: (ev.tries || 0) + 1, start: ev.start || ev.t }));
      } else if (!ev.first) scheduleNext(ev);
      continue;
    }
    running++;
    // a poll without any write since this person's last poll only gets "same"
    const kind = ev.kind === 'poll' && lastPoll[ev.u] !== undefined && lastWrite < lastPoll[ev.u] ? 'pollSame' : ev.kind;
    if (ev.kind === 'poll') lastPoll[ev.u] = ev.t;
    const p = prof.kinds[kind];
    const write = /update|create|comment/.test(ev.kind);
    // before: writes always read the whole sheet under the lock; after: the cached copy is used
    const hit = write ? cacheValid && cfg.cacheInTx : cacheValid && tasksFit;
    if (!write) { if (hit) res.cacheHits++; else res.cacheMiss++; }
    let dur = hit ? p.warm : p.cold;
    if (write) {
      const lockMs = hit ? p.lockWarm : p.lockCold;
      const startLock = Math.max(ev.t + 100, lockFreeAt);
      const wait = startLock - (ev.t + 100);
      res.lockWait.push(wait);
      if (wait > LIMITS.lockWait) {
        res.lockTimeout++;
        queue.push({ t: ev.t + LIMITS.lockWait, done: true });
        scheduleNext(ev);
        continue;
      }
      lockFreeAt = startLock + lockMs;
      dur = 100 + wait + (hit ? p.warm : p.cold);
      // the write bumps the version; with write-through the new copy is in the cache at once
      cacheValid = !!cfg.writeThrough && tasksFit;
      lastWrite = ev.t;
    } else if (!hit) cacheValid = tasksFit; // the miss re-fills the cache
    queue.push({ t: ev.t + dur, done: true });
    const total = ev.t + dur - (ev.start || ev.t);
    lat.push(total);
    (res.byKind[ev.kind] = res.byKind[ev.kind] || []).push(total);
    res.ok++;
    scheduleNext(ev);
  }
  function scheduleNext(ev) {
    const u = ev.u;
    if (ev.first) {
      queue.push({ u, kind: 'calendar', t: ev.t + 300 });
      queue.push({ u, kind: 'report', t: ev.t + 600 });
      queue.push({ u, kind: 'poll', t: ev.t + nextPoll() });
      queue.push({ u, kind: pickWrite(), t: ev.t + expo(r, cfg.writeEveryMin * 60000) });
      return;
    }
    if (ev.kind === 'poll') queue.push({ u, kind: 'poll', t: ev.t + nextPoll() });
    else if (/update|create|comment/.test(ev.kind)) queue.push({ u, kind: pickWrite(), t: ev.t + expo(r, cfg.writeEveryMin * 60000) });
  }
  function nextPoll() { return cfg.pollJitter ? S.pollDelay(cfg.pollSec, 0, r()) : cfg.pollSec * 1000; }
  function pickWrite() { const x = r(); return x < 0.6 ? 'update' : x < 0.85 ? 'create' : 'comment'; }
  lat.sort((a, b) => a - b);
  const pct = q => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]) : 0);
  const lw = res.lockWait.sort((a, b) => a - b);
  const attempts = res.ok + res.refused + res.lockTimeout;
  return {
    users: cfg.users, requests: attempts, ok: res.ok,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
    refusedPct: round(100 * res.refused / attempts), lockTimeoutPct: round(100 * res.lockTimeout / attempts),
    lockWaitP95: lw.length ? Math.round(lw[Math.floor(0.95 * (lw.length - 1))]) : 0,
    cacheHitPct: round(100 * res.cacheHits / Math.max(1, res.cacheHits + res.cacheMiss)),
    rps: round(attempts / (cfg.minutes * 60)),
  };
}
const round = x => Math.round(x * 10) / 10;

/** Min-heap for the event queue. */
function Heap(cmp) {
  const a = [];
  this.size = () => a.length;
  this.push = x => { a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (cmp(a[i], a[p]) >= 0) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } };
  this.pop = () => {
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i;
        if (l < a.length && cmp(a[l], a[m]) < 0) m = l;
        if (rr < a.length && cmp(a[rr], a[m]) < 0) m = rr;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  };
}

/* ---------------- 3. theory: Erlang B (refusals with c = 30 servers) ---------------- */
function erlangB(lambdaPerSec, serviceSec, c) {
  const A = lambdaPerSec * serviceSec;
  let b = 1;
  for (let k = 1; k <= c; k++) b = (A * b) / (k + A * b);
  return { offered: round(A), refusedPct: round(100 * b) };
}

/* ---------------- 4. consistency with the real code ---------------- */
/** Runs many writes in lock order on the real code and checks: no lost update, no wrong row. */
function consistencyCheck(n) {
  const app = scaledApp(50, 300);
  const tasks = app.call('tasks.list', { ver: '' }).tasks.slice(0, 40);
  const expected = {};
  const r = rng(7);
  let created = 0;
  for (let i = 0; i < n; i++) {
    const t = tasks[Math.floor(r() * tasks.length)];
    if (r() < 0.2) { app.call('tasks.save', { title: 'c' + i, assignees: ['demo.user@firma.de'] }); created++; continue; }
    const field = r() < 0.5 ? 'title' : 'priority';
    const value = field === 'title' ? 'v' + i : ['low', 'medium', 'high', 'urgent'][i % 4];
    app.call('tasks.save', { id: t.id, [field]: value });
    expected[t.id] = Object.assign(expected[t.id] || {}, { [field]: value });
    if (i % 97 === 0) { // someone sorts the sheet by hand now and then
      const d = app.sheet('Tasks').data;
      const a = 1 + Math.floor(r() * (d.length - 1)), b = 1 + Math.floor(r() * (d.length - 1));
      [d[a], d[b]] = [d[b], d[a]];
    }
  }
  app.x.Db.reset();
  const rows = app.sheet('Tasks').data.slice(1).filter(row => row[0]);
  const byId = {};
  rows.forEach(row => { byId[row[0]] = row; });
  const cols = vm.runInContext('SCHEMA', app.ctx).Tasks.cols;
  let lost = 0;
  Object.keys(expected).forEach(id => Object.keys(expected[id]).forEach(f => { if (String(byId[id][cols.indexOf(f)]) !== String(expected[id][f])) lost++; }));
  const dupes = rows.length - Object.keys(byId).length;
  return { writes: n, created, lostUpdates: lost, duplicateIds: dupes, rows: rows.length };
}

/* ---------------- main ---------------- */
function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const usersArg = Number((args[args.indexOf('--users') + 1]) || 0) || 10000;
  const scenarioUsers = quick ? [200, 1000] : [250, 500, 1000, 2500, 5000, usersArg];
  const tasksPerUser = 3;
  const sizeUsers = quick ? 1000 : usersArg;
  const t0 = Date.now();
  const kinds = profile(Math.min(sizeUsers, 10000), Math.min(sizeUsers * tasksPerUser, 30000));
  const nTasks = Math.min(sizeUsers * tasksPerUser, 30000);
  const tableJson = JSON.stringify(Array.from({ length: nTasks }, (_, i) => ({ obj: { id: 'tk_load_' + i, title: 'Aufgabe ' + i, status: 'todo', priority: '', projectId: '', teams: ['tm_x'],
    assignees: ['u' + i + '@firma.de'], tags: [], startDate: '', dueDate: '2026-11-01', estimate: 0, parentId: '', recurrence: '', sort: i, createdBy: 'demo.user@firma.de',
    createdAt: '2026-01-01', updatedAt: '', completedAt: '', planDate: '', planStart: 0, progress: 0, spent: 0, timerStart: '' }, row: i + 2 })));
  const tasksBytes = tableJson.length;
  const tasksZipBytes = Math.ceil(require('zlib').gzipSync(tableJson).length * 4 / 3);
  const prof = { kinds, tasksBytes, tasksZipBytes, shared: require('./load').load({ quiet: true }).__exports.Shared };
  console.log('Profile (real server code, ' + sizeUsers + ' people, ' + Math.min(sizeUsers * tasksPerUser, 30000) + ' tasks):');
  Object.keys(kinds).forEach(k => console.log('  ' + k.padEnd(10) + ' warm ' + String(Math.round(kinds[k].warm)).padStart(6) + ' ms  cold ' +
    String(Math.round(kinds[k].cold)).padStart(6) + ' ms  response ' + Math.round(kinds[k].bytes / 1024) + ' KB'));
  console.log('  Task table in the cache: ' + Math.round(tasksBytes / 1024) + ' KB as JSON (fits ' + (tasksBytes < LIMITS.cacheTableMax ? 'yes' : 'NO') + '), compressed ' +
    Math.round(tasksZipBytes / 1024) + ' KB (fits ' + (tasksZipBytes < LIMITS.cacheTableMax ? 'yes' : 'NO') + ')');

  const before = { pollSec: 90, pollJitter: 0, writeEveryMin: 10, retry: 'reads', jitter: false, cacheInTx: false, zip: false };
  const after = { pollSec: 120, pollJitter: 0.25, writeEveryMin: 10, retry: 'all', jitter: true, cacheInTx: true, zip: true, writeThrough: true };
  const rows = [];
  scenarioUsers.forEach(n => {
    // data grows with the people: 3 tasks each (at most 30 000)
    const nt = Math.min(n * tasksPerUser, 30000);
    const kindsN = n === sizeUsers ? kinds : profile(Math.min(n, 10000), nt);
    const jsonN = Math.round(tasksBytes * nt / Math.max(1, Math.min(sizeUsers * tasksPerUser, 30000)));
    const profN = { kinds: kindsN, tasksBytes: jsonN, tasksZipBytes: Math.round(tasksZipBytes * jsonN / tasksBytes), shared: prof.shared };
    const b = simulate(profN, Object.assign({ users: n, minutes: 15 }, before));
    const a = simulate(profN, Object.assign({ users: n, minutes: 15 }, after));
    // offered load uses the service time of each variant (median of the successful calls)
    rows.push({ n, b, a, eb: erlangB(b.rps, (b.p50 || 400) / 1000, LIMITS.concurrent), ea: erlangB(a.rps, (a.p50 || 400) / 1000, LIMITS.concurrent) });
  });
  console.log('\nSimulation, 15 min peak load (3 tasks per person), each cell before → after:');
  const cols = [['People', 7], ['Req/s', 15], ['p50 ms', 15], ['p95 ms', 16], ['p99 ms', 16], ['refused %', 14], ['lock timeout %', 15], ['lock wait p95', 17], ['cache hits %', 16], ['Erlang B refused %', 18]];
  console.log(cols.map(c => c[0].padStart(c[1])).join(' '));
  const f = (x, y, w) => (x + ' → ' + y).padStart(w);
  rows.forEach(({ n, b, a, eb, ea }) => console.log([String(n).padStart(7), f(b.rps, a.rps, 15), f(b.p50, a.p50, 15), f(b.p95, a.p95, 16), f(b.p99, a.p99, 16),
    f(b.refusedPct, a.refusedPct, 14), f(b.lockTimeoutPct, a.lockTimeoutPct, 15), f(b.lockWaitP95, a.lockWaitP95, 17), f(b.cacheHitPct, a.cacheHitPct, 16), f(eb.refusedPct, ea.refusedPct, 18)].join(' ')));
  if (!quick) {
    // what if the web app ran as the visiting person (each person has their own 30, about 1000 per script)
    const big = rows[rows.length - 1];
    const nt = Math.min(big.n * tasksPerUser, 30000);
    const profBig = { kinds: profile(Math.min(big.n, 10000), nt), tasksBytes, tasksZipBytes, shared: prof.shared };
    const w = simulate(profBig, Object.assign({ users: big.n, minutes: 15, concurrent: 1000 }, after));
    console.log('\nWhat if (' + big.n + ' people, executed as the visiting person, ~1000 parallel): p50 ' + w.p50 + ' ms, p95 ' + w.p95 +
      ' ms, refused ' + w.refusedPct + ' %, Lock-Timeout ' + w.lockTimeoutPct + ' %, lock wait p95 ' + w.lockWaitP95 + ' ms');
    console.log('Write capacity of the global lock at ' + nt + ' tasks: about ' + round(1000 / profBig.kinds.update.lockWarm) + ' writes/s');
  }
  const c = consistencyCheck(quick ? 300 : 1500);
  console.log('\nConsistency (real code, ' + c.writes + ' writes, rows shuffled by hand in between): lost updates ' +
    c.lostUpdates + ', duplicate ids ' + c.duplicateIds + ', ' + c.created + ' created');
  console.log('Duration ' + Math.round((Date.now() - t0) / 1000) + ' s');
  return { rows, consistency: c, prof };
}

if (require.main === module && process.argv.includes('--consistency')) {
  const c = consistencyCheck(1500);
  console.log('Data consistency: ' + c.writes + ' writes (rows shuffled by hand in between), lost updates ' + c.lostUpdates + ', duplicate ids ' + c.duplicateIds);
  process.exit(c.lostUpdates || c.duplicateIds ? 1 : 0);
} else if (require.main === module) {
  const out = main();
  const worst = out.rows[0];
  // guard budget for the short profile: small team load must stay healthy
  const fail = out.consistency.lostUpdates || out.consistency.duplicateIds || worst.a.refusedPct > 1 || worst.a.p95 > 3000;
  if (process.argv.includes('--quick') && fail) { console.error('load budget violated'); process.exit(1); }
}
module.exports = { simulate, profile, erlangB, consistencyCheck, COST, LIMITS };
