// The server's intake: what an upload may say (worker.js upload), and a results page's
// upload going in through /record and back out through the stats site's reads, over D1's schema
// in SQLite (a stand-in for D1: the same SQL, bound by number as D1 binds it).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const plans = require('./plans.cjs');

// D1's statement and batch, over node:sqlite.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync('server/schema.sql', 'utf8'));
  const statement = (sql, args = []) => {
    plans.record(sql);
    const run = (how) => {
      const s = db.prepare(sql);
      s.setAllowUnknownNamedParameters?.(true);
      const values = args.map((v) => (typeof v === 'boolean' ? Number(v) : v ?? null));
      // Bare ? (the search's matcher) bind in order; ?N by number, as D1 binds both.
      return /\?(?!\d)/.test(sql) ? s[how](...values) : s[how](Object.fromEntries(values.map((v, i) => [i + 1, v])));
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

// An upload as the site shows it once rankings have caught up: results leave their athletes' ranking rows to the nightly
// rebuild (worker.js rebuild), run here at once, to the end.
async function posted(worker, env, path, body) {
  const response = await worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  const { rebuild } = await import('../server/worker.js');
  await env.DB.prepare("DELETE FROM meta WHERE k = 'rank'").run();
  do await rebuild(env); while (JSON.parse(await env.DB.prepare("SELECT v FROM meta WHERE k = 'rank'").first('v')).to);
  return response;
}

const athletes = {
  11: { name: '  Kim Lee ', club: 'Alpha BJJ', clubId: '501', country: 'NL', belt: 'Adult / Blue', age: 30, photo: 'https://evil.example/x.png', hidden: false,
    entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { submission: 2, forfeit: 1, 'submission_armbar': 1 }, losses: {},
      bouts: [{ won: true, type: 'submission_armbar', opponent: 'Bo Sun', user: '12', stage: 'Final' }, { won: true, type: 'tko', opponent: 'Cy Dee', user: null, stage: 'Semifinals' }] }] },
  12: { name: 'Bo Sun', club: 'Beta', clubId: '502', belt: 'Purple/Brown', entries: [{ division: 'Adult / Blue / -76 kg', place: 2, wins: { points: 1 }, losses: { submission: 2 } }] },
  x: { name: 'Not a user' },
};
const meta = { title: 'Berlin Open', start: '2026-10-03T08:00:00Z', end: '2026-10-04T18:00:00Z', city: 'Berlin', country: 'de', lat: '52.52', lng: '13.4' };

test('an upload keeps only the shapes the tables hold', async () => {
  const { upload } = await import('../server/worker.js');
  const said = upload('900', meta, athletes, Date.parse('2026-11-23'));
  assert.deepEqual(said.about, { title: 'Berlin Open', start: '2026-10-03T08:00:00Z', city: 'Berlin', country: 'de', organiser: null, ends: Date.parse('2026-10-04T18:00:00Z'), lat: 52.52, lng: 13.4 });
  assert.deepEqual(said.people.map((p) => [p.user, p.name, p.country, p.belt, p.born, p.photo, p.hidden]), [['11', 'Kim Lee', 'nl', 'blue', 1996, null, 0], ['12', 'Bo Sun', null, null, null, null, null]]);
  // Finishes go in grouped (a forfeit a walkover), each match with its detail.
  assert.deepEqual(JSON.parse(said.entries[0].wins), { submission: 3, walkover: 1 });
  assert.deepEqual(JSON.parse(said.entries[0].bouts)[0], { won: true, type: 'submission', how: 'Submission (armbar)', opponent: 'Bo Sun', user: '12', club: null, stage: 'Final' });
  assert.equal(upload('900', meta, null), null);
});

test("a results page's upload reads back on the stats site", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  const response = await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  assert.equal(response.status, 200);
  const event = await (await API.event(env, new URLSearchParams('site=smoothcomp.com&id=900'))).json();
  assert.equal(event.event.title, 'Berlin Open');
  assert.deepEqual(event.entries.map((e) => [e.user, e.place, e.wins]).sort(), [['11', 1, { submission: 3, walkover: 1 }], ['12', 2, { points: 1 }]]);
  // Each result names its matches with no score read, for Read scores, bar a stoppage's; one with none names none.
  assert.deepEqual(event.entries.map((e) => [e.user, e.open]).sort(), [['11', [{ match: null, stage: 'Final', bracket: null, opponent: 'Bo Sun' }]], ['12', undefined]]);
  // An academy's page opens one event at a time, reading only its own athletes there.
  const club = await (await API.event(env, new URLSearchParams('site=smoothcomp.com&id=900&club=502'))).json();
  assert.deepEqual(club.entries.map((e) => e.user), ['12']);
  // The rankings count the results read, walkovers left out by default.
  const ranked = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json();
  assert.deepEqual(ranked.rows.map((r) => [r.user, r.wins, r.won, r.lost]), [['11', 3, 3, 0], ['12', 1, 1, 2]]);
  // An athlete with no win among the finishes counted still ranks on their losses there.
  const lossesOnly = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off=walkover,points&sort=winRate&dir=asc'))).json();
  assert.deepEqual(lossesOnly.rows.map((r) => [r.user, r.wins, r.won, r.lost]), [['12', 0, 0, 2], ['11', 3, 3, 0]]);
  // The page and its count read apart (?part=rows, ?part=total) give what one read gives.
  const page = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off=walkover,points&part=rows'))).json();
  const count = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off=walkover,points&part=total'))).json();
  const whole = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off=walkover,points'))).json();
  const figures = (r) => [r.user, r.wins, r.won, r.lost];
  assert.deepEqual([page.rows.map(figures), page.total, count], [whole.rows.map(figures), null, { total: whole.total }]);
  assert.equal(whole.total, 2);
  // The count read off board_count's masks matches the board's own sums under every finish set: each finish alone, each left out.
  const { MASKS } = await import('../server/stats.js');
  const schema = fs.readFileSync('server/schema.sql', 'utf8');
  for (const mask of Object.values(MASKS)) assert.ok(schema.includes(`(${mask})`), 'board_count holds stats.js MASKS word for word');
  const finishes = ['submission', 'stoppage', 'fastest_escape', 'points', 'decision', 'disqualification', 'walkover', 'other'];
  for (const off of [...finishes.map((t) => finishes.filter((u) => u !== t)), ...finishes.map((t) => [t]), []]) {
    for (const extra of ['', '&agemin=16', '&belt=blue', '&events=1']) {
      const q = `site=smoothcomp.com&off=${off.join(',')}${extra}`;
      const read = async (part) => (await (await API.athletes(env, new URLSearchParams(q + part))).json()).total;
      assert.equal(await read('&part=total'), await read(''), q);
    }
  }
  // A loss's finish ranks too (lost_ and the finish), the losses by finish coming with each row.
  const subbed = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&sort=lost_submission'))).json();
  assert.deepEqual(subbed.rows.map((r) => [r.user, r.lost_types?.submission]), [['12', 2], ['11', 0]]);
  // A registration read after the results stays behind them.
  await post('/roster', { site: 'smoothcomp.com', event: '900', meta, athletes: { 11: { name: 'Kim Lee', entries: [{ division: 'Adult / Blue / -76 kg' }] } }, read: Date.now() });
  const after = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=11'))).json();
  assert.deepEqual(after.entries.map((e) => [e.event, e.fought]), [['900', 1]]);
  // A participants page's lookup gets each athlete's record by finish, to seed brackets by win rate.
  const looked = await (await post('/lookup', { site: 'smoothcomp.com', users: ['11', '12', '13'], clubs: ['501', '999'] })).json();
  assert.deepEqual(looked.records, { 11: { submission: [3, 0], walkover: [1, 0] }, 12: { points: [1, 0], submission: [0, 2] } });
  // And each academy asked after, its athletes' [won, lost], which breaks the seed's ties; one nobody ranks for, nothing.
  assert.deepEqual(looked.academies, { 501: [3, 0] });
});

