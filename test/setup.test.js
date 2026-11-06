/** setup() and the demo data: safe on a real company domain. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers');

describe('manifest', () => {
  const manifest = require('../src/appsscript.json');
  test('asks only for the scopes the app needs: sheets, holiday calendars (read), own Drive files, outgoing requests, own e-mail, Cloud (Gemini in the own project)', () => {
    assert.deepEqual(manifest.oauthScopes.slice().sort(), [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  });
  test('the web app is open to the company domain only', () => {
    assert.equal(manifest.webapp.access, 'DOMAIN');
  });
});

describe('sheet protection', () => {
  test('setup() protects every table sheet once (only the owner edits; the app runs as the owner)', () => {
    const app = freshApp();
    app.ctx.setup();
    ['Tasks', 'Users', 'Journal'].forEach(t => {
      const p = app.sheet(t).getProtections();
      assert.equal(p.length, 1, t);
      assert.equal(p[0].getEditors().length, 0);
      assert.equal(p[0].domainEdit, false);
    });
  });
});

describe('demo data', () => {
  test('is refused unless the script property ALLOW_DEMO_DATA is "true"', () => {
    const app = freshApp();
    assert.throws(() => app.ctx.seedDemoData(), /ALLOW_DEMO_DATA/);
    assert.equal(app.sheet('Users').data.filter(r => /anna\.schmidt@/.test(r[0])).length, 0, 'no made-up people were created');
  });
  test('works once ALLOW_DEMO_DATA is "true"', () => {
    const app = freshApp();
    app.ctx.PropertiesService.getScriptProperties().setProperty('ALLOW_DEMO_DATA', 'true');
    app.x.Config.reset();
    app.ctx.seedDemoData();
    assert.ok(app.call('bootstrap').tasks.length > 10);
  });
});
