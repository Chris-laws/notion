/** The accessibility rules themselves: they must report broken markup and accept good markup. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { inspect, motionCheck } = require('../dev/checks/a11y');

const rulesFor = html => Object.keys(inspect(new JSDOM('<body>' + html + '</body>').window.document));

describe('a11y rules', () => {
  test('an icon-only button needs a name', () => {
    assert.deepEqual(rulesFor('<button><svg></svg></button>'), ['Schaltfläche ohne zugänglichen Namen']);
    assert.deepEqual(rulesFor('<button aria-label="Schließen"><svg></svg></button>'), []);
  });
  test('an image needs alt (empty alt is fine for decoration)', () => {
    assert.deepEqual(rulesFor('<img src="x.png">'), ['Bild ohne alt']);
    assert.deepEqual(rulesFor('<img src="x.png" alt="">'), []);
  });
  test('a select without label, aria-label or title is reported', () => {
    assert.deepEqual(rulesFor('<select><option>a</option></select>'), ['Eingabefeld ohne Beschriftung']);
    assert.deepEqual(rulesFor('<label>Land <select><option>a</option></select></label>'), []);
  });
  test('a dialog needs aria-modal and a name', () => {
    assert.deepEqual(rulesFor('<div role="dialog"></div>').sort(), ['Dialog ohne Namen', 'Dialog ohne aria-modal']);
  });
  test('positive tabindex and duplicate ids are reported', () => {
    assert.deepEqual(rulesFor('<span tabindex="3" id="a"></span><i id="a"></i>').sort(), ['doppelte id', 'positiver tabindex']);
  });
  test('the global reduced-motion rule is required', () => {
    assert.deepEqual(motionCheck('.x { animation: spin 1s; }'), ['globale prefers-reduced-motion-Regel fehlt']);
    assert.deepEqual(motionCheck('@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms; transition-duration: .01ms; } }'), []);
  });
});
