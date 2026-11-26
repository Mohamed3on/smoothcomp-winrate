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

// The same rows counted both ways: the server's TALLY over them in SQLite, and eventRecords. Each record by finish, as
// [won, lost], the empty ones left out; the events eventRecords counts; and how many of the events their profile lists (every
// event here, its wins as the results give them) count, in the rankings (tallies.listed) and on the athlete page (rules.js showed).
const counted = (types) => Object.fromEntries(Object.entries(types).filter(([, [w, l]]) => w || l).sort());
async function bothWays(outcomes, entries) {
  const { TALLY } = await import('../server/stats.js');
  const { eventRecords, totals, showed } = globalThis.SCWRRules;
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('server/schema.sql', 'utf8'));
  for (const o of outcomes) db.prepare('INSERT INTO outcomes (site, user, event, start, title, out, at) VALUES (?, ?, ?, ?, ?, ?, 0)').run(SITE, USER, o.event, o.start, null, JSON.stringify(o.out));
  for (const e of entries) {
    db.prepare('INSERT OR IGNORE INTO events (site, event, start, at) VALUES (?, ?, ?, 0)').run(SITE, e.event, e.start);
    db.prepare('INSERT INTO entries (site, event, user, division, wins, losses, fought, at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(SITE, e.event, USER, e.division, JSON.stringify(e.wins), JSON.stringify(e.losses), e.fought);
  }
  const listed = [...new Set([...outcomes, ...entries].map((r) => r.event))];
  for (const event of listed) {
    const wins = entries.filter((e) => e.event === event).reduce((n, e) => n + Object.values(e.wins).reduce((a, b) => a + b, 0), 0);
    db.prepare('INSERT INTO history (site, user, event, start, wins, at) VALUES (?, ?, ?, ?, ?, 0)').run(SITE, USER, event, [...outcomes, ...entries].find((r) => r.event === event).start, wins);
  }
  db.prepare(TALLY).run({ 1: SITE, 2: JSON.stringify([USER]) }); // D1's ?1 and ?2, by number
  const row = db.prepare('SELECT rec, listed FROM tallies WHERE site = ? AND user = ?').get(SITE, USER);
  const rec = JSON.parse(row?.rec ?? '{}');
  const records = eventRecords(outcomes, entries);
  const shown = listed.filter((k) => showed(entries.filter((e) => e.event === k), outcomes.find((o) => o.event === k))).length;
  return { sql: counted(rec), js: counted(totals(records)), events: records.map((r) => r.event), listed: [row?.listed, shown] };
}

test('the rankings and the pages count one record', async () => {
  const { sql, js, events } = await bothWays(outcomes, entries);
  assert.deepEqual(sql, js);
  assert.deepEqual(js, { fastest_escape: [1, 0], points: [2, 2], submission: [2, 2], walkover: [1, 1] });
  assert.deepEqual(events, ['1', '2', '4']);
});

test('each belt takes the events from its start, the current one shown even without any', () => {
  const { eventRecords, beltSplit } = globalThis.SCWRRules;
  const records = eventRecords(outcomes, entries);
  const split = beltSplit(records, ['blue', 'purple', 'brown'], [null, Date.parse('2026-05-01'), Date.parse('2027-01-01')]);
  assert.deepEqual(JSON.parse(JSON.stringify(split.map((b) => [b.belt, b.events]))), [['brown', 0], ['purple', 1], ['blue', 2]]);
});

test("an event they didn't show at isn't one of theirs, in the rankings as on the pages, unless the results say they fought there", async () => {
  const absent = (event) => ({ event, start: '2026-08-01T09:00:00Z', out: { v: 2, types: {}, losses: [], faced: [], absent: true } });
  // Their profile lists event 5, with no match there: not theirs.
  const away = await bothWays([...outcomes, absent('5')], entries);
  assert.deepEqual([away.sql, away.events, away.listed], [away.js, ['1', '2', '4'], [4, 4]]);
  // It lists event 2 with no match there, but the results read there say they fought: the results count.
  const fought = await bothWays([...outcomes, absent('2')], entries);
  assert.deepEqual([fought.sql, fought.events, fought.listed], [fought.js, ['1', '2', '4'], [4, 4]]);
  assert.deepEqual(fought.js, { fastest_escape: [1, 0], points: [2, 2], submission: [2, 2], walkover: [1, 1] });
  // Walkovers alone at event 6 (rules.js noShow): they fought no one there, though their profile counts the walkover won.
  const walked = await bothWays(outcomes, [...entries, { event: '6', start: '2026-09-01T09:00:00Z', division: 'Adult / Blue / -76 kg', wins: { walkover: 1 }, losses: { walkover: 1 }, fought: 1 }]);
  assert.deepEqual([walked.sql, walked.events, walked.listed], [walked.js, ['1', '2', '4'], [4, 4]]);
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
