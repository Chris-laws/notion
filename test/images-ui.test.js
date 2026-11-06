/** Images in the page: markers become previews (loaded once), pasting into a description uploads and inserts the marker. */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, wait } = require('../dev/checks/dom');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let w;
before(async () => { w = await bootApp({ lang: 'de' }); });
after(() => w && w.close());
const $ = sel => w.document.querySelector(sel);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
async function until(cond, ms) { const end = Date.now() + (ms || 4000); while (!cond() && Date.now() < end) await wait(25); }

describe('images in the page', () => {
  test('pasting an image into a task description uploads it and puts the marker in; the preview appears', async () => {
    const id = w.eval('S.tasks.find(t => isMine(t) && t.projectId).id');
    w.eval(`openPeek(${JSON.stringify(id)})`);
    await until(() => $('#peek textarea.desc'));
    const ta = $('#peek textarea.desc');
    const bytes = Uint8Array.from(Buffer.from(PNG, 'base64'));
    const file = new w.File([bytes], 'tafel.png', { type: 'image/png' });
    const ev = new w.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { files: [file] };
    ta.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, 'the browser does not paste anything itself');
    // the panel may have been drawn anew meanwhile: the current field
    const desc = () => $('#peek textarea.desc').value;
    await until(() => /!\[tafel\.png\]\(lf:fl_[a-z0-9]+\)/.test(desc()), 6000);
    assert.match(desc(), /!\[tafel\.png\]\(lf:fl_[a-z0-9]+\)/);
    await until(() => $('#peek .lf-imgs img[src^="data:image/png;base64,"]'), 6000);
    assert.ok($('#peek .lf-imgs img[src^="data:image/png;base64,"]'), 'the preview is loaded');
  });
  test('a click on the preview shows the image large', async () => {
    click($('#peek .lf-thumb'));
    await until(() => $('#modal-root .lf-big'));
    assert.match($('#modal-root .lf-big').getAttribute('src'), /^data:image\/png;base64,/);
    w.eval('closeModal(); closePeek()');
  });
  test('markers in minutes are previews; other text stays escaped; a non-image is refused', async () => {
    const html = w.eval(`richText('Siehe ![a<b>](lf:fl_abc123) und <i>x</i> https://x.example/y')`);
    const d = w.document.createElement('div');
    d.innerHTML = html;
    assert.ok(d.querySelector('img[data-lf="fl_abc123"]'));
    assert.equal(d.querySelector('i'), null);
    assert.ok(d.querySelector('a[href="https://x.example/y"]'));
    assert.equal(w.eval(`richText('![x](lf:../../etc)')`).indexOf('<img'), -1, 'only real ids');
    await w.eval("loadChunk('Images')");
    w.eval("document.querySelector('#toasts').innerHTML = ''");
    await w.eval("imgUpload(new File(['x'], 'a.pdf', { type: 'application/pdf' }), { kind: 'task', taskId: 'x' }, null)");
    assert.match($('#toasts').textContent, /Nur Bilder/);
  });
});