test('ratings weigh whom an athlete beat, start a newcomer from their career, and rank by rating', async () => {
  const { rate, packer, rerate } = await import('../server/rating.js');
  // A beat B, who beat five others; C beat D, who lost to the same five: A's win counts for more.
  const p = packer();
  p.event(20000);
  for (const x of ['x1', 'x2', 'x3', 'x4', 'x5']) { p.match('B', x, 1); p.match(x, 'D', 1); }
  p.event(20010);
  p.match('A', 'B', 1); p.match('C', 'D', 1);
  const r = rate(p.done(), new Map(), 20010);
  assert.ok(r.get('A').mean > r.get('C').mean + 100);
  // An athlete new to the matches read starts from their career's wins per event before them, and with less doubt.
  const q = packer();
  q.event(20000);
  q.match('E', 'F', 1); q.match('G', 'H', 1);
  const c = rate(q.done(), new Map([['E', { wins: 41, events: 11 }]]), 20000);
  assert.ok(c.get('E').mean > c.get('G').mean + 100 && c.get('E').doubt < c.get('G').doubt);
  // Nightly, from every match read: 11 beat 12 at sixteen events; both rated, 11 first, and a walkover counts for nothing.
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB, db } = d1();
  const env = { DB };
  await posted(worker, env, '/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  const bout = (type) => JSON.stringify([{ won: true, type, how: null, opponent: 'Bo Sun', user: '12', club: null, stage: 'Final' }]);
  for (let i = 1; i <= 15; i++) {
    db.prepare("INSERT INTO events (site, event, start, at) VALUES ('smoothcomp.com', ?, ?, 0)").run(`${900 + i}`, `2026-10-${String(3 + i).padStart(2, '0')}T08:00:00Z`);
    db.prepare("INSERT INTO entries (site, event, user, division, fought, at, bouts) VALUES ('smoothcomp.com', ?, '11', 'Male / Blue / Adult / -76 kg', 1, 0, ?)").run(`${900 + i}`, bout(i === 15 ? 'walkover' : 'points'));
  }
  await rerate(env, Date.parse('2026-10-20'));
  const kept = db.prepare('SELECT user, rating, mean, doubt, matches FROM ratings ORDER BY rating DESC').all();
  assert.deepEqual(kept.map((k) => [k.user, k.matches]), [['11', 15], ['12', 15]]);
  assert.ok(kept[0].rating > kept[1].rating && kept.every((k) => k.doubt < 200 && k.rating === Math.round(k.mean - 2 * k.doubt) || Math.abs(k.rating - (k.mean - 2 * k.doubt)) <= 1));
  const ranked = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&sort=rating'))).json();
  assert.deepEqual([ranked.rows.map((a) => [a.user, a.rating]), ranked.total], [kept.map((k) => [k.user, k.rating]), 2]);
  const total = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&sort=rating&part=total'))).json();
  assert.equal(total.total, 2);
  // Every ranking's rows carry the rating; a rebuild leaves no one it no longer rates.
  const byWins = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json();
  assert.deepEqual(byWins.rows.map((a) => [a.user, a.rating, a.rated]), kept.map((k) => [k.user, k.rating, k.matches]));
  await rerate(env, Date.parse('2030-01-01'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM ratings').get().n, 0);
});

test("an event their profile lists but they didn't show at isn't theirs: not in their history, events or last event", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB, db } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  const listed = db.prepare("INSERT INTO history (site, user, event, title, start, wins, at) VALUES ('smoothcomp.com', '31', ?, 'Open', ?, ?, 0)");
  listed.run('900', '2026-10-03', 0);
  listed.run('800', '2025-10-03', 1);
  // Their profile counts both events.
  await post('/keep', { site: 'smoothcomp.com', careers: { 31: { at: Date.now(), wins: { points: 1 }, medals: [0, 0, 0], events: 2 } } });
  await post('/roster', { site: 'smoothcomp.com', event: '900', meta, athletes: { 31: { name: 'Max Roe', entries: [{ division: 'Adult / Blue / -76 kg' }] } }, read: Date.now() });
  assert.deepEqual({ ...db.prepare("SELECT events, last FROM board WHERE user = '31'").get() }, { events: 2, last: '2026-10-03' });
  // The results come in without them.
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  assert.deepEqual({ ...db.prepare("SELECT events, last FROM board WHERE user = '31'").get() }, { events: 1, last: '2025-10-03' });
  const page = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=31'))).json();
  assert.deepEqual(page.history.map((h) => h.event), ['800']);
  // A participants page's lookup says how many of their listed events they didn't show at.
  assert.deepEqual((await (await post('/lookup', { site: 'smoothcomp.com', users: ['31'] })).json()).absent, { 31: 1 });
  // Their profile's match lists, from any install, showing no match, win or medal at an event: not theirs either.
  listed.run('700', '2025-06-01', 0);
  await post('/keep-outcomes', { site: 'smoothcomp.com', user: '31', events: [{ id: 700, start_date: '2025-06-01', title: 'Open', out: { v: 2, types: {}, losses: [], faced: [] } }] });
  assert.equal(db.prepare("SELECT out ->> '$.absent' AS absent FROM outcomes WHERE user = '31' AND event = '700'").get().absent, 1);
  assert.deepEqual({ ...db.prepare("SELECT events, last FROM board WHERE user = '31'").get() }, { events: 1, last: '2025-10-03' });
});

test("a career read says whether a profile is hidden, over the events' flag", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { DB, db } = d1();
  const post = (path, body) => posted(worker, { DB }, path, body);
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  const hidden = () => db.prepare("SELECT p.user, p.hidden, b.hidden AS ranked FROM people p LEFT JOIN board b USING (site, user) ORDER BY p.user").all().map((r) => [r.user, r.hidden, r.ranked]);
  assert.deepEqual(hidden(), [['11', 0, 0], ['12', null, null]]);
  await post('/keep', { site: 'smoothcomp.com', careers: { 11: { at: Date.now(), hidden: true }, 12: { at: Date.now(), wins: { points: 4 }, medals: [1, 0, 0] } } });
  assert.deepEqual(hidden(), [['11', 1, 1], ['12', 0, 0]]);
});

test("an event where an athlete had walkovers alone isn't one of theirs: no event, medal or match there counts", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  const at = (event, start, entries) => post('/record', { site: 'smoothcomp.com', event, meta: { ...meta, start }, read: Date.now(), records: { 21: [0, 0] },
    athletes: { 21: { name: 'Ana Ruiz', club: 'Alpha BJJ', clubId: '501', entries } } });
  await at('901', '2026-09-01T08:00:00Z', [{ division: 'Adult / Blue / -76 kg', place: 2, wins: { submission: 1 }, losses: { points: 1 } }]);
  // A no-show: a walkover won, then walkovers lost, and a silver for it.
  await at('902', '2026-10-01T08:00:00Z', [{ division: 'Adult / Blue / -76 kg', place: 2, wins: { walkover: 1 }, losses: { forfeit: 2 } }]);
  // A bracket of one, with no match at all, still counts.
  await at('903', '2026-11-01T08:00:00Z', [{ division: 'Adult / Blue / -82 kg', place: 1, wins: {}, losses: {} }]);
  const ranked = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off='))).json();
  assert.deepEqual(ranked.rows.map((r) => [r.user, r.events, r.gold, r.silver, r.won, r.lost, r.walkovers]), [['21', 2, 1, 1, 1, 1, 0]]);
  const club = await (await API.team(env, new URLSearchParams('site=smoothcomp.com&id=501'))).json();
  assert.deepEqual(club.events.map((e) => e.event), ['903', '901']);
});

test("an athlete's accounts with their name, birth year and country read as one", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  // AJP numbers its events and accounts apart: its event 900 is another event, and its Kim Lee in Germany someone else.
  const ajp = {
    77: { name: 'kim  LEE', club: 'Gamma', clubId: '7', country: 'NL', age: 30, entries: [{ division: 'Adult / Black / -76 kg', place: 2, wins: { points: 2 }, losses: { submission: 1 } }] },
    78: { name: 'Kim Lee', club: 'Delta', clubId: '8', country: 'DE', age: 30, entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { points: 3 }, losses: {} }] },
  };
  await post('/record', { site: 'ajptour.com', event: '900', records: { 77: [2, 1], 78: [3, 0] }, meta, athletes: ajp, read: Date.now() });
  const one = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=11'))).json();
  assert.deepEqual(one.accounts.map((a) => [a.site, a.user]), [['ajptour.com', '77']]);
  assert.deepEqual(one.entries.map((e) => [e.site, e.event, e.place]).sort(), [['ajptour.com', '900', 2], ['smoothcomp.com', '900', 1]]);
  assert.deepEqual([one.career.wins, one.career.won, one.career.lost, one.career.gold, one.career.silver], [5, 5, 1, 1, 1]);
  assert.equal(one.person.club, 'Alpha BJJ');
  // A belt one account shows (black at AJP) is theirs on every account: belts only go up.
  assert.equal(one.career.belt, 'black');
  // From the other side, the same athlete.
  const other = await (await API.athlete(env, new URLSearchParams('site=ajptour.com&id=77'))).json();
  assert.deepEqual(other.accounts.map((a) => [a.site, a.user]), [['smoothcomp.com', '11']]);
  assert.equal(other.entries.length, 2);
  // Each site's ranking counts the person whole, under its own account.
  const ranked = async (site) => (await (await API.athletes(env, new URLSearchParams(`site=${site}`))).json()).rows.map((r) => [r.user, r.wins, r.won, r.lost]);
  assert.deepEqual(await ranked('smoothcomp.com'), [['11', 5, 5, 1], ['12', 1, 1, 2]]);
  assert.deepEqual(await ranked('ajptour.com'), [['77', 5, 5, 1], ['78', 3, 3, 0]]);
  // A second AJP account of theirs, at another event, joins them: it adds its win, and the ranking shows them once,
  // under the account with more events.
  await post('/record', { site: 'ajptour.com', event: '901', records: { 79: [1, 0] }, meta: { ...meta, title: 'Berlin Open II' },
    athletes: { 79: { name: 'Kim Lee', club: 'Gamma', clubId: '7', country: 'NL', age: 30, entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { submission: 1 }, losses: {} }] } }, read: Date.now() });
  assert.deepEqual(await ranked('ajptour.com'), [['77', 6, 6, 1], ['78', 3, 3, 0]]);
  assert.deepEqual(await ranked('smoothcomp.com'), [['11', 6, 6, 1], ['12', 1, 1, 2]]);
  const dup = await (await API.athlete(env, new URLSearchParams('site=ajptour.com&id=79'))).json();
  assert.equal(dup.career.wins, 6);
  // Its academy counts them once.
  const teams = (await (await API.teams(env, new URLSearchParams('site=ajptour.com&athletes=1'))).json()).rows.map((t) => [t.club_id, t.athletes, t.wins]);
  assert.deepEqual(teams.sort(), [['7', 1, 6], ['8', 1, 3]]);
  // An account with no birth year joins them where their name and country match one person, one of whose accounts was
  // at its academy; at an academy none of theirs was at, it stays apart.
  await post('/record', { site: 'smoothcomp.com', event: '902', records: { 13: [2, 0], 14: [4, 0] }, meta: { ...meta, title: 'Berlin Open III' }, athletes: {
    13: { name: 'Kim Lee', club: 'alpha bjj', clubId: '501', country: 'NL', entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { submission: 2 }, losses: {} }] },
    14: { name: 'Kim Lee', club: 'Omega', clubId: '599', country: 'NL', entries: [{ division: 'Adult / Blue / -82 kg', place: 1, wins: { points: 4 }, losses: {} }] },
  }, read: Date.now() });
  assert.deepEqual(await ranked('smoothcomp.com'), [['11', 8, 8, 1], ['14', 4, 4, 0], ['12', 1, 1, 2]]);
  const unborn = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=13'))).json();
  assert.deepEqual(unborn.accounts.map((a) => [a.site, a.user]).sort(), [['ajptour.com', '77'], ['ajptour.com', '79'], ['smoothcomp.com', '11']]);
  // Through every merge and recount, each academy's kept totals (club_board, the default list) are what adding up its athletes gives.
  for (const site of ['smoothcomp.com', 'ajptour.com']) assert.ok((await bothPaths(DB, `site=${site}&active=0`)).length);
});

