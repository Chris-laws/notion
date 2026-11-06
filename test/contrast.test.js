/** WCAG contrast of the design tokens (light and dark). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { contrastRatio, resolve, themes } = require('../dev/checks/contrast');

describe('contrast math', () => {
  test('black on white is 21:1, same colours 1:1', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#777', '#777'), 1);
  });
  test('short hex is expanded', () => {
    assert.equal(contrastRatio('#fff', '#000'), 21);
  });
  test('var() references are followed, also across several steps', () => {
    const vars = { '--a': '#123456', '--b': 'var(--a)', '--c': 'var(--b)' };
    assert.equal(resolve('var(--c)', vars), '#123456');
  });
  test('the dark theme overrides the light values and keeps the rest', () => {
    const t = themes(':root { --x: #ffffff; --y: #000000; } :root[data-theme="dark"] { --x: #111111; }');
    assert.deepEqual([t.dark['--x'], t.dark['--y']], ['#111111', '#000000']);
  });
});
