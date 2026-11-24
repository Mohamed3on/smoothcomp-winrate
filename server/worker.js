// The career cache every install shares. Installs keep what they read here and
// look up a whole event at once; each one cleans what it gets (career-cache.js),
// so the worker only bounds what it stores.
import '../rules.js';
import { API, BOARD, CLUBS, EVENT_COUNTS, MERGE, TALLY } from './stats.js';

const { BELTS, LABELS, finishOf, detailOf, beltOf } = globalThis.SCWRRules;

// Recounts these athletes' totals (stats.js TALLY) and rebuilds their ranking rows (BOARD), each summed with
// their person's other accounts (MERGE), a few hundred at a time, at most as many as an upload can store; one left with nothing to count loses its rows.
async function retally(env, site, users) {
  const all = [...new Set(users)].filter(validUser).slice(0, 5000);
  const statements = [];
  for (let i = 0; i < all.length; i += 400) {
    const some = JSON.stringify(all.slice(i, i + 400));
    statements.push(env.DB.prepare(TALLY).bind(site, some), env.DB.prepare(`DELETE FROM tallies WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2))
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = ?1 AND e.user = tallies.user AND e.fought = 1)
      AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.site = ?1 AND o.user = tallies.user) AND NOT EXISTS (SELECT 1 FROM history h WHERE h.site = ?1 AND h.user = tallies.user)`).bind(site, some),
      ...BOARD.map((sql) => env.DB.prepare(sql).bind(site, some, 0)), ...MERGE.map((sql) => env.DB.prepare(sql).bind(site, some)));
  }
  if (statements.length) await env.DB.batch(statements);
}

