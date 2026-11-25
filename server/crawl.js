// Results for events nobody opened with the extension, read by the server itself. Two kinds of
// Smoothcomp JSON answer without a browser: an event's schedule (every match: division, stage,
// winner, finish, and each side's registration) and a match's bracket card, which names both
// sides' users. Every past event Mat Stats knows of with no results yet is queued, newest first;
// each minute's run reads for 50 seconds, six requests at a time (a Worker's open connections),
// keeping what it has read, until every side is named. The event then goes in as a results page would send it, its medals from the
// final and bronze match, as the extension counts a division not yet published. A results page
// read later replaces it.
import '../rules.js';
import { CLUBS } from './stats.js';

const HOSTS = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const RUN = 50e3; // each run reads this long, then leaves the rest to the next minute's
const BUDGET = 5000; // requests per run, well under a paid Worker's 10,000
const ROUND = 300; // bracket cards asked for at a time
const AT_ONCE = 6;
// Smoothcomp answers a placed crawler in about 100 ms. When the median of a lane's last 30 requests
// passes this, it is straining (crawling at 80 requests a second took it to a second for everyone),
// so the lane asks one at a time; past twice this even so, it stops until the next minute.
const SLOW = 300;
const DAY = 864e5;
// Events read a day (UTC) at most; lanes count at their start, so together they may pass it by a few. What
// keeps D1 inside what the plan includes is the budget (budget.js), which stops the crawler for the day.
const DAILY = 300;
const { finishOf, normalize, placeOf, roundOf, isPool, poolPlaces } = globalThis.SCWRRules;

class Gone extends Error {}
class Busy extends Error {}

// How a run spent its time, logged when it ends: requests, their average wait, how long at least
// one was in flight (the rest went to the database and the counting), and events finished.
function client(run = RUN) {
  let used = 0, waited = 0, open = 0, since = 0, busy = 0;
  const recent = [];
  const started = Date.now();
  const until = started + Math.min(run, RUN);
  const left = () => (Date.now() < until ? BUDGET - used : 0);
  const get = async (url) => {
    const median = () => (recent.length >= 30 ? [...recent].sort((a, b) => a - b)[15] : 0);
    if (median() > 2 * SLOW) throw new Busy('slow');
    // Waiting its turn while slow; the turn is taken in the same tick the wait ends, so one goes at a time.
    while (median() > SLOW && open) await new Promise((r) => setTimeout(r, 20));
    if (!left()) throw new Busy('budget');
    used++;
    const t = Date.now();
    if (!open++) since = t;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Busy(`${r.status}`);
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Gone(`${r.status}`);
      return await r.json();
    } finally {
      waited += Date.now() - t;
      recent.push(Date.now() - t);
      if (recent.length > 30) recent.shift();
      if (!--open) busy += Date.now() - since;
    }
  };
  const report = (done, why) => console.log('lane', JSON.stringify({ used, avg: Math.round(waited / (used || 1)), busy, wall: Date.now() - started, done, why }));
  return { get, left, report };
}

// A few at a time; the first refusal stops the rest.
async function each(items, work) {
  const out = [];
  let next = 0, stop = null;
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    while (!stop && next < items.length) {
      const i = next++;
      try { out[i] = await work(items[i]); } catch (e) { if (e instanceof Busy) stop = e; else out[i] = e; }
    }
  }));
  if (stop) throw stop;
  return out;
}

// The whole schedule, kept small: [id, division, stage, finish (one winner, finished), sides],
// a side being [registration, won, name, club, country, affiliation]. Whether every match is finished, and when
// the last mat ends.
async function schedule(get, base) {
  const days = await get(`${base}/schedule/new/matcategories.json`);
  if (!Array.isArray(days) || !days.length) throw new Gone('no days');
  const mats = (await each(days, (d) => get(`${base}/schedule/new/mats.json/${d.id}`))).flatMap((m) => (Array.isArray(m) ? m : []));
  const lists = await each(mats, (m) => get(`${base}/schedule/new/mat/${m.id}/matches.json`));
  const seen = new Map();
  for (const m of lists.flatMap((l) => (Array.isArray(l) ? l : []))) {
    const sides = (m.seats ?? []).filter((s) => s.type === 'registration' && s.event_registration_id);
    if (!sides.length || seen.has(m.id)) continue;
    const winners = sides.filter((s) => s.isWinner);
    const finish = m.state === 'finished' && sides.length === 2 && winners.length === 1 && m.wonBy ? String(m.wonBy) : null;
    seen.set(m.id, [m.id, m.group ?? '', m.name ?? '', finish, sides.map((s) => [s.event_registration_id, !!s.isWinner, s.name ?? null, s.club || null, s.country || null, s.affiliation || null]), m.state === 'finished']);
  }
  const matches = [...seen.values()];
  const ends = Math.max(0, ...mats.map((m) => Date.parse(m.estimated_end) || 0));
  return { matches: matches.map((m) => m.slice(0, 5)), over: matches.every((m) => m[5]), ends: ends || null };
}