// An academy's totals read both ways (stats.js academyTotals): kept (club_board, club_recent) and added up live, which must agree.
async function bothPaths(DB, q) {
  const { academyTotals, filters } = await import('../server/stats.js');
  const read = async (live) => {
    const t = academyTotals(filters(new URLSearchParams(q)), { least: 1, live });
    return (await DB.prepare(`WITH ${t.with} SELECT * FROM totals ORDER BY club_id`).bind(...t.args).all()).results;
  };
  const [kept, live] = [await read(false), await read(true)];
  assert.deepEqual(kept, live, q);
  return kept;
}

test("an academy's totals are the same kept as added up, over everyone and over the last two years, under the academy's own filters", async () => {
  const { keepRecent } = await import('../server/stats.js');
  const { DB, db } = d1();
  const counts = ['w', 'rw', 'rl', 'sl'].flatMap((p) => ['submission', 'points', 'walkover', 'decision', 'disqualification', 'stoppage', 'fastest_escape', 'other'].map((g) => `${p}_${g}`));
  const lately = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
  // Two academies: a career athlete with no medals read (NULL), a results athlete with a record, one out of the window, one of a person's other accounts.
  const add = (user, club, last, values, more = {}) => db.prepare(`INSERT INTO board (site, user, source, club_id, last, ${[...counts, ...Object.keys(more)]})
    VALUES ('smoothcomp.com', '${user}', '${more.source ?? 'results'}', '${club}', '${last}', ${[...counts.map((c) => values[c] ?? 0), ...Object.values(more).map((v) => (typeof v === 'string' ? `'${v}'` : v))]})`).run();
  add(1, '9', lately, { w_submission: 3, w_points: 2, w_walkover: 4, rw_submission: 3, rl_points: 1 }, { gold: 1, silver: 0, bronze: 2 });
  add(2, '9', lately, { w_points: 5, w_decision: 1 }, { source: 'career' });
  add(3, '10', '2020-01-01', { w_submission: 1, sl_points: 2 }, { silver: 1 });
  add(4, '10', lately, { w_points: 2 }, { dup: 1 });
  db.exec("INSERT INTO clubs (site, club_id, club, entered, country) VALUES ('smoothcomp.com', '9', 'Nine', 3, 'DE'), ('smoothcomp.com', '10', 'Ten', 1, 'NL')");
  await keepRecent({ DB }, 'smoothcomp.com');
  const figures = (rows) => rows.map((r) => [r.club_id, r.athletes, r.wins, r.submission, r.points, r.gold, r.silver, r.bronze, r.won, r.lost]);
  // Over everyone: Nine's career athlete adds wins and no record, its results athlete their record.
  assert.deepEqual(figures(await bothPaths(DB, 'site=smoothcomp.com&active=0')), [['10', 1, 1, 1, 0, 0, 1, 0, 1, 2], ['9', 2, 11, 3, 7, 1, 0, 2, 3, 1]]);
  // The last two years leave Ten's only counted athlete out.
  assert.deepEqual(figures(await bothPaths(DB, 'site=smoothcomp.com&active=24')), [['9', 2, 11, 3, 7, 1, 0, 2, 3, 1]]);
  // The academy's own wins, events and country: each a filter on the academy, kept or not.
  for (const q of ['wins=5', 'wins=12', 'events=2', 'country=nl', 'q=Ni']) await bothPaths(DB, `site=smoothcomp.com&active=0&${q}`);
});

test("an academy's kept totals follow its athletes in, changed, moved away and out", () => {
  const { db } = d1();
  const counts = ['w', 'rw', 'rl', 'sl'].flatMap((p) => ['submission', 'points', 'walkover', 'decision', 'disqualification', 'stoppage', 'fastest_escape', 'other'].map((g) => `${p}_${g}`));
  db.prepare(`INSERT INTO board (site, user, source, club_id, gold, silver, bronze, ${counts}) VALUES ('s', '1', 'results', '9', 1, 0, 0, ${counts.map((c) => (c === 'w_submission' ? 2 : 0))})`).run();
  const kept = () => db.prepare('SELECT club_id, athletes, wins, submission, points, gold, won, lost FROM club_board WHERE athletes > 0').all().map((r) => Object.values(r));
  // A results-ranked athlete's record is their wins and their results' losses.
  assert.deepEqual(kept(), [['9', 1, 2, 2, 0, 1, 2, 0]]);
  db.prepare("UPDATE board SET w_points = 3, w_walkover = 4, sl_points = 1 WHERE user = '1'").run();
  assert.deepEqual(kept(), [['9', 1, 5, 2, 3, 1, 5, 1]]);
  // A match-list record, where one is read, is the record (walkovers aside).
  db.prepare("UPDATE board SET rw_points = 6, rw_walkover = 9, rl_submission = 2 WHERE user = '1'").run();
  assert.deepEqual(kept(), [['9', 1, 5, 2, 3, 1, 6, 2]]);
  db.prepare("UPDATE board SET club_id = '10' WHERE user = '1'").run();
  assert.deepEqual(kept(), [['10', 1, 5, 2, 3, 1, 6, 2]]);
  db.prepare("UPDATE board SET dup = 1 WHERE user = '1'").run();
  assert.deepEqual(kept(), []);
  db.prepare("UPDATE board SET dup = 0 WHERE user = '1'").run();
  assert.deepEqual(kept(), [['10', 1, 5, 2, 3, 1, 6, 2]]);
  // One with nothing counted yet joins its academy's totals once they have, and leaves them when it's gone again.
  db.prepare(`INSERT INTO board (site, user, source, club_id, gold, silver, bronze, ${counts}) VALUES ('s', '2', 'career', '10', 0, 0, 0, ${counts.map(() => 0)})`).run();
  assert.deepEqual(kept(), [['10', 1, 5, 2, 3, 1, 6, 2]]);
  db.prepare("UPDATE board SET w_decision = 2, gold = 1 WHERE user = '2'").run();
  assert.deepEqual(kept(), [['10', 2, 7, 2, 3, 2, 6, 2]]);
  db.prepare("UPDATE board SET w_decision = 0 WHERE user = '2'").run();
  assert.deepEqual(kept(), [['10', 1, 5, 2, 3, 1, 6, 2]]);
  db.prepare("DELETE FROM board WHERE user = '1'").run();
  assert.deepEqual(kept(), []);
});

test("the academies list's two-year totals count only those who competed in two years, and rewrite only what changed", async () => {
  const { keepRecent, API } = await import('../server/stats.js');
  const { DB, db } = d1();
  const counts = ['w', 'rw', 'rl', 'sl'].flatMap((p) => ['submission', 'points', 'walkover', 'decision', 'disqualification', 'stoppage', 'fastest_escape', 'other'].map((g) => `${p}_${g}`));
  const lately = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
  const add = (user, club, last, sub) => db.prepare(`INSERT INTO board (site, user, source, club_id, last, gold, silver, bronze, ${counts}) VALUES ('smoothcomp.com', '${user}', 'results', '${club}', '${last}', 1, 0, 0, ${counts.map((c) => (c === 'w_submission' ? sub : 0))})`).run();
  add(1, '9', lately, 2); add(2, '9', '2020-01-01', 5); add(3, '10', '2020-01-01', 1);
  assert.deepEqual(await keepRecent({ DB }, 'smoothcomp.com'), { academies: 1, written: 1, gone: 0 });
  assert.deepEqual(db.prepare('SELECT club_id, athletes, wins, submission, gold FROM club_recent').all().map((r) => Object.values(r)), [['9', 1, 2, 2, 1]]);
  // Nothing changed, nothing written; an academy whose last recent athlete goes stale leaves.
  assert.deepEqual(await keepRecent({ DB }, 'smoothcomp.com'), { academies: 1, written: 0, gone: 0 });
  // The list under the default window reads these totals (club 10, nobody recent, isn't in it).
  db.exec("INSERT INTO clubs (site, club_id, club) VALUES ('smoothcomp.com', '9', 'Nine'), ('smoothcomp.com', '10', 'Ten')");
  const list = await (await API.teams({ DB }, new URLSearchParams('site=smoothcomp.com&active=24&athletes=1'))).json();
  assert.deepEqual(list.rows.map((r) => [r.club_id, r.athletes, r.wins]), [['9', 1, 2]]);  db.prepare("UPDATE board SET last = '2020-01-01' WHERE user = '1'").run();
  assert.deepEqual(await keepRecent({ DB }, 'smoothcomp.com'), { academies: 0, written: 0, gone: 1 });
});

