/**
 * Accessibility check on every page and dialog of the real app (jsdom tour):
 * images have alt, buttons/links have a name, form fields a label, checkboxes aria-checked,
 * dialogs role=dialog + aria-modal + a name, no positive tabindex, no duplicate ids.
 * Plus: animations respect prefers-reduced-motion, every route has a skeleton.
 * Usage: node dev/checks/a11y.js
 */
const fs = require('fs');
const path = require('path');
const { bootApp, walk } = require('./dom');

const name = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() ||
  (el.getAttribute('aria-labelledby') ? 'labelledby' : '') || (el.querySelector('img[alt]:not([alt=""])') ? 'img' : '');
const describe = el => el.outerHTML.replace(/\s+/g, ' ').slice(0, 110);

/** Findings in the current DOM: { rule: [samples] } */
function inspect(doc) {
  const out = {};
  const add = (rule, el) => { (out[rule] = out[rule] || []).push(describe(el)); };
  doc.querySelectorAll('img').forEach(el => { if (!el.hasAttribute('alt') && el.getAttribute('aria-hidden') !== 'true') add('image without alt', el); });
  doc.querySelectorAll('button, a[href], [role="button"], [data-action]:not(div):not(span):not(section):not(form)').forEach(el => {
    if (!el.closest('[aria-hidden="true"]') && !name(el)) add('button without accessible name', el);
  });
  doc.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('title') || el.closest('label') ||
      (el.id && doc.querySelector('label[for="' + el.id + '"]')) || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder');
    if (!labelled) add('form field without label', el);
  });
  doc.querySelectorAll('[role="checkbox"]').forEach(el => { if (!el.hasAttribute('aria-checked')) add('checkbox without aria-checked', el); });
  doc.querySelectorAll('[role="dialog"]').forEach(el => {
    if (el.getAttribute('aria-modal') !== 'true') add('dialog without aria-modal', el);
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) add('dialog without name', el);
  });
  doc.querySelectorAll('[tabindex]').forEach(el => { if (Number(el.getAttribute('tabindex')) > 0) add('positive tabindex', el); });
  const ids = {};
  doc.querySelectorAll('[id]').forEach(el => { ids[el.id] = (ids[el.id] || 0) + 1; });
  Object.keys(ids).filter(k => ids[k] > 1).forEach(k => add('duplicate id', { outerHTML: 'id="' + k + '" ×' + ids[k] }));
  return out;
}

/** CSS: a global reduced-motion rule that switches animations and transitions off. */
function motionCheck(css) {
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{([^}]*)\}/.exec(css);
  return block && /animation-duration/.test(block[1]) && /transition-duration/.test(block[1]) ? [] : ['global prefers-reduced-motion rule missing'];
}

async function main() {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'Styles.html'), 'utf8');
  const found = {};
  const note = (rule, where, sample) => {
    const f = found[rule] = found[rule] || { count: 0, where: {}, sample: sample };
    f.count++;
    f.where[where] = 1;
  };
  motionCheck(css).forEach(r => note(r, 'Styles.html', ''));
  const w = await bootApp({ lang: 'de' });
  // skeletons: every route has one before data arrives
  ['dash', 'home', 'tasks', 'calendar', 'capacity', 'settings', 'team', 'project'].forEach(v => {
    const htmlSk = w.eval('skPage({ view: ' + JSON.stringify(v) + ', id: null })');
    if (!/class="sk[ "-]/.test(htmlSk)) note('skeleton missing', v, '');
  });
  await walk(w, (win, where) => {
    const res = inspect(win.document);
    Object.keys(res).forEach(rule => res[rule].forEach(s => note(rule, where, s)));
  }, (where, e) => note('script error', where, e.message));
  w.close();
  const rules = Object.keys(found);
  rules.forEach(r => console.log('  ✗ ' + r + ' (' + found[r].count + '×, e.g. ' + Object.keys(found[r].where).slice(0, 3).join(', ') + ')' + (found[r].sample ? '\n      ' + found[r].sample : '')));
  console.log(rules.length ? rules.length + ' accessibility rules violated' : 'Accessibility ok: names, labels, dialogs, keyboard, motion, skeletons');
  process.exit(rules.length ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { inspect, motionCheck };