// Each match's bracket card: who each side is (their user, academy, affiliation, age, photo), and
// the score, kept for the matches whose card is read. Cards are read only to name everyone (a card
// for every match would be about 2.5 times the requests): matches naming two unknown sides first.
// A card that fails leaves its sides to another match.
const scored = (m) => m[3] && finishOf(m[3]) !== 'walkover' && m[4].length === 2;
const seconds = (t) => (/^\d+:\d\d$/.test(t ?? '') ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);
async function name(get, host, data) {
  const users = data.users;
  data.cards ??= {};
  const tried = new Set(data.tried);
  const open = (reg) => !(reg in users) && !(data.missed ?? []).includes(reg);
  const pick = () => {
    const want = new Set(data.matches.flatMap((m) => m[4].map((s) => s[0])).filter(open));
    const out = [];
    const taken = new Set();
    // Of two matches naming as many, a scored one first, so more matches keep their score.
    const rank = data.matches.filter((m) => !tried.has(m[0])).map((m) => [m, m[4].filter((s) => want.has(s[0]) && !taken.has(s[0])).length]).sort((a, b) => b[1] - a[1] || scored(b[0]) - scored(a[0]));
    for (const [m] of rank) {
      if (out.length >= data.room) break;
      const fresh = m[4].filter((s) => want.has(s[0]) && !taken.has(s[0]));
      if (!fresh.length) continue;
      fresh.forEach((s) => taken.add(s[0]));
      out.push(m);
    }
    return { out, want };
  };
  for (;;) {
    data.room = Math.min(ROUND, Math.max(0, data.left() - 1));
    const { out, want } = pick();
    if (!out.length) {
      // Nothing left to try for these: they stay unnamed.
      data.missed = [...new Set([...(data.missed ?? []), ...want])];
      return;
    }
    if (!data.room) throw new Busy('budget');
    const cards = await each(out, (m) => get(`${host}/en/getBracketMatchData/${m[0]}`));
    out.forEach((m, i) => {
      tried.add(m[0]);
      const card = cards[i];
      if (!card || card instanceof Error) return;
      const people = [card.left, card.right].filter((p) => p?.id);
      // Each card side to its seat by name, else in order.
      const score = [];
      for (const [k, s] of m[4].entries()) {
        const p = people.find((x) => normalize(`${x.first_name} ${x.last_name}`) === normalize(s[2])) ?? (people.length === m[4].length ? people[k] : null);
        if (!p) continue;
        users[s[0]] = { id: String(p.id), name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || s[2], club: p.club || s[3], clubId: p.club_id ? String(p.club_id) : null,
          affiliation: p.affiliation || s[5] || null,
          country: p.country_flag || (s[4] ? String(s[4]).toLowerCase() : null), countryName: p.country || null, age: Number.isSafeInteger(p.age) ? p.age : null,
          photo: /^https:/.test(p.profile_image ?? '') ? p.profile_image : null, hidden: p.public === false };
        score[k] = [p.score, p.advantage, p.penalty].map((n) => (Number.isSafeInteger(n) ? n : 0));
      }
      // The score per seat ([points, advantages, penalties]) and the clock: match length and time left.
      if (scored(m) && score[0] && score[1]) data.cards[m[0]] = { s: score, t: [seconds(card.matchInfo?.time), Number.isSafeInteger(card.matchInfo?.timeRemaining) ? card.matchInfo.timeRemaining : null] };
    });
    data.tried = [...tried];
  }
}