test('the same results sent again write nothing but when they were read', async () => {
  const worker = (await import('../server/worker.js')).default;
  const { DB, db } = d1();
  const env = { DB };
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  const changes = () => db.prepare('SELECT total_changes() AS n').get().n;
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  const first = changes();
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() + 1000 });
  // The read time (reads) and the site's change stamp (meta): nothing else.
  assert.equal(changes() - first, 2);
  // A result that changes rewrites that athlete alone.
  const changed = structuredClone(athletes);
  changed[12].entries[0].place = 3;
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes: changed, read: Date.now() + 2000 });
  const rows = db.prepare("SELECT user, place FROM entries WHERE event = '900' ORDER BY user").all().map((r) => [r.user, r.place]);
  assert.deepEqual(rows, [['11', 1], ['12', 3]]);
  // An older read arriving late changes nothing.
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0] }, meta, athletes: { 11: athletes[11] }, read: Date.now() - 60e3 });
  assert.equal(db.prepare("SELECT count(*) AS n FROM entries WHERE event = '900'").get().n, 2);
});

test('D1 usage near what the plan includes rests the crawler, then stops uploads', async () => {
  const worker = (await import('../server/worker.js')).default;
  const { verdict, budget } = await import('../server/budget.js');
  assert.equal(verdict({ written: 10e6, read: 5e9, writtenToday: 0.5e6, readToday: 0.2e9 }), 'ok');
  assert.equal(verdict({ written: 10e6, read: 5e9, writtenToday: 1.7e6, readToday: 0.2e9 }), 'slow');
  assert.equal(verdict({ written: 10e6, read: 5e9, writtenToday: 0.5e6, readToday: 0.9e9 }), 'ok');
  assert.equal(verdict({ written: 36e6, read: 5e9, writtenToday: 0, readToday: 0 }), 'slow');
  assert.equal(verdict({ written: 10e6, read: 23e9, writtenToday: 0, readToday: 0 }), 'stop');
  const { DB } = d1();
  const env = { DB };
  // No verdict yet: the background work rests; uploads go on.
  assert.equal(await budget(env), 'slow');
  await DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('budget', ?1)").bind(JSON.stringify({ state: 'stop', at: Date.now() })).run();
  assert.equal(await budget(env, Date.now(), true), 'stop');
  const post = (path, body) => posted(worker, env, path, body);
  assert.equal((await post('/record', { site: 'smoothcomp.com', event: '900', records: {}, meta, athletes, read: Date.now() })).status, 503);
  // Lookups still answer.
  assert.equal((await post('/lookup', { site: 'smoothcomp.com', users: ['11'] })).status, 200);
});

test("an athlete's belt is at least the lowest belt of every division they entered", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  // Purple in 2024; in 2026 a Brown/Black division, which names no one belt. A kids' green belt never lifts an adult white.
  await post('/record', { site: 'smoothcomp.com', event: '950', records: { 21: [1, 0], 22: [1, 0] }, meta: { ...meta, start: '2024-09-15T07:00:00Z' }, athletes: {
    21: { name: 'Tam Nja', belt: 'Purple', entries: [{ division: 'Gi Adult / Male / Purple / -170 lbs', place: 1, wins: { points: 1 }, losses: {} }] },
    22: { name: 'Kid Ko', belt: 'Green', entries: [{ division: 'Kids / Green / -40 kg', place: 1, wins: { points: 1 }, losses: {} }] },
  }, read: Date.now() });
  await post('/record', { site: 'smoothcomp.com', event: '951', records: { 21: [2, 0], 22: [1, 0] }, meta: { ...meta, start: '2026-05-23T07:00:00Z' }, athletes: {
    21: { name: 'Tam Nja', entries: [{ division: 'Male Gi / Brown/Black / Master 1 (30+) / -85,00 kg', place: 1, wins: { submission: 2 }, losses: {} }] },
    22: { name: 'Kid Ko', belt: 'White', entries: [{ division: 'Adult / White / -70 kg', place: 1, wins: { points: 1 }, losses: {} }] },
    // A brown belt who fought the black division once, and is in brown again at a later event.
    23: { name: 'Mo Ve', belt: 'Brown', entries: [{ division: 'Gi Adult / Male / Black / Master (30+) / -170 lbs', place: 1, wins: { points: 1 }, losses: {} }] },
  }, read: Date.now() });
  await post('/record', { site: 'smoothcomp.com', event: '952', records: { 23: [1, 0] }, meta: { ...meta, start: '2026-12-13T07:00:00Z' }, athletes: {
    23: { name: 'Mo Ve', entries: [{ division: 'Gi Adult / Male / Brown / Adult / -170 lbs', place: 1, wins: { points: 1 }, losses: {} }] },
  }, read: Date.now() });
  const rows = (await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json()).rows;
  assert.deepEqual(rows.map((r) => [r.user, r.belt]).sort(), [['21', 'brown'], ['22', 'white'], ['23', 'brown']]);
  // Each ranks in the bracket their divisions give over the year to their latest event (rules.js bracketOf).
  assert.deepEqual(rows.map((r) => [r.user, r.sex, r.age, r.weight]).sort(), [['21', 'm', 'Master', 85], ['22', null, 'Adult', 70], ['23', 'm', 'Adult', 77]]);
  const list = async (q) => (await (await API.athletes(env, new URLSearchParams(`site=smoothcomp.com&${q}`))).json());
  assert.deepEqual((await list('weight=77&sex=m')).rows.map((r) => r.user), ['23']);
  assert.deepEqual((await list('age=Master')).rows.map((r) => r.user), ['21']);
  assert.equal((await list('part=total&age=Adult')).total, 2);
  assert.equal((await list('part=total&weight=85&age=Master&sex=m')).total, 1);
  // An athlete page ranks them in their bracket and belt by wins: a second brown Master at −85 kg with more wins goes first.
  await post('/record', { site: 'smoothcomp.com', event: '953', records: { 24: [4, 0] }, meta: { ...meta, start: '2026-06-01T07:00:00Z' }, athletes: {
    24: { name: 'Al Ba', belt: 'Brown', entries: [{ division: 'Male Gi / Brown / Master 2 (36+) / -84,9 kg', place: 1, wins: { submission: 4 }, losses: {} }] },
  }, read: Date.now() });
  const page = async (id) => (await (await API.athlete(env, new URLSearchParams(`site=smoothcomp.com&id=${id}`))).json()).bracket;
  assert.deepEqual(await page('24'), { sex: 'm', age: 'Master', weight: 85, belt: 'brown', rank: 1, of: 2 });
  assert.deepEqual(await page('21'), { sex: 'm', age: 'Master', weight: 85, belt: 'brown', rank: 2, of: 2 });
  // Their profile's belt list ends at blue, yet they entered a purple division since (athlete 1296744): they competed up, and stay blue.
  await post('/record', { site: 'smoothcomp.com', event: '954', records: { 25: [1, 0] }, meta: { ...meta, start: '2026-11-14T07:00:00Z' }, athletes: {
    25: { name: 'Max Up', belt: 'Blue', entries: [{ division: 'Men Gi / Purple / Middle Weight (80 Kg to 84.9 Kg) / Master (30+)', place: 1, wins: { points: 1 }, losses: {} }] },
  }, read: Date.now() });
  await post('/belts', { site: 'smoothcomp.com', user: '25', worn: ['white', 'blue'], starts: [null, Date.parse('2025-06-01')] });
  assert.equal((await page('25')).belt, 'blue');
  // A ranking of those who competed lately ranks only them: one whose latest event is older has no place in it.
  const lately = async (id) => (await (await API.athlete(env, new URLSearchParams(`site=smoothcomp.com&id=${id}&active=6`))).json()).bracket;
  assert.equal((await lately('24'))?.of, 1);
  assert.equal(await lately('22'), null);
});

