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
  const looked = await (await post('/lookup', { site: 'smoothcomp.com', users: ['11', '12', '13'] })).json();
  assert.deepEqual(looked.records, { 11: { submission: [3, 0], walkover: [1, 0] }, 12: { points: [1, 0], submission: [0, 2] } });
});

test("a career read says whether a profile is hidden, over the events' flag", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { DB, db } = d1();
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), { DB }, {});
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
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
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
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
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
  // Through every merge and recount, each academy's kept totals (club_board, the default list) are what adding up its
  // athletes gives (?clubs= adds them up).
  for (const site of ['smoothcomp.com', 'ajptour.com']) {
    const list = async (q) => (await (await API.teams(env, new URLSearchParams(`site=${site}&athletes=1&${q}`))).json()).rows.map(({ total, ...t }) => t);
    const kept = await list('top=0');
    assert.ok(kept.length);
    assert.deepEqual(await list(`top=0&clubs=${kept.map((t) => t.club_id)}`), kept);
  }
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
  assert.equal(verdict({ written: 36e6, read: 5e9, writtenToday: 0, readToday: 0 }), 'slow');
  assert.equal(verdict({ written: 10e6, read: 23e9, writtenToday: 0, readToday: 0 }), 'stop');
  const { DB } = d1();
  const env = { DB };
  // No verdict yet: the background work rests; uploads go on.
  assert.equal(await budget(env), 'slow');
  await DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('budget', ?1)").bind(JSON.stringify({ state: 'stop', at: Date.now() })).run();
  assert.equal(await budget(env, Date.now(), true), 'stop');
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  assert.equal((await post('/record', { site: 'smoothcomp.com', event: '900', records: {}, meta, athletes, read: Date.now() })).status, 503);
  // Lookups still answer.
  assert.equal((await post('/lookup', { site: 'smoothcomp.com', users: ['11'] })).status, 200);
});

test("an athlete's belt is at least the lowest belt of every division they entered", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
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
  const { DB } = d1();
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
  assert.deepEqual(await find('when=past'), []);
  // An academy sits where it competes most, and a radius finds it.
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
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
  // Smoothcomp's past pages: 1–3 this year, 4–20 from 2020, none after; AJP Tour lists nothing.
  const page = (p) => (p <= 3 ? [day(-p)] : p <= 20 ? ['2020-01-01'] : []).map((start, i) => ({ id: p * 100 + i, title: `E${p}`, startdate: start }));
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const p = Number(new URL(url).searchParams.get('page'));
    if (url.includes('smoothcomp') && p) asked.push(p);
    return new Response(`<script>\nvar events = ${JSON.stringify(url.includes('smoothcomp') && p ? page(p) : [])}\n</script>`);
  };
  const listedPages = async () => (await DB.prepare("SELECT DISTINCT event / 100 AS p FROM events WHERE site = 'smoothcomp.com' ORDER BY p").all()).results.map((r) => r.p);
  try {
    // The year's pages, then eight more from its last batch.
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), [1, 2, 3, 4, 5, 6, 7, 8]);
    // The next day picks up where it stopped, and the end of the list holds it there.
    await listEvents({ DB });
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(await DB.prepare("SELECT v FROM meta WHERE k = 'archive:smoothcomp.com'").first('v'), 21);
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
  const { DB } = d1();
  const env = { DB };
  const page = (profile) => `<div data-profile="${JSON.stringify(profile).replaceAll('"', '&quot;')}"></div>`;
  assert.deepEqual(clubPlace(page({ id: 501, city: 'München', country_code: 'DE', address: 'Boschetsrieder Str. 60', location_lat: 48.1001095, location_long: 11.530871 })),
    { lat: 48.1001095, lng: 11.530871, city: 'München', country: 'DE', address: 'Boschetsrieder Str. 60' });
  assert.deepEqual(clubPlace(page({ id: 7, city: null, location_lat: null, location_long: null })), { lat: null, lng: null, city: null, country: null, address: null });
  assert.equal(clubPlace('<title>403 - not allowed</title>'), null);
  // Its athletes competed in Berlin, but its page pins it in Munich.
  const day = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  await post('/record', { site: 'smoothcomp.com', event: '9', records: { 11: [3, 0], 12: [1, 2] }, meta: { title: 'Berlin Open', start: `${day}T09:00:00Z`, city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.4 }, athletes, read: Date.now() });
  const near = async (q) => (await (await API.teams(env, new URLSearchParams(`site=smoothcomp.com&athletes=1&${q}`))).json()).rows.map((t) => [t.club_id, t.city, t.placed]);
  assert.deepEqual(await near('near=52.52,13.40&km=50'), [['501', 'Berlin', 'events'], ['502', 'Berlin', 'events']]);
  await DB.prepare(PLACED).bind(Date.now(), JSON.stringify([{ site: 'smoothcomp.com', club_id: '501', lat: 48.1, lng: 11.53, city: 'München', country: 'DE', source: 'pin' }, { site: 'smoothcomp.com', club_id: '502', source: null }])).run();
  assert.deepEqual(await near('near=52.52,13.40&km=50'), [['502', 'Berlin', 'events']]);
  assert.deepEqual(await near('near=48.14,11.58&km=50'), [['501', 'München', 'pin']]);
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

