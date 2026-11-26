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
import { dayShare } from './budget.js';

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
// Rows an event read writes to D1, about (entries, people, board, tallies): events are read while the day's
// writes stay under the day's share of the plan (budget.js dayShare) taken evenly over the day, so the
// crawler gets whatever uploads leave.
const ROWS = 7000;
const { scheduleOf, nameSides, eventResults, registeredIn, clubPlace } = globalThis.SCWRRules;
export { clubPlace };

class Gone extends Error {}
class Busy extends Error {}

let relayUntil = 0;
// How a run spent its time, logged when it ends: requests, their average wait, how long at least
// one was in flight (the rest went to the database and the counting), and events finished.
function client(run = RUN, env = {}) {
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
      // Straight from here first. Refused (Smoothcomp blocked Workers the match lists on 2026-11-25), the request
      // and the next quarter hour's go through the Hetzner relay (server/relay/relay.ts); then here is tried again.
      const ask = (relay) => fetch(relay ? `${env.RELAY}?url=${encodeURIComponent(url)}` : url,
        { headers: { 'User-Agent': UA, Accept: 'application/json', ...(relay && { 'x-relay-key': env.RELAY_KEY }) } });
      const direct = !env.RELAY || Date.now() >= relayUntil;
      let r = await ask(!direct);
      if (direct && r.status === 403 && env.RELAY) {
        relayUntil = Date.now() + 15 * 60e3;
        r = await ask(true);
      }
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

// The whole schedule (rules.js scheduleOf). A day or mat that failed to read fails the event, so it is read again rather
// than kept with its matches missing. Refused (403) past the event's day list is Smoothcomp blocking Workers (since
// 2026-11-25): the lane stops, as for a 429, and no event loses a try.
async function schedule(get, base) {
  const days = await get(`${base}/schedule/new/matcategories.json`);
  if (!Array.isArray(days) || !days.length) throw new Gone('no days');
  const read = async (items, url) => {
    const out = await each(items, (x) => get(url(x)));
    const failed = out.find((x) => x instanceof Error);
    if (failed) throw failed.message === '403' ? new Busy('403') : failed;
    return out;
  };
  const mats = (await read(days, (d) => `${base}/schedule/new/mats.json/${d.id}`)).flatMap((m) => (Array.isArray(m) ? m : []));
  return scheduleOf(mats, await read(mats, (m) => `${base}/schedule/new/mat/${m.id}/matches.json`));
}

// Every side named from the matches' bracket cards (rules.js nameSides), ROUND at a time, within the run's requests.
const name = (get, host, data) => nameSides(data, () => {
  const room = Math.min(ROUND, Math.max(0, data.left() - 1));
  if (!room) throw new Busy('budget');
  return room;
}, (matches) => each(matches, (m) => get(`${host}/en/getBracketMatchData/${m[0]}`)));

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
// Where an academy's page puts it: its pin ('pin'); else its town ('town'), where another academy's page
// placed that town, else Open-Meteo's geocoder; else nowhere, and it keeps where it competes most (stats.js CLUBS).
export async function locate(env, place) {
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
  // Finding the due ones walks every academy and its place (64k rows), so once a run finds fewer than it takes
  // (all caught up) the next looks again an hour on (meta 'clubs:rest'), not every minute.
  if (await env.DB.prepare("SELECT 1 FROM meta WHERE k = 'clubs:rest' AND v > ?1").bind(Date.now()).first()) return 0;
  const due = (await env.DB.prepare(`SELECT c.site, c.club_id FROM clubs c LEFT JOIN club_places p ON p.site = c.site AND p.club_id = c.club_id
    WHERE p.checked IS NULL OR p.checked < ?1 ORDER BY p.checked IS NOT NULL, p.checked, coalesce(c.entered, 0) DESC LIMIT ?2`).bind(Date.now() - 182 * DAY, take).all()).results;
  if (due.length < take) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('clubs:rest', ?1)").bind(Date.now() + 3600e3).run();
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
    await env.DB.prepare(SIZED).bind(site, event, registeredIn(html), html.includes('/participants"') ? 1 : 0, Date.now()).run();
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
  // Never a place in another country than the academy's own: near where a big team competes most, its affiliate
  // there shares its name (PSLPB Cicero Costha, of Brazil, took Cicero Costha Berlin's address).
  const placed = (places ?? []).filter((p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude)
    && (!club.country || part(p, 'country', 'shortText') === club.country));
  const near = (p) => club.lat == null || between(club.lat, club.lng, p.location.latitude, p.location.longitude) <= 150;
  const found = placed.find((p) => near(p) && sameAcademy(club.club, p.displayName?.text, club.city))
    ?? placed.find((p) => club.country && sameAcademy(club.club, p.displayName?.text, club.city, true));
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
// after the recent ones, within its daily share. The page reached is kept in meta, and the walk stops once
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

// BJJ only (the user's call, 2026-11-26): an event the events lists name sports for is read when one of them is Jiu-Jitsu,
// gi or no-gi (its ADCC and Submission Wrestling rules too; stats.js SPORTS); judo, MMA, wrestling, kempo and the rest
// took a quarter of the events read and a fifth of the matches. One with no sport named (from an athlete's event list) is read.
const BJJ = ['1', '7', '4', '3'];
const other = (site, event) => `EXISTS (SELECT 1 FROM events o WHERE o.site = ${site} AND o.event = ${event} AND o.sports IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM json_each(o.sports) j WHERE j.value IN (${BJJ.map((x) => `'${x}'`).join(', ')})))`;

// Every known event that has ended with no results, newest first; ids from profiles' event lists too.
// Those queued already are skipped before their entries are looked through.
export async function queue(env) {
  await env.DB.prepare(`DELETE FROM crawls WHERE state = 'queued' AND ${other('crawls.site', 'crawls.event')}`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT k.site, k.event, 'queued', max(k.start), max(k.title), max(k.city), 0, ?1 FROM (
      SELECT site, event, start, title, city FROM events UNION ALL SELECT site, event, start, title, city FROM history) k
    WHERE k.start < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM crawls c WHERE c.site = k.site AND c.event = k.event) AND NOT ${other('k.site', 'k.event')}
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = k.site AND e.event = k.event AND e.fought = 1)
    GROUP BY k.site, k.event`).bind(Date.now()).run();
  // Events a results page sent without matches: read for those alone. Event by event through the
  // event key, skipping those queued already, instead of walking every entry.
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT v.site, v.event, 'queued', v.start, v.title, v.city, 0, ?1 FROM events v
    WHERE v.start < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM crawls c WHERE c.site = v.site AND c.event = v.event) AND NOT ${other('v.site', 'v.event')}
      AND EXISTS (SELECT 1 FROM entries e WHERE e.site = v.site AND e.event = v.event AND e.fought = 1)
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = v.site AND e.event = v.event AND e.fought = 1 AND e.bouts IS NOT NULL)`).bind(Date.now()).run();
  // Results can still be corrected after an event: one read under ten days after it started is
  // read again once ten days have passed.
  await env.DB.prepare(`UPDATE crawls SET state = 'queued', data = NULL, next = 0, tries = 0 WHERE state = 'done' AND wrote IS NOT NULL
    AND wrote < unixepoch(start) * 1000 + 864000000 AND unixepoch('now') > unixepoch(start) + 864000 AND NOT ${other('crawls.site', 'crawls.event')}`).run();
}