const KEPT = 30 * 24 * 60 * 60 * 1000; // the longest career-cache.js keeps anything
const SITES = ['smoothcomp.com', 'ajptour.com'];
const KINDS = ['careers', 'ranks'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
const validUser = user => /^\d{1,12}$/.test(user);

async function lookup(env, { site, users }) {
  if (!SITES.includes(site) || !Array.isArray(users) || users.length > 5000 || !users.every(u => typeof u === 'string' && validUser(u))) return json({ error: 'Bad lookup' }, 400);
  const { results } = await env.DB.prepare('SELECT user, kind, entry FROM athletes WHERE site = ?1 AND at > ?2 AND user IN (SELECT value FROM json_each(?3))')
    .bind(site, Date.now() - KEPT, JSON.stringify(users)).all();
  const kept = { careers: {}, ranks: {}, seen: {} };
  for (const row of results) kept[row.kind][row.user] = JSON.parse(row.entry);
  // A career kept without its event count takes the count of the event list kept beside it,
  // so no install reads the profile again just for that.
  const counts = await env.DB.prepare('SELECT user, count(*) AS events FROM history WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2)) GROUP BY user')
    .bind(site, JSON.stringify(Object.keys(kept.careers).filter((user) => kept.careers[user].wins && kept.careers[user].events == null))).all();
  for (const row of counts.results) kept.careers[row.user].events = row.events;
  // What results pages have shown of each athlete, event by event, walkovers aside.
  const seen = await env.DB.prepare('SELECT user, sum(wins) wins, sum(losses) losses, count(*) events FROM records WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2)) GROUP BY user')
    .bind(site, JSON.stringify(users)).all();
  for (const row of seen.results) kept.seen[row.user] = [row.wins, row.losses, row.events];
  // Each athlete's record by finish, [won, lost], as the stats site rates them (stats.js TALLY): a
  // participants page seeds its brackets by win rate.
  const rated = await env.DB.prepare('SELECT user, rec FROM tallies WHERE site = ?1 AND rec IS NOT NULL AND user IN (SELECT value FROM json_each(?2))')
    .bind(site, JSON.stringify(users)).all();
  kept.records = Object.fromEntries(rated.results.map((row) => [row.user, JSON.parse(row.rec)]));
  // When the latest event each athlete entered ended, so a career read before it is read again.
  // An event whose end no page has sent yet counts as over at its start.
  const over = 'coalesce(v.ends, unixepoch(v.start) * 1000)';
  const ended = await env.DB.prepare(`SELECT user, max(${over}) AS ended FROM entries e JOIN events v USING (site, event)
    WHERE e.site = ?1 AND user IN (SELECT value FROM json_each(?2)) AND ${over} <= ?3 GROUP BY user`)
    .bind(site, JSON.stringify(users), Date.now()).all();
  kept.ended = Object.fromEntries(ended.results.map((row) => [row.user, row.ended]));
  return json(kept);
}

async function keep(env, body) {
  if (!SITES.includes(body.site)) return json({ error: 'Bad site' }, 400);
  const rows = KINDS.flatMap(kind => Object.entries(body[kind] ?? {}).map(([user, entry]) => ({ user, kind, entry })))
    .filter(({ user, entry }) => validUser(user) && Number.isFinite(entry?.at) && entry.at <= Date.now() + 60000 && JSON.stringify(entry).length <= 1000);
  if (rows.length > 20000) return json({ error: 'Too many' }, 413);
  // One statement for the lot; an entry only replaces an older one.
  const { results: changed } = await env.DB.prepare(`INSERT INTO athletes (site, user, kind, at, entry)
    SELECT ?1, value ->> 'user', value ->> 'kind', value ->> '$.entry.at', value ->> 'entry' FROM json_each(?2) WHERE true
    ON CONFLICT (site, user, kind) DO UPDATE SET at = excluded.at, entry = excluded.entry WHERE excluded.at > athletes.at RETURNING user`)
    .bind(body.site, JSON.stringify(rows)).all();
  // A career or belt read changes their ranking row: only those that changed are recounted.
  await retally(env, body.site, changed.map((row) => row.user));
  return json({});
}

// What an event page shows of the event and of each athlete, for the public site.
// Strings are capped and finishes grouped by the rules (rules.js), so every source counts under the same switches.
const text = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);
// An athlete's matches in a division, in order: won or lost, the finish (grouped, with its detail),
// and who they met (name, user, academy) in which round.
const bouts = (list) => (Array.isArray(list) && list.length ? JSON.stringify(list.slice(0, 40).filter((b) => b && typeof b === 'object').map((b) => ({
  won: b.won === true, type: finishOf(b.type ?? ''), how: text(b.how, 60) ?? text(detailOf(b.type), 60), opponent: text(b.opponent, 120), user: validUser(String(b.user ?? '')) ? String(b.user) : null,
  club: text(b.club, 160), stage: text(b.stage, 60),
  // The score, theirs and their opponent's ([points, advantages, penalties]), and the clock ([length, left], seconds).
  ...(trio(b.us) && trio(b.them) ? { us: b.us, them: b.them } : {}),
  ...(Array.isArray(b.clock) && b.clock.length === 2 && b.clock.every((n) => n === null || (Number.isSafeInteger(n) && n >= 0 && n < 36000)) ? { clock: b.clock } : {}),
}))) : null);
const trio = (s) => Array.isArray(s) && s.length === 3 && s.every((n) => Number.isSafeInteger(n) && n >= -99 && n < 1000);
const tally = (bucket) => {
  const out = {};
  for (const [type, n] of Object.entries(bucket && typeof bucket === 'object' ? bucket : {})) {
    if (/^[\w -]{1,40}$/.test(type) && Number.isSafeInteger(n) && n > 0 && n < 100) out[finishOf(type)] = (out[finishOf(type)] ?? 0) + n;
  }
  return out;
};
// Photos only from the sites' own hosts.
const photo = (url) => (typeof url === 'string' && /^https:\/\/([\w-]+\.)*(smoothcomp\.com|ajptour\.com)\/[^\s"'<>]{1,300}$/.test(url) ? url : null);
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
const coord = (v, max) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
// When the page read what it sends: an upload read before the one kept is dropped, so a
// late arrival never undoes a newer read. Older installs send none and count as read now.
const readAt = (read, now = Date.now()) => (Number.isSafeInteger(read) && read > now - 60 * 60 * 1000 ? Math.min(read, now) : now);

// What an upload says, cleaned and bounded, with nothing written yet: the event (title, dates,
// place), who each athlete is, their divisions there (an event's upload) and the events their
// profile lists. Uploads are trusted; this only keeps them to the shapes the tables hold.
export function upload(event, meta, athletes, now = Date.now()) {
  if (!athletes || typeof athletes !== 'object') return null;
  // A date decides whose academy and photo win, so none from the future.
  const start = typeof meta?.start === 'string' && ISO.test(meta.start) && Date.parse(meta.start) < now + 366 * 24 * 60 * 60 * 1000 ? meta.start : null;
  const ends = typeof meta?.end === 'string' && ISO.test(meta.end) && Date.parse(meta.end) < now + 366 * 24 * 60 * 60 * 1000 ? Date.parse(meta.end) : null;
  const about = meta && typeof meta === 'object' ? { title: text(meta.title, 200), start, city: text(meta.city, 100), country: text(meta.country, 8), organiser: text(meta.organiser, 200), ends, lat: coord(meta.lat, 90), lng: coord(meta.lng, 180) } : null;
  const people = [];
  const entries = [];
  const history = {};
  // An age is as of the event, or as of now for a profile; kept as the year it implies.
  const year = new Date(start ?? now).getUTCFullYear();
  for (const [user, a] of Object.entries(athletes).slice(0, 5000)) {
    if (!validUser(user) || !a || typeof a !== 'object') continue;
    const hidden = typeof a.hidden === 'boolean' ? Number(a.hidden) : null;
    const club = text(a.club, 160);
    const clubId = /^\d{1,12}$/.test(a.clubId) ? a.clubId : null;
    people.push({ user, name: text(a.name, 120), club, clubId, affiliation: text(a.affiliation, 120), country: typeof a.country === 'string' && /^[a-z-]{2,8}$/i.test(a.country) ? a.country.toLowerCase() : null,
      countryName: text(a.countryName, 80), photo: photo(a.photo), belt: beltOf(a.belt), born: Number.isSafeInteger(a.age) && a.age > 2 && a.age < 100 ? year - a.age : null, hidden });
    // An install sends one athlete's list per career read, so a request carries a few lists at most.
    if (Array.isArray(a.history) && Object.keys(history).length < 20 && Object.values(history).flat().length + a.history.length <= 2000) history[user] = a.history.slice(0, 500).filter((e) => /^\d{1,9}$/.test(e?.event)).map((e) => ({
      event: e.event, title: text(e.title, 200), start: typeof e.start === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(e.start) ? e.start : null, city: text(e.city, 100),
      wins: Number.isSafeInteger(e.wins) && e.wins >= 0 && e.wins < 100 ? e.wins : null,
      medals: [0, 1, 2].map((i) => (Number.isSafeInteger(e.medals?.[i]) && e.medals[i] >= 0 && e.medals[i] < 20 ? e.medals[i] : 0)),
      image: photo(e.image),
    }));
    for (const e of (event && Array.isArray(a.entries) ? a.entries : []).slice(0, 20)) {
      const division = text(e?.division, 200);
      if (!division) continue;
      const place = Number.isSafeInteger(e.place) && e.place > 0 && e.place < 1000 ? e.place : null;
      entries.push({ user, division, club, clubId, place, wins: JSON.stringify(tally(e.wins)), losses: JSON.stringify(tally(e.losses)), bouts: bouts(e.bouts) });
    }
  }
  return { about, people, entries, history };
}

async function identify(env, site, event, meta, athletes, fought, read = Date.now()) {
  const now = Date.now();
  const said = upload(event, meta, athletes, now);
  if (!said) return;
  const { about, people, entries, history } = said;
  const start = about?.start ?? null;
  const statements = [];
  if (about) {
    statements.push(env.DB.prepare(`INSERT INTO events (site, event, title, start, city, country, organiser, at, ends, lat, lng) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT (site, event) DO UPDATE SET title = coalesce(excluded.title, title), start = coalesce(excluded.start, start), city = coalesce(excluded.city, city),
      country = coalesce(excluded.country, country), organiser = coalesce(excluded.organiser, organiser), at = excluded.at, ends = coalesce(excluded.ends, ends),
      lat = coalesce(excluded.lat, lat), lng = coalesce(excluded.lng, lng)`)
      .bind(site, event, about.title, about.start, about.city, about.country, about.organiser, now, about.ends, about.lat, about.lng));
  }
  // A newer event's academy, photo and name replace an older one's; an older event only fills gaps.
  const keep = (column) => `${column} = CASE WHEN excluded.seen >= people.seen THEN coalesce(excluded.${column}, people.${column}) ELSE coalesce(people.${column}, excluded.${column}) END`;
  statements.push(env.DB.prepare(`INSERT INTO people (site, user, name, club, club_id, affiliation, country, country_name, photo, belt, born, hidden, seen, at)
    SELECT ?1, value ->> 'user', value ->> 'name', value ->> 'club', value ->> 'clubId', value ->> 'affiliation', value ->> 'country', value ->> 'countryName', value ->> 'photo', value ->> 'belt', value ->> 'born', value ->> 'hidden', ?2, ?3 FROM json_each(?4) WHERE true
    ON CONFLICT (site, user) DO UPDATE SET ${['name', 'club', 'club_id', 'affiliation', 'country', 'country_name', 'photo', 'belt', 'born'].map(keep).join(', ')},
    hidden = coalesce(excluded.hidden, people.hidden), seen = max(people.seen, excluded.seen), at = excluded.at`)
    // A profile has no date: it fills gaps and never outranks an event.
    .bind(site, start ?? (event ? new Date(now).toISOString() : ''), now, JSON.stringify(people)));
  // A profile only says who the athlete is; an event also says who entered and how it went.
  // The registration list (fought = 0) and the results (fought = 1) are two layers, each
  // replaced whole by its own page's next read, so who entered survives while results arrive.
  // A results row outranks a registration row under the same athlete and division.
  if (event) {
    const layer = Number(fought);
    const newer = 'NOT EXISTS (SELECT 1 FROM entries WHERE site = ?1 AND event = ?2 AND fought = ?3 AND at > ?4)';
    statements.push(env.DB.prepare(`DELETE FROM entries WHERE site = ?1 AND event = ?2 AND fought = ?3 AND ${newer}`).bind(site, event, layer, read));
    statements.push(env.DB.prepare(`INSERT OR ${fought ? 'REPLACE' : 'IGNORE'} INTO entries (site, event, user, division, club, club_id, place, wins, losses, fought, at, bouts)
      SELECT ?1, ?2, value ->> 'user', value ->> 'division', value ->> 'club', value ->> 'clubId', value ->> 'place', value ->> 'wins', value ->> 'losses', ?3, ?4, value ->> 'bouts' FROM json_each(?5) WHERE ${newer}`)
      .bind(site, event, layer, read, JSON.stringify(entries)));
  }
  // An athlete's events join the ones kept: a career read sends its newest page, a
  // profile every page it read, and a past event never changes.
  for (const [user, rows] of Object.entries(history)) {
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO history (site, user, event, title, start, city, wins, gold, silver, bronze, at, image)
      SELECT ?1, ?2, value ->> 'event', value ->> 'title', value ->> 'start', value ->> 'city', value ->> 'wins', value ->> '$.medals[0]', value ->> '$.medals[1]', value ->> '$.medals[2]', ?3,
        coalesce(value ->> 'image', (SELECT image FROM history h WHERE h.site = ?1 AND h.user = ?2 AND h.event = value ->> 'event')) FROM json_each(?4)`)
      .bind(site, user, now, JSON.stringify(rows)));
  }
  await env.DB.batch(statements);
}

// Who an athlete is, from the profile page an install read their career from.
async function people(env, { site, athletes }) {
  if (!SITES.includes(site)) return json({ error: 'Bad people' }, 400);
  await identify(env, site, null, null, athletes, false);
  // An event list read changes how many events they have and when they last fought; a profile, who they are.
  await retally(env, site, Object.keys(athletes ?? {}).slice(0, 20));
  return json({});
}

// After an event's entries change: its athletes' totals and ranking rows, its academies' names and
// podiums, and its own counts.
async function settle(env, site, event, users) {
  await retally(env, site, users);
  // The + keeps SQLite off the academy index, which reads every entry on the site, onto the event key.
  const ids = (await env.DB.prepare('SELECT DISTINCT +club_id AS club_id FROM entries WHERE site = ?1 AND event = ?2 AND +club_id IS NOT NULL').bind(site, event).all()).results.map((row) => row.club_id);
  await env.DB.batch([env.DB.prepare(CLUBS).bind(site, JSON.stringify(ids)), env.DB.prepare(EVENT_COUNTS).bind(site, event)]);
}

// A registration list's athletes and the event they entered.
async function roster(env, { site, event, meta, athletes, read }) {
  if (!SITES.includes(site) || !/^\d{1,9}$/.test(event)) return json({ error: 'Bad roster' }, 400);
  await identify(env, site, event, meta, athletes, false, readAt(read));
  await settle(env, site, event, Object.keys(athletes ?? {}).slice(0, 5000));
  return json({});
}

// A results page's records for its event; the latest read of an event replaces the last.
async function record(env, { site, event, records, meta, athletes, read }) {
  if (!SITES.includes(site) || !/^\d{1,9}$/.test(event) || typeof records !== 'object' || !records) return json({ error: 'Bad record' }, 400);
  const rows = Object.entries(records).filter(([user, r]) => validUser(user) && Array.isArray(r) && r.length === 2 && r.every(n => Number.isSafeInteger(n) && n >= 0 && n < 100));
  if (rows.length > 5000) return json({ error: 'Too many' }, 413);
  const at = readAt(read);
  // Whoever this read drops from the event's results is recounted too.
  const before = (await env.DB.prepare('SELECT DISTINCT user FROM entries WHERE site = ?1 AND event = ?2 AND fought = 1').bind(site, event).all()).results.map((e) => e.user);
  await env.DB.prepare(`INSERT OR REPLACE INTO records (site, event, user, wins, losses, at)
    SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, ?3 FROM json_each(?4) WHERE NOT EXISTS (SELECT 1 FROM records WHERE site = ?1 AND event = ?2 AND at > ?3)`)
    .bind(site, event, at, JSON.stringify(rows.map(([user, [wins, losses]]) => [user, wins, losses]))).run();
  await identify(env, site, event, meta, athletes, true, at);
  await settle(env, site, event, [...before, ...rows.map(([user]) => user), ...Object.keys(athletes ?? {}).slice(0, 5000)]);
  return json({});
}

// An athlete's settled events, as profile pages read them from the match lists. The
// worker keeps only the shape profile.js reads: finishes (walkovers aside, which match lists
// never count), counts and bounded text. Older installs name a fastest escape "escape".
const SETTLED = 7 * 24 * 60 * 60 * 1000;
const count = n => (Number.isSafeInteger(n) && n >= 0 && n < 1000 ? n : 0);
const regOf = r => (Number.isSafeInteger(r) && r > 0 ? r : null);
const finished = (type) => (typeof type === 'string' && type && finishOf(type) !== 'walkover' ? finishOf(type) : null);
export function cleanOut(out) {
  const types = {};
  for (const [type, pair] of Object.entries(out?.types && typeof out.types === 'object' ? out.types : {})) {
    const t = finished(type);
    if (t && Array.isArray(pair) && (count(pair[0]) || count(pair[1]))) types[t] = [(types[t]?.[0] ?? 0) + count(pair[0]), (types[t]?.[1] ?? 0) + count(pair[1])];
  }
  const losses = (Array.isArray(out?.losses) ? out.losses : []).slice(0, 60).filter(l => finished(l?.type)).map(l => ({
    type: finished(l.type), how: text(l.how, 60) ?? '', opponent: text(l.opponent, 120), club: text(l.club, 160), division: text(l.division, 200),
    reg: regOf(l.reg), image: photo(l.image), bracket: regOf(l.bracket), stage: text(l.stage, 60),
  }));
  // A win names its finish, round and division too (from v 2), for a head-to-head.
  const faced = (Array.isArray(out?.faced) ? out.faced : []).slice(0, 120).filter(m => text(m?.name, 120)).map(m => ({
    name: text(m.name, 120), club: text(m.club, 160), image: photo(m.image), reg: regOf(m.reg), won: m.won === true,
    ...(m.won === true && finished(m.type) ? { type: finished(m.type), how: text(m.how, 60) ?? '', division: text(m.division, 200), bracket: regOf(m.bracket), stage: text(m.stage, 60) } : {}),
  }));
  return { ...(out?.v === 2 ? { v: 2 } : {}), types, losses, faced, ...(out?.extra === true ? { extra: true } : {}) };
}
async function outcomes(env, { site, user }) {
  if (!SITES.includes(site) || !validUser(user)) return json({ error: 'Bad outcomes' }, 400);
  const { results } = await env.DB.prepare('SELECT event, start, title, out FROM outcomes WHERE site = ?1 AND user = ?2').bind(site, user).all();
  return json({ events: results.map(r => ({ id: Number(r.event), start_date: r.start, title: r.title, out: JSON.parse(r.out) })) });
}
// Events a profile couldn't read (Smoothcomp never answers some match-list pages), from the
// matches the crawler or a results page saved: every division they fought there with its
// matches read, or none at an event they won nothing at once the crawler has read it.
// The rest go to the front of the crawl queue.
async function crawled(env, { site, user, events }) {
  if (!SITES.includes(site) || !validUser(user) || !Array.isArray(events) || events.length > 400) return json({ error: 'Bad events' }, 400);
  const ids = JSON.stringify(events.filter(e => Number.isSafeInteger(e) && e > 0).map(String));
  const { results } = await env.DB.prepare(`SELECT j.value event, h.start, h.title, h.wins, c.state, e.division, e.bouts FROM json_each(?3) j
    LEFT JOIN history h ON h.site = ?1 AND h.user = ?2 AND h.event = j.value LEFT JOIN crawls c ON c.site = ?1 AND c.event = j.value
    LEFT JOIN entries e ON e.site = ?1 AND e.event = j.value AND e.user = ?2 AND e.fought = 1`).bind(site, user, ids).all();
  const by = Map.groupBy(results, r => r.event);
  const found = [];
  for (const [event, rows] of by) {
    const fought = rows.filter(r => r.division);
    if ((!fought.length || fought.some(r => !r.bouts)) && (rows[0].state !== 'done' || rows[0].wins)) continue;
    const out = { v: 2, types: {}, losses: [], faced: [] };
    for (const r of fought) for (const b of JSON.parse(r.bouts ?? '[]')) {
      const type = finishOf(b.type);
      if (type === 'walkover') continue;
      (out.types[type] ??= [0, 0])[b.won ? 0 : 1]++;
      const at = { how: b.how ?? LABELS[type], division: r.division, stage: b.stage };
      if (b.opponent) out.faced.push({ name: b.opponent, club: b.club, won: b.won, ...(b.won ? { type, ...at } : {}) });
      if (!b.won) out.losses.push({ type, opponent: b.opponent, club: b.club, ...at });
    }
    found.push({ id: Number(event), start_date: rows[0].start, title: rows[0].title, out: cleanOut(out) });
  }
  const waiting = [...by.keys()].filter(event => !found.some(e => e.id === Number(event)));
  if (waiting.length) await env.DB.prepare(`UPDATE crawls SET priority = 3 WHERE site = ?1 AND state = 'queued' AND priority < 3 AND event IN (SELECT value FROM json_each(?2))`)
    .bind(site, JSON.stringify(waiting)).run();
  return json({ events: found });
}
async function keepOutcomes(env, { site, user, events }) {
  if (!SITES.includes(site) || !validUser(user) || !Array.isArray(events) || events.length > 400) return json({ error: 'Bad outcomes' }, 400);
  // An event only a match list names may come undated; every other one must have started.
  const rows = events.filter(e => Number.isSafeInteger(e?.id) && e.id > 0 && (typeof e.start_date === 'string' ? Date.parse(e.start_date) < Date.now() : e.start_date == null && e.out?.extra === true))
    .map(e => [String(e.id), e.start_date?.slice(0, 40) ?? null, text(e.title, 200), JSON.stringify(cleanOut(e.out))]);
  // A copy taken in an event's first week, while its results can still change, gives way to any later
  // one. After that the event is settled, so the first copy of it stands and later ones cannot replace
  // it, except a copy from before v 2, which lacks the wins' details: a v 2 upload with the same record
  // and losses can add them, and change nothing else.
  if (rows.length) await env.DB.prepare(`INSERT INTO outcomes (site, user, event, start, title, out, at)
    SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, value ->> 3, ?3 FROM json_each(?4) WHERE true
    ON CONFLICT (site, user, event) DO UPDATE SET start = excluded.start, title = excluded.title, out = excluded.out, at = excluded.at
    WHERE outcomes.at < unixepoch(outcomes.start) * 1000 + ?5
      OR (outcomes.out ->> '$.v' IS NOT 2 AND excluded.out ->> '$.v' = 2
        AND excluded.out ->> '$.types' = outcomes.out ->> '$.types' AND excluded.out ->> '$.losses' = outcomes.out ->> '$.losses')`).bind(site, user, Date.now(), JSON.stringify(rows), SETTLED).run();
  if (rows.length) await retally(env, site, [user]);
  return json({ kept: rows.length });
}

// When each belt an athlete wore began, as their profile's belt list dates them: the stats site
// splits their win rate by it. The latest read replaces the last.
async function belts(env, { site, user, worn, starts }) {
  if (!SITES.includes(site) || !validUser(user) || !Array.isArray(worn) || !worn.length || worn.length > BELTS.length || !worn.every(b => BELTS.includes(b))
    || !Array.isArray(starts) || starts.length !== worn.length || !starts.every(t => t === null || Number.isSafeInteger(t))) return json({ error: 'Bad belts' }, 400);
  await env.DB.prepare('INSERT OR REPLACE INTO belts (site, user, worn, starts, at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(site, user, JSON.stringify(worn), JSON.stringify(starts), Date.now()).run();
  // The belt worn now (the list's last) outranks the one their registrations name.
  await retally(env, site, [user]);
  return json({});
}

// What else a profile shows: belts in each art, rankings, academy and affiliation, match videos.
// Each part sent replaces the last; each event's cover joins the athlete's event list.
const id = (n) => (Number.isSafeInteger(n) && n > 0 ? n : null);
const small = (n) => (Number.isSafeInteger(n) && n >= 0 && n < 1e7 ? n : null);
const club = (c) => ({ id: id(c?.id), name: text(c?.name, 160), city: text(c?.city, 100), country: text(c?.country, 80), logo: photo(c?.logo) });
async function profile(env, body) {
  const { site, user } = body;
  if (!SITES.includes(site) || !validUser(user)) return json({ error: 'Bad profile' }, 400);
  const entry = {};
  if (Array.isArray(body.skills)) entry.skills = body.skills.slice(0, 30).map((s) => ({ name: text(s?.name, 80), belt: text(s?.belt, 40), degree: small(s?.degree), competed: small(s?.competed), order: small(s?.order) })).filter((s) => s.name && s.belt);
  if (Array.isArray(body.rankings)) {
    entry.rankings = body.rankings.slice(0, 10).map((r) => ({ placement: id(r?.placement), name: text(r?.name, 160), owner: text(r?.owner, 160), ownerId: id(r?.ownerId),
      type: ['federation', 'event'].includes(r?.type) ? r.type : null, toplist: id(r?.toplist) })).filter((r) => r.placement && r.name);
    entry.ranked = small(body.ranked) ?? entry.rankings.length;
  }
  for (const k of ['academies', 'affiliations']) if (Array.isArray(body[k])) entry[k] = body[k].slice(0, 10).map(club).filter((c) => c.name);
  if (small(body.videos) != null) entry.videos = body.videos;
  const images = Object.entries(body.images && typeof body.images === 'object' ? body.images : {}).slice(0, 500)
    .map(([event, url]) => [event, photo(url)]).filter(([event, url]) => /^\d{1,9}$/.test(event) && url);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO profiles (site, user, entry, at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (site, user) DO UPDATE SET entry = json_patch(profiles.entry, excluded.entry), at = excluded.at`).bind(site, user, JSON.stringify(entry), Date.now()),
    env.DB.prepare(`UPDATE history SET image = j.value ->> 1 FROM json_each(?3) j WHERE history.site = ?1 AND history.user = ?2 AND history.event = j.value ->> 0`)
      .bind(site, user, JSON.stringify(images)),
  ]);
  return json({});
}

