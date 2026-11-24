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
      bouts: [{ won: true, type: 'submission_armbar', opponent: 'Bo Sun', user: '12', stage: 'Final' }] }] },
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
  // The rankings count the results read, walkovers left out by default.
  const ranked = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json();
  assert.deepEqual(ranked.rows.map((r) => [r.user, r.wins, r.won, r.lost]), [['11', 3, 3, 0], ['12', 1, 1, 2]]);
  // An athlete with no win among the finishes counted still ranks on their losses there.
  const lossesOnly = await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com&off=walkover,points&sort=winRate&dir=asc'))).json();
  assert.deepEqual(lossesOnly.rows.map((r) => [r.user, r.wins, r.won, r.lost]), [['12', 0, 0, 2], ['11', 3, 3, 0]]);
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

test("an athlete's accounts with their name, birth year and country read as one", async () => {
  const worker = (await import('../server/worker.js')).default;
  const { API } = await import('../server/stats.js');
  const { DB } = d1();
  const env = { DB };
  const post = (path, body) => worker.fetch(new Request(`https://matstats.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env, {});
  await post('/record', { site: 'smoothcomp.com', event: '900', records: { 11: [3, 0], 12: [1, 2] }, meta, athletes, read: Date.now() });
  // AJP numbers its events and accounts apart: its event 900 is another event, and its Kim Lee in Germany someone else.
  const ajp = {
    77: { name: 'kim  LEE', club: 'Gamma', clubId: '7', country: 'NL', age: 30, entries: [{ division: 'Adult / Blue / -76 kg', place: 2, wins: { points: 2 }, losses: { submission: 1 } }] },
    78: { name: 'Kim Lee', club: 'Delta', clubId: '8', country: 'DE', age: 30, entries: [{ division: 'Adult / Blue / -76 kg', place: 1, wins: { points: 3 }, losses: {} }] },
  };
  await post('/record', { site: 'ajptour.com', event: '900', records: { 77: [2, 1], 78: [3, 0] }, meta, athletes: ajp, read: Date.now() });
  const one = await (await API.athlete(env, new URLSearchParams('site=smoothcomp.com&id=11'))).json();
  assert.deepEqual(one.accounts.map((a) => [a.site, a.user]), [['ajptour.com', '77']]);
  assert.deepEqual(one.entries.map((e) => [e.site, e.event, e.place]).sort(), [['ajptour.com', '900', 2], ['smoothcomp.com', '900', 1]]);
  assert.deepEqual([one.career.wins, one.career.won, one.career.lost, one.career.gold, one.career.silver], [5, 5, 1, 1, 1]);
  assert.equal(one.person.club, 'Alpha BJJ');
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
  }, read: Date.now() });
  const rows = (await (await API.athletes(env, new URLSearchParams('site=smoothcomp.com'))).json()).rows;
  assert.deepEqual(rows.map((r) => [r.user, r.belt]).sort(), [['21', 'brown'], ['22', 'white']]);
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

test('the daily listing walks older events a few pages a day, from where it left off, until the database nears full', async () => {
  const { listEvents } = await import('../server/crawl.js');
  const { DB } = d1();
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  // Smoothcomp's past pages: 1–3 this year, 4–150 from 2020, none after; AJP Tour lists nothing.
  const page = (p) => (p <= 3 ? [day(-p)] : p <= 150 ? ['2020-01-01'] : []).map((start, i) => ({ id: p * 100 + i, title: `E${p}`, startdate: start }));
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const p = Number(new URL(url).searchParams.get('page'));
    if (url.includes('smoothcomp') && p) asked.push(p);
    return new Response(`<script>\nvar events = ${JSON.stringify(url.includes('smoothcomp') && p ? page(p) : [])}\n</script>`);
  };
  const listedPages = async () => (await DB.prepare("SELECT DISTINCT event / 100 AS p FROM events WHERE site = 'smoothcomp.com' ORDER BY p").all()).results.map((r) => r.p);
  try {
    // The year's pages, then a hundred more from its last batch.
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), Array.from({ length: 100 }, (_, i) => i + 1));
    // The next day picks up where it stopped, and the end of the list holds it there.
    await listEvents({ DB });
    await listEvents({ DB });
    assert.deepEqual(await listedPages(), Array.from({ length: 150 }, (_, i) => i + 1));
    assert.equal(await DB.prepare("SELECT v FROM meta WHERE k = 'archive:smoothcomp.com'").first('v'), 151);
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
