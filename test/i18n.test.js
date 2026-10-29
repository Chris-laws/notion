/** English translation rules from I18n.html (dictionary, patterns with numbers, fragments). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Only the pure part of I18n.html: the tables and trText(). */
function loadTranslator() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'I18n.html'), 'utf8');
  const start = src.indexOf('const EN = {');
  const end = src.indexOf('/** Translates inserted DOM in place');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(start, end) + '\nglobalThis.trText = trText; globalThis.EN = EN;', ctx);
  return ctx;
}
const t = loadTranslator();

describe('English translation', () => {
  test('a dictionary entry replaces the whole text and keeps the spaces around it', () => {
    assert.equal(t.trText('  Neue Aufgabe '), '  New task ');
  });
  test('sentences with numbers go through the patterns', () => {
    assert.equal(t.trText('3 von 5 erledigt'), '3 of 5 done');
    assert.equal(t.trText('Ungültige E-Mail-Adresse: x@y'), 'Invalid email address: x@y');
  });
  test('text that is not German stays untouched', () => {
    assert.equal(t.trText('Q4 Kampagne · 12'), 'Q4 Kampagne · 12');
  });
  test('the greeting is translated for every time of day', () => {
    assert.deepEqual(['Guten Morgen', 'Hallo', 'Guten Abend'].map(x => t.trText(x)), ['Good morning', 'Hello', 'Good evening']);
  });
  test('every server error message has an English version', () => {
    const src = path.join(__dirname, '..', 'src');
    const missing = [];
    fs.readdirSync(src).filter(f => f.endsWith('.js')).forEach(f => {
      const re = /new Error\('((?:[^'\\]|\\.)+)'\)/g;
      let m;
      const code = fs.readFileSync(path.join(src, f), 'utf8');
      while ((m = re.exec(code))) if (t.trText(m[1]) === m[1]) missing.push(f + ': ' + m[1]);
    });
    assert.deepEqual(missing, []);
  });
});
