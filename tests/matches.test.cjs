const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, memoryStorage, plain } = require('./load.cjs');

const api = load(['site.js', 'matches.js'], {
  location: { pathname: '/en/event/19856/toplist', origin: 'https://x.smoothcomp.com' },
  localStorage: memoryStorage(),
})('SCWRMatches');

// One decided match, written the way parsePage emits it.
const bout = (cat, winner, loser, type = 'submission', id = '1') => ({
  id, cat, sides: [{ club: winner, won: type }, { club: loser, won: null }],
});

test('the win type is read out of the phrase printed on the winning side', () => {
  assert.equal(api.winType('Won by points - 03:00'), 'points');
  assert.equal(api.winType('Won by Disqualification (dq)'), 'disqualification');
  assert.equal(api.winType('  Won  by\n  Submission  '), 'submission');
  assert.equal(api.winType('Walkover'), 'walkover');
  // Nothing recognisable is still a win, just not one we can name.
  assert.equal(api.winType(''), 'unknown');
});

test('a tally credits the winner and charges every other side the same win type', () => {
  const clubs = api.tally([
    bout('Gi Adult', 'Alpha', 'Beta', 'submission', '1'),
    bout('Gi Adult', 'Alpha', 'Beta', 'points', '2'),
    bout('Gi Adult', 'Beta', 'Alpha', 'submission', '3'),
  ], () => true);
  assert.deepEqual(plain(clubs.Alpha), { w: { submission: 1, points: 1 }, l: { submission: 1 } });
  assert.deepEqual(plain(clubs.Beta), { w: { submission: 1 }, l: { submission: 1, points: 1 } });
});

test('a tally honours the category filter and ignores undecided rows', () => {
  const matches = [
    bout('Gi Adult', 'Alpha', 'Beta', 'submission', '1'),
    bout('Gi Kids White', 'Alpha', 'Beta', 'submission', '2'),
    { id: '3', cat: 'Gi Adult', sides: [{ club: 'Alpha', won: null }, { club: 'Beta', won: null }] },
  ];
  assert.equal(api.tally(matches, (c) => !/Kids/.test(c)).Alpha.w.submission, 1);
  assert.equal(api.tally(matches, () => true).Alpha.w.submission, 2);
});

// A toplist covers one age group; the match list covers the whole event. Rather
// than read the toplist's title, pickScope tries each filter and keeps whichever
// reproduces the win counts the page is already showing.
const SPLIT_EVENT = [
  bout('Gi Adult / Black', 'Alpha', 'Beta', 'submission', '1'),
  bout('Gi Adult / Black', 'Alpha', 'Beta', 'submission', '2'),
  bout('Gi Kids White', 'Beta', 'Alpha', 'submission', '3'),
  bout('No Gi Teens Blue', 'Beta', 'Alpha', 'submission', '4'),
];

test('scope is whichever category filter reproduces the win counts on the page', () => {
  // Alpha on 2 wins can only be the adult divisions.
  assert.equal(api.pickScope(SPLIT_EVENT, new Map([['Alpha', 2]])).name, 'adults');
  // Beta on 2 wins can only be kids & teens.
  assert.equal(api.pickScope(SPLIT_EVENT, new Map([['Beta', 2]])).name, 'youth');
  // Both academies on 2 wins each is only true of the whole event.
  const whole = api.pickScope(SPLIT_EVENT, new Map([['Alpha', 2], ['Beta', 2]]));
  assert.equal(whole.name, 'all');
  assert.equal(whole.hits, 2);
});

test('when nothing reconciles, the scope falls to adults — a guess, not a finding', () => {
  const best = api.pickScope(SPLIT_EVENT, new Map([['Not At This Event', 7]]));
  assert.equal(best.hits, 0);
  // Documented rather than endorsed: the tie-break is `hits > best.hits`, so
  // every tie including the all-zero tie keeps the first option. The toolbar
  // shows `0/1 teams matched` when this happens, which is the only signal.
  assert.equal(best.name, 'adults');
});

test('a club record counts only the selected win types and keeps a stable split order', () => {
  const tally = { w: { points: 3, submission: 2, walkover: 1 }, l: { submission: 1, decision: 4 } };
  const counted = api.clubRecord(tally, ['submission', 'points']);
  assert.equal(counted.wins, 5);
  assert.equal(counted.losses, 1);
  assert.equal(counted.total, 6);
  // Always most-decisive-first, whatever order the caller listed the types in.
  assert.deepEqual(plain(counted.split), [['submission', 2, 1], ['points', 3, 0]]);
  const subsOnly = api.clubRecord(tally, ['submission']);
  assert.equal(subsOnly.wins, 2);
  assert.equal(subsOnly.losses, 1);
  assert.deepEqual(plain(subsOnly.split), [['submission', 2, 1]]);
});

test('a club with no counted matches at all reports an empty record, not a crash', () => {
  const counted = api.clubRecord({ w: {}, l: {} }, ['submission']);
  assert.deepEqual(plain(counted), { wins: 0, losses: 0, total: 0, split: [] });
});

// parsePage is the only function here that needs a DOM, and this extension ships
// no dependencies on purpose. Install linkedom or jsdom as a dev dependency and
// this test starts running; without one it skips rather than pretending to pass.
function domParser() {
  try { return new (require('linkedom').DOMParser)(); } catch {}
  try { return new (new (require('jsdom').JSDOM)().window.DOMParser)(); } catch {}
  return null;
}

const parser = domParser();

test('parsePage reads the match-list markup', {
  skip: parser ? false : 'needs a DOMParser — install linkedom or jsdom as a dev dependency',
}, () => {
  const dom = load(['site.js', 'matches.js'], {
    DOMParser: function () { return parser; },
    URL,
    location: { pathname: '/en/event/19856/schedule/matchlist', origin: 'https://x.smoothcomp.com' },
    localStorage: memoryStorage(),
  })('SCWRMatches');

  const { out, lastPage } = dom.parsePage(fs.readFileSync(`${__dirname}/fixtures/matchlist.html`, 'utf8'));
  assert.equal(lastPage, 3, 'the highest matchlist page link is how many pages there are');
  assert.equal(out.length, 3);

  const [first, second, third] = plain(out);
  assert.equal(first.id, '5501');
  assert.equal(first.bracketId, '771');
  assert.equal(first.cat, 'Gi Adult / Black / -76 kg');
  assert.equal(first.status, 'Finished');
  assert.deepEqual(first.sides[0], { name: 'Alice Johnson', userId: '101', club: 'Alpha BJJ', won: 'submission' });
  assert.equal(first.sides[1].won, null);

  // A detail panel between two rows costs the second one its category, which is
  // what pickScope then has to work around.
  assert.equal(second.cat, '');
  // A hidden profile has no link, so it joins by name and academy instead.
  assert.equal(second.sides[0].userId, null);
  assert.equal(second.sides[0].name, 'Carol Nguyen');
  assert.equal(second.sides[0].won, 'points');

  assert.equal(third.cat, 'Gi Kids White / -30 kg');
  assert.equal(third.status, 'Upcoming');
  assert.equal(third.sides[0].won, 'walkover');
  assert.equal(third.sides[1].club, null, 'an unaffiliated competitor has no .club node');
});