// run: how long the lane reads (at most RUN).
export async function crawl(env, record, addBouts, run) {
  const { get, left, report } = client(run, env);
  let done = 0, why = 'time';
  try { why = (await lane(env, record, addBouts, get, left, () => done++)) ?? why; } finally { report(done, why); }
}

async function lane(env, record, addBouts, get, left, finished) {
  const now = Date.now();
  // Spread over the day (one about every six minutes), so Smoothcomp sees a trickle rather than the day's reads in one
  // burst; a lane reads at most one a run, so time lost (a pause, a block) is made up three a minute at most.
  // Today's writes: as last counted (every ten minutes, budget.js), plus ROWS for each event read since.
  const today = now - (now % DAY);
  const kept = JSON.parse(await env.DB.prepare("SELECT v FROM meta WHERE k = 'budget'").first('v') ?? 'null');
  const fresh = kept?.at >= today;
  const since = await env.DB.prepare("SELECT count(*) AS n FROM crawls WHERE state = 'done' AND at >= ?1").bind(fresh ? kept.at : today).first('n');
  const written = (fresh ? kept.writtenToday : 0) + ROWS * since;
  const line = kept ? dayShare({ written: kept.written, writtenToday: fresh ? kept.writtenToday : 0 }) * ((now % DAY) + 60e3) / DAY : 0;
  let room = written + ROWS <= line ? 1 : 0;
  while (left() > 10) {
    if (room <= 0) return 'daily';
    // Taken and held in one statement, so lanes running side by side never take the same event; through
    // crawls_due, in the order taken, so it stops at the first one due instead of sorting the queue.
    const job = await env.DB.prepare(`UPDATE crawls SET next = ?2 WHERE rowid = (SELECT rowid FROM crawls INDEXED BY crawls_due WHERE state IN ('queued', 'reading') AND next <= ?1 ORDER BY priority DESC, start DESC LIMIT 1) RETURNING *`)
      .bind(Date.now(), Date.now() + 10 * 60e3).first();
    if (!job) return;
    const host = HOSTS[job.site];
    const save = (state, data, next = 0, tries = job.tries) => env.DB.prepare("UPDATE crawls SET state = ?3, data = ?4, next = ?5, tries = ?6, at = ?7 WHERE site = ?1 AND event = ?2")
      .bind(job.site, job.event, state, data == null ? null : JSON.stringify(data), next, tries, Date.now()).run();
    let data = job.data ? JSON.parse(job.data) : null;
    try {
      if (!data) {
        const read = await schedule(get, `${host}/en/event/${job.event}`);
        // Matches still to finish at an event under four days old: it may still be on.
        if (!read.over && Date.parse(job.start) > now - 4 * DAY) { await save('queued', null, now + 6 * 3600e3); continue; }
        // Kept only if this run ends before the event is done (the catch below).
        data = { matches: read.matches, ends: read.ends, users: {}, tried: [], ...(!read.over && { on: true }) };
      }
      try { await name(get, host, Object.assign(data, { left })); } finally { delete data.left; }
      // Results a page sent meanwhile stand.
      // (A crawl reading an event again replaces its own copy, or a visitor's read on the site: results written by the time it last wrote.)
      const has = await env.DB.prepare('SELECT 1 FROM reads WHERE site = ?1 AND event = ?2 AND fought = 1 AND at > ?3').bind(job.site, job.event, job.wrote ?? 0).first();
      const { athletes, records } = eventResults(data, job.start);
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
        if (['budget', 'slow', '429', '403'].includes(e.message)) return e.message;
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