test('listed events are found by place, date, sport and size, and academies where they compete', async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { listed, LISTED } = await import('../server/crawl.js');
  const { DB, db } = d1();
  const env = { DB };
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const at = (id, start, city, lat, lng, sports, url) => ({ id, title: `${city} ${id}`, startdate: start, location_city: city, location_country: 'DE', location_lat: lat, location_long: lng, categoryGroups: sports, url });
  const html = `<script>\nvar events = ${JSON.stringify([
    at(1, day(10), 'Potsdam', '52.39', '13.06', ['1'], 'https://smoothcomp.com/en/event/1'), at(2, day(20), 'Munich', '48.14', '11.58', ['7'], 'https://evil.example/2'),
    at(3, day(5), 'Berlin', '52.52', '13.40', ['26']), at(4, day(200), 'Berlin', '52.5', '13.4', ['1']), { id: 'x' }])}\n</script>`;
  const rows = listed(html);
  assert.deepEqual(rows.map((r) => [r.event, r.lat, r.sports, r.url]), [['1', 52.39, '["1"]', 'https://smoothcomp.com/en/event/1'], ['2', 48.14, '["7"]', null], ['3', 52.52, '["26"]', null], ['4', 52.5, '["1"]', null]]);
  await DB.prepare(LISTED).bind('smoothcomp.com', Date.now(), JSON.stringify(rows)).run();
  const find = async (q) => (await (await API.events(env, new URLSearchParams(`site=smoothcomp.com&${q}`))).json()).rows;
  // Within 100 km of Berlin and 90 days: Potsdam; not Munich, the judo, or next year's.
  assert.deepEqual((await find('near=52.52,13.40&km=100&days=90')).map((e) => [e.event, Math.round(e.km)]), [['1', 27]]);
  assert.deepEqual((await find('near=52.52,13.40&sort=distance')).map((e) => e.event), ['4', '1', '2']);
  assert.deepEqual((await find('sport=nogi')).map((e) => e.event), ['2']);
  // AJP Tour's events list beside them, ids apart; it files all under Gi, so a No-Gi title counts as NoGi.
  await DB.prepare(LISTED).bind('ajptour.com', Date.now(), JSON.stringify(listed(`<script>\nvar events = ${JSON.stringify([{ ...at(1, day(15), 'Berlin', '52.5', '13.4', ['1']), title: 'AJP Tour Berlin - Gi & No-Gi' }])}\n</script>`))).run();
  assert.deepEqual((await find('sport=nogi')).map((e) => [e.site, e.event]), [['ajptour.com', '1'], ['smoothcomp.com', '2']]);
  assert.deepEqual((await find('near=52.52,13.40&km=100&days=90')).map((e) => [e.site, e.event]), [['smoothcomp.com', '1'], ['ajptour.com', '1']]);
  // A minimum size leaves out events nobody has read; past events show once read.
  assert.deepEqual(await find('min=1'), []);
  assert.deepEqual(await find('when=past'), []);
  // Upcoming grappling events' pages give their size: a count, a menu with none (hidden), a challenge (kept as was).
  const { sizeEvents } = await import('../server/crawl.js');
  const menu = (n) => `<a href="https://x/en/event/9/participants"><span>\n  Athletes\n  ${n == null ? '' : `<span class="badge">${n}</span>`}\n</span></a>`;
  const pages = { 'smoothcomp.com/en/event/1/': menu(1204), 'smoothcomp.com/en/event/2/': menu(null), 'smoothcomp.com/en/event/4/': menu(7) };
  const real = globalThis.fetch, asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    const page = Object.entries(pages).find(([k]) => url.includes(k))?.[1];
    return new Response(page ?? 'Just a moment...', { status: page ? 200 : 403 });
  };
  try {
    assert.equal(await sizeEvents(env, 10, 0), 4);
    assert.deepEqual(asked, ['https://smoothcomp.com/en/event/1/accommodations', 'https://ajptour.com/en/event/1/accommodations',
      'https://smoothcomp.com/en/event/2/accommodations', 'https://smoothcomp.com/en/event/4/accommodations']);
    assert.equal(await sizeEvents(env, 10, 0), 0); // read again a day on
  } finally { globalThis.fetch = real; }
  assert.deepEqual((await find('min=1&sort=athletes')).map((e) => [e.event, e.athletes, e.registered]), [['1', 0, 1204], ['4', 0, 7]]);
  // An install that opens an event's page sends its count too; nonsense is refused.
  const send = (body) => worker.fetch(new Request('https://matstats.test/size', { method: 'POST', body: JSON.stringify({ site: 'smoothcomp.com', ...body }) }), env, {});
  assert.equal((await send({ event: '4', registered: 1500 })).status, 200);
  assert.equal((await send({ event: '1', registered: null })).status, 200);
  assert.equal((await send({ event: '2', registered: -3 })).status, 400);
  assert.deepEqual((await find('min=1&sort=athletes')).map((e) => [e.event, e.registered]), [['4', 1500]]);
  // The same count sent a day after it was read stamps the read, so the crawler leaves it; within the day it writes nothing.
  db.prepare("UPDATE events SET sized = 1 WHERE event = '4'").run();
  await send({ event: '4', registered: 1500 });
  const sized = db.prepare("SELECT sized FROM events WHERE site = 'smoothcomp.com' AND event = '4'").get().sized;
  assert.ok(sized > Date.now() - 60e3);
  await send({ event: '4', registered: 1500 });
  assert.equal(db.prepare("SELECT sized FROM events WHERE site = 'smoothcomp.com' AND event = '4'").get().sized, sized);
  assert.deepEqual(await find('when=past'), []);
  // An academy sits where it competes most, and a radius finds it.
  const post = (path, body) => posted(worker, env, path, body);
  await post('/record', { site: 'smoothcomp.com', event: '1', records: { 11: [3, 0], 12: [1, 2] }, meta: { title: 'Potsdam Open', start: `${day(10)}T09:00:00Z` }, athletes, read: Date.now() });
  const near = async (q) => (await (await API.teams(env, new URLSearchParams(`site=smoothcomp.com&athletes=1&${q}`))).json()).rows;
  assert.deepEqual((await near('near=52.52,13.40&km=50')).map((t) => [t.club_id, t.city, Math.round(t.km)]), [['501', 'Potsdam', 27], ['502', 'Potsdam', 27]]);
  assert.deepEqual(await near('near=48.14,11.58&km=100'), []);
  // Places to search from are the cities events are held in.
  const places = await (await API.places({ ...env, GEOCODER: '' }, new URLSearchParams('q=pots'))).json();
  assert.deepEqual(places.rows.map((p) => [p.city, p.events]), [['Potsdam', 1]]);
});

test('the place search lists towns once, names that start with the search first, then the biggest', async () => {
  const { API } = await import('../server/stats.js');
  const town = (id, name, admin1, country_code, population, feature_code = 'PPL') => ({ id, name, admin1, country_code, population, feature_code, latitude: 0, longitude: 0 });
  const answers = {
    en: [town(1, 'Chiang Mai', 'Chiang Mai', 'TH', 127240, 'PPLA'), town(2, 'Yangzhou', 'Jiangsu', 'CN', 4559797), town(3, 'Bâ', 'North Province', 'NC', null, 'PK'),
      town(4, 'Bâ', 'North Province', 'NC', null), town(5, 'Bâ', 'North Province', 'NC', null), town(6, 'Bangko', 'North Sumatra', 'ID', null)],
    de: [town(6, 'Bangko', 'Sumatera Utara', 'ID', null), town(7, 'Chiang Rai', 'Chiang Rai', 'TH', 78756, 'PPLA')],
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json({ results: answers[new URL(url).searchParams.get('language')] });
  try {
    const rows = (await (await API.places({}, new URLSearchParams('q=chiang&lang=de'))).json()).rows;
    // The peak goes, the second Bâ looks the same as the first, and Bangko is one town in two languages.
    assert.deepEqual(rows.map((p) => p.city), ['Chiang Mai', 'Chiang Rai', 'Yangzhou', 'Bâ', 'Bangko']);
  } finally { globalThis.fetch = real; }
});

test('the daily listing walks older events a few pages a day, from where it left off, until the database nears full', async () => {
  const { listEvents } = await import('../server/crawl.js');
  const { DB } = d1();
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  // Smoothcomp's past pages: 1–3 this year, 4–60 from 2020, none after; AJP Tour lists nothing.
  const page = (p) => (p <= 3 ? [day(-p)] : p <= 60 ? ['2020-01-01'] : []).map((start, i) => ({ id: p * 100 + i, title: `E${p}`, startdate: start }));
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const p = Number(new URL(url).searchParams.get('page'));
    if (url.includes('smoothcomp') && p) asked.push(p);
    return new Response(`<script>\nvar events = ${JSON.stringify(url.includes('smoothcomp') && p ? page(p) : [])}\n</script>`);
  };
  const listedPages = async () => (await DB.prepare("SELECT DISTINCT event / 100 AS p FROM events WHERE site = 'smoothcomp.com' ORDER BY p").all()).results.map((r) => r.p);
  try {
    // The year's pages, then 24 from its last batch.
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), Array.from({ length: 24 }, (_, i) => i + 1));
    // The next day picks up where it stopped, and the end of the list holds it there.
    await listEvents({ DB });
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), Array.from({ length: 60 }, (_, i) => i + 1));
    assert.equal(await DB.prepare("SELECT v FROM meta WHERE k = 'archive:smoothcomp.com'").first('v'), 61);
    // Past 9 GB the walk stops at the year.
    asked.length = 0;
    const full = { ...DB, prepare: (sql) => { const s = DB.prepare(sql); return { ...s, bind: (...v) => ({ ...s.bind(...v), run: async () => ({ meta: { size_after: 9.5e9 } }) }) }; } };
    await listEvents({ DB: full });
    assert.deepEqual(asked, [1, 2, 3, 4]);
  } finally { globalThis.fetch = real; }
});

test("an academy's own page places it, over where it competes most", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { clubPlace, PLACED } = await import('../server/crawl.js');
  const { DB, db } = d1();
  const env = { DB };
  const page = (profile) => `<div data-profile="${JSON.stringify(profile).replaceAll('"', '&quot;')}"></div>`;
  assert.deepEqual(clubPlace(page({ id: 501, city: 'München', country_code: 'DE', address: 'Boschetsrieder Str. 60', location_lat: 48.1001095, location_long: 11.530871 })),
    { lat: 48.1001095, lng: 11.530871, city: 'München', country: 'DE', address: 'Boschetsrieder Str. 60' });
  assert.deepEqual(clubPlace(page({ id: 7, city: null, location_lat: null, location_long: null })), { lat: null, lng: null, city: null, country: null, address: null });
  assert.equal(clubPlace('<title>403 - not allowed</title>'), null);
  // Its athletes competed in Berlin, but its page pins it in Munich.
  const day = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const post = (path, body) => posted(worker, env, path, body);
  await post('/record', { site: 'smoothcomp.com', event: '9', records: { 11: [3, 0], 12: [1, 2] }, meta: { title: 'Berlin Open', start: `${day}T09:00:00Z`, city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.4 }, athletes, read: Date.now() });
  const near = async (q) => (await (await API.teams(env, new URLSearchParams(`site=smoothcomp.com&athletes=1&${q}`))).json()).rows.map((t) => [t.club_id, t.city, t.placed]);
  assert.deepEqual(await near('near=52.52,13.40&km=50'), [['501', 'Berlin', 'events'], ['502', 'Berlin', 'events']]);
  await DB.prepare(PLACED).bind(Date.now(), JSON.stringify([{ site: 'smoothcomp.com', club_id: '501', lat: 48.1, lng: 11.53, city: 'München', country: 'DE', source: 'pin' }, { site: 'smoothcomp.com', club_id: '502', source: null }])).run();
  assert.deepEqual(await near('near=52.52,13.40&km=50'), [['502', 'Berlin', 'events']]);
  assert.deepEqual(await near('near=48.14,11.58&km=50'), [['501', 'München', 'pin']]);
  // A browser opening the academy reads its page the same way (site lib/smoothcomp.ts placeClub); the academy says when.
  const placed = async () => (await (await API.team(env, new URLSearchParams('site=smoothcomp.com&id=502'))).json()).club.placed;
  const before = await placed();
  assert.equal((await post('/place', { site: 'smoothcomp.com', club: '502', place: 'x' })).status, 400);
  db.prepare("UPDATE club_places SET checked = 1 WHERE club_id = '502'").run(); // read over half a year ago
  assert.equal((await post('/place', { site: 'smoothcomp.com', club: '502', place: clubPlace(page({ city: 'Potsdam', country_code: 'DE', location_lat: 52.4, location_long: 13.06 })) })).status, 200);
  assert.deepEqual(await near('near=52.4,13.06&km=10'), [['502', 'Potsdam', 'pin']]);
  assert.ok((await placed()) >= before);
  // Read within half a year, it stands: a page read later changes nothing.
  assert.equal((await post('/place', { site: 'smoothcomp.com', club: '502', place: null })).status, 200);
  assert.deepEqual(await near('near=52.4,13.06&km=10'), [['502', 'Potsdam', 'pin']]);
  // Older, a private page (none) counts as read.
  db.prepare("UPDATE club_places SET checked = 1 WHERE club_id = '502'").run();
  assert.equal((await post('/place', { site: 'smoothcomp.com', club: '502', place: null })).status, 200);
  assert.deepEqual(await near('near=52.52,13.40&km=50'), [['502', 'Berlin', 'events']]);
});

