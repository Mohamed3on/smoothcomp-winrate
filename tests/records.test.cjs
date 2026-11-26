// An athlete's record has one rule (rules.js eventRecords): the pages count it in JavaScript and
// the server's rankings in SQL (server/stats.js TALLY). Both run here over the same rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const SITE = 'smoothcomp.com';
const USER = '7';
const outcomes = [
  // Their profile's match lists at event 1 (an older copy, saying "escape") and event 4.
  { event: '1', start: '2026-01-10T09:00:00Z', out: { v: 2, types: { submission: [2, 1], escape: [1, 0] }, losses: [], faced: [{ name: 'A', won: true, division: 'Adult / Blue / -76 kg' }] } },
  { event: '4', start: '2026-06-01T09:00:00Z', out: { v: 2, types: { points: [1, 2] }, losses: [{ division: 'Adult / Purple / -76 kg' }], faced: [] } },
];
const entries = [
  // The results read at event 1: only its walkovers count beside the match lists.
  { event: '1', start: '2026-01-10T09:00:00Z', division: 'Adult / Blue / -76 kg', wins: { submission: 2, walkover: 1 }, losses: { points: 1 }, fought: 1 },
  // Event 2 has results alone; event 3 only a registration.
  { event: '2', start: '2026-03-05T09:00:00Z', division: 'Adult / Blue / Absolute', wins: { points: 1 }, losses: { submission: 1, walkover: 1 }, fought: 1 },
  { event: '3', start: '2026-04-05T09:00:00Z', division: 'Adult / Blue / -76 kg', wins: {}, losses: {}, fought: 0 },
];

test('the rankings and the pages count one record', async () => {
  const { TALLY } = await import('../server/stats.js');
  const { eventRecords, totals } = globalThis.SCWRRules;
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('server/schema.sql', 'utf8'));
  for (const o of outcomes) db.prepare('INSERT INTO outcomes (site, user, event, start, title, out, at) VALUES (?, ?, ?, ?, ?, ?, 0)').run(SITE, USER, o.event, o.start, null, JSON.stringify(o.out));
  for (const e of entries) {
    db.prepare('INSERT OR IGNORE INTO events (site, event, start, at) VALUES (?, ?, ?, 0)').run(SITE, e.event, e.start);
    db.prepare('INSERT INTO entries (site, event, user, division, wins, losses, fought, at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(SITE, e.event, USER, e.division, JSON.stringify(e.wins), JSON.stringify(e.losses), e.fought);
  }
  db.prepare(TALLY).run({ 1: SITE, 2: JSON.stringify([USER]) }); // D1's ?1 and ?2, by number
  const rec = JSON.parse(db.prepare('SELECT rec FROM tallies WHERE site = ? AND user = ?').get(SITE, USER).rec);
  const records = eventRecords(outcomes, entries);
  const counted = (types) => Object.fromEntries(Object.entries(types).filter(([, [w, l]]) => w || l).sort());
  assert.deepEqual(counted(rec), counted(totals(records)));
  assert.deepEqual(counted(totals(records)), { fastest_escape: [1, 0], points: [2, 2], submission: [2, 2], walkover: [1, 1] });
  assert.deepEqual(records.map((r) => r.event), ['1', '2', '4']);
});

test('each belt takes the events from its start, the current one shown even without any', () => {
  const { eventRecords, beltSplit } = globalThis.SCWRRules;
  const records = eventRecords(outcomes, entries);
  const split = beltSplit(records, ['blue', 'purple', 'brown'], [null, Date.parse('2026-05-01'), Date.parse('2027-01-01')]);
  assert.deepEqual(JSON.parse(JSON.stringify(split.map((b) => [b.belt, b.events]))), [['brown', 0], ['purple', 1], ['blue', 2]]);
});

test("an event their profile lists that they didn't show at isn't one of theirs, unless the results say they fought there", () => {
  const { eventRecords } = globalThis.SCWRRules;
  const absent = (event) => ({ event, start: '2026-08-01T09:00:00Z', out: { v: 2, types: {}, losses: [], faced: [], absent: true } });
  assert.deepEqual(eventRecords([...outcomes, absent('5')], entries).map((r) => r.event), ['1', '2', '4']);
  assert.deepEqual(eventRecords([...outcomes, absent('2')], entries).map((r) => r.event), ['1', '2', '4']);
});

test('a rival has beaten them twice, the furthest behind first', () => {
  const { rivalsOf } = globalThis.SCWRRules;
  const meetings = [
    { name: 'Ana  Lima', won: false, club: 'New Club' }, { name: 'ana lima', won: false, club: 'Old Club' }, { name: 'Ana Lima', won: true },
    { name: 'Bo', won: false }, { name: 'Bo', won: false }, { name: 'Bo', won: false }, { name: 'Bo', won: true }, { name: 'Bo', won: true },
    { name: 'Cy', won: false },
  ];
  assert.deepEqual(rivalsOf(meetings).map((r) => [r.key, r.club ?? null, r.w, r.l]), [['bo', null, 2, 3], ['ana lima', 'New Club', 1, 2]]);
});