// The event as a results page would send it: each athlete's divisions, wins and losses by finish,
// and a place where the matches give one (rules.js placeOf, poolPlaces), in the order fought.
// No-shows (walkover losses alone) are left out, as published results leave them out.
function results(data, start) {
  const athletes = {};
  const records = {};
  // An age is the athlete's now; the event's is what the server keeps a birth year from.
  const back = start ? new Date().getUTCFullYear() - new Date(start).getUTCFullYear() : 0;
  const divisions = new Map();
  for (const m of data.matches) {
    const key = normalize(m[1]);
    if (!divisions.has(key)) divisions.set(key, []);
    divisions.get(key).push(m);
  }
  for (const matches of divisions.values()) {
    const division = matches[0][1];
    const entries = new Map();
    const beat = new Set();
    const of = (s) => {
      const u = data.users[s[0]];
      if (!u) return null;
      if (!entries.has(u.id)) entries.set(u.id, { user: u, e: { division, place: null, wins: {}, losses: {}, bouts: [] }, w: 0, sub: 0, shown: false });
      return entries.get(u.id);
    };
    const bronze = matches.some((m) => m[2] === 'Bronze match');
    for (const [id, , stage, finish, sides] of [...matches].sort((a, b) => roundOf(a[2]) - roundOf(b[2]) || a[0] - b[0])) {
      const card = data.cards?.[id];
      const seats = sides.map(of);
      if (!finish) continue;
      sides.forEach((s, i) => {
        const x = seats[i];
        if (!x) return;
        // Who they met: the other side, named as their bracket card names them where it was read.
        const k = 1 - i;
        const them = sides[k] && (data.users[sides[k][0]] ?? null);
        if (sides[k]) x.e.bouts.push({ won: s[1], type: finish, opponent: them?.name ?? sides[k][2], user: them?.id ?? null, club: them?.club ?? sides[k][3], stage,
          ...(card ? { us: card.s[i], them: card.s[k], clock: card.t } : {}) });
        const bucket = s[1] ? x.e.wins : x.e.losses;
        bucket[finish] = (bucket[finish] ?? 0) + 1;
        if (s[1]) { x.w++; if (/^sub/.test(finish)) x.sub++; }
        if (s[1] || finishOf(finish) !== 'walkover') x.shown = true;
        const place = placeOf(stage, s[1], bronze);
        if (place) x.e.place = place;
      });
      const [a, b] = seats;
      if (a && b) beat.add(`${(sides[0][1] ? a : b).user.id}>${(sides[0][1] ? b : a).user.id}`);
    }
    const shown = [...entries.values()].filter((x) => x.shown || !Object.keys(x.e.losses).length);
    if (isPool(matches.map((m) => m[2])) && matches.some((m) => m[3])) {
      const places = poolPlaces(shown.map((x) => ({ key: x.user.id, wins: x.w, subs: x.sub })), (a, b) => beat.has(`${a}>${b}`));
      for (const x of shown) x.e.place = places.get(x.user.id);
    }
    for (const { user: u, e } of shown) {
      const a = athletes[u.id] ??= { name: u.name, club: u.club, clubId: u.clubId, affiliation: u.affiliation, country: u.country, countryName: u.countryName, belt: division,
        age: u.age == null ? null : u.age - back, photo: u.photo, hidden: u.hidden, entries: [] };
      a.entries.push(e);
    }
  }
  for (const [id, a] of Object.entries(athletes)) {
    const count = (b) => Object.entries(b).reduce((n, [t, c]) => n + (finishOf(t) === 'walkover' ? 0 : c), 0);
    const w = a.entries.reduce((n, e) => n + count(e.wins), 0);
    const l = a.entries.reduce((n, e) => n + count(e.losses), 0);
    if (w + l) records[id] = [w, l];
  }
  return { athletes, records };
}

// An event list page's events (`var events = [...]`, as /en/events/upcoming and /past print it): each
// one's title, date, city, coordinates, sports (Smoothcomp's ids) and page.
const coord = (v, max) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
export function listed(html) {
  let list = [];
  try { list = JSON.parse(html.match(/var events = (\[.*\])\s*$/m)?.[1] ?? '[]'); } catch { /* a changed page lists nothing */ }
  return list.filter((e) => Number.isSafeInteger(e?.id) && /^\d{4}-\d{2}-\d{2}$/.test(e.startdate)).map((e) => ({
    event: String(e.id), title: e.title ?? null, start: e.startdate, city: e.location_city ?? null, country: e.location_country ?? null,
    lat: coord(e.location_lat, 90), lng: coord(e.location_long, 180),
    sports: Array.isArray(e.categoryGroups) ? JSON.stringify(e.categoryGroups.map(String).filter((g) => /^\d{1,4}$/.test(g))) : null,
    url: typeof e.url === 'string' && /^https:\/\/([\w-]+\.)?(smoothcomp\.com|ajptour\.com)\//.test(e.url) ? e.url : null,
  }));
}

