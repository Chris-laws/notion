/**
 * v61 images in task descriptions and jour fixe minutes: only images, size limit, stored in the owner's
 * Drive (LidlFlow/Projects/<team>/<project>/Bilder), handed out only to people who see the task or project.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

const OUT = 'fremd.person@firma.de';
// smallest real images: a 1×1 PNG and the start of a JPEG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');
function world() {
  const app = freshApp();
  [ME, ANNA, OUT].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  app.ctx.Drive = app.ctx.__driveAdvanced();
  const team = app.call('teams.save', { name: 'Kern', members: [ME, ANNA] });
  const project = app.call('projects.save', { teamId: team.id, name: 'Portal', members: [] });
  const [task] = app.call('tasks.save', { title: 'Mit Bild', projectId: project.id, assignees: [ANNA] });
  return { app, project, task };
}

describe('images', () => {
  test('a PNG goes into the Drive folder of the project; the person and others of the project get it back', () => {
    const { app, project, task } = world();
    const r = app.as(ANNA).call('files.upload', { kind: 'task', taskId: task.id, name: 'screenshot.png', mime: 'image/png', data: PNG });
    assert.match(r.id, /^fl_/);
    assert.equal(r.token, '![screenshot.png](lf:' + r.id + ')');
    const row = app.x.Db.get('Files', r.id);
    assert.equal(row.projectId, project.id);
    const path = [];
    for (let f = app.ctx.DriveApp.getFileById(row.driveId); f; ) { path.unshift(f.getName()); const p = f.getParents(); f = p.hasNext() ? p.next() : null; }
    assert.equal(path.join('/'), 'LidlFlow/Projects/Kern/Portal/Bilder/screenshot.png');
    const back = app.as(ME).call('files.get', { id: r.id });
    assert.equal(back.mime, 'image/png');
    assert.equal(back.data, PNG, 'the same bytes');
  });
  test('people outside the project get neither upload nor image', () => {
    const { app, project, task } = world();
    const r = app.call('files.upload', { kind: 'task', taskId: task.id, name: 'a.png', mime: 'image/png', data: PNG });
    assert.ok(app.as(OUT).error('files.get', { id: r.id }));
    assert.ok(app.as(OUT).error('files.upload', { kind: 'task', taskId: task.id, name: 'b.png', mime: 'image/png', data: PNG }));
    assert.ok(app.as(OUT).error('files.upload', { kind: 'project', projectId: project.id, name: 'b.png', mime: 'image/png', data: PNG }));
  });
  test('minutes: images go with the project of the jour fixe (also before the minutes are saved)', () => {
    const { app, project } = world();
    const r = app.as(ANNA).call('files.upload', { kind: 'project', projectId: project.id, name: 'tafel.jpg', mime: 'image/jpeg', data: JPEG });
    assert.equal(app.as(ME).call('files.get', { id: r.id }).mime, 'image/jpeg');
  });
  test('only real images, not too big', () => {
    const { app, task } = world();
    const up = (mime, data) => app.error('files.upload', { kind: 'task', taskId: task.id, name: 'x', mime: mime, data: data });
    assert.match(up('application/pdf', PNG), /Bilder/);
    assert.match(up('image/svg+xml', PNG), /Bilder/, 'no SVG (could carry script)');
    assert.match(up('image/png', Buffer.from('<script>alert(1)</script>').toString('base64')), /kein gültiges Bild/);
    assert.match(up('image/png', Buffer.alloc(3 * 1024 * 1024 + 10, 1).toString('base64')), /zu groß/);
  });
  test('the image stays readable for the project after its task was deleted', () => {
    const { app, task } = world();
    const r = app.call('files.upload', { kind: 'task', taskId: task.id, name: 'a.png', mime: 'image/png', data: PNG });
    app.call('tasks.remove', { id: task.id });
    assert.equal(app.as(ANNA).call('files.get', { id: r.id }).data, PNG);
  });
});
