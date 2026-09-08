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
  // Its mirror is measured against losses alone: A lost once, on a decision;
  // B was submitted in one of two.
  assert.equal(a.concededRate, 0); assert.equal(summary(m, 2).concededRate, 1 / 2);
});

test('duplicate match IDs are counted once; rematches with different IDs survive', () => {
  const a = match(1, 1, 1, 2);
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [a, a, match(2, 1, 1, 2)]);
  assert.equal(summary(m, 1).wins, 2); assert.equal(m.completed, 2);
});

test('academy head-to-head returns one aggregate backed by its direct match ledger', () => {
  const bouts = [
    { id: '1', bracketId: '10', cat: 'Adult / Black', sides: [
      { userId: '1', name: 'Alice', club: 'Fightzone', won: 'submission' },
      { userId: '2', name: 'Bea', club: 'Cicero Costha', won: null },
    ] },
    { id: '2', bracketId: '11', cat: 'Master / Brown', sides: [
      { userId: '3', name: 'Carla', club: 'Cicero Costha', won: 'points' },
      { userId: '4', name: 'Dina', club: 'Fightzone', won: null },
    ] },
    { id: '3', bracketId: '12', cat: 'Adult / Purple', sides: [
      { userId: '5', name: 'Eva', club: 'Fightzone', won: 'decision' },
      { userId: '6', name: 'Fran', club: 'Other', won: null },
    ] },
  ];
  const h2h = api.headToHead(bouts, ' Fightzone ', 'CICERO COSTHA', ['submission', 'points']);
  assert.equal(h2h.a.wins, 1); assert.equal(h2h.b.wins, 1); assert.equal(h2h.total, 2);
  assert.deepEqual(plain(h2h.a.types), { submission: 1 });
  assert.deepEqual(plain(h2h.b.types), { points: 1 });
  assert.deepEqual(plain(h2h.matches.map((m) => [m.id, m.winner.name, m.category])), [
    ['1', 'Alice', 'Adult / Black'], ['2', 'Carla', 'Master / Brown'],
  ]);
});

test('the direct-match ledger reads most decisive first, then division, then match order', () => {
  const bout = (id, cat, type) => ({ id, bracketId: id, cat, sides: [
    { name: `W${id}`, club: 'Alpha', won: type }, { name: `L${id}`, club: 'Beta', won: null },
  ] });
  const h2h = api.headToHead([
    bout('4', 'B Division (Day 2)', 'points'), bout('1', 'C Division', 'walkover'),
    bout('3', 'B Division (Day 1)', 'points'), bout('2', 'A Division', 'submission'),
  ], 'Alpha', 'Beta', ['submission', 'points', 'walkover']);
  assert.deepEqual(plain(h2h.matches.map((m) => m.id)), ['2', '3', '4', '1']);
});

test('academy head-to-head ignores duplicates, byes, undecided bouts and same-academy matches', () => {
  const direct = { id: '1', bracketId: '10', sides: [
    { name: 'A', club: 'Alpha', won: 'submission' }, { name: 'B', club: 'Beta', won: null },
  ] };
  const h2h = api.headToHead([direct, direct,
    { ...direct, id: '2', sides: [{ name: 'A', club: 'Alpha', won: 'bye' }, { name: 'B', club: 'Beta', won: null }] },
    { ...direct, id: '3', sides: [{ name: 'A', club: 'Alpha', won: null }, { name: 'B', club: 'Beta', won: null }] },
    { ...direct, id: '4', sides: [{ name: 'A', club: 'Alpha', won: 'points' }, { name: 'B', club: 'Alpha', won: null }] },
  ], 'Alpha', 'Beta');
  assert.equal(h2h.total, 1); assert.equal(h2h.a.wins, 1); assert.equal(h2h.b.wins, 0);
});