test('Google Maps places an academy whose page names no place, only on a matching name nearby', async () => {
  const { sameAcademy, pickPlace, findClubs, lookable } = await import('../server/crawl.js');
  // Placeholders aren't looked for.
  assert.deepEqual(['(No academy)', 'Independent No club', 'BJJ Team', 'n/a', 'Fightzone Berlin'].map(lookable), [false, false, false, false, true]);
  assert.equal(sameAcademy('POUND FOR POUND TEAM', 'Pound for Pound Team München', 'Berlin'), true);
  assert.equal(sameAcademy('Berlin BJJ', 'Berlin Boxing Club', 'Berlin'), false); // the town and "BJJ" say nothing
  assert.equal(sameAcademy('Fightzone Berlin', 'FIGHTZONE e.V.', 'Berlin'), true);
  assert.equal(sameAcademy('GFTeam Berlin', 'GF Team Berlin', 'Berlin'), true); // run together
  assert.equal(sameAcademy('GF Berlin', 'Bergfried Gym', 'Berlin'), false); // too short to look inside
  const at = (name, latitude, longitude, locality, country = 'DE') => ({ displayName: { text: name }, location: { latitude, longitude }, formattedAddress: `${name}, ${locality}`,
    addressComponents: [{ longText: locality, types: ['locality', 'political'] }, { longText: country, shortText: country, types: ['country', 'political'] }] });
  const club = { club: 'Gracie Barra Berlin', city: 'Berlin', lat: 52.52, lng: 13.4, country: 'DE' };
  // Hamburg's branch shares the name but lies 255 km off; Berlin's is taken.
  assert.deepEqual(pickPlace(club, [at('Gracie Barra Hamburg', 53.55, 9.99, 'Hamburg'), at('Gracie Barra Berlin Mitte', 52.53, 13.41, 'Berlin')]),
    { lat: 52.53, lng: 13.41, city: 'Berlin', address: 'Gracie Barra Berlin Mitte, Berlin' });
  assert.equal(pickPlace(club, [at('Kingdom Boxing', 52.5, 13.4, 'Berlin')]), null);
  assert.equal(pickPlace(club, [at('Gracie Barra Hamburg', 53.55, 9.99, 'Hamburg')]), null); // far, and "Berlin" isn't in its name
  // A team that travels: its athletes compete in Berlin, but every word of its name is in a Munich gym's, in its country.
  const travels = { club: 'POUND FOR POUND TEAM', city: 'Berlin', lat: 52.52, lng: 13.4, country: 'DE' };
  assert.equal(pickPlace(travels, [at('Pound for Pound Team', 48.1, 11.53, 'München')]).city, 'München');
  assert.equal(pickPlace(travels, [at('Pound for Pound Team', 40.7, -74, 'New York', 'US')]), null);
  // The whole step, with Google answered here.
  const { DB, db } = d1();
  db.exec(`INSERT INTO clubs (site, club_id, club, entered, lat, lng, city, country) VALUES ('smoothcomp.com', '5879', 'POUND FOR POUND TEAM', 104, 52.52, 13.4, 'Berlin', 'DE');
    INSERT INTO club_places (site, club_id, source, checked) VALUES ('smoothcomp.com', '5879', NULL, 1);`);
  assert.equal(await findClubs({ DB }), 0); // no key, no lookup
  const real = globalThis.fetch;
  let asked;
  globalThis.fetch = async (url, init) => { asked = JSON.parse(init.body); return Response.json({ places: [at('Pound for Pound Team', 48.1, 11.53, 'München')] }); };
  try { assert.equal(await findClubs({ DB, GOOGLE_MAPS_KEY: 'k' }), 1); } finally { globalThis.fetch = real; }
  assert.equal(asked.textQuery, 'POUND FOR POUND TEAM');
  assert.deepEqual(asked.locationBias.circle.center, { latitude: 52.52, longitude: 13.4 });
  assert.deepEqual({ ...db.prepare("SELECT source, city, google IS NOT NULL AS asked FROM club_places WHERE club_id = '5879'").get() }, { source: 'google', city: 'München', asked: 1 });
  assert.equal(await findClubs({ DB, GOOGLE_MAPS_KEY: 'k' }), 0); // asked once
});

test("an event a visitor's browser reads goes in as the crawler's read would: read again while on, then replaced by the crawler's", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { addBouts, record } = await import('../server/worker.js');
  const { crawl } = await import('../server/crawl.js');
  const { scheduleOf, knownSides, nameSides, eventResults } = globalThis.SCWRRules;
  const { DB, db } = d1();
  const env = { DB };
  const today = new Date().toISOString().slice(0, 10);
  // Smoothcomp's schedule: the final done, a semifinal still to fight.
  const seat = (reg, name, win) => ({ type: 'registration', event_registration_id: reg, name, isWinner: win });
  const semi = { id: 71, group: 'Adult / Blue / -82 kg', name: 'Semifinals', state: 'pending', seats: [seat(3, 'Al Ray', false), seat(4, 'Cy Day', false)] };
  const answers = {
    'matcategories.json': [{ id: 1 }], 'mats.json/1': [{ id: 7, estimated_end: `${today}T18:00:00Z` }],
    'mat/7/matches.json': [{ id: 70, group: 'Adult / Blue / -76 kg', name: 'Final', state: 'finished', wonBy: 'submission_armbar', seats: [seat(1, 'Kim Lee', true), seat(2, 'Bo Sun', false)] }, semi],
    'getBracketMatchData/70': { left: { id: 11, first_name: 'Kim', last_name: 'Lee', score: 2 }, right: { id: 12, first_name: 'Bo', last_name: 'Sun' }, matchInfo: { time: '3:12', timeRemaining: 108000 } },
    'getBracketMatchData/71': { left: { id: 13, first_name: 'Al', last_name: 'Ray' }, right: { id: 14, first_name: 'Cy', last_name: 'Day' }, matchInfo: {} },
  };
  const get = async (url) => answers[Object.keys(answers).find((k) => String(url).endsWith(k))];
  // The browser's read (site read-now.tsx): the schedule, every card at once, the results to /record.
  const data = { ...scheduleOf([await get('mats.json/1')].flat(), [await get('mat/7/matches.json')]), users: {}, tried: [] };
  assert.equal(data.over, false);
  await nameSides(data, () => Infinity, (matches) => Promise.all(matches.map((m) => get(`getBracketMatchData/${m[0]}`))));
  const { athletes, records } = eventResults(data, today);
  const post = (body) => worker.fetch(new Request('https://matstats.test/record', { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: () => {} });
  const now = Date.now();
  assert.equal((await post({ site: 'smoothcomp.com', event: '950', records, athletes, read: now, asked: true, on: !data.over, meta: { title: 'Today Open', start: `${today}T00:00:00.000Z` } })).status, 200);
  const places = () => db.prepare("SELECT user, place FROM entries WHERE event = '950' AND fought = 1 ORDER BY user").all().map((r) => [r.user, r.place]);
  assert.deepEqual(places(), [['11', 1], ['12', 2], ['13', null], ['14', null]]);
  // Each match keeps its id and the score its card gave.
  assert.deepEqual(JSON.parse(db.prepare("SELECT bouts FROM entries WHERE event = '950' AND user = '11'").get().bouts)[0], { won: true, type: 'submission', how: 'Submission (armbar)', opponent: 'Bo Sun', user: '12', club: null, stage: 'Final', match: 70, us: [2, 0, 0], them: [0, 0, 0], clock: [192, 108] });
  // Still on: queued to be read again in six hours, as the crawler would have it.
  const row = db.prepare("SELECT state, next, wrote FROM crawls WHERE event = '950'").get();
  assert.equal(row.state, 'queued');
  assert.ok(row.next > now + 5 * 3600e3 && row.wrote >= now);
  // Six hours on, the semifinal fought: the crawler's read replaces the browser's, the event done.
  Object.assign(semi, { state: 'finished', wonBy: 'points', seats: [seat(3, 'Al Ray', true), seat(4, 'Cy Day', false)] });
  db.prepare("UPDATE crawls SET next = 0 WHERE event = '950'").run();
  await DB.prepare("INSERT INTO meta (k, v) VALUES ('budget', ?1)").bind(JSON.stringify({ at: now, written: 0, writtenToday: 0 })).run();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { const body = await get(url); return body ? Response.json(body) : new Response('', { status: 404 }); };
  try { await crawl(env, record, addBouts, 5000); } finally { globalThis.fetch = real; }
  assert.deepEqual(places(), [['11', 1], ['12', 2], ['13', null], ['14', 3]]);
  assert.equal(db.prepare("SELECT state FROM crawls WHERE event = '950'").get().state, 'done');
  // Read again: the matches Mat Stats keeps name every side (stats.js known), so no card is read, and the scores stand.
  const { API } = await import('../server/stats.js');
  const known = await (await API.known(env, new URLSearchParams('site=smoothcomp.com&id=950'))).json();
  const again = { ...scheduleOf([await get('mats.json/1')].flat(), [await get('mat/7/matches.json')]), users: {}, tried: [] };
  knownSides(again, known);
  const cards = [];
  await nameSides(again, () => Infinity, async (matches) => (cards.push(...matches), []));
  assert.deepEqual(cards, []);
  // The same results as reading every card.
  const fresh = { ...scheduleOf([await get('mats.json/1')].flat(), [await get('mat/7/matches.json')]), users: {}, tried: [] };
  await nameSides(fresh, () => Infinity, (matches) => Promise.all(matches.map((m) => get(`getBracketMatchData/${m[0]}`))));
  const second = eventResults(again, today), first = eventResults(fresh, today);
  const placed = (r) => Object.fromEntries(Object.entries(r.athletes).map(([id, a]) => [id, a.entries.map((e) => [e.division, e.place, e.wins, e.losses])]));
  assert.deepEqual([second.records, placed(second)], [first.records, placed(first)]);
  assert.deepEqual(Object.keys(second.athletes).sort(), ['11', '12', '13', '14']);
  assert.deepEqual(second.athletes[12].entries[0].bouts[0], { won: false, type: 'submission_armbar', opponent: 'Kim Lee', user: '11', club: null, stage: 'Final', bracket: null, match: 70, us: [0, 0, 0], them: [2, 0, 0], clock: [192, 108] });
});

