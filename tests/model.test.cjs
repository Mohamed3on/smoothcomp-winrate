const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load.cjs');
// No DOM, no clock, no storage in the context: these joins are pure, and the
// suite fails at load time if that ever stops being true.
const api = load(['site.js', 'model.js'])('SCWRModel');
const p = (user, name, place = 1, club = 'Academy', hidden = false) => ({
  id: user, placement: place, club: { name: club }, target: { user_id: user, fullname: name, hide_public_profile: hidden },
});
const bracket = (id, size, people, name = 'Gi Adult') => ({
  published: true, bracket: { id }, group: { name }, placements: size, top3: people, after3: [],
});
const match = (id, bracketId, a, b, type = 'submission') => ({ id: String(id), bracketId: String(bracketId), sides: [
  { userId: String(a), name: 'A', club: 'Academy', won: type }, { userId: String(b), name: 'B', club: 'Academy', won: null },
] });
const summary = (m, id, options) => api.summarize(m.athletes.get(`user:${id}`), m, options);

test('one athlete accumulates actual wins across brackets ahead of a one-win gold', () => {
  const results = [bracket(1, 16, [p(1, 'A'), p(2, 'B', 2)]), bracket(2, 8, [p(1, 'A'), p(3, 'C', 2)]), bracket(3, 2, [p(4, 'D'), p(5, 'E', 2)])];
  const m = api.build(results, [match(1, 1, 1, 2), match(2, 1, 1, 2), match(3, 2, 1, 3), match(4, 3, 4, 5)]);
  const a = summary(m, 1);
  assert.equal(a.wins, 3); assert.equal(a.golds, 2); assert.equal(a.biggestGold, 16);
  assert.equal(api.rank([summary(m, 4), a], 'wins')[0].name, 'A');
});

test('walkovers are excluded from both numerator and denominator by default', () => {
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [match(1, 1, 1, 2, 'walkover'), match(2, 1, 2, 1, 'points')]);
  assert.equal(summary(m, 1).wins, 0); assert.equal(summary(m, 1).losses, 1); assert.equal(summary(m, 1).rate, 0);
  assert.equal(summary(m, 1, { walkovers: true }).rate, 0.5);
});

test('submission rate uses every counted match including losses', () => {
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [match(1, 1, 1, 2), match(2, 1, 1, 2, 'points'), match(3, 1, 2, 1, 'decision')]);
  const a = summary(m, 1);
  assert.equal(a.submissions, 1); assert.equal(a.rate, 2 / 3); assert.equal(a.submissionRate, 1 / 3);
});

test('duplicate match IDs are counted once; rematches with different IDs survive', () => {
  const a = match(1, 1, 1, 2);
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [a, a, match(2, 1, 1, 2)]);
  assert.equal(summary(m, 1).wins, 2); assert.equal(m.completed, 2);
});

test('hidden profile joins require a unique name and academy within the bracket', () => {
  const m = api.build([bracket(1, 2, [p(1, 'A', 1, 'Academy', true), p(2, 'B', 2)])], [{ ...match(1, 1, 1, 2), sides: [
    { name: ' A ', club: 'ACADEMY', won: 'submission' }, { userId: '2', name: 'B', won: null },
  ] }]);
  assert.equal(summary(m, 1).wins, 1); assert.equal(m.unmatched, 0); assert.equal(summary(m, 1).hidden, true);
});

test('ambiguous names are not merged; explicit wrong IDs never fall back to names', () => {
  const results = [bracket(1, 3, [p(1, 'Same'), p(2, 'Same'), p(3, 'B')])];
  const m = api.build(results, [{ id: '1', bracketId: '1', sides: [{ name: 'Same', club: 'Academy', won: 'points' }, { userId: '3', won: null }] },
    { id: '2', bracketId: '1', sides: [{ userId: '999', name: 'Same', club: 'Academy', won: 'points' }, { userId: '3', won: null }] }]);
  assert.equal(m.unmatched, 2); assert.equal(summary(m, 1).wins, 0); assert.equal(summary(m, 2).wins, 0);
});

test('division filters restrict matches and golds together', () => {
  const m = api.build([bracket(1, 8, [p(1, 'A'), p(2, 'B')]), bracket(2, 16, [p(1, 'A'), p(2, 'B')], 'No Gi Adult')], [match(1, 1, 1, 2), match(2, 2, 2, 1)]);
  const a = summary(m, 1, { bracketIds: new Set(['1']) });
  assert.equal(a.wins, 1); assert.equal(a.losses, 0); assert.equal(a.golds, 1); assert.equal(a.biggestGold, 8);
});

test('byes, pending and two-winner rows do not create contested wins', () => {
  const a = match(1, 1, 1, 2); a.sides[1].won = 'points';
  const b = match(2, 1, 1, 2); b.sides = b.sides.slice(0, 1);
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B')])], [a, b, match(3, 1, 1, 2, null), match(4, 1, 1, 2, 'bye')]);
  assert.equal(summary(m, 1).total, 0); assert.equal(summary(m, 1).rate, null); assert.equal(m.unresolved, 4);
});

