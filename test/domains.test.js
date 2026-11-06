/** Who may sign in: one domain, a list of domains, or a pattern like "lidl.*" (all country domains). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp } = require('./helpers');

function as(domains, email) {
  const app = freshApp();
  app.ctx.PropertiesService.getScriptProperties().setProperty('ALLOWED_DOMAIN', domains);
  app.x.Config.reset();
  return app.as(email).raw('bootstrap');
}

describe('allowed domains', () => {
  test('a single domain as before', () => {
    assert.equal(as('lidl.com', 'a.b@lidl.com').ok, true);
    assert.match(as('lidl.com', 'a.b@lidl.it').error, /nur für @lidl\.com freigegeben/);
  });
  test('several domains, separated by comma, semicolon or space', () => {
    assert.equal(as('lidl.com, lidl.it; kaufland.de', 'x@lidl.it').ok, true);
    assert.equal(as('lidl.com, lidl.it; kaufland.de', 'x@kaufland.de').ok, true);
    assert.match(as('lidl.com, lidl.it', 'x@example.com').error, /@lidl\.com, @lidl\.it/);
  });
  test('"lidl.*" admits every country domain of Lidl, nothing that only looks similar', () => {
    assert.equal(as('lidl.*', 'x@lidl.it').ok, true);
    assert.equal(as('lidl.*', 'x@lidl.co.uk').ok, true);
    assert.equal(as('lidl.*', 'x@notlidl.com').ok, false);
    assert.equal(as('lidl.*', 'x@lidl.evil.example.com').ok, true, 'a subdomain-like ending is still lidl.<something>');
  });
});