test("an event's scores a browser read fill its stored matches that have none, each side's its own, in its own division", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { DB, db } = d1();
  const env = { DB };
  const post = (body) => worker.fetch(new Request('https://matstats.test/scores', { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: () => {} });
  const bouts = (list) => JSON.stringify(list.map(([won, type, user, stage, extra]) => ({ won, type, opponent: 'x', user, stage, ...extra })));
  const row = db.prepare("INSERT INTO entries (site, event, user, division, fought, at, bouts) VALUES ('smoothcomp.com', '960', ?, 'Adult / Blue', 1, 0, ?)");
  row.run('11', bouts([[true, 'submission', '12', 'Match 1/3'], [false, 'walkover', '13', 'Match 3/3'], [true, 'points', '14', 'Final', { us: [2, 0, 0], them: [0, 0, 0] }]]));
  row.run('12', bouts([[false, 'submission', '11', 'Match 1/3']]));
  // One kept without its round takes the only match the two fought there.
  row.run('15', bouts([[false, 'points', '11', '']]));
  // The same two met in the same round of another division: that match is its own.
  db.prepare("INSERT INTO entries (site, event, user, division, fought, at, bouts) VALUES ('smoothcomp.com', '960', '11', 'No Gi / Blue', 1, 0, ?)").run(bouts([[true, 'points', '12', 'Match 1/3']]));
  const matches = [
    { stage: 'Match 1/3', group: 'Adult / Blue', users: ['12', '11'], s: [[0, 0, 0], [4, 1, 0]], clock: [148, 151] },
    { stage: 'Match 3/3', users: ['11', '13'], s: [[0, 0, 0], [0, 0, 0]], clock: [0, 300] },
    { stage: 'Final', users: ['11', '14'], s: [[9, 0, 0], [0, 0, 0]], clock: [300, 0] },
    { stage: 'Semifinals', group: 'Adult / Blue', users: ['11', '15'], s: [[3, 0, 0], [1, 0, 0]], clock: [300, 0] },
  ];
  assert.equal((await post({ site: 'smoothcomp.com', event: '960', matches: [{ stage: 'x', users: ['a', 'b'], s: [] }] })).status, 400);
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '960', matches })).json(), { filled: 3, kept: 0 });
  const read = (user, division = 'Adult / Blue') => JSON.parse(db.prepare("SELECT bouts FROM entries WHERE user = ? AND division = ?").get(user, division).bouts).map((b) => [b.us, b.them, b.clock]);
  // A walkover keeps none, a match already scored keeps its own.
  assert.deepEqual(read('11'), [[[4, 1, 0], [0, 0, 0], [148, 151]], [undefined, undefined, undefined], [[2, 0, 0], [0, 0, 0], undefined]]);
  assert.deepEqual(read('12'), [[[0, 0, 0], [4, 1, 0], [148, 151]]]);
  assert.deepEqual(read('15'), [[[1, 0, 0], [3, 0, 0], [300, 0]]]);
  assert.deepEqual(read('11', 'No Gi / Blue'), [[undefined, undefined, undefined]]);
  // An athlete's profile asks for their matches with a score read (worker.js scored).
  const scored = async (user) => (await (await worker.fetch(new Request('https://matstats.test/scored', { method: 'POST', body: JSON.stringify({ site: 'smoothcomp.com', user }) }), env, { waitUntil: () => {} })).json()).matches;
  assert.deepEqual((await scored('12')).map((m) => [m.event, m.division, m.won, m.opponent, m.stage, m.us, m.them]), [[960, 'Adult / Blue', false, 'x', 'Match 1/3', [0, 0, 0], [4, 1, 0]]]);
  // A card sent with its match id is kept by it even for an event with no results read (no round needed), and comes
  // back to either side's profile when asked for, theirs first.
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '961', matches: [{ match: 7001, stage: null, users: ['21', '22'], s: [[6, 0, 1], [2, 0, 0]], clock: [119, 181] }] })).json(), { filled: 0, kept: 1 });
  const card = async (user) => (await (await worker.fetch(new Request('https://matstats.test/scored', { method: 'POST', body: JSON.stringify({ site: 'smoothcomp.com', user, matches: [7001, 7002] }) }), env, { waitUntil: () => {} })).json()).matches;
  assert.deepEqual(await card('22'), [{ match: 7001, us: [2, 0, 0], them: [6, 0, 1] }]);
  assert.deepEqual(await card('99'), []);
  // A card already kept isn't overwritten by a later upload.
  await post({ site: 'smoothcomp.com', event: '961', matches: [{ match: 7001, stage: null, users: ['21', '22'], s: [[0, 0, 0], [99, 0, 0]], clock: null }] });
  assert.deepEqual(await card('22'), [{ match: 7001, us: [2, 0, 0], them: [6, 0, 1] }]);
  // Sent again, nothing is left to fill.
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '960', matches })).json(), { filled: 0, kept: 0 });
});

test("search finds both sites' athletes, academies and events, one person's accounts once", async () => {
  const { API } = await import('../server/stats.js');
  const { DB, db } = d1();
  const person = db.prepare('INSERT INTO people (site, user, name, club, club_id, country, born, seen, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)');
  // The same person on both sites, someone of the same name born another year, and two sites' academies sharing an id.
  person.run('ajptour.com', '7', 'Ana  Silva', 'Silva Team', '40', 'br', 1990, '2026-01-01');
  person.run('smoothcomp.com', '7', 'Ana Silva', 'Silva BJJ', '40', 'br', 1990, '2025-01-01');
  person.run('smoothcomp.com', '8', 'Ana Silva', 'Other', '41', 'br', 1999, '2024-01-01');
  db.prepare("INSERT INTO events (site, event, title, start, at) VALUES ('ajptour.com', '3', 'Silva Cup', '2026-05-01', 0)").run();
  const found = async (site) => (await API.search({ DB }, new URLSearchParams({ site, q: 'silva' }))).json();
  const sc = await found('smoothcomp.com');
  assert.deepEqual(sc.athletes.map((a) => [a.site, a.user]), [['smoothcomp.com', '7'], ['smoothcomp.com', '8']]);
  assert.deepEqual(sc.teams.map((t) => [t.site, t.club_id]).sort(), [['ajptour.com', '40'], ['smoothcomp.com', '40']]);
  assert.deepEqual(sc.events.map((e) => [e.site, e.event]), [['ajptour.com', '3']]);
  // On AJP, the person is their AJP account.
  assert.deepEqual((await found('ajptour.com')).athletes.map((a) => [a.site, a.user]), [['ajptour.com', '7'], ['smoothcomp.com', '8']]);
});

test("an event a profile couldn't read comes from the crawled results: a bracket of one is theirs, an event with no result of theirs isn't", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { DB, db } = d1();
  const post = (path, body) => posted(worker, { DB }, path, body);
  db.exec(`INSERT INTO crawls (site, event, state, at) VALUES ('smoothcomp.com', '901', 'done', 0), ('smoothcomp.com', '902', 'done', 0);
    INSERT INTO entries (site, event, user, division, place, wins, losses, fought, at, bouts) VALUES ('smoothcomp.com', '901', '7', 'Adult / Blue / -76 kg', 1, '{}', '{}', 1, 0, '[]');
    INSERT INTO history (site, user, event, start, wins, gold, at) VALUES ('smoothcomp.com', '7', '902', '2026-10-01', 0, 0, 0);`);
  const { events } = await (await post('/crawled', { site: 'smoothcomp.com', user: '7', events: [901, 902] })).json();
  // Gold in a bracket of one, its history row not read yet: no match, and theirs all the same.
  assert.deepEqual(events.map((e) => [e.id, e.out.absent ?? false]).sort(), [[901, false], [902, true]]);
});

