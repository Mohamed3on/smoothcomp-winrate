// The server's intake: what an upload may say (worker.js upload, cleanOut), and a results page's
// upload going in through /record and back out through the stats site's reads, over D1's schema
// in SQLite (a stand-in for D1: the same SQL, bound by number as D1 binds it).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// D1's statement and batch, over node:sqlite.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('server/schema.sql', 'utf8'));
  const statement = (sql, args = []) => {
    const run = (how) => {
      const s = db.prepare(sql);
      s.setAllowUnknownNamedParameters?.(true);
      return s[how](Object.fromEntries(args.map((v, i) => [i + 1, typeof v === 'boolean' ? Number(v) : v ?? null])));
    };
    return {
      bind: (...values) => statement(sql, values),
      run: async () => (run('run'), { success: true }),
      all: async () => ({ results: run('all') }),
      first: async (column) => { const row = run('get'); return column ? row?.[column] ?? null : row ?? null; },
    };
  };
  const DB = {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.all()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    withSession: () => DB,
  };
  return { DB, db };
}

const athletes = {
  11: { name: '  Kim Lee ', club: 'Alpha BJJ', clubId: '501', country: 'NL', belt: 'Adult / Blue', age: 30, photo: 'https://evil.example/x.png', hidden: false,
    entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { submission: 2, forfeit: 1, 'submission_armbar': 1 }, losses: {},
      bouts: [{ won: true, type: 'submission_armbar', opponent: 'Bo Sun', user: '12', stage: 'Final' }] }] },
  12: { name: 'Bo Sun', club: 'Beta', clubId: '502', belt: 'Purple/Brown', entries: [{ division: 'Adult / Blue / -76 kg', place: 2, wins: { points: 1 }, losses: { submission: 2 } }] },
  x: { name: 'Not a user' },
};
const meta = { title: 'Berlin Open', start: '2026-10-03T08:00:00Z', end: '2026-10-04T18:00:00Z', city: 'Berlin', country: 'de' };

test('an upload keeps only the shapes the tables hold', async () => {
  const { upload } = await import('../server/worker.js');
  const said = upload('900', meta, athletes, Date.parse('2026-11-23'));
  assert.deepEqual(said.about, { title: 'Berlin Open', start: '2026-10-03T08:00:00Z', city: 'Berlin', country: 'de', organiser: null, ends: Date.parse('2026-10-04T18:00:00Z') });
  assert.deepEqual(said.people.map((p) => [p.user, p.name, p.country, p.belt, p.born, p.photo, p.hidden]), [['11', 'Kim Lee', 'nl', 'blue', 1996, null, 0], ['12', 'Bo Sun', null, null, null, null, null]]);
  // Finishes go in grouped (a forfeit a walkover), each match with its detail.
  assert.deepEqual(JSON.parse(said.entries[0].wins), { submission: 3, walkover: 1 });
  assert.deepEqual(JSON.parse(said.entries[0].bouts)[0], { won: true, type: 'submission', how: 'Submission (armbar)', opponent: 'Bo Sun', user: '12', club: null, stage: 'Final' });
  assert.equal(upload('900', meta, null), null);
});

test("a profile's match lists keep finishes, an older install's \"escape\" a fastest escape", async () => {
  const { cleanOut } = await import('../server/worker.js');
  const out = cleanOut({ v: 2, types: { escape: [1, 0], fastest_escape: [1, 1], walkover: [3, 0] }, losses: [{ type: 'escape', opponent: 'A' }, { type: 'walkover' }], faced: [{ name: 'A', won: true, type: 'escape' }] });
  assert.deepEqual(out.types, { fastest_escape: [2, 1] });
  assert.deepEqual(out.losses.map((l) => l.type), ['fastest_escape']);
  assert.equal(out.faced[0].type, 'fastest_escape');
});

test("a results page's upload reads back on the stats site", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  const response = await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  assert.equal(response.status, 200);
  const event = await (await API.event(env, new URLSearchParams('site=smoothcomp.com&id=900'))).json();
  assert.equal(event.event.title, 'Berlin Open');
  assert.deepEqual(event.entries.map((e) => [e.user, e.place, e.wins]).sort(), [['11', 1, { submission: 3, walkover: 1 }], ['12', 2, { points: 1 }]]);
  // The rankings count the results read, walkovers left out by default.
  const ranked = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json();
  assert.deepEqual(ranked.rows.map((r) => [r.user, r.wins, r.won, r.lost]), [['11', 3, 3, 0], ['12', 1, 1, 2]]);
  // A registration read after the results stays behind them.
  await post('/roster', { site: 'smoothcomp.com', event: '900', meta, athletes: { 11: { name: 'Kim Lee', entries: [{ division: 'Adult / Blue / -76 kg' }] } }, read: Date.now() });
  const after = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=11'))).json();
  assert.deepEqual(after.entries.map((e) => [e.event, e.fought]), [['900', 1]]);
});
