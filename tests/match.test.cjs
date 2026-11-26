// Whether two records are the same match (rules.js matchFinder): the profile's match lists, the
// results read, the schedule's matches, the cards read and the matches Mat Stats keeps each name a match differently.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../rules.js');

const { matchFinder } = globalThis.SCWRRules;
const sameMatch = (a, b) => matchFinder([b])(a) === b;
const at = (stage, sides, more = {}) => ({ division: 'Adult / Blue / -76 kg', stage, sides, ...more });

test('a match is found by its id, else its division (or bracket), round and either side, spelt either way', () => {
  const cases = [
    // [a, b, same]
    [at('Final', ['Kim Lee', 'Bo Sun'], { id: 5 }), at('Semifinals', ['X', 'Y'], { id: 5 }), true],
    [at('Final', ['Kim Lee', 'Bo Sun'], { id: 5 }), at('Final', ['Kim Lee', 'Bo Sun'], { id: 6 }), false],
    // A profile's "Hüseyin" is a registration's "Huseyin", in any case and spacing.
    [at('Final', ['Hüseyin  Kaya', 'Bo Sun']), at('Final', ['huseyin kaya', null]), true],
    [at('Final', ['Kim Lee', 'Bo Sun']), at('Semifinals', ['Kim Lee', 'Bo Sun']), false],
    // A round robin's numbered match is the only one of its number there, whoever fought it.
    [at('Match 2/10', ['Kim Lee', 'Bo Sun']), at('Match 2/10', ['K. Lee', 'B. Sun']), true],
    [at('Match 2/10', ['Kim Lee', 'Bo Sun']), at('Match 3/10', ['Kim Lee', 'Bo Sun']), false],
    // Its bracket names its division as well as the division's name does.
    [{ bracket: 9, stage: 'Final', sides: ['Kim Lee', 'Bo Sun'] }, at('Final', ['Bo Sun', 'Kim Lee'], { bracket: 9 }), true],
    // A bracket decides over the division's name, which a results page may give otherwise.
    [{ bracket: 9, division: 'Blue -76', stage: 'Final', sides: ['Kim Lee', 'Bo Sun'] }, at('Final', ['Kim Lee', null], { bracket: 9 }), true],
    [{ bracket: 8, stage: 'Final', sides: ['Kim Lee', 'Bo Sun'] }, at('Final', ['Kim Lee', 'Bo Sun'], { bracket: 9 }), false],
    // Another division, or another event, is another match.
    [at('Final', ['Kim Lee', 'Bo Sun']), { ...at('Final', ['Kim Lee', 'Bo Sun']), division: 'Adult / Blue / Absolute' }, false],
    [at('Final', ['Kim Lee', 'Bo Sun'], { event: 1 }), at('Final', ['Kim Lee', 'Bo Sun'], { event: 2 }), false],
  ];
  for (const [a, b, same] of cases) {
    assert.equal(sameMatch(a, b), same, JSON.stringify([a, b]));
    assert.equal(sameMatch(b, a), same, JSON.stringify([b, a]));
  }
});

test('a match kept without its round is the only one the two fought there; one side alone names none', () => {
  const list = [at('Match 1/3', ['Kim Lee', 'Bo Sun']), at('Final', ['Kim Lee', 'Ana Lima']), at('Match 2/3', ['Kim Lee', 'Cy Doe']), at('Final', ['Kim Lee', 'Cy Doe'], { division: 'Adult / Blue / Absolute' })];
  const find = matchFinder(list);
  assert.equal(find(at(null, ['kim lee', 'Ana Lima'])), list[1]);
  // The opponent alone would name every match they fought there.
  assert.equal(find(at(null, [null, 'Kim Lee'])), undefined);
  // The same two met twice (a pool, then a final): without the round, neither; with it, that one.
  const twice = matchFinder([...list, at('Final', ['Kim Lee', 'Bo Sun'], { id: 8 })]);
  assert.equal(twice(at(null, ['Kim Lee', 'Bo Sun'])), undefined);
  assert.equal(twice(at('Final', ['Kim Lee', 'Bo Sun'])).id, 8);
  // Where one side's own record says who won, a match without its round is the one with that result.
  const theirs = matchFinder([at(null, [null, 'Bo Sun'], { won: true }), at(null, [null, 'Bo Sun'], { won: false })]);
  assert.equal(theirs(at('Final', [null, 'Bo Sun'], { won: false })).won, false);
  // A record that names no division finds one in any division, where only one fits.
  assert.equal(find({ stage: 'Final', sides: ['Kim Lee', 'Cy Doe'] }), list[3]);
  assert.equal(find({ stage: 'Final', sides: ['Kim Lee', null] }), undefined);
});