test('the crawler queues BJJ events alone, and those no events list names a sport for', async () => {
  const { queue } = await import('../server/crawl.js');
  const { DB, db } = d1();
  const event = db.prepare("INSERT INTO events (site, event, title, start, sports, at) VALUES ('smoothcomp.com', ?, 'Open', '2026-01-10', ?, 0)");
  event.run('1', '["1","7"]'); event.run('2', '["26"]'); event.run('3', '["19","3"]');
  db.exec("INSERT INTO history (site, user, event, title, start, at) VALUES ('smoothcomp.com', '11', '4', 'Open', '2026-01-10', 0)");
  // One queued before the rule, judo: taken off.
  db.exec("INSERT INTO events (site, event, title, start, sports, at) VALUES ('smoothcomp.com', '5', 'Judo', '2026-01-10', '[\"26\"]', 0)");
  db.exec("INSERT INTO crawls (site, event, state, start, next, at) VALUES ('smoothcomp.com', '5', 'queued', '2026-01-10', 0, 0)");
  await queue({ DB });
  assert.deepEqual(db.prepare('SELECT event FROM crawls ORDER BY event').all().map((r) => r.event), ['1', '3', '4']);
});

test("what was kept of an event that isn't BJJ goes, and whoever is left with nothing is forgotten", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { purge } = await import('../server/worker.js');
  const { API } = await import('../server/stats.js');
  const { DB, db } = d1();
  const env = { DB };
  const post = (path, body) => posted(worker, env, path, body);
  const site = 'smoothcomp.com', read = Date.now();
  const entered = (who, entry) => ({ ...athletes[who], entries: [entry] });
  await post('/record', { site, event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read });
  await post('/record', { site, event: '901', records: { 11: [1, 1], 13: [2, 0] }, meta: { ...meta, title: 'Judo Cup' }, read, athletes: {
    11: entered(11, { division: 'Adult / -73 kg', place: 2, wins: { points: 1 }, losses: { points: 1 } }),
    13: { name: 'Jo Do', club: 'Judo Club', clubId: '503', entries: [{ division: 'Adult / -73 kg', place: 1, wins: { points: 2 }, losses: {} }] } } });
  await post('/record', { site, event: '902', records: { 12: [1, 0] }, meta: { ...meta, title: 'AIGA Grappling Series' }, read,
    athletes: { 12: entered(12, { division: 'Adult / -76 kg', place: 1, wins: { submission: 1 }, losses: {} }) } });
  // Ju-Jitsu events: one with a No-Gi division, one with fighting alone.
  await post('/record', { site, event: '903', records: { 12: [1, 0] }, meta: { ...meta, title: 'Astana Tour' }, read,
    athletes: { 12: entered(12, { division: 'MALE NO GI / (+18 years) / -62 kg', place: 1, wins: { submission: 1 }, losses: {} }) } });
  await post('/record', { site, event: '904', records: { 13: [1, 0] }, meta: { ...meta, title: 'National Ju-Jitsu Tour' }, read,
    athletes: { 13: { name: 'Jo Do', club: 'Judo Club', clubId: '503', entries: [{ division: 'MALE/FIGHTING / -62 kg', place: 1, wins: { points: 1 }, losses: {} }] } } });
  db.exec(`UPDATE events SET sports = '["1"]' WHERE event = '900'; UPDATE events SET sports = '["26"]' WHERE event = '901'; UPDATE events SET sports = '["32"]' WHERE event = '902';
    UPDATE events SET sports = '["2"]' WHERE event IN ('903', '904')`);
  const ranked = async () => (await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json()).rows.map((r) => [r.user, r.wins]).sort();
  assert.deepEqual(await ranked(), [['11', 4], ['12', 3], ['13', 3]]);
  // The judo goes, and the Ju-Jitsu event with no BJJ division; the grappling event its title calls BJJ stays, and the
  // Ju-Jitsu event with a No-Gi division, as does all of the BJJ event.
  // A run cut short after the deletion leaves who's to recount, and the next run finishes it.
  const real = DB.prepare;
  let cut = true;
  env.DB = { ...DB, prepare: (sql) => (cut && sql.startsWith('DELETE FROM people') ? { bind: () => ({ run: async () => { throw new Error('overloaded'); } }) } : real(sql)) };
  await assert.rejects(purge(env));
  assert.ok(db.prepare("SELECT v FROM meta WHERE k = 'purge'").get());
  cut = false;
  assert.equal(await purge(env), 1);
  assert.equal(await purge(env), 1);
  assert.equal(await purge(env), 0);
  env.DB = DB;
  // With none left it rests an hour, then looks again.
  assert.ok(db.prepare("SELECT v FROM meta WHERE k = 'purge:idle'").get());
  assert.deepEqual(await ranked(), [['11', 3], ['12', 3]]);
  assert.deepEqual(db.prepare('SELECT DISTINCT event FROM entries ORDER BY event').all().map((r) => r.event), ['900', '902', '903']);
  assert.deepEqual(db.prepare('SELECT user FROM people ORDER BY user').all().map((r) => r.user), ['11', '12']);
  assert.deepEqual(db.prepare('SELECT club_id FROM clubs ORDER BY club_id').all().map((r) => r.club_id), ['501', '502']);
  assert.deepEqual({ ...db.prepare("SELECT athletes, fought FROM events WHERE event = '901'").get() }, { athletes: 0, fought: null });
});

test("results reach the rankings at the nightly rebuild, and an athlete's own page at once", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { rebuild } = await import('../server/worker.js');
  const { DB, db } = d1();
  const env = { DB };
  const fetch = (path, init) => worker.fetch(new Request(`https://matstats.test${path}`, init), env, { waitUntil: () => {} });
  await fetch('/record', { method: 'POST', body: JSON.stringify({ site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() }) });
  const ranked = () => db.prepare('SELECT user FROM board ORDER BY user').all().map((r) => r.user);
  // Their totals are counted, their ranking rows wait.
  assert.deepEqual(db.prepare('SELECT user FROM tallies WHERE changed IS NOT NULL ORDER BY user').all().map((r) => r.user), ['11', '12']);
  assert.deepEqual(ranked(), []);
  // Opening an athlete's page ranks them first (no stored copy: a Worker's cache, empty).
  globalThis.caches ??= { default: { match: async () => undefined, put: async () => {} } };
  await fetch('/api/athlete?site=smoothcomp.com&id=12');
  assert.deepEqual(ranked(), ['12']);
  // Ranked, they no longer wait: the next view and the rebuild leave them be.
  assert.equal(db.prepare("SELECT changed FROM tallies WHERE user = '12'").get().changed, 0);
  // The rebuild ranks the rest, then waits a day.
  await rebuild(env);
  assert.deepEqual(ranked(), ['11', '12']);
  assert.equal(JSON.parse(db.prepare("SELECT v FROM meta WHERE k = 'rank'").get().v).to, undefined);
  await DB.prepare("UPDATE tallies SET changed = ?1").bind(Date.now() + 1000).run();
  await DB.prepare("DELETE FROM board").run();
  await rebuild(env, Date.now() + 2000);
  assert.deepEqual(ranked(), []);
});

test('a slow or wasteful D1 query is told once in six hours; ANALYZE, schema changes and cheap queries never', async () => {
  const { slowQueries, SLOW } = await import('../server/crawler.js');
  const g = (query, rowsRead, queryDurationMs, count = 1) => ({ count, sum: { rowsRead: rowsRead * count }, avg: { rowsRead, queryDurationMs }, dimensions: { query } });
  const now = Date.parse('2026-11-28T12:00:00Z');
  const groups = [g('SELECT DISTINCT e.event FROM entries mine  JOIN people p', 5.6e6, 33e3), g('SELECT 1 FROM tiny', 10, 2, 900), g('ANALYZE people', 3e6, 1000), g('CREATE INDEX x ON entries (site)', 2e6, 2000), g('SELECT slow()', 10, 12e3)];
  const found = slowQueries(groups, {}, now);
  assert.deepEqual(found.map(([key]) => key), ['SELECT DISTINCT e.event FROM entries mine JOIN people p', 'SELECT slow()']);
  assert.match(found[0][1], /5,600,000 rows, 33\.0 s a run, ×1/);
  // Told an hour ago: quiet; seven hours ago: told again.
  assert.deepEqual(slowQueries(groups, Object.fromEntries(found.map(([key]) => [key, now - 3600e3])), now), []);
  assert.equal(slowQueries(groups, Object.fromEntries(found.map(([key]) => [key, now - 7 * 3600e3])), now).length, 2);
  // An hour reading past the day's share, paced by the hour, is told on its own.
  assert.deepEqual(slowQueries([g('SELECT cheap', 1000, 5, Math.ceil(SLOW.readHour / 1000) + 1)], {}, now).map(([key]) => key), ['hour']);
});

// Last: every statement the tests above ran, explained as D1 would plan it (plans.cjs).
test('no query walks a big table that fixtures/walks.json does not list', () => {
  const { unlisted, stale, statements } = plans.check();
  assert.ok(statements > 50, `only ${statements} statements recorded`);
  assert.deepEqual(unlisted.map(([stats, sql, walk]) => `${walk} (${stats})\n    in ${sql.slice(0, 400)}`), [], 'a query walks a big table: fix its plan (pin the join, use the index), or list it with WALKS=write');
  assert.deepEqual(stale, [], 'walks.json lists walks no query makes any more: rewrite it with WALKS=write');
});