const READS = new Set(['/lookup', '/outcomes', '/crawled']);
const ROUTES = { '/lookup': lookup, '/keep': keep, '/record': record, '/roster': roster, '/people': people, '/outcomes': outcomes, '/crawled': crawled, '/keep-outcomes': keepOutcomes, '/belts': belts, '/profile': profile };

// The site's reads, kept at Cloudflare's edge so most visits never reach the database. Seconds an
// answer stays fresh; past that, lists are still served at once (for up to a day) while a fresh copy
// is made behind them, and an athlete's page is made again before it is served, so a profile just
// opened shows within a minute. Reads go to the nearest read replica (a D1 session). An install's
// upload stamps the time (meta 'changed'): an athlete's page stored before it is made again before it is
// served, and a list is served as stored and made again behind it, at most once a minute, so nobody
// waits on a list being counted again. Stamping meta 'reset' (after a deploy changes a reply's shape)
// makes every copy stored before it again before it is served. The crawler's results stamp neither.
const FRESH = { athletes: 600, teams: 600, event: 600, division: 600, team: 600, events: 600, search: 600, countries: 3600, summary: 600, athlete: 60, places: 30 * 86400 };
const STALE_OK = new Set(['athletes', 'teams', 'event', 'division', 'team', 'events', 'search', 'countries', 'summary', 'places']);
async function cached(request, ctx, name, env, make) {
  const cache = caches.default;
  // One session for the stamp and the read, so the read sees at least what the stamp saw.
  const db = env.DB.withSession();
  const key = new Request(request.url, { method: 'GET' });
  const fresh = FRESH[name] ?? 60;
  const headers = (state) => ({ 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${Math.min(fresh, 30)}`, 'X-Cache': state });
  const build = async () => {
    const started = Date.now(); // a copy is as old as its read, not its storing
    const response = await make(db);
    if (response.status !== 200) return response;
    const body = await response.text();
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${STALE_OK.has(name) ? 86400 : fresh}`, 'X-Stored': String(started) } })));
    return new Response(body, { headers: headers('MISS') });
  };
  const hit = await cache.match(key);
  const stored = Number(hit?.headers.get('X-Stored'));
  try {
    const stamps = hit ? (await db.prepare("SELECT k, v FROM meta WHERE k IN ('changed', 'reset')").all()).results : [];
    const stamp = (k) => Number(stamps.find((row) => row.k === k)?.v ?? 0);
    if (hit && stamp('reset') <= stored) {
      const age = (Date.now() - stored) / 1000;
      const changed = stamp('changed') > stored;
      if (age <= fresh && (!changed || (STALE_OK.has(name) && age < 60))) return new Response(hit.body, { headers: headers('HIT') });
      if (STALE_OK.has(name)) {
        ctx.waitUntil(build().catch(() => {}));
        return new Response(hit.body, { headers: headers('STALE') });
      }
    }
    return await build();
  } catch (error) {
    // D1 turns reads away for a few seconds when it is overloaded: any copy stored, however old, beats an
    // error, and with none the reader is told to try again (the site retries) instead of getting a 500.
    console.error(name, String(error));
    if (hit) return new Response(hit.body, { headers: headers('STALE') });
    return Response.json({ error: 'Busy, try again' }, { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } });
  }
}