// Listed events in: a page an install read keeps its title, city and timed start, and the list adds
// where it is and its sports. An upcoming event's list date wins, so a postponement shows. ?1 site, ?2 now, ?3 events (JSON).
export const LISTED = `INSERT INTO events (site, event, title, start, city, country, lat, lng, sports, url, at)
  SELECT ?1, value ->> 'event', value ->> 'title', value ->> 'start', value ->> 'city', value ->> 'country', value ->> 'lat', value ->> 'lng', value ->> 'sports', value ->> 'url', ?2 FROM json_each(?3) WHERE true
  ON CONFLICT (site, event) DO UPDATE SET title = coalesce(events.title, excluded.title),
    start = iif(excluded.start > date('now') AND substr(coalesce(events.start, ''), 1, 10) != excluded.start, excluded.start, coalesce(events.start, excluded.start)),
    city = coalesce(events.city, excluded.city), country = coalesce(events.country, excluded.country),
    lat = coalesce(excluded.lat, events.lat), lng = coalesce(excluded.lng, events.lng), sports = coalesce(excluded.sports, events.sports), url = coalesce(excluded.url, events.url)`;

// Read daily, as servers may: every upcoming event on both sites (one page each), so the site can find
// one near you, and both sites' past events (40 a page, newest first) of the last year (and ARCHIVE pages more), so the queue
// holds those nobody opened too. Then a few thousand academies with no place yet look for one.
// An academy's page says where it is when the academy set it (data-profile): its map pin, its town and street.
const unescape = (s) => s.replace(/&(quot|amp|#0?39|lt|gt);/g, (_, e) => ({ quot: '"', amp: '&', '#039': "'", '#39': "'", lt: '<', gt: '>' })[e]);
const words = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);
export function clubPlace(html) {
  let p;
  try { p = JSON.parse(unescape(html.match(/data-profile="(\{[^"]*\})"/)?.[1] ?? 'null')); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  const lat = coord(p.location_lat, 90), lng = coord(p.location_long, 180);
  const pinned = lat != null && lng != null && (lat !== 0 || lng !== 0);
  return { lat: pinned ? lat : null, lng: pinned ? lng : null, city: words(p.city, 100), country: /^[A-Z]{2}$/.test(p.country_code ?? '') ? p.country_code : null, address: words(p.address, 200) };
}

// Where an academy's page puts it: its pin ('pin'); else its town ('town'), where another academy's page
// placed that town, else Open-Meteo's geocoder; else nowhere, and it keeps where it competes most (stats.js CLUBS).
async function locate(env, place) {
  if (!place) return { source: null };
  if (place.lat != null) return { ...place, source: 'pin' };
  if (!place.city) return { ...place, source: null };
  const known = await env.DB.prepare(`SELECT avg(lat) AS lat, avg(lng) AS lng FROM club_places WHERE lower(city) = lower(?1) AND country IS ?2 AND lat IS NOT NULL`).bind(place.city, place.country).first();
  if (known?.lat != null) return { ...place, lat: known.lat, lng: known.lng, source: 'town' };
  const query = new URLSearchParams({ name: place.city, count: '1', language: 'en', format: 'json', ...(place.country && { countryCode: place.country }) });
  const found = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${query}`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const town = found.results?.[0];
  return town ? { ...place, lat: town.latitude, lng: town.longitude, source: 'town' } : { ...place, source: null };
}

// Every minute, the next academies' pages, those never read first, then the busiest; each is read again
// after half a year. Smoothcomp answers a burst of five or so with 429, so they go one every 2.5 seconds.
// A private academy's page (403) has nothing to say; a busy site (429, 5xx) ends the run, to go on next minute.
export const PLACED = `INSERT OR REPLACE INTO club_places (site, club_id, lat, lng, city, country, address, source, checked)
  SELECT value ->> 'site', value ->> 'club_id', value ->> 'lat', value ->> 'lng', value ->> 'city', value ->> 'country', value ->> 'address', value ->> 'source', ?1 FROM json_each(?2)`;
export async function placeClubs(env, take = 20, gap = 2500) {
  const due = (await env.DB.prepare(`SELECT c.site, c.club_id FROM clubs c LEFT JOIN club_places p ON p.site = c.site AND p.club_id = c.club_id
    WHERE p.checked IS NULL OR p.checked < ?1 ORDER BY p.checked IS NOT NULL, p.checked, coalesce(c.entered, 0) DESC LIMIT ?2`).bind(Date.now() - 182 * DAY, take).all()).results;
  // Each is kept as soon as it's read, so a run that overlaps the next minute's never reads it twice.
  let read = 0;
  for (const [i, { site, club_id }] of due.entries()) {
    if (i) await new Promise((wait) => setTimeout(wait, gap));
    const page = await fetch(`${HOSTS[site]}/en/club/${club_id}`, { headers: { 'User-Agent': UA } });
    if (page.status === 429 || page.status >= 500) break;
    const row = { site, club_id, ...(await locate(env, page.ok ? clubPlace(await page.text()) : null)) };
    await env.DB.prepare(PLACED).bind(Date.now(), JSON.stringify([row])).run();
    read++;
  }
  return read;
}

// How many athletes an event's pages count: the badge on the Athletes link of the menu each one shows.
// None (null) while the organiser keeps the list hidden, or nobody has entered.
export function registered(html) {
  const n = html.match(/Athletes\s*<span class="badge">([^<]*)<\/span>/)?.[1].replace(/\D/g, '');
  return n ? Number(n) : null;
}

// Every upcoming grappling event's size, read a few each minute and again a day on, so events nobody opened
// still show how big they are. Read from its accommodations page: the event's other pages challenge a server
// (Cloudflare's "Just a moment"), that one doesn't, and its menu counts the athletes the same. A busy site
// (429, 5xx) ends the run; a page that won't say is asked again a day on.
export const SIZED = 'UPDATE events SET registered = iif(?4, ?3, registered), sized = ?5 WHERE site = ?1 AND event = ?2';
export async function sizeEvents(env, take = 10, gap = 2500) {
  const due = (await env.DB.prepare(`SELECT site, event, url FROM events WHERE site IN ('smoothcomp.com', 'ajptour.com') AND start >= date('now')
    AND (sized IS NULL OR sized < ?1) AND (sports IS NULL OR EXISTS (SELECT 1 FROM json_each(sports) s WHERE s.value IN ('1', '7', '4', '3', '24')))
    ORDER BY sized IS NOT NULL, sized, start LIMIT ?2`).bind(Date.now() - DAY, take).all()).results;
  let read = 0;
  for (const [i, { site, event, url }] of due.entries()) {
    if (i) await new Promise((wait) => setTimeout(wait, gap));
    const page = await fetch(`${url ? new URL(url).origin : HOSTS[site]}/en/event/${event}/accommodations`, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (!page || page.status === 429 || page.status >= 500) break;
    const html = page.ok ? await page.text() : '';
    await env.DB.prepare(SIZED).bind(site, event, registered(html), html.includes('/participants"') ? 1 : 0, Date.now()).run();
    read++;
  }
  return read;
}

// Academies whose page names no place, looked up on Google Maps (Text Search, which gives each place's
// name, location and address), searched by the academy's name near where its athletes compete: the busiest
// first, one every ten minutes (inside the 5,000 a month Google gives free), kept until the academy's page is
// read again, half a year on. A place counts if its name shares a word with the academy's, past the words every
// academy uses and that town's, within 150 km of there; or, as a team that travels competes far from home, if
// its name holds every such word of the academy's and it is in the academy's country. Without env.GOOGLE_MAPS_KEY, nothing.
const COMMON = new Set(['for', 'of', 'bjj', 'jj', 'jiu', 'jitsu', 'jiujitsu', 'brazilian', 'academy', 'academia', 'akademie', 'team', 'club', 'mma', 'gym', 'fight', 'fighting', 'martial', 'arts', 'the', 'and', 'de', 'do', 'da', 'e', 'v', 'ev', 'grappling', 'school', 'association', 'sport', 'sports', 'center', 'centre', 'combat', 'kampfsport', 'verein']);
const tokens = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
export function sameAcademy(ours, theirs, town, every = false) {
  const skip = new Set([...COMMON, ...(every ? [] : tokens(town))]);
  const named = new Set(tokens(theirs)), joined = tokens(theirs).join('');
  const words = tokens(ours).filter((w) => !skip.has(w));
  // "GFTeam" is "GF Team" run together: a long word counts inside their name with its spaces dropped.
  return words.length > 0 && words[every ? 'every' : 'some']((w) => named.has(w) || (w.length >= 4 && joined.includes(w)));
}
const between = (a, b, c, d) => 6371 * Math.acos(Math.min(1, Math.sin(a * Math.PI / 180) * Math.sin(c * Math.PI / 180) + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.cos((d - b) * Math.PI / 180)));
// "(No academy)", "Independent", "No club": nobody to look for.
const NOBODY = /^\W*(no (academy|club|team|affiliation)|independent( no club)?|none|n\W?a|unknown|sin (equipo|academia|club)|sem (equipe|academia)|ohne verein|kein verein|free ?agent)\W*$/i;
export const lookable = (name) => !NOBODY.test(name ?? '') && tokens(name).some((w) => !COMMON.has(w));
export function pickPlace(club, places) {
  const part = (p, type, form = 'longText') => p.addressComponents?.find((c) => c.types?.includes(type))?.[form] ?? null;
  const placed = (places ?? []).filter((p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude));
  const near = (p) => club.lat == null || between(club.lat, club.lng, p.location.latitude, p.location.longitude) <= 150;
  const found = placed.find((p) => near(p) && sameAcademy(club.club, p.displayName?.text, club.city))
    ?? placed.find((p) => club.country && part(p, 'country', 'shortText') === club.country && sameAcademy(club.club, p.displayName?.text, club.city, true));
  return found ? { lat: found.location.latitude, lng: found.location.longitude, city: found.postalAddress?.locality || part(found, 'locality') || part(found, 'postal_town'),
    address: typeof found.formattedAddress === 'string' ? found.formattedAddress.slice(0, 200) : null } : null;
}
export async function findClubs(env) {
  if (!env.GOOGLE_MAPS_KEY) return 0;
  const club = await env.DB.prepare(`SELECT p.site, p.club_id, c.club, c.lat, c.lng, c.city, coalesce(p.country, c.country) AS country FROM club_places p JOIN clubs c ON c.site = p.site AND c.club_id = p.club_id
    WHERE p.source IS NULL AND p.google IS NULL AND c.club IS NOT NULL ORDER BY coalesce(c.entered, 0) DESC LIMIT 1`).first();
  if (!club) return 0;
  const asked = (found) => env.DB.prepare(`UPDATE club_places SET google = ?3, lat = coalesce(?4, lat), lng = coalesce(?5, lng), city = coalesce(?6, city), address = coalesce(?7, address),
    source = iif(?4 IS NULL, source, 'google') WHERE site = ?1 AND club_id = ?2`)
    .bind(club.site, club.club_id, Date.now(), found?.lat ?? null, found?.lng ?? null, found?.city ?? null, found?.address ?? null).run();
  if (!lookable(club.club)) return (await asked(null), 0);
  const answer = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.addressComponents,places.postalAddress' },
    body: JSON.stringify({ textQuery: club.club, pageSize: 5, languageCode: 'en',
      ...(club.lat != null && { locationBias: { circle: { center: { latitude: club.lat, longitude: club.lng }, radius: 50000 } } }) }),
  });
  if (!answer.ok) return 0; // a refused key or a spent quota asks again next time
  const found = pickPlace(club, (await answer.json()).places);
  await asked(found);
  return found ? 1 : 0;
}

// Older events, ARCHIVE pages a site a day past the last year's (about 320 events): the crawler reads them
// after the recent ones, within its DAILY limit. The page reached is kept in meta, and the walk stops once
// the database passes 9 GB (D1 holds 10).
const ARCHIVE = 8;

export async function listEvents(env) {
  const since = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const read = async (site, path) => listed(await (await fetch(`${HOSTS[site]}/en/events/${path}`, { headers: { 'User-Agent': UA } })).text());
  let size = 0;
  const save = async (site, rows) => {
    for (let i = 0; i < rows.length; i += 500) size = (await env.DB.prepare(LISTED).bind(site, Date.now(), JSON.stringify(rows.slice(i, i + 500))).run()).meta?.size_after ?? size;
  };
  for (const site of Object.keys(HOSTS)) await save(site, await read(site, 'upcoming'));
  for (const site of Object.keys(HOSTS)) {
    let n = 1;
    for (let older = false; !older && n <= 400; n += 4) {
      const found = (await Promise.all([n, n + 1, n + 2, n + 3].map((p) => read(site, `past?page=${p}`)))).flat();
      older = !found.length || found.some((e) => e.start < since);
      await save(site, found.filter((e) => e.start >= since));
    }
    if (size > 9e9) continue;
    // From the year's last pages read (new events push old ones later, so none is skipped), or further on.
    const key = `archive:${site}`;
    const from = Math.max(n - 4, (await env.DB.prepare('SELECT v FROM meta WHERE k = ?1').bind(key).first('v')) ?? 0);
    const pages = await Promise.all(Array.from({ length: ARCHIVE }, (_, i) => read(site, `past?page=${from + i}`)));
    await save(site, pages.flat());
    await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)').bind(key, from + pages.filter((p) => p.length).length).run();
  }
  for (const site of Object.keys(HOSTS)) {
    const ids = (await env.DB.prepare('SELECT club_id FROM clubs WHERE site = ?1 AND lat IS NULL ORDER BY random() LIMIT 2000').bind(site).all()).results.map((r) => r.club_id);
    if (ids.length) await env.DB.prepare(CLUBS).bind(site, JSON.stringify(ids)).run();
  }
}

// Every known event that has ended with no results, newest first; ids from profiles' event lists too.
// Those queued already are skipped before their entries are looked through.
export async function queue(env) {
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT k.site, k.event, 'queued', max(k.start), max(k.title), max(k.city), 0, ?1 FROM (
      SELECT site, event, start, title, city FROM events UNION ALL SELECT site, event, start, title, city FROM history) k
    WHERE k.start < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM crawls c WHERE c.site = k.site AND c.event = k.event)
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = k.site AND e.event = k.event AND e.fought = 1)
    GROUP BY k.site, k.event`).bind(Date.now()).run();
  // Events a results page sent without matches: read for those alone. Event by event through the
  // event key, skipping those queued already, instead of walking every entry.
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT v.site, v.event, 'queued', v.start, v.title, v.city, 0, ?1 FROM events v
    WHERE v.start < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM crawls c WHERE c.site = v.site AND c.event = v.event)
      AND EXISTS (SELECT 1 FROM entries e WHERE e.site = v.site AND e.event = v.event AND e.fought = 1)
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = v.site AND e.event = v.event AND e.fought = 1 AND e.bouts IS NOT NULL)`).bind(Date.now()).run();
  // Results can still be corrected after an event: one read under ten days after it started is
  // read again once ten days have passed.
  await env.DB.prepare(`UPDATE crawls SET state = 'queued', data = NULL, next = 0, tries = 0 WHERE state = 'done' AND wrote IS NOT NULL
    AND wrote < unixepoch(start) * 1000 + 864000000 AND unixepoch('now') > unixepoch(start) + 864000`).run();
}

// run: how long the lane reads (at most RUN); asked: only events someone on the site asked for.
export async function crawl(env, record, addBouts, run, asked = false) {
  const { get, left, report } = client(run);
  let done = 0, why = 'time';
  try { why = (await lane(env, record, addBouts, get, left, () => done++, asked)) ?? why; } finally { report(done, why); }
}

async function lane(env, record, addBouts, get, left, finished, onlyAsked) {
  const now = Date.now();
  let room = DAILY - await env.DB.prepare("SELECT count(*) AS n FROM crawls WHERE state = 'done' AND at >= ?1").bind(now - (now % DAY)).first('n');
  while (left() > 10) {
    // Taken and held in one statement, so lanes running side by side never take the same event; through
    // crawls_due, in the order taken, so it stops at the first one due instead of sorting the queue.
    // Once the day's events are read, only those someone on the site asked for now (priority 4, worker.js readNow).
    const job = await env.DB.prepare(`UPDATE crawls SET next = ?2 WHERE rowid = (SELECT rowid FROM crawls INDEXED BY crawls_due WHERE state IN ('queued', 'reading') AND next <= ?1 AND priority >= ?3 ORDER BY priority DESC, start DESC LIMIT 1) RETURNING *`)
      .bind(Date.now(), Date.now() + 10 * 60e3, room > 0 && !onlyAsked ? 0 : 4).first();
    if (!job) return onlyAsked ? 'asked' : room > 0 ? undefined : 'daily';
    const asked = job.priority >= 4;
    const host = HOSTS[job.site];
    // Asked-for ones go back in line once read (or given up on); a lane stopping mid-read keeps its place.
    const save = (state, data, next = 0, tries = job.tries) => env.DB.prepare("UPDATE crawls SET state = ?3, data = ?4, next = ?5, tries = ?6, at = ?7, priority = iif(?3 = 'reading', priority, min(priority, 3)) WHERE site = ?1 AND event = ?2")
      .bind(job.site, job.event, state, data == null ? null : JSON.stringify(data), next, tries, Date.now()).run();
    let data = job.data ? JSON.parse(job.data) : null;
    try {
      if (!data) {
        const read = await schedule(get, `${host}/en/event/${job.event}`);
        // Matches still to finish at an event under four days old: it may still be on. Asked for, it is read
        // as it stands, and read again later.
        if (!read.over && !asked && Date.parse(job.start) > now - 4 * DAY) { await save('queued', null, now + 6 * 3600e3); continue; }
        // Kept only if this run ends before the event is done (the catch below). Asked for, it is newer than
        // a results page read before now (one read mid-event), so it replaces it.
        data = { matches: read.matches, ends: read.ends, users: {}, tried: [], ...(!read.over && { on: true }), ...(asked && { read: now }) };
      }
      try { await name(get, host, Object.assign(data, { left })); } finally { delete data.left; delete data.room; }
      // Results a page sent meanwhile stand.
      // (A crawl reading an event again replaces its own copy: results written by the time it last wrote.)
      const has = await env.DB.prepare('SELECT 1 FROM reads WHERE site = ?1 AND event = ?2 AND fought = 1 AND at > ?3').bind(job.site, job.event, Math.max(job.wrote ?? 0, data.read ?? 0)).first();
      const { athletes, records } = results(data, job.start);
      // Results a page sent stand; the matches are added to them.
      if (has) await addBouts(env, job.site, job.event, athletes);
      else {
        const iso = (t) => (t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null);
        await record(env, { site: job.site, event: job.event, records, athletes, read: Date.now(), crawled: true,
          meta: { title: job.title, start: iso(job.start), end: iso(data.ends), city: job.city } });
        await env.DB.prepare('UPDATE crawls SET wrote = ?3 WHERE site = ?1 AND event = ?2').bind(job.site, job.event, Date.now()).run();
      }
      // An event still on is read again in six hours, as one would be that nobody asked for.
      if (data.on) { await save('queued', null, now + 6 * 3600e3); continue; }
      finished();
      room--;
      await save('done', { named: Object.keys(data.users).length, missed: data.missed?.length ?? 0, matches: data.matches.length });
    } catch (e) {
      // Out of time: the next run goes on from here. Told to slow down (429): this run stops. A site
      // erroring (5xx): this event waits a quarter hour while the others go on.
      if (e instanceof Busy) {
        const later = e.message === 'budget' || e.message === 'slow' ? 0 : Date.now() + 15 * 60e3;
        if (data) await save('reading', data, later); else await env.DB.prepare('UPDATE crawls SET next = ?3 WHERE site = ?1 AND event = ?2').bind(job.site, job.event, later).run();
        if (e.message === 'budget' || e.message === 'slow' || e.message === '429') return e.message;
        continue;
      }
      const tries = job.tries + 1;
      // No schedule (never published, or hidden): asked again a week, then a month on, then left.
      if (e instanceof Gone || !data) await save(tries >= 3 ? 'gone' : 'queued', null, now + (tries === 1 ? 7 : 30) * DAY, tries);
      // Anything else keeps what was read and tries again in an hour, five times.
      else await save(tries >= 5 ? 'failed' : 'reading', data, now + 3600e3, tries);
      console.error('crawl', job.site, job.event, e?.message);
    }
  }
}
