// The profile page's rules (profile-model.js), held to match lists and belt lists shaped as
// Smoothcomp's athlete JSON sends them, and to the visits that broke before: a page that never
// answers, an event only a match list holds, and older copies kept under other names.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({});
for (const file of ['rules.js', 'profile-model.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const { outcomes, planBelts, clean, entry, merge, share, scoresOf, fromCard } = vm.runInContext('SCWRProfile', context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 864e5;
const NOW = Date.parse('2026-11-23T12:00:00Z');

const seat = (id, name, won) => ({ event_registration_id: id, name, club: `${name} BJJ`, image: null, isWinner: won, isLoser: !won });
const match = (wonBy, stage, a, b) => ({ wonBy, name: stage, bracket_id: 9, seats: [a, b] });

test('their seat is the registration in the most matches, their name settling a tie', () => {
  // A three-way round robin lists every match of the pool: each seat is in two, so the name decides.
  const pool = { group: 'Adult / Blue / -76 kg', matches: [
    match('submission_armbar', 'Match 1/3', seat(1, 'Kim Lee', true), seat(2, 'Ana Lima', false)),
    match('points', 'Match 2/3', seat(2, 'Ana Lima', true), seat(3, 'Bo Sun', false)),
    match('decision_unanimous', 'Match 3/3', seat(3, 'Bo Sun', true), seat(1, 'Kim Lee', false)),
  ] };
  // A walkover never counts, a forfeit being one.
  const bracket = { group: 'Adult / Blue / Absolute', matches: [
    match('forfeit', 'Semifinals', seat(4, 'Kim Lee', true), seat(5, 'Cy Doe', false)),
    match('tko', 'Final', seat(4, 'Kim Lee', true), seat(6, 'Di Roe', false)),
  ] };
  const out = outcomes({ id: 1, matches: { a: pool, b: bracket } }, ' Kim Lee ');
  assert.deepEqual(plain(out.types), { submission: [1, 0], decision: [0, 1], stoppage: [1, 0] });
  assert.deepEqual(plain(out.losses.map((l) => [l.opponent, l.how, l.stage])), [['Bo Sun', 'Decision (unanimous)', 'Match 3/3']]);
  assert.deepEqual(plain(out.faced.map((f) => [f.name, f.won, f.how ?? null])), [['Ana Lima', true, 'Submission (armbar)'], ['Bo Sun', false, null], ['Di Roe', true, 'Stoppage']]);
});

test('each belt begins after the last event listed at the belt below, the current one worn without events', () => {
  const bjj = (belt, order, competed, ...starts) => ({ name: 'Brazilian Jiu-Jitsu', belt, sort_order: order, competed_count: competed, events: starts.map((event_start) => ({ event_start })) });
  const plan = planBelts([bjj('Purple', 3, 0), bjj('Blue', 2, 2, '2025-01-10', '2025-06-01'), bjj('White', 1, 1, '2024-03-01'), { name: 'Judo', belt: 'Black', sort_order: 9 }]);
  assert.equal(plan.belt, 'purple');
  assert.deepEqual(plain(plan.worn), ['white', 'blue', 'purple']);
  // Blue's list is complete, so blue begins at its first event; purple, with none, just after blue's last.
  assert.deepEqual(plain(plan.starts.slice(1)), [Date.parse('2025-01-10'), Date.parse('2025-06-01') + 1]);
  assert.equal(plan.beltOf({ start_date: '2025-03-01' }), 'blue');
  assert.deepEqual(plain(planBelts([bjj('Blue', 2, 4)])), { belt: 'blue', whole: true });
});

test('a kept copy keeps only finishes, an older "escape" a fastest escape', () => {
  const out = clean({ types: { escape: [1, 0], walkover: [2, 0], points: [1, 1], junk: 'x' }, losses: [{ type: 'escape', opponent: 'A' }, { type: 'walkover' }, {}], faced: [{ name: 'A', won: true, type: 'escape' }, { won: false }], v: 2 });
  assert.deepEqual(plain(out), { types: { fastest_escape: [1, 0], points: [1, 1] }, losses: [{ type: 'fastest_escape', opponent: 'A' }], faced: [{ name: 'A', won: true, type: 'fastest_escape' }], v: 2 });
});

test("an event listed with no match, win or medal there is one they didn't show at; a bracket of one won isn't", () => {
  const context = { name: 'Kim Lee', dated: new Map(), now: NOW };
  const row = (wins, medals) => ({ id: 9, title: 'Open', start_date: '2026-10-01', wins, medals });
  assert.equal(entry(row(0, { gold: 0, silver: 0, bronze: 0 }), undefined, context).out.absent, true);
  assert.equal(entry(row(0, { gold: 1, silver: 0, bronze: 0 }), undefined, context).out.absent, undefined);
  assert.equal(entry(row(1, {}), undefined, context).out.absent, undefined);
  // The mark is kept with the copy.
  assert.equal(clean(entry(row(0, {}), undefined, context).out).absent, true);
});

test('a visit keeps what it read and what was kept, leaving out what an unanswered page may hold', () => {
  const name = 'Kim Lee';
  const event = (id) => ({ id, title: `Event ${id}`, matches: { a: { group: 'Blue', matches: [match('points', 'Final', seat(id * 10, name, true), seat(id * 10 + 1, 'X', false))] } } });
  const row = (id, start) => ({ id, title: `Event ${id}`, start_date: start });
  const old = { id: 1, start_date: '2025-01-01', title: 'Event 1', out: clean({ types: { points: [1, 0] } }), settled: true };
  const gone = { id: 2, start_date: '2025-02-01', title: 'Event 2', out: clean({ types: { points: [0, 1] } }), settled: true };
  const extra = { id: 3, start_date: null, title: 'Event 3', out: clean({ types: { points: [1, 0] }, extra: true }), settled: true };
  const known = new Map([[1, old], [2, gone], [3, extra]]);
  const context = { name, dated: new Map(), now: NOW };
  const news = [row(5, '2026-11-20'), row(4, '2026-10-01'), row(1, '2025-01-01')];

  // A page failed: the new event its match list didn't come back with stays unkept, to read next visit.
  const partial = merge({ news: news.slice(0, 2), found: new Map([[4, event(4)]]), failed: 1, known, all: false }, context);
  assert.deepEqual(plain(partial.events.map((e) => e.id)), [4, 1, 2, 3]);
  assert.equal(partial.fresh[0].settled, true);

  // A whole read: an event Smoothcomp no longer lists goes, one only a match list holds stays,
  // and an event the match lists hold that the event list doesn't joins as extra.
  const whole = merge({ news, found: new Map([[5, event(5)], [4, event(4)], [1, event(1)], [6, event(6)]]), failed: 0, known, all: true }, context);
  assert.deepEqual(plain(whole.events.map((e) => e.id).sort()), [1, 3, 4, 5, 6]);
  assert.equal(whole.events.find((e) => e.id === 5).settled, false);
  assert.equal(whole.events.find((e) => e.id === 6).out.extra, true);

  // The first share from this browser sends every settled event the server lacks, and every unsettled one;
  // after that, only what this visit read.
  const first = share({ events: whole.events, fresh: whole.fresh, shared: new Set([1]), kept: null, total: 3, holes: [], all: true, now: NOW });
  assert.deepEqual(plain(first.unshared.map((e) => e.id).sort()), [3, 4, 5, 6]);
  assert.equal(first.missing, 0);
  const later = share({ events: partial.events, fresh: partial.fresh, shared: new Set(), kept: { shared: true, gaps: { at: NOW - DAY } }, total: 5, holes: [5], all: false, now: NOW });
  assert.deepEqual(plain(later.unshared.map((e) => e.id)), [4]);
  assert.deepEqual(plain(later.gaps), { at: NOW - DAY, ids: [5] });
});

test("each match's points come from this browser's copy, else what Mat Stats holds, by id or the same meeting; walkovers and stoppages have none", () => {
  const division = 'Adult / Blue';
  const events = [{ id: 5, out: { types: {}, faced: [
    { name: 'Bo Sun', won: true, type: 'points', stage: 'Final', match: 11, division },
    { name: 'Cy Dee', won: true, type: 'stoppage', stage: 'Quarterfinals', match: 12, division },
    { name: 'Hüseyin Akinci', won: true, type: 'submission', stage: 'Semifinals', match: 13, division },
    { name: 'Al Ray', won: false },
  ], losses: [{ type: 'points', opponent: 'Al Ray', stage: 'Match 2/3', match: 14, division }, { type: 'walkover', opponent: 'Ed', match: 15, division }] } }];
  const stored = [
    { event: 5, division, won: true, opponent: 'Huseyin Akinci', stage: 'Semifinals', match: null, us: [9, 0, 0], them: [2, 0, 0] },
    { event: 5, division, won: true, opponent: 'Bo Sun', stage: 'Final', match: 11, us: [1, 0, 0], them: [0, 0, 0] },
  ];
  assert.deepEqual(plain(scoresOf(events, { 11: [4, 0] }, stored)).map((m) => [m.id, m.type, m.score]), [[11, 'points', [4, 0]], [13, 'submission', [9, 2]], [14, 'points', null]]);
});

test("a match card reads as their score, whichever side they are; a card without them reads as none", () => {
  const card = { left: { id: 854897, score: 6, advantage: 0, penalty: 1 }, right: { id: 1567570, score: 2 }, matchInfo: { time: '1:59', timeRemaining: 181000 } };
  assert.deepEqual(plain(fromCard(card, '1567570')), { score: [2, 6], users: ['854897', '1567570'], s: [[6, 0, 1], [2, 0, 0]], clock: [119, 181] });
  assert.deepEqual(plain(fromCard(card, '854897').score), [6, 2]);
  assert.equal(fromCard(card, '99'), null);
  assert.equal(fromCard(null, '1567570'), null);
});
