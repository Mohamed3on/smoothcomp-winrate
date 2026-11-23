// The career cache every install shares. Installs keep what they read here and
// look up a whole event at once; each one cleans what it gets (career-cache.js),
// so the worker only bounds what it stores.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { API, TALLY } from './stats.js';
import { crawl, queue } from './crawl.js';

// Recounts these athletes' totals (stats.js TALLY), a few hundred at a time, at most as many as an
// upload can store; one left with nothing to count loses its row.
async function retally(env, site, users) {
  const all = [...new Set(users)].filter(validUser).slice(0, 5000);
  for (let i = 0; i < all.length; i += 400) {
    const some = JSON.stringify(all.slice(i, i + 400));
    await env.DB.batch([env.DB.prepare(TALLY).bind(site, some), env.DB.prepare(`DELETE FROM tallies WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2))
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = ?1 AND e.user = tallies.user AND e.fought = 1)
      AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.site = ?1 AND o.user = tallies.user) AND NOT EXISTS (SELECT 1 FROM history h WHERE h.site = ?1 AND h.user = tallies.user)`).bind(site, some)]);
  }
}

const KEPT = 30 * 24 * 60 * 60 * 1000; // the longest career-cache.js keeps anything
const LANES = 9; // crawls side by side each minute
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
  await env.DB.prepare(`INSERT INTO athletes (site, user, kind, at, entry)
    SELECT ?1, value ->> 'user', value ->> 'kind', value ->> '$.entry.at', value ->> 'entry' FROM json_each(?2) WHERE true
    ON CONFLICT (site, user, kind) DO UPDATE SET at = excluded.at, entry = excluded.entry WHERE excluded.at > athletes.at`)
    .bind(body.site, JSON.stringify(rows)).run();
  return json({});
}

// What an event page shows of the event and of each athlete, for the public site.
// Strings are capped and finish types follow the career cache's rule.
const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
const text = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);
const tally = (bucket) => Object.fromEntries(Object.entries(bucket && typeof bucket === 'object' ? bucket : {})
  .filter(([type, n]) => /^[\w -]{1,40}$/.test(type) && Number.isSafeInteger(n) && n > 0 && n < 100));