test('an event asked for on the site is read at once, past the crawler\'s day, while still on, and again later', async () => {
  const worker = (await import('../server/worker.js')).default;
  const { addBouts, record } = await import('../server/worker.js');
  const { crawl } = await import('../server/crawl.js');
  const { DB, db } = d1();
  const kicks = [];
  const env = { DB, CRAWL_KEY: 'k', CRAWLER: { fetch: async (url) => (kicks.push(url), new Response(null, { status: 204 })) } };
  const waits = [];
  const post = (body) => worker.fetch(new Request('https://matstats.test/read-now', { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: (p) => waits.push(p) });
  const today = new Date().toISOString().slice(0, 10);
  await DB.prepare("INSERT INTO events (site, event, title, start, at) VALUES ('smoothcomp.com', '950', 'Today Open', ?1, 0), ('smoothcomp.com', '951', 'Next Month Open', '2099-01-01', 0)").bind(today).run();
  // The crawler's day is spent.
  const now = Date.now();
  for (let i = 0; i < 300; i++) db.prepare("INSERT INTO crawls (site, event, state, at) VALUES ('smoothcomp.com', ?, 'done', ?)").run(`x${i}`, now);
  // Not started yet, or unknown: nothing to read.
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '951' })).json(), { events: [] });
  assert.equal((await post({ site: 'smoothcomp.com', event: 'nope' })).status, 400);
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '950' })).json(), { events: ['950'], found: 1 });
  assert.equal(kicks.length, 1);
  assert.match(kicks[0], /\/run\?for=20000$/);
  // Asked again: it is still waiting, so it stays at the front, but a lane is started at most once a minute.
  assert.deepEqual((await (await post({ site: 'smoothcomp.com', event: '950' })).json()).events, ['950']);
  assert.equal(kicks.length, 1);
  assert.deepEqual({ ...db.prepare("SELECT state, priority, next FROM crawls WHERE event = '950'").get() }, { state: 'queued', priority: 4, next: 0 });
  // Smoothcomp's schedule: the final done, a semifinal still to fight.
  const seat = (reg, name, win) => ({ type: 'registration', event_registration_id: reg, name, isWinner: win });
  const answers = {
    'matcategories.json': [{ id: 1 }], 'mats.json/1': [{ id: 7, estimated_end: `${today}T18:00:00Z` }],
    'mat/7/matches.json': [{ id: 70, group: 'Adult / Blue / -76 kg', name: 'Final', state: 'finished', wonBy: 'submission_armbar', seats: [seat(1, 'Kim Lee', true), seat(2, 'Bo Sun', false)] },
      { id: 71, group: 'Adult / Blue / -82 kg', name: 'Semifinal', state: 'pending', seats: [seat(3, 'Al Ray', false), seat(4, 'Cy Day', false)] }],
    'getBracketMatchData/70': { left: { id: 11, first_name: 'Kim', last_name: 'Lee' }, right: { id: 12, first_name: 'Bo', last_name: 'Sun' }, matchInfo: {} },
    'getBracketMatchData/71': { left: { id: 13, first_name: 'Al', last_name: 'Ray' }, right: { id: 14, first_name: 'Cy', last_name: 'Day' }, matchInfo: {} },
  };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = Object.keys(answers).find((k) => String(url).endsWith(k));
    return key ? Response.json(answers[key]) : new Response('', { status: 404 });
  };
  try { await crawl(env, record, addBouts, 5000); } finally { globalThis.fetch = real; }
  // Read as it stands, its row kept to read again in six hours, back in line.
  const entries = db.prepare("SELECT user, place FROM entries WHERE event = '950' AND fought = 1 ORDER BY user").all().map((r) => [r.user, r.place]);
  assert.deepEqual(entries, [['11', 1], ['12', 2], ['13', null], ['14', null]]);
  // Each match keeps its id, so its card can be read again later without the schedule.
  assert.equal(JSON.parse(db.prepare("SELECT bouts FROM entries WHERE event = '950' AND user = '11'").get().bouts)[0].match, 70);
  const row = db.prepare("SELECT state, priority, next, wrote FROM crawls WHERE event = '950'").get();
  assert.equal(row.state, 'queued');
  assert.equal(row.priority, 3);
  assert.ok(row.next > now + 5 * 3600e3 && row.wrote);
  // Just read: asking again within five minutes changes nothing.
  db.prepare("UPDATE crawls SET state = 'done', next = 0 WHERE event = '950'").run();
  assert.deepEqual(await (await post({ site: 'smoothcomp.com', event: '950' })).json(), { events: [], found: 1 });
  // An athlete's last events of the month, from what they entered.
  db.prepare("UPDATE crawls SET at = 0 WHERE event = '950'").run();
  assert.deepEqual((await (await post({ site: 'smoothcomp.com', user: '11' })).json()).events, ['950']);
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
