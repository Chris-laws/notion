/**
 * Contrast of the design tokens in src/Styles.html, light and dark (WCAG 2.2):
 * 4.5:1 for text, 3:1 for secondary/large text and UI parts (WCAG 1.4.3 / 1.4.11).
 * Usage: node dev/checks/contrast.js
 */
const fs = require('fs');
const path = require('path');

/** Every text/background pair the UI really uses, with its minimum ratio. */
const PAIRS = [
  ['--text', '--bg', 4.5, 'text on cards'],
  ['--text', '--canvas', 4.5, 'text on the page background'],
  ['--text', '--bg-elevated', 4.5, 'text in dialogs'],
  ['--text-2', '--bg', 4.5, 'secondary text'],
  ['--text-2', '--bg-subtle', 4.5, 'secondary text on grey surface'],
  ['--text-3', '--bg', 3, 'hints, metadata'],
  ['--accent-text', '--accent-soft', 4.5, 'accent chips'],
  ['--accent-text', '--bg', 4.5, 'links'],
  ['#ffffff', '--accent', 4.5, 'primary buttons'],
  ['--danger', '--danger-soft', 4.5, 'error/overdue chips'],
  ['--danger', '--bg', 4.5, 'overdue text'],
  ['--warning', '--warning-soft', 4.5, 'warning chips, holidays'],
  ['--success', '--success-soft', 4.5, 'done chips'],
  ['--on-warning', '--warning-strong', 4.5, 'warning toast'],
  ['--ai-text', '--ai-soft', 4.5, 'AI elements'],
  ['--yellow-ink', '--yellow-soft', 4.5, 'yellow hints'],
  ['--st-doing', '--bg', 3, 'status in progress (icon)'],
  ['--st-review', '--bg', 3, 'status review (icon)'],
  ['--st-done', '--bg', 3, 'status done (icon)'],
  ['--prio-high', '--bg', 3, 'high priority (bars)'],
  ['--prio-high', '--prio-high-soft', 4.5, 'high priority (pill)'],
  ['--border-strong', '--bg', 1.5, 'input borders (visible)'],
];
// letters on project/team tiles: dark ink on the colours App.html lists as light, white on the rest
const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'App.html'), 'utf8');
const LIGHT = JSON.parse((/LIGHT_COLORS = (\[[^\]]*\])/.exec(APP) || [0, '[]'])[1].replace(/'/g, '"'));
['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red', 'teal'].forEach(c =>
  PAIRS.push([LIGHT.indexOf(c) >= 0 ? '#1d2433' : '#ffffff', '--c-' + c, 3, 'letter on a ' + c + ' tile']));

function hex(c) {
  let h = String(c).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(c) {
  return hex(c).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
/** WCAG contrast ratio, rounded to 2 decimals. */
function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round((l1 + 0.05) / (l2 + 0.05) * 100) / 100;
}
/** Follows var(--x) until a literal value. */
function resolve(value, vars, depth) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(value || '').trim());
  if (!m) return String(value || '').trim();
  if ((depth || 0) > 10) return null;
  return resolve(vars[m[1]], vars, (depth || 0) + 1);
}
/** Custom properties of the light and the dark theme (dark = light + dark overrides). */
function themes(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const grab = re => {
    const out = {};
    let m;
    while ((m = re.exec(css))) m[1].split(';').forEach(decl => {
      const i = decl.indexOf(':');
      if (i > 0 && /^\s*--/.test(decl)) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    });
    return out;
  };
  const light = grab(/(?:^|[\s}]):root\s*\{([^}]*)\}/g);
  const dark = Object.assign({}, light, grab(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/g));
  return { light, dark };
}

function check(css) {
  const t = themes(css);
  const rows = [];
  ['light', 'dark'].forEach(mode => PAIRS.forEach(([fg, bg, min, what]) => {
    const f = fg.startsWith('--') ? resolve('var(' + fg + ')', t[mode]) : fg;
    const b = resolve('var(' + bg + ')', t[mode]);
    if (!hex(f) || !hex(b)) { rows.push({ mode, what, fg, bg, min, ratio: null, ok: false, why: 'no colour value' }); return; }
    const ratio = contrastRatio(f, b);
    rows.push({ mode, what, fg, bg, min, ratio, ok: ratio >= min });
  }));
  return rows;
}

if (require.main === module) {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'Styles.html'), 'utf8');
  const rows = check(css);
  const bad = rows.filter(r => !r.ok);
  rows.filter(r => !r.ok || process.argv.includes('--all')).forEach(r =>
    console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + (r.mode === 'light' ? 'light' : 'dark ') + ' ' + String(r.ratio).padStart(5) + ':1 (min ' + r.min + ')  ' + r.what + '  ' + r.fg + ' on ' + r.bg + (r.why ? ' – ' + r.why : '')));
  console.log(bad.length ? bad.length + ' colour pairs below the contrast threshold' : 'Contrast ok: ' + rows.length + ' colour pairs in light and dark');
  process.exit(bad.length ? 1 : 0);
}
module.exports = { contrastRatio, resolve, themes, check, PAIRS };