test('largest gold field ignores larger brackets where the athlete did not win gold', () => {
  const m = api.build([bracket(1, 32, [p(1, 'A', 2), p(2, 'B')]), bracket(2, 2, [p(1, 'A')])], []);
  assert.equal(summary(m, 1).biggestGold, 2); assert.equal(summary(m, 1).biggestBracket, 32);
});

test('pool matches join the published final bracket through a unique division name', () => {
  const m = api.build([bracket(10, 16, [p(1, 'A'), p(2, 'B')], 'Gi Adult / White')], [
    { ...match(1, 11, 1, 2), cat: 'Gi Adult / White (Day 1)' }, match(2, 10, 1, 2),
  ]);
  assert.equal(m.unmatched, 0); assert.equal(summary(m, 1).wins, 2);
  assert.equal(summary(m, 1).golds, 1); assert.equal(summary(m, 1).biggestGold, 16);
});

test('identical division names in multiple brackets do not guess a pool join', () => {
  const m = api.build([bracket(10, 4, [p(1, 'A'), p(2, 'B')]), bracket(12, 4, [p(1, 'A'), p(2, 'B')])], [
    { ...match(1, 11, 1, 2), cat: 'Gi Adult (Day 1)' },
  ]);
  assert.equal(m.unmatched, 2); assert.equal(summary(m, 1).wins, 0);
});

// --- the win-type allowlist: the only mode the pages ever run in -------------

test('an explicit allowlist decides what counts, in both directions', () => {
  const m = api.build([bracket(1, 4, [p(1, 'A'), p(2, 'B', 2)])],
    [match(1, 1, 1, 2, 'submission'), match(2, 1, 1, 2, 'points'), match(3, 1, 2, 1, 'decision')]);
  const subs = summary(m, 1, { types: ['submission'] });
  assert.equal(subs.wins, 1); assert.equal(subs.losses, 0); assert.equal(subs.rate, 1);
  const both = summary(m, 1, { types: ['submission', 'points'] });
  assert.equal(both.wins, 2); assert.equal(both.losses, 0);
  assert.deepEqual(plain(both.types), { submission: 1, points: 1 });
  // The allowlist overrides the walkover default rather than stacking with it.
  const wo = api.build([bracket(2, 2, [p(1, 'A'), p(2, 'B', 2)])], [match(1, 2, 1, 2, 'walkover')]);
  assert.equal(summary(wo, 1, { types: ['walkover'] }).wins, 1);
  assert.equal(summary(wo, 1, { types: ['submission'] }).wins, 0);
});

test('entryRecord and summarize agree on one bracket entry', () => {
  const m = api.build([bracket(1, 4, [p(1, 'A'), p(2, 'B', 2)])],
    [match(1, 1, 1, 2), match(2, 1, 1, 2, 'points'), match(3, 1, 2, 1, 'decision')]);
  const types = ['submission', 'points'];
  const cheap = api.entryRecord(m.brackets.get('1').entries.get('user:1'), types);
  const full = summary(m, 1, { types, bracketIds: new Set(['1']) });
  assert.equal(cheap.wins, full.wins);
  assert.equal(cheap.losses, full.losses);
  assert.deepEqual(plain(cheap.types), plain(full.types));
});

// --- academies ---------------------------------------------------------------

test('academies combine every athlete record and separate depth from total wins', () => {
  const m = api.build([
    bracket(1, 8, [p(1, 'A', 1, 'Alpha'), p(2, 'B', 2, 'Beta')]),
    bracket(2, 8, [p(3, 'C', 1, 'Alpha'), p(4, 'D', 2, 'Beta')], 'Gi Adult 2'),
  ], [match(1, 1, 1, 2), match(2, 1, 1, 2), match(3, 2, 3, 4)]);
  const clubs = api.academies([...m.athletes.values()].map((a) => api.summarize(a, m, { types: ['submission'] })));

  const alpha = clubs.find((c) => c.name === 'Alpha');
  assert.equal(alpha.wins, 3); assert.equal(alpha.athletes, 2); assert.equal(alpha.golds, 2);
  assert.equal(alpha.depth, 1.5, 'wins per athlete entered, not per match');
  const beta = clubs.find((c) => c.name === 'Beta');
  assert.equal(beta.wins, 0); assert.equal(beta.losses, 3); assert.equal(beta.rate, 0); assert.equal(beta.silvers, 2);
});

test('athletes with no academy collect under one unaffiliated row', () => {
  const anon = (id, name, place) => ({ ...p(id, name, place), club: null });
  const m = api.build([bracket(1, 2, [anon(1, 'A', 1), anon(2, 'B', 2)])], [match(1, 1, 1, 2)]);
  const clubs = api.academies([...m.athletes.values()].map((a) => api.summarize(a, m, { types: ['submission'] })));
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].name, 'Unaffiliated');
  assert.equal(clubs[0].athletes, 2);
});

// --- rank --------------------------------------------------------------------

