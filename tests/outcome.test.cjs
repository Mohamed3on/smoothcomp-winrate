// An event's Outcome (rules.js Outcome): made from a profile's match list or from the matches the results read keep,
// cleaned to one bounded shape wherever it is read back or kept, and counted into the same Record either way.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../rules.js');

const { Outcome, eventRecords, totals } = globalThis.SCWRRules;
const seat = (id, name, won) => ({ event_registration_id: id, name, club: `${name} BJJ`, image: null, isWinner: won, isLoser: !won });
const match = (id, wonBy, stage, a, b) => ({ id, wonBy, name: stage, bracket_id: 9, seats: [a, b] });
// A three-way round robin lists every match of the pool: each seat is in two, so the name decides. A walkover never
// counts, a forfeit being one.
const pool = { group: 'Adult / Blue / -76 kg', matches: [
  match(1, 'submission_armbar', 'Match 1/3', seat(1, 'Kim Lee', true), seat(2, 'Ana Lima', false)),
  match(2, 'points', 'Match 2/3', seat(2, 'Ana Lima', true), seat(3, 'Bo Sun', false)),
  match(3, 'decision_unanimous', 'Match 3/3', seat(3, 'Bo Sun', true), seat(1, 'Kim Lee', false)),
] };
const bracket = { group: 'Adult / Blue / Absolute', matches: [
  match(4, 'forfeit', 'Semifinals', seat(4, 'Kim Lee', true), seat(5, 'Cy Doe', false)),
  match(5, 'tko', 'Final', seat(4, 'Kim Lee', true), seat(6, 'Di Roe', false)),
] };
const listed = { wins: 3, medals: { gold: 1, silver: 0, bronze: 0 } };
const plain = (v) => JSON.parse(JSON.stringify(v));

test('their seat is the registration in the most matches, their name settling a tie', () => {
  const out = Outcome.fromMatchList({ id: 1, matches: { a: pool, b: bracket } }, ' Kim Lee ', listed);
  assert.deepEqual(out.types, { submission: [1, 0], decision: [0, 1], stoppage: [1, 0] });
  assert.deepEqual(out.losses.map((l) => [l.opponent, l.how, l.stage, l.match]), [['Bo Sun', 'Decision (unanimous)', 'Match 3/3', 3]]);
  assert.deepEqual(out.faced.map((f) => [f.name, f.won, f.how ?? null]), [['Ana Lima', true, 'Submission (armbar)'], ['Bo Sun', false, null], ['Di Roe', true, 'Stoppage']]);
});

test('a match list and the results read give one Record, kept the same once cleaned', () => {
  const fromList = Outcome.clean(Outcome.fromMatchList({ id: 1, matches: { a: pool, b: bracket } }, 'Kim Lee', listed));
  // The same matches as the results keep them, theirs alone.
  const bouts = (group, rows) => ({ division: group, bouts: rows.map(([won, type, opponent, stage, id]) => ({ won, type, opponent, stage, match: id, bracket: 9 })) });
  const fromResults = Outcome.clean(Outcome.fromBouts([
    bouts('Adult / Blue / -76 kg', [[true, 'submission', 'Ana Lima', 'Match 1/3', 1], [false, 'decision', 'Bo Sun', 'Match 3/3', 3]]),
    bouts('Adult / Blue / Absolute', [[true, 'walkover', 'Cy Doe', 'Semifinals', 4], [true, 'stoppage', 'Di Roe', 'Final', 5]]),
  ], listed));
  const record = (out) => totals(eventRecords([{ event: '1', start: '2026-10-01', out }], []));
  assert.deepEqual(record(fromResults), record(fromList));
  assert.deepEqual(record(fromList), { submission: [1, 0], decision: [0, 1], stoppage: [1, 0] });
  assert.deepEqual(fromResults.losses.map((l) => [l.opponent, l.division, l.stage, l.match]), [['Bo Sun', 'Adult / Blue / -76 kg', 'Match 3/3', 3]]);
  // Cleaning a clean Outcome changes nothing.
  assert.deepEqual(Outcome.clean(fromList), fromList);
});

test("an event listed with no match, win or medal there is one they didn't show at; a bracket of one won isn't", () => {
  const row = (wins, medals) => ({ wins, medals });
  for (const make of [(l) => Outcome.fromMatchList(null, 'Kim Lee', l), (l) => Outcome.fromBouts([], l)]) {
    assert.equal(make(row(0, { gold: 0, silver: 0, bronze: 0 })).absent, true);
    assert.equal(make(row(0, [1, 0, 0])).absent, undefined);
    assert.equal(make(row(1, {})).absent, undefined);
    // The mark is kept with the copy.
    assert.equal(Outcome.clean(make(row(0, {}))).absent, true);
  }
  // A match list the event list leaves out counts all the same (extra).
  assert.equal(Outcome.fromMatchList({ id: 2, matches: { b: bracket } }, 'Kim Lee', null).extra, true);
});

test('a kept copy keeps only finishes, bounded: an older "escape" a fastest escape, no walkovers, photos from the sites alone', () => {
  const out = Outcome.clean({ v: 2, types: { escape: [1, 0], fastest_escape: [1, 1], walkover: [3, 0], points: [1, 1], junk: 'x' },
    losses: [{ type: 'escape', opponent: 'A', image: 'https://evil.example/a.png' }, { type: 'walkover' }, {}],
    faced: [{ name: 'A', won: true, type: 'escape', image: 'https://smoothcomp.com/a.png' }, { won: false }, { name: 'x'.repeat(300), won: false }], absent: true });
  assert.deepEqual(out.types, { fastest_escape: [2, 1], points: [1, 1] });
  assert.deepEqual(plain(out.losses), [{ type: 'fastest_escape', how: '', opponent: 'A', club: null, division: null, reg: null, image: null, bracket: null, stage: null, match: null }]);
  assert.deepEqual(out.faced.map((f) => [f.name.length, f.type ?? null, f.image]), [[1, 'fastest_escape', 'https://smoothcomp.com/a.png'], [120, null, null]]);
  // An absent mark beside finishes contradicts itself: the finishes stand.
  assert.equal(out.absent, undefined);
  assert.equal(out.v, 2);
});
