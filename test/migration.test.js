/**
 * The migration check must catch what it is meant to catch. Probe files go to the git-ignored
 * dev/local/; probe values are built at run time so this file itself stays clean.
 */
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scanFile } = require('../dev/checks/migration');

const DIR = path.join(__dirname, '..', 'dev', 'local');
const probes = [];
const rev = s => s.split('').reverse().join('');
const BS = String.fromCharCode(92);
function probe(name, text) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, name), text);
  probes.push(path.join(DIR, name));
  return scanFile('dev/local/' + name, []).map(h => h.replace(/^\S+\s+/, ''));
}
after(() => probes.forEach(p => fs.rmSync(p, { force: true })));

describe('migration check', () => {
  test('finds a local Windows path and a machine name', () => {
    const winPath = ['C:', 'Users', 'someone', 'project'].join(BS);
    const machine = rev('3DC21BA-POTKSED');
    assert.deepEqual(probe('a.js', '// see ' + winPath + "\nconst host = '" + machine + "';\n"), ['local Windows path', 'machine name']);
  });
  test('finds a deployment id and a web-app URL', () => {
    const id = rev('cyfKA') + 'b'.repeat(40);
    assert.deepEqual(probe('b.js', "const url = 'https://script.google.com/macros/s/" + id + "/exec';\n"), ['web-app deployment URL', 'deployment id']);
  });
  test('finds a personal mail address, accepts a company or example address', () => {
    const personal = 'someone@' + rev('moc.liamg');
    assert.deepEqual(probe('c.js', "const a = '" + personal + "';\n"), ['personal mail address']);
    assert.deepEqual(probe('d.js', "const a = 'demo.user@firma.de', b = 'x@example.com';\n"), []);
  });
  test('finds comments that are not in English, accepts quoted UI text', () => {
    assert.deepEqual(probe('e.js', '// ' + rev('ietaD eid ruf ratnemmoK nie tsi saD') + '\n'), ['not English']);
    assert.deepEqual(probe('f.js', '// renders the card "Heute dran" for the overview\n'), []);
  });
  test('accepts the own product name and branding', () => {
    const NL = String.fromCharCode(10);
    assert.deepEqual(probe('i.js', '// LidlFlow logo, Lidl blue and yellow' + NL + "const name = 'LidlFlow';" + NL), []);
    assert.deepEqual(probe('j.md', '# LidlFlow' + NL + NL + 'Task management and team calendar in the Lidl design.' + NL), []);
  });
  test('finds a script id in a clasp file, accepts the placeholder', () => {
    assert.deepEqual(probe('g.json', '{ "scriptId": "' + '1'.repeat(30) + '" }\n'), ['script id']);
    assert.deepEqual(probe('h.json', '{ "scriptId": "YOUR_SCRIPT_ID" }\n'), []);
  });
});