// Photos only from the sites' own hosts.
const photo = (url) => (typeof url === 'string' && /^https:\/\/([\w-]+\.)*(smoothcomp\.com|ajptour\.com)\/[^\s"'<>]{1,300}$/.test(url) ? url : null);
// A grade label names one belt, or none: "Purple/Brown" and "All belts" name none.
const oneBelt = (label) => {
  const named = typeof label === 'string' ? BELTS.filter((b) => new RegExp(`\\b${b}`, 'i').test(label.replace(/gray/i, 'grey'))) : [];
  return named.length === 1 ? named[0] : null;
};
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
// When the page read what it sends: an upload read before the one kept is dropped, so a
// late arrival never undoes a newer read. Older installs send none and count as read now.
const readAt = (read, now = Date.now()) => (Number.isSafeInteger(read) && read > now - 60 * 60 * 1000 ? Math.min(read, now) : now);

async function identify(env, site, event, meta, athletes, fought, read = Date.now()) {
  if (!athletes || typeof athletes !== 'object') return;
  // A date decides whose academy and photo win, so none from the future.
  const start = typeof meta?.start === 'string' && ISO.test(meta.start) && Date.parse(meta.start) < Date.now() + 366 * 24 * 60 * 60 * 1000 ? meta.start : null;
  const now = Date.now();
  const ends = typeof meta?.end === 'string' && ISO.test(meta.end) && Date.parse(meta.end) < now + 366 * 24 * 60 * 60 * 1000 ? Date.parse(meta.end) : null;
  const statements = [];
  if (meta && typeof meta === 'object') {
    statements.push(env.DB.prepare(`INSERT INTO events (site, event, title, start, city, country, organiser, at, ends) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT (site, event) DO UPDATE SET title = coalesce(excluded.title, title), start = coalesce(excluded.start, start), city = coalesce(excluded.city, city),
      country = coalesce(excluded.country, country), organiser = coalesce(excluded.organiser, organiser), at = excluded.at, ends = coalesce(excluded.ends, ends)`)
      .bind(site, event, text(meta.title, 200), start, text(meta.city, 100), text(meta.country, 8), text(meta.organiser, 200), now, ends));
  }
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
    people.push({ user, name: text(a.name, 120), club, clubId, country: typeof a.country === 'string' && /^[a-z-]{2,8}$/i.test(a.country) ? a.country.toLowerCase() : null,
      countryName: text(a.countryName, 80), photo: photo(a.photo), belt: oneBelt(a.belt), born: Number.isSafeInteger(a.age) && a.age > 2 && a.age < 100 ? year - a.age : null, hidden });
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
      entries.push({ user, division, club, clubId, place, wins: JSON.stringify(tally(e.wins)), losses: JSON.stringify(tally(e.losses)) });
    }
  }
  // A newer event's academy, photo and name replace an older one's; an older event only fills gaps.
  const keep = (column) => `${column} = CASE WHEN excluded.seen >= people.seen THEN coalesce(excluded.${column}, people.${column}) ELSE coalesce(people.${column}, excluded.${column}) END`;
  statements.push(env.DB.prepare(`INSERT INTO people (site, user, name, club, club_id, country, country_name, photo, belt, born, hidden, seen, at)
    SELECT ?1, value ->> 'user', value ->> 'name', value ->> 'club', value ->> 'clubId', value ->> 'country', value ->> 'countryName', value ->> 'photo', value ->> 'belt', value ->> 'born', value ->> 'hidden', ?2, ?3 FROM json_each(?4) WHERE true
    ON CONFLICT (site, user) DO UPDATE SET ${['name', 'club', 'club_id', 'country', 'country_name', 'photo', 'belt', 'born'].map(keep).join(', ')},
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
    statements.push(env.DB.prepare(`INSERT OR ${fought ? 'REPLACE' : 'IGNORE'} INTO entries (site, event, user, division, club, club_id, place, wins, losses, fought, at)
      SELECT ?1, ?2, value ->> 'user', value ->> 'division', value ->> 'club', value ->> 'clubId', value ->> 'place', value ->> 'wins', value ->> 'losses', ?3, ?4 FROM json_each(?5) WHERE ${newer}`)
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
  // An event list read changes how many events they have and when they last fought.
  await retally(env, site, Object.entries(athletes ?? {}).filter(([, a]) => Array.isArray(a?.history)).slice(0, 20).map(([user]) => user));
  return json({});
}

// A registration list's athletes and the event they entered.
async function roster(env, { site, event, meta, athletes, read }) {
  if (!SITES.includes(site) || !/^\d{1,9}$/.test(event)) return json({ error: 'Bad roster' }, 400);
  await identify(env, site, event, meta, athletes, false, readAt(read));
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
  await retally(env, site, [...before, ...rows.map(([user]) => user), ...Object.keys(athletes ?? {}).slice(0, 5000)]);
  return json({});
}

// An athlete's settled events, as profile pages read them from the match lists. The
// worker keeps only the shape profile.js reads: known finishes, counts and bounded text.
const FINISHES = ['submission', 'stoppage', 'escape', 'points', 'decision', 'disqualification', 'other'];
const SETTLED = 7 * 24 * 60 * 60 * 1000;
const count = n => (Number.isSafeInteger(n) && n >= 0 && n < 1000 ? n : 0);
const regOf = r => (Number.isSafeInteger(r) && r > 0 ? r : null);
function cleanOut(out) {
  const types = {};
  for (const type of FINISHES) {
    const pair = out?.types?.[type];
    if (Array.isArray(pair) && (count(pair[0]) || count(pair[1]))) types[type] = [count(pair[0]), count(pair[1])];
  }
  const losses = (Array.isArray(out?.losses) ? out.losses : []).slice(0, 60).filter(l => FINISHES.includes(l?.type)).map(l => ({
    type: l.type, how: text(l.how, 60) ?? '', opponent: text(l.opponent, 120), club: text(l.club, 160), division: text(l.division, 200),
    reg: regOf(l.reg), image: photo(l.image), bracket: regOf(l.bracket), stage: text(l.stage, 60),
  }));
  // A win names its finish, round and division too (from v 2), for a head-to-head.
  const faced = (Array.isArray(out?.faced) ? out.faced : []).slice(0, 120).filter(m => text(m?.name, 120)).map(m => ({
    name: text(m.name, 120), club: text(m.club, 160), image: photo(m.image), reg: regOf(m.reg), won: m.won === true,
    ...(m.won === true && FINISHES.includes(m.type) ? { type: m.type, how: text(m.how, 60) ?? '', division: text(m.division, 200), bracket: regOf(m.bracket), stage: text(m.stage, 60) } : {}),
  }));
  return { ...(out?.v === 2 ? { v: 2 } : {}), types, losses, faced, ...(out?.extra === true ? { extra: true } : {}) };
}
async function outcomes(env, { site, user }) {
  if (!SITES.includes(site) || !validUser(user)) return json({ error: 'Bad outcomes' }, 400);
  const { results } = await env.DB.prepare('SELECT event, start, title, out FROM outcomes WHERE site = ?1 AND user = ?2').bind(site, user).all();
  return json({ events: results.map(r => ({ id: Number(r.event), start_date: r.start, title: r.title, out: JSON.parse(r.out) })) });
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

const ROUTES = { '/lookup': lookup, '/keep': keep, '/record': record, '/roster': roster, '/people': people, '/outcomes': outcomes, '/keep-outcomes': keepOutcomes, '/belts': belts, '/profile': profile };

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
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname, searchParams } = new URL(request.url);
    const read = pathname.startsWith('/api/') && API[pathname.slice(5)];
    if (read) return request.method === 'GET' ? read(env, searchParams) : json({ error: 'Not found' }, 404);
    if ((request.method === 'GET' || request.method === 'HEAD') && !pathname.startsWith('/api/')) return page(request, env);
    if (request.method !== 'POST' || !ROUTES[pathname]) return json({ error: 'Not found' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    return ROUTES[pathname](env, body ?? {});
  },
  async scheduled(controller, env) {
    // Each minute, results for events nobody opened; the queue is refilled every half hour.
    if (controller.cron === '* * * * *') {
      if (new Date(controller.scheduledTime).getUTCMinutes() % 30 === 0) await queue(env);
      // Nine lanes, each its own invocation with its own six connections, each on its own event.
      return Promise.all([crawl(env, record), ...Array.from({ length: LANES - 1 }, () => env.CRAWLER.run())]);
    }
    await env.DB.prepare('DELETE FROM athletes WHERE at <= ?1').bind(Date.now() - KEPT).run();
  },
};

// A crawl lane, called through the CRAWLER binding to this same Worker, so it runs as its own invocation.
export class Crawler extends WorkerEntrypoint {
  async run() {
    await crawl(this.env, record);
  }
}
