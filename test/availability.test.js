/** Team availability (50 % warning) and capacity (hours minus holidays and absences). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { freshApp, ME, ANNA, LEA } = require('./helpers');

const BOB = 'bob.berg@firma.de';
const MON = '2030-01-14'; // a Monday without holidays in DE

/** A team of four in DE without a region (only national holidays apply). */
function fourPeople() {
  const app = freshApp();
  [ME, ANNA, LEA, BOB].forEach(e => app.as(e).call('bootstrap'));
  app.as(ME);
  [ME, ANNA, LEA, BOB].forEach(e => app.call('users.save', { email: e, country: 'DE', region: '', hoursPerWeek: 40, workDays: '1,2,3,4,5' }));
  const team = app.call('teams.save', { name: 'Vier', members: [ME, ANNA, LEA, BOB] });
  return { app, team };
}
const away = (app, email, from, to) => app.call('absences.save', { email, type: 'vacation', startDate: from, endDate: to || from });
const warnDays = (app, team) => app.call('availability', { teamId: team.id, from: MON, weeks: 1 }).team.filter(d => d.warn).map(d => d.date);

describe('50 % warning', () => {
  test('one of four away (25 %) gives no warning', () => {
    const { app, team } = fourPeople();
    away(app, ANNA, MON);
    assert.deepEqual(warnDays(app, team), []);
  });
  test('two of four away (exactly 50 %) warns on that day only', () => {
    const { app, team } = fourPeople();
    away(app, ANNA, MON);
    away(app, LEA, MON);
    assert.deepEqual(warnDays(app, team), [MON]);
  });
  test('saving the absence that crosses the threshold returns the warning', () => {
    const { app } = fourPeople();
    away(app, ANNA, MON);
    const res = away(app, LEA, MON);
    assert.equal(res.warnings.length, 1);
    assert.equal(res.threshold, 50);
  });
  test('the threshold comes from ABSENCE_WARN_PERCENT', () => {
    const { app, team } = fourPeople();
    app.ctx.PropertiesService.getScriptProperties().setProperty('ABSENCE_WARN_PERCENT', '25');
    away(app, ANNA, MON);
    assert.deepEqual(warnDays(app, team), [MON]);
  });
});

describe('capacity', () => {
  const week = (app, team, from) => app.call('capacity', { teamId: team.id, from: from, weeks: 1 }).members.find(m => m.email === ANNA).weeks[0];
  test('a full week without absences is 40 h', () => {
    const { app, team } = fourPeople();
    assert.equal(week(app, team, MON).available, 40);
  });
  test('a vacation day removes one fifth of the week', () => {
    const { app, team } = fourPeople();
    away(app, ANNA, MON);
    assert.equal(week(app, team, MON).available, 32);
  });
  test('a national holiday on a workday counts as away (New Year 2030 is a Tuesday)', () => {
    const { app, team } = fourPeople();
    assert.equal(week(app, team, '2029-12-31').available, 32);
  });
});
