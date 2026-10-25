/**
 * Contrast of the design tokens in src/Styles.html, light and dark (WCAG 2.2):
 * 4.5:1 for text, 3:1 for secondary/large text and UI parts (WCAG 1.4.3 / 1.4.11).
 * Usage: node dev/checks/contrast.js
 */
const fs = require('fs');
const path = require('path');

/** Every text/background pair the UI really uses, with its minimum ratio. */
const PAIRS = [
  ['--text', '--bg', 4.5, 'Text auf Karten'],
  ['--text', '--canvas', 4.5, 'Text auf dem Seitenhintergrund'],
  ['--text', '--bg-elevated', 4.5, 'Text in Dialogen'],
  ['--text-2', '--bg', 4.5, 'Sekundärtext'],
  ['--text-2', '--bg-subtle', 4.5, 'Sekundärtext auf grauer Fläche'],
  ['--text-3', '--bg', 3, 'Hinweise, Metadaten'],
  ['--accent-text', '--accent-soft', 4.5, 'Akzent-Chips'],
  ['--accent-text', '--bg', 4.5, 'Links'],
  ['#ffffff', '--accent', 4.5, 'Primär-Buttons'],
  ['--danger', '--danger-soft', 4.5, 'Fehler/überfällig-Chips'],
  ['--danger', '--bg', 4.5, 'Überfällig-Text'],
  ['--warning', '--warning-soft', 4.5, 'Warn-Chips, Feiertage'],
  ['--success', '--success-soft', 4.5, 'Erledigt-Chips'],
  ['--on-warning', '--warning-strong', 4.5, 'Warn-Toast'],
  ['--ai-text', '--ai-soft', 4.5, 'KI-Elemente'],
  ['--yellow-ink', '--yellow-soft', 4.5, 'Gelbe Hinweise'],
  ['--st-doing', '--bg', 3, 'Status „In Arbeit" (Symbol)'],
  ['--st-review', '--bg', 3, 'Status „Review" (Symbol)'],
  ['--st-done', '--bg', 3, 'Status „Erledigt" (Symbol)'],
  ['--prio-high', '--bg', 3, 'Priorität hoch (Balken)'],
  ['--prio-high', '--prio-high-soft', 4.5, 'Priorität hoch (Pill)'],
  ['--border-strong', '--bg', 1.5, 'Rahmen von Eingabefeldern (sichtbar)'],
];

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
    if (!hex(f) || !hex(b)) { rows.push({ mode, what, fg, bg, min, ratio: null, ok: false, why: 'kein Farbwert' }); return; }
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
    console.log('  ' + (r.ok ? '✓' : '✗') + ' ' + (r.mode === 'light' ? 'hell  ' : 'dunkel') + ' ' + String(r.ratio).padStart(5) + ':1 (min ' + r.min + ')  ' + r.what + '  ' + r.fg + ' auf ' + r.bg + (r.why ? ' – ' + r.why : '')));
  console.log(bad.length ? bad.length + ' Farbpaare unter der Kontrast-Schwelle' : 'Kontrast ok: ' + rows.length + ' Farbpaare in Hell und Dunkel');
  process.exit(bad.length ? 1 : 0);
}
module.exports = { contrastRatio, resolve, themes, check, PAIRS };
