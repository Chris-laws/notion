/** Admins check the Vertex AI connection with one click: the answer, or what went wrong (key, UrlFetchApp, model). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA } = require('./helpers');

describe('testing the AI connection', () => {
  test('without a key: says so, nothing is sent', () => {
    const app = freshApp();
    app.call('bootstrap');
    const calls = app.fakeFetch(() => ({ code: 200, body: {} }));
    const r = app.call('ai.test', {});
    assert.equal(r.ok, false);
    assert.match(r.error, /VERTEX_API_KEY/);
    assert.equal(calls.length, 0);
  });
  test('with a key: Gemini answers; the key goes in a header, never in the address', () => {
    const app = freshApp();
    app.call('bootstrap');
    app.ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'test-key-123');
    app.x.Config.reset();
    const calls = app.fakeFetch(() => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } }));
    const r = app.call('ai.test', {});
    assert.equal(r.ok, true);
    assert.equal(r.answer, 'OK');
    assert.doesNotMatch(calls[0].url, /test-key-123/);
    assert.equal(calls[0].opts.headers['x-goog-api-key'], 'test-key-123');
  });
  test('Google refuses or external calls are blocked: the reason comes back, not just "error"', () => {
    const app = freshApp();
    app.call('bootstrap');
    app.ctx.PropertiesService.getScriptProperties().setProperty('VERTEX_API_KEY', 'test-key-123');
    app.x.Config.reset();
    app.fakeFetch(() => ({ code: 403, body: { error: { message: 'API key not valid for this project' } } }));
    assert.match(app.call('ai.test', {}).error, /403.*API key not valid/);
    app.fakeFetch(() => { throw new Error('You do not have permission to call UrlFetchApp.fetch'); });
    assert.match(app.call('ai.test', {}).error, /UrlFetchApp/);
  });
  test('only admins may run it', () => {
    const app = freshApp();
    [ME, ANNA].forEach(e => app.as(e).call('bootstrap'));
    assert.ok(app.as(ANNA).error('ai.test', {}));
  });
});