// A page of the site, with a CSP nonce made for this response alone. Cloudflare's bot
// detection injects an inline script and signs it with the nonce it finds in this header.
async function page(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (!response.headers.get('Content-Type')?.includes('text/html')) return response;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname, searchParams } = new URL(request.url);
    // The events map's tiles: Mapbox's dark style, fetched here so its token stays a secret, and kept in
    // the edge cache a month, so a tile any reader has seen costs Mapbox nothing again. /tiles/{z}/{x}/{y}.
    const tile = pathname.match(/^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
    if (tile && request.method === 'GET') {
      const [z, x, y] = tile.slice(1).map(Number);
      if (!env.MAPBOX_TOKEN || z > 20 || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 404 });
      const key = new Request(`https://tiles.cache/${z}/${x}/${y}`);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      const got = await fetch(`https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${env.MAPBOX_TOKEN}`);
      if (!got.ok) return new Response(null, { status: got.status === 404 ? 404 : 502 });
      const served = new Response(got.body, { headers: { 'Content-Type': got.headers.get('Content-Type') ?? 'image/png', 'Cache-Control': 'public, max-age=2592000' } });
      ctx.waitUntil(caches.default.put(key, served.clone()));
      return served;
    }
    // Roughly where the reader is (Cloudflare's guess from their connection, city-level), so the site can
    // look near them without asking for their location. Theirs alone, so never cached.
    if (pathname === '/api/here' && request.method === 'GET') {
      const cf = request.cf ?? {};
      return Response.json({ lat: coord(cf.latitude, 90), lng: coord(cf.longitude, 180), city: cf.city ?? null, country: cf.country ?? null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const read = pathname.startsWith('/api/') && API[pathname.slice(5)];
    if (read) return request.method === 'GET' ? cached(request, ctx, pathname.slice(5), env, (db) => read({ ...env, DB: db }, searchParams)) : json({ error: 'Not found' }, 404);
    if ((request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/api/')) return page(request, env);
    if (request.method !== 'POST' || !ROUTES[pathname]) return json({ error: 'Not found' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const response = await ROUTES[pathname](env, body ?? {});
    if (response.ok && !READS.has(pathname)) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('changed', ?1)").bind(Date.now()).run();
    return response;
  },
};

// The crawler Worker (crawler.js) saves an event's results the way a results page does, or, where a
// results page already did, adds each athlete's matches to its rows and leaves the rest as published.
export { record };
export async function addBouts(env, site, event, athletes) {
  const rows = Object.entries(athletes ?? {}).filter(([user]) => validUser(user))
    .flatMap(([user, a]) => (a.entries ?? []).map((e) => [user, e.division, bouts(e.bouts)])).filter(([, division, list]) => division && list);
  if (!rows.length) return;
  await env.DB.prepare(`UPDATE entries SET bouts = j.value ->> 2 FROM json_each(?3) j
    WHERE entries.site = ?1 AND entries.event = ?2 AND entries.fought = 1 AND (entries.bouts IS NULL OR instr(entries.bouts, '"us":') = 0) AND entries.user = j.value ->> 0 AND entries.division = j.value ->> 1`)
    .bind(site, event, JSON.stringify(rows)).run();
}
