// The rules every part of Mat Stats counts by (rules.js), held to the codes and labels
// Smoothcomp really sends, and the server's SQL to the same answers as the pages' JavaScript.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('rules.js', 'utf8'), context, { filename: 'rules.js' });
const { finishOf, finishSql, detailOf, howOf, beltOf, beltsIn, isGrade } = context.SCWRRules;

const CODES = {
  submission: 'submission', submission_armbar: 'submission', 'Submission (rear naked choke)': 'submission',
  points: 'points', advantage: 'points', penalties: 'points', decision: 'decision', decision_unanimous: 'decision', referee_decision: 'decision', judges: 'decision',
  walkover: 'walkover', forfeit: 'walkover', disqualification: 'disqualification', dq: 'disqualification', 'double-dq': 'disqualification',
  stoppage: 'stoppage', tko: 'stoppage', ko: 'stoppage', 'ko-punch': 'stoppage',
  'fastest escape': 'fastest_escape', fastest_escape: 'fastest_escape', escape: 'fastest_escape',
  fullippon: 'other', vs0: 'other', other: 'other', '': 'other',
};

test('every code counts under one finish, and a finish name under itself', () => {
  for (const [code, finish] of Object.entries(CODES)) assert.equal(finishOf(code), finish, code);
  for (const finish of context.SCWRRules.FINISHES) assert.equal(finishOf(finish), finish);
});

test("the server's SQL groups every code as the pages do", () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE codes (code TEXT)');
  const insert = db.prepare('INSERT INTO codes VALUES (?)');
  for (const code of Object.keys(CODES)) insert.run(code);
  for (const { code, finish } of db.prepare(`SELECT code, ${finishSql('code')} AS finish FROM codes`).all()) assert.equal(finish, finishOf(code), code);
});

test('a finer code gives its detail; a bare one its finish', () => {
  assert.equal(detailOf('submission_armbar'), 'Submission (armbar)');
  assert.equal(detailOf('decision_unanimous'), 'Decision (unanimous)');
  assert.equal(detailOf('submission'), null);
  assert.equal(howOf('points'), 'Points');
  assert.equal(howOf('tko'), 'Stoppage');
});

test('a label names one belt, or none', () => {
  assert.equal(beltOf('Gi Adult / Male / Blue / -76 kg'), 'blue');
  assert.equal(beltOf('Beginner (Gray)'), 'grey');
  assert.equal(beltOf('Advanced (Purple/Brown/Black)'), null);
  assert.equal(beltOf('All belts'), null);
  assert.equal(beltOf(null), null);
  assert.deepEqual([...beltsIn('Purple/Brown')], ['purple', 'brown']);
  for (const field of ['Belt', 'Level', 'Rank', 'Skill level', 'Grade']) assert.ok(isGrade(field), field);
  for (const field of ['Weight', 'Age', 'Gender', 'Division']) assert.ok(!isGrade(field), field);
});

test('a division is placed by the round each side went out in, a round robin by its record', () => {
  const { placeOf, isPool, poolPlaces } = context.SCWRRules;
  assert.deepEqual([placeOf('Final', true, true), placeOf('Final', false, true), placeOf('Bronze match', true, true), placeOf('Bronze match', false, true)], [1, 2, 3, 4]);
  assert.deepEqual([placeOf('Semifinals', false, false), placeOf('Semifinals', false, true), placeOf('Quarterfinals', false, true), placeOf('16th-finals', false, true), placeOf('Semifinals', true, true)], [3, null, 5, 17, null]);
  assert.ok(isPool(['Match 1/3', 'Match 3/3']) && !isPool(['Match 1/3', 'Final']) && !isPool([]));
  // Level on wins and submissions, the one who beat the other goes first.
  const places = poolPlaces([{ key: 'a', wins: 1, subs: 0 }, { key: 'b', wins: 2, subs: 0 }, { key: 'c', wins: 1, subs: 0 }], (x, y) => x === 'c' && y === 'a');
  assert.deepEqual(JSON.parse(JSON.stringify([...places])), [['b', 1], ['c', 2], ['a', 3]]);
});
