/** The accessibility rules themselves: they must report broken markup and accept good markup. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { inspect, motionCheck } = require('../dev/checks/a11y');

const rulesFor = html => Object.keys(inspect(new JSDOM('<body>' + html + '</body>').window.document));

describe('a11y rules', () => {
  test('an icon-only button needs a name', () => {
    assert.deepEqual(rulesFor('<button><svg></svg></button>'), ['button without accessible name']);
    assert.deepEqual(rulesFor('<button aria-label="Schließen"><svg></svg></button>'), []);
  });
  test('an image needs alt (empty alt is fine for decoration)', () => {
    assert.deepEqual(rulesFor('<img src="x.png">'), ['image without alt']);
    assert.deepEqual(rulesFor('<img src="x.png" alt="">'), []);
  });
  test('a select without label, aria-label or title is reported', () => {
    assert.deepEqual(rulesFor('<select><option>a</option></select>'), ['form field without label']);
    assert.deepEqual(rulesFor('<label>Land <select><option>a</option></select></label>'), []);
  });
  test('a dialog needs aria-modal and a name', () => {
    assert.deepEqual(rulesFor('<div role="dialog"></div>').sort(), ['dialog without aria-modal', 'dialog without name']);
  });
  test('positive tabindex and duplicate ids are reported', () => {
    assert.deepEqual(rulesFor('<span tabindex="3" id="a"></span><i id="a"></i>').sort(), ['duplicate id', 'positive tabindex']);
  });
  test('the global reduced-motion rule is required', () => {
    assert.deepEqual(motionCheck('.x { animation: spin 1s; }'), ['global prefers-reduced-motion rule missing']);
    assert.deepEqual(motionCheck('@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms; transition-duration: .01ms; } }'), []);
  });
});