test('rank falls through a fixed tie-break chain and sorts names both ways', () => {
  const row = (name, over) => ({ name, wins: 0, rate: null, golds: 0, biggestGold: 0, total: 0, ...over });
  const rows = [row('Zoe'), row('Adam'), row('Mia', { wins: 1 })];
  assert.deepEqual(plain(api.rank(rows, 'wins').map((r) => r.name)), ['Mia', 'Adam', 'Zoe']);
  assert.deepEqual(plain(api.rank(rows, 'name', 1).map((r) => r.name)), ['Adam', 'Mia', 'Zoe']);
  assert.deepEqual(plain(api.rank(rows, 'name', -1).map((r) => r.name)), ['Zoe', 'Mia', 'Adam']);
  // Golds break a tie that wins and win rate cannot.
  assert.equal(api.rank([row('Late'), row('Early', { golds: 2 })], 'wins')[0].name, 'Early');
  // A null rate never outranks a real one.
  assert.equal(api.rank([row('None'), row('Some', { rate: 0 })], 'rate')[0].name, 'Some');
});

// --- leaderboard: the whole filter-and-rank pipeline the pages render ---------

const EVENT = () => api.build([
  bracket(1, 16, [p(1, 'A', 1, 'Alpha'), p(2, 'B', 2, 'Beta')], 'Gi Adult'),
  bracket(2, 4, [p(3, 'C', 1, 'Beta'), p(4, 'D', 2, 'Alpha')], 'No Gi Kids'),
], [match(1, 1, 1, 2), match(2, 1, 1, 2), match(3, 2, 3, 4)]);

const names = (rows) => plain(rows.map((r) => r.name));
const view = { types: ['submission'], sort: 'wins' };

test('the leaderboard ranks athletes and academies from one model', () => {
  const m = EVENT();
  assert.deepEqual(names(api.leaderboard(m, { ...view, table: 'athletes' })), ['A', 'C', 'B', 'D']);
  assert.deepEqual(names(api.leaderboard(m, { ...view, table: 'academies' })), ['Alpha', 'Beta']);
});

test('division, age, search and minimum each narrow the leaderboard', () => {
  const m = EVENT();
  const at = (over) => names(api.leaderboard(m, { ...view, table: 'athletes', ...over })).sort();
  assert.deepEqual(at({ age: 'adults' }), ['A', 'B'], 'kids brackets drop out with their entrants');
  assert.deepEqual(at({ age: 'youth' }), ['C', 'D']);
  assert.deepEqual(at({ division: 'nogi' }), ['C', 'D']);
  assert.deepEqual(at({ division: 'gi' }), ['A', 'B']);
  assert.deepEqual(at({ search: 'alpha' }), ['A', 'D'], 'search reaches the academy, not just the name');
  assert.deepEqual(at({ search: 'no gi' }), ['C', 'D'], 'and the division names an athlete entered');
  assert.deepEqual(at({ minimum: 2 }), ['A', 'B'], 'minimum counts contested matches, not wins');
  assert.deepEqual(at({ search: 'nobody here' }), []);
});

test('the brackets view names the gold medallist beside whoever won the most', () => {
  // Champ took gold on one win; Grinder won two in the same bracket.
  const m = api.build([bracket(1, 8, [p(1, 'Champ', 1), p(2, 'Runner', 2), p(3, 'Grinder', 3)])],
    [match(1, 1, 1, 2), match(2, 1, 3, 2), match(3, 1, 3, 1)]);
  const [b] = api.leaderboard(m, { ...view, table: 'brackets' });
  assert.equal(b.champion.name, 'Champ');
  assert.equal(b.leader.name, 'Grinder');
  assert.equal(b.leader.wins, 2);
  assert.deepEqual(plain(b.leader.types), { submission: 2 });
  assert.equal(b.gapCount, 1);
});

test('a bracket where gold also led on wins reports no gap', () => {
  const m = api.build([bracket(1, 4, [p(1, 'Champ', 1), p(2, 'Runner', 2)])], [match(1, 1, 1, 2), match(2, 1, 1, 2)]);
  const [b] = api.leaderboard(m, { ...view, table: 'brackets' });
  assert.equal(b.gapCount, 0);
  assert.equal(b.leader.name, 'Champ', 'a tie on wins goes to the better placement');
});

test('changing the counted win types changes who leads a bracket', () => {
  // Champ won gold on points; Grinder submitted one opponent.
  const m = api.build([bracket(1, 8, [p(1, 'Champ', 1), p(2, 'Runner', 2), p(3, 'Grinder', 3)])], [
    { ...match(1, 1, 1, 2, 'points') }, { ...match(2, 1, 1, 3, 'points') }, { ...match(3, 1, 3, 2, 'submission') },
  ]);
  const onPoints = api.leaderboard(m, { table: 'brackets', types: ['points', 'submission'], sort: 'wins' })[0];
  assert.equal(onPoints.leader.name, 'Champ');
  assert.equal(onPoints.gapCount, 0);
  const onSubs = api.leaderboard(m, { table: 'brackets', types: ['submission'], sort: 'wins' })[0];
  assert.equal(onSubs.leader.name, 'Grinder');
  assert.equal(onSubs.champion.wins, 0, 'gold won nothing that counts once only submissions do');
  assert.equal(onSubs.gapCount, 1);
});
