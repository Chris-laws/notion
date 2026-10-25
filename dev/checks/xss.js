/**
 * XSS check: user text with attack patterns goes into every kind of data (task, project, team,
 * comment, event, tag, person's name), then the whole tour renders every view and dialog.
 * Nothing of the input may turn into markup: no marker element, no injected on…= attribute,
 * no executed handler. Usage: node dev/checks/xss.js
 */
const { bootApp, walk, wait } = require('./dom');

const PAYLOADS = [
  '<img src=x class="xss-marker" onerror="window.__xss=1">',
  '"><svg class="xss-marker" onload="window.__xss=1">',
  "' onmouseover='window.__xss=1' data-x='",
  '</script><script>window.__xss=1</script>',
  'javascript:window.__xss=1',
];
const evil = i => 'Test ' + PAYLOADS[i % PAYLOADS.length];

/** Seeds the attack strings through the real API (as the browser would). */
async function seed(w) {
  const run = js => w.eval('(async () => { ' + js + ' })()');
  await run(`
    const P = ${JSON.stringify(PAYLOADS)};
    const t = S.teams[0];
    await call('users.save', { email: S.me.email, name: 'Chris ' + P[0] });
    const team = await call('teams.save', { name: 'Team ' + P[1], members: [S.me.email] });
    const proj = await call('projects.save', { teamId: team.id, name: 'Projekt ' + P[2], description: P[3], members: [] });
    const created = await call('tasks.save', { title: 'Aufgabe ' + P[0], description: P[1], tags: [P[2]], projectId: proj.id, assignees: [S.me.email], dueDate: TODAY() });
    await call('comments.add', { taskId: created[0].id, body: P[3] + P[4] });
    await call('events.save', { title: 'Termin ' + P[1], startDate: TODAY(), teamId: t.id, note: P[0] });
    window.__xssTask = created[0].id;
    await reloadAll();
  `);
  await wait(800);
}

function inspect(w) {
  const doc = w.document;
  const hits = [];
  doc.querySelectorAll('.xss-marker').forEach(el => hits.push('eingeschleustes Element <' + el.tagName.toLowerCase() + '>'));
  doc.querySelectorAll('*').forEach(el => Array.from(el.attributes).forEach(a => {
    if (/^on/i.test(a.name) && /__xss/.test(a.value)) hits.push('eingeschleustes Attribut ' + a.name + ' an <' + el.tagName.toLowerCase() + '>');
    if (/^(href|src|action)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) hits.push('javascript:-Link an <' + el.tagName.toLowerCase() + '>');
  }));
  doc.querySelectorAll('script').forEach(el => { if (/__xss/.test(el.textContent)) hits.push('eingeschleustes <script>'); });
  if (w.__xss) hits.push('Schadcode wurde ausgeführt');
  return hits;
}

async function main() {
  const w = await bootApp({ lang: 'de' });
  await seed(w);
  const found = {};
  // the attack text must really be in the data and visible as plain text, else the check proves nothing
  const seeded = w.eval("S.tasks.some(t => t.title.indexOf('xss-marker') >= 0) && S.projects.some(p => p.name.indexOf('onmouseover') >= 0)");
  w.eval("go('home')");
  await wait(400);
  const shown = w.document.body.textContent.indexOf('class="xss-marker"') >= 0;
  if (!seeded || !shown) found['Testdaten nicht angelegt oder nicht sichtbar (seeded ' + seeded + ', sichtbar ' + shown + ')'] = 'seed';
  const extra = ["openPeek(window.__xssTask)", "closePeek(); go('project', S.projects[S.projects.length - 1].id)"];
  await walk(w, (win, where) => inspect(win).forEach(h => { found[h] = found[h] || where; }), (where, e) => { found['Skriptfehler: ' + e.message] = where; });
  for (const js of extra) { w.eval(js); await wait(400); inspect(w).forEach(h => { found[h] = found[h] || js; }); }
  w.close();
  const keys = Object.keys(found);
  keys.forEach(k => console.log('  ✗ ' + k + '  (' + found[k] + ')'));
  console.log(keys.length ? keys.length + ' XSS-Befunde' : 'XSS ok: ' + PAYLOADS.length + ' Angriffsmuster in 7 Datenarten, alle Ansichten escapen sauber');
  process.exit(keys.length ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { PAYLOADS, inspect, evil };