test('academy head-to-head applies the same athlete eligibility rule to both sides', () => {
  const bouts = [{ id: '1', bracketId: '10', sides: [
    { userId: '1', name: 'Adult', club: 'Alpha', won: 'points' },
    { userId: '2', name: 'Youth', club: 'Beta', won: null },
  ] }, { id: '2', bracketId: '10', sides: [
    { userId: '3', name: 'Adult B', club: 'Beta', won: 'decision' },
    { userId: '4', name: 'Adult A', club: 'Alpha', won: null },
  ] }];
  const eligible = (side) => side.userId !== '2';
  const h2h = api.headToHead(bouts, 'Alpha', 'Beta', ['points', 'decision'], eligible);
  assert.equal(h2h.total, 1); assert.equal(h2h.a.wins, 0); assert.equal(h2h.b.wins, 1);
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
  // Two winless athletes tie on every record metric, so the longer record wins
  // the slot rather than the alphabet — 0–6 is a more convincing 0% than 0–2.
  const winless = [row('Adam', { rate: 0, total: 2 }), row('Zoe', { rate: 0, total: 6 })];
  assert.equal(api.rank(winless, 'rate')[0].name, 'Zoe');
  assert.equal(api.rank(winless, 'rate', 1)[0].name, 'Zoe');
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

test('minimum age uses participant ages while gi and no-gi stay combined', () => {
  const m = EVENT();
  m.athletes.get('user:1').age = 34;
  m.athletes.get('user:2').age = 29;
  m.athletes.get('user:3').age = 42;
  // Unknown ages remain visible without a floor, but cannot satisfy one.
  m.athletes.get('user:4').age = null;
  const at = (over) => names(api.leaderboard(m, { ...view, table: 'athletes', ...over })).sort();
  assert.deepEqual(at({ minimumAge: 0 }), ['A', 'B', 'C', 'D']);
  assert.deepEqual(at({ minimumAge: 30 }), ['A', 'C']);
  assert.deepEqual(at({ minimumAge: 40 }), ['C']);
  assert.deepEqual(at({ division: 'gi', age: 'adults' }), ['A', 'B', 'C', 'D'],
    'legacy name-based filters no longer split gi, no-gi or named age groups');
  assert.deepEqual(names(api.leaderboard(m, { ...view, table: 'academies', minimumAge: 40 })), ['Beta'],
    'academy totals are built only from age-eligible athletes');
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

// Shapes taken verbatim from a real POST /en/event/{id}/participants response.
const CATEGORIES = [
  { event_category_id: 823906, category_name: 'Belt', id: 6173100, name: 'White' },
  { event_category_id: 823906, category_name: 'Belt', id: 6173101, name: 'Blue' },
  { event_category_id: 823913, category_name: 'Level', id: 6173140, name: 'Intermediate (Blue)' },
  { event_category_id: 823907, category_name: 'Division', id: 6173105, name: 'Adult' },
  { event_category_id: 823908, category_name: 'Weight', id: 6173110, name: '-155 lbs' },
];
const PLACEHOLDER = '/build/webpack/img/placeholder-image-profile-inverted.bcebcff626c61413d7d5..png';
const registration = (userId, extra = {}) => ({
  user_id: userId, age: 22, birth: '2003', gender: 'M', country: 'Germany',
  profile_image_id: 1, profile_image: `https://smoothcomp.com/pictures/t/${userId}/x.jpg`,
  categories: [{ category_value_id: 6173100 }, { category_value_id: 6173105 }, { category_value_id: 6173110 }],
  ...extra,
});
const payload = (registrations) => ({ categories: CATEGORIES, participants: [{ registrations }] });

test('the roster reads age, belt, country and photo per competitor', () => {
  const people = api.roster(payload([registration(1)]));
  assert.equal(people.size, 1);
  // The model runs in its own vm context, so its objects carry a foreign
  // prototype; compare the fields rather than the identity.
  assert.deepEqual({ ...people.get('1') }, {
    age: 22, birth: '2003', country: 'Germany', belt: 'White',
    photo: 'https://smoothcomp.com/pictures/t/1/x.jpg',
  });
});

test('a no-gi division reports its grade under "Level" instead of "Belt"', () => {
  const people = api.roster(payload([registration(1, { categories: [{ category_value_id: 6173140 }] })]));
  assert.equal(people.get('1').belt, 'Intermediate (Blue)');
});

test('the placeholder avatar is not treated as a photo', () => {
  const withPlaceholder = registration(1, { profile_image_id: null, profile_image: PLACEHOLDER });
  assert.equal(api.roster(payload([withPlaceholder])).get('1').photo, null);
});

test('an entrant registered in several divisions is counted once', () => {
  const people = api.roster(payload([registration(1), registration(1, { age: 99 })]));
  assert.equal(people.size, 1);
  assert.equal(people.get('1').age, 22, 'the first registration wins');
});

test('a missing age is null rather than NaN', () => {
  assert.equal(api.roster(payload([registration(1, { age: null })])).get('1').age, null);
});

test('the roster attaches to athletes by user id and fills only missing photos', () => {
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [match(1, 1, 1, 2)]);
  m.athletes.get('user:1').logo = 'https://smoothcomp.com/pictures/t/own.jpg';
  api.attachRoster(m, api.roster(payload([registration(1), registration(2)])));
  const first = m.athletes.get('user:1');
  const second = m.athletes.get('user:2');
  assert.equal(first.age, 22);
  assert.equal(first.belt, 'White');
  assert.equal(first.logo, 'https://smoothcomp.com/pictures/t/own.jpg', 'the results photo is kept');
  assert.equal(second.logo, 'https://smoothcomp.com/pictures/t/2/x.jpg', 'the roster fills the gap');
});

test('an unavailable roster leaves the model untouched', () => {
  const m = api.build([bracket(1, 2, [p(1, 'A'), p(2, 'B', 2)])], [match(1, 1, 1, 2)]);
  assert.equal(api.attachRoster(m, null), m);
  assert.equal(m.athletes.get('user:1').age, undefined);
});
