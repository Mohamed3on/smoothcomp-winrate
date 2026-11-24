// The public site's reads. Every list takes the same quality filters: a site,
// the finish types counted, a belt, a country, and the fewest wins and events that count.
import '../rules.js';

const { BELTS, FINISHES, finishSql } = globalThis.SCWRRules;
const SITES = ['smoothcomp.com', 'ajptour.com'];
const KEPT = 30 * 24 * 60 * 60 * 1000;
const json = (body, status = 200, cache = 'public, max-age=60') => Response.json(body, { status, headers: { 'Cache-Control': cache } });
const whole = (value, fallback, max = 1e6) => {
  const n = value == null || value === '' ? NaN : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

// The finish types left out of a win count; walkovers unless the reader counts them.
const TYPE = /^[\w -]{1,40}$/;
function filters(params) {
  const off = params.has('off') ? params.get('off').split(',').filter((t) => TYPE.test(t)).slice(0, 20) : ['walkover'];
  return {
    site: SITES.includes(params.get('site')) ? params.get('site') : SITES[0],
    off: JSON.stringify(off),
    country: /^[a-z-]{2,8}$/.test(params.get('country') ?? '') ? params.get('country') : '',
    belts: JSON.stringify((params.get('belt') ?? '').split(',').filter((b) => BELTS.includes(b))),
    wins: whole(params.get('wins'), 0),
    events: whole(params.get('events'), 0),
    q: (params.get('q') ?? '').trim().slice(0, 80),
    // An age range, open at either end, as birth years.
    bornFrom: params.get('agemax') ? new Date().getUTCFullYear() - whole(params.get('agemax'), 200, 200) - 1 : 0,
    bornTo: params.get('agemin') ? new Date().getUTCFullYear() - whole(params.get('agemin'), 0, 200) : 9999,
    // Competed within this many months: the earliest event date that still counts.
    since: whole(params.get('active'), 0, 600) ? new Date(Date.now() - whole(params.get('active'), 0, 600) * 30.44 * 864e5).toISOString().slice(0, 10) : '',
    limit: whole(params.get('limit'), 50, 2000),
    offset: whole(params.get('offset'), 0),
    // A place, as "lat,lng", and how far from it counts (km; 0 for anywhere).
    ...place(params),
  };
}
function place(params) {
  const m = (params.get('near') ?? '').match(/^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)$/);
  const [lat, lng] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, km: whole(params.get('km'), 0, 20000) } : { lat: null, lng: null, km: 0 };
}

// Great-circle kilometres from the place bound at `at` (its latitude, then longitude at the next
// number) to a row's coordinates; null where either is unknown.
const KM = (lat, lng, at) => `(6371 * acos(min(1, max(-1, sin(radians(?${at})) * sin(radians(${lat})) + cos(radians(?${at})) * cos(radians(${lat})) * cos(radians(${lng} - ?${at + 1}))))))`;
// The grappling sports' ids on Smoothcomp: Jiu-Jitsu (Gi); Jiu-Jitsu (NoGi), its ADCC and Submission Wrestling rules; Luta Livre.
const SPORTS = { gi: ['1'], nogi: ['7', '4', '3'], grappling: ['1', '7', '4', '3', '24'] };

// Each athlete's totals, kept up to date as results, match lists and event lists arrive, so a
// ranking reads one row per athlete instead of every result. Per finish, as [won, lost]:
// `rec` from the match lists of their profile where it was opened (with the results' walkovers there;
// older lists name a fastest escape "escape", which the rules group) with the results read at every event those lists
// don't hold (for an athlete whose profile nobody opened, every event read); `seen` from every
// event read. Medals and events from the events read, `listed` the events their profile lists,
// `last` their latest event. ?1 site, ?2 the athletes (JSON).
export const TALLY = `INSERT OR REPLACE INTO tallies (site, user, rec, seen, gold, silver, bronze, events, listed, last)
  WITH us AS MATERIALIZED (SELECT DISTINCT value AS user FROM json_each(?2)),
  -- CROSS JOIN keeps these athletes the outer loop, so each table is read by athlete, never whole.
  fe AS MATERIALIZED (SELECT e.* FROM us CROSS JOIN entries e WHERE e.site = ?1 AND e.user = us.user AND e.fought = 1),
  per AS (
    SELECT o.user, ${finishSql('j.key')} AS t, j.value ->> 0 AS w, j.value ->> 1 AS l FROM us CROSS JOIN outcomes o, json_each(o.out, '$.types') j WHERE o.site = ?1 AND o.user = us.user
    UNION ALL SELECT f.user, j.key, j.value, 0 FROM fe f, json_each(f.wins) j WHERE NOT EXISTS (SELECT 1 FROM outcomes x WHERE x.site = ?1 AND x.user = f.user AND x.event = f.event)
    UNION ALL SELECT f.user, j.key, 0, j.value FROM fe f, json_each(f.losses) j WHERE NOT EXISTS (SELECT 1 FROM outcomes x WHERE x.site = ?1 AND x.user = f.user AND x.event = f.event)
    -- The match lists leave walkovers out: the results give them there.
    UNION ALL SELECT f.user, 'walkover', coalesce(f.wins ->> '$.walkover', 0), coalesce(f.losses ->> '$.walkover', 0) FROM fe f WHERE EXISTS (SELECT 1 FROM outcomes x WHERE x.site = ?1 AND x.user = f.user AND x.event = f.event)),
  rec AS (SELECT user, json_group_object(t, json_array(w, l)) AS rec FROM (SELECT user, t, sum(w) AS w, sum(l) AS l FROM per GROUP BY user, t) GROUP BY user),
  read AS (SELECT f.user, j.key AS t, j.value AS w, 0 AS l FROM fe f, json_each(f.wins) j UNION ALL SELECT f.user, j.key, 0, j.value FROM fe f, json_each(f.losses) j),
  seen AS (SELECT user, json_group_object(t, json_array(w, l)) AS seen FROM (SELECT user, t, sum(w) AS w, sum(l) AS l FROM read GROUP BY user, t) GROUP BY user),
  med AS (SELECT user, sum(place = 1) AS gold, sum(place = 2) AS silver, sum(place = 3) AS bronze, count(DISTINCT event) AS events FROM fe GROUP BY user),
  listed AS (SELECT h.user, count(*) AS listed, max(substr(h.start, 1, 10)) AS last FROM us CROSS JOIN history h WHERE h.site = ?1 AND h.user = us.user GROUP BY h.user),
  latest AS (SELECT f.user, max(substr(v.start, 1, 10)) AS last FROM fe f JOIN events v ON v.site = f.site AND v.event = f.event GROUP BY f.user)
  SELECT ?1, us.user, rec.rec, seen.seen, coalesce(med.gold, 0), coalesce(med.silver, 0), coalesce(med.bronze, 0), coalesce(med.events, 0), coalesce(listed.listed, 0),
    nullif(max(coalesce(listed.last, ''), coalesce(latest.last, '')), '')
  FROM us LEFT JOIN rec USING (user) LEFT JOIN seen USING (user) LEFT JOIN med USING (user) LEFT JOIN listed USING (user) LEFT JOIN latest USING (user)
  WHERE rec.rec IS NOT NULL OR seen.seen IS NOT NULL OR med.events IS NOT NULL OR listed.listed IS NOT NULL`;

// The finishes every count is kept under (rules.js), a column each on the board.
const GROUPS = FINISHES;
const cols = (prefix) => GROUPS.map((g) => `${prefix}_${g}`).join(', ');

// The highest belt an athlete's divisions name, for one with no belt read: a division naming
// several ("Expert (Brown/Black)") names none.
const NAMED = `'${JSON.stringify(BELTS)}'`;
const namedBelt = (user) => `(SELECT k.value FROM entries e CROSS JOIN json_each(${NAMED}) k
      WHERE e.site = ?1 AND e.user = ${user} AND replace(lower(e.division), 'gray', 'grey') LIKE '%' || k.value || '%'
        AND (SELECT count(*) FROM json_each(${NAMED}) j WHERE replace(lower(e.division), 'gray', 'grey') LIKE '%' || j.value || '%') = 1
      ORDER BY k.key DESC LIMIT 1)`;
// The least belt an athlete holds now, as their divisions show it: belts only go up, so every division they entered
// puts them at its lowest belt or above ("Brown/Black": brown). Only blue and up count: a kids' belt never lifts an adult.
const names = (belt) => `replace(lower(e.division), 'gray', 'grey') LIKE '%' || ${belt} || '%'`;
const floorBelt = (user) => `(SELECT k.value FROM entries e CROSS JOIN json_each(${NAMED}) k
      WHERE e.site = ?1 AND e.user = ${user} AND k.key >= ${BELTS.indexOf('blue')} AND ${names('k.value')}
        AND NOT EXISTS (SELECT 1 FROM json_each(${NAMED}) j WHERE j.key < k.key AND ${names('j.value')})
      ORDER BY k.key DESC LIMIT 1)`;
// The higher of two belts; one not a colour gives way.
const higher = (a, b) => `(SELECT value FROM json_each(${NAMED}) WHERE value = lower(${a}) OR value = ${b} ORDER BY key DESC LIMIT 1)`;

// Every athlete with something to rank, one row each, rebuilt with their tally. A career is
// Smoothcomp's, the latest read however old; with none readable (a profile not public, or not read yet), an
// athlete's record stands in: wins by finish and losses from their profile's match lists where it was
// opened, else the results read; placements from the events read; events the more of those read and
// those their profile lists. Per finish group: w_ the wins (career or record), rw_/rl_ the record
// their tally gives, sl_ the record's losses. ?1 site, ?2 the athletes (JSON),
// ?3 the oldest career read that counts (0: all).
export const BOARD = [`DELETE FROM board WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2)) AND ?3 IS NOT NULL`,
`INSERT INTO board (site, user, source, at, types, name, club, club_id, country, country_name, photo, born, hidden, belt, last, events, gold, silver, bronze,
    ${cols('w')}, ${cols('rw')}, ${cols('rl')}, ${cols('sl')})
  WITH us AS MATERIALIZED (SELECT DISTINCT value AS user FROM json_each(?2)),
  src AS MATERIALIZED (
    SELECT us.user, c.at, c.entry, t.rec, t.seen, t.gold AS tg, t.silver AS ts, t.bronze AS tb, t.events AS te, t.listed, t.last,
      p.name, p.club, p.club_id, p.country, p.country_name, p.photo, p.born, p.hidden, coalesce(bl.worn ->> '$[#-1]', r.entry ->> '$.belt', p.belt) AS grade,
      ${floorBelt('us.user')} AS least_belt
    FROM us
    LEFT JOIN athletes c ON c.site = ?1 AND c.user = us.user AND c.kind = 'careers' AND c.at > ?3 AND c.entry ->> '$.wins' IS NOT NULL
    LEFT JOIN tallies t ON t.site = ?1 AND t.user = us.user
    LEFT JOIN people p ON p.site = ?1 AND p.user = us.user
    LEFT JOIN athletes r ON r.site = ?1 AND r.user = us.user AND r.kind = 'ranks'
    LEFT JOIN belts bl ON bl.site = ?1 AND bl.user = us.user),
  b AS (
    SELECT *, iif(entry IS NOT NULL, 'career', 'results') AS source,
      iif(entry IS NOT NULL, (SELECT json_group_object(g, n) FROM (SELECT ${finishSql('key')} AS g, sum(value) AS n FROM json_each(entry, '$.wins') GROUP BY g)),
        coalesce((SELECT json_group_object(key, value ->> 0) FROM json_each(rec) WHERE value ->> 0 > 0), '{}')) AS types
    FROM src WHERE entry IS NOT NULL OR te > 0)
  SELECT ?1, user, source, iif(source = 'career', at, NULL), types, name, club, club_id, country, country_name, photo, born, hidden,
    coalesce(${higher('b.grade', 'b.least_belt')}, b.grade, ${namedBelt('b.user')}), last,
    iif(source = 'career', nullif(max(coalesce(entry ->> '$.events', 0), coalesce(listed, 0)), 0), max(te, coalesce(listed, 0))),
    iif(source = 'career', coalesce(entry ->> '$.medals[0]', 0), tg), iif(source = 'career', coalesce(entry ->> '$.medals[1]', 0), ts), iif(source = 'career', coalesce(entry ->> '$.medals[2]', 0), tb),
    ${GROUPS.map((g) => `coalesce(types ->> '$.${g}', 0)`).join(', ')},
    ${GROUPS.map((g) => `coalesce(rec ->> '$.${g}[0]', 0)`).join(', ')},
    ${GROUPS.map((g) => `coalesce(rec ->> '$.${g}[1]', 0)`).join(', ')},
    ${GROUPS.map((g) => `coalesce(rec ->> '$.${g}[1]', 0)`).join(', ')}
  FROM b`];

// One person's accounts are the ones with their name as written (case and runs of spaces aside), birth year and
// country, on either site: AJP keeps its own accounts, and both sites hold duplicates. people_ident reads them.
const IDENT = (p) => `lower(trim(replace(replace(replace(${p}name, '  ', ' '), '  ', ' '), '  ', ' ')))`;
// The birth year an account goes by: its own, else (none read) the one birth year of everyone with its name and country,
// where one of them was at its academy too.
const BORN = (p) => `coalesce(${p}born, (SELECT iif(count(DISTINCT q.born) = 1 AND max(lower(trim(q.club)) = lower(trim(${p}club))), min(q.born), NULL)
  FROM people q WHERE ${IDENT('q.')} = ${IDENT(p)} AND q.country = ${p}country AND q.born IS NOT NULL))`;
// Every account sharing a person with the accounts `from` names (aliased f: site, user), as members (site, user, and
// the person: k name, kb birth year, kc country).
const MEMBERS = (from) => `seeds AS MATERIALIZED (SELECT ${IDENT('p.')} AS k, ${BORN('p.')} AS kb, p.country AS kc FROM ${from} CROSS JOIN people p ON p.site = f.site AND p.user = f.user
      WHERE trim(p.name) != '' AND p.country IS NOT NULL),
  members AS MATERIALIZED (SELECT DISTINCT m.site, m.user, s.k, s.kb, s.kc FROM seeds s CROSS JOIN people m ON ${IDENT('m.')} = s.k AND m.country = s.kc
    WHERE s.kb IS NOT NULL AND (m.born = s.kb OR (m.born IS NULL AND ${BORN('m.')} = s.kb)))`;

// Each account's board row holds its whole person: every account sharing them, on either site, summed, after BOARD has
// rebuilt these athletes' own rows. An account that shares its person keeps its own row in board_own, which the sums
// read; one whose row was never summed still holds its own on the board. Of a person's accounts on one site, the one
// with the most events ranks; the others are dup. ?1 site, ?2 the athletes (JSON).
const BOARD_COLS = `site, user, source, at, types, name, club, club_id, country, country_name, photo, born, hidden, belt, last, events, gold, silver, bronze,
    ${cols('w')}, ${cols('rw')}, ${cols('rl')}, ${cols('sl')}`;
const COUNTS = ['w', 'rw', 'rl', 'sl'].flatMap((p) => GROUPS.map((g) => `${p}_${g}`));
const PEOPLE = `${MEMBERS('(SELECT ?1 AS site, value AS user FROM json_each(?2)) f')},
  shared AS MATERIALIZED (SELECT * FROM members WHERE (k, kb, kc) IN (SELECT k, kb, kc FROM members GROUP BY k, kb, kc HAVING count(*) > 1))`;
export const MERGE = [`DELETE FROM board_own WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2))`,
`INSERT OR IGNORE INTO board_own (${BOARD_COLS}) WITH ${PEOPLE}
  SELECT ${BOARD_COLS.replace(/(\w+)/g, 'b.$1')} FROM shared s CROSS JOIN board b ON b.site = s.site AND b.user = s.user`,
`INSERT OR REPLACE INTO board (${BOARD_COLS}, dup) WITH ${PEOPLE},
  own AS MATERIALIZED (SELECT o.*, s.k, s.kb, s.kc FROM shared s CROSS JOIN board_own o ON o.site = s.site AND o.user = s.user),
  sums AS (SELECT k, kb, kc, max(source = 'career') AS career, max(at) AS at, max(last) AS last, sum(events) AS events, sum(gold) AS gold, sum(silver) AS silver, sum(bronze) AS bronze,
      ${COUNTS.map((c) => `sum(${c}) AS ${c}`).join(', ')}
    FROM own GROUP BY k, kb, kc),
  ranked AS (SELECT site, user, row_number() OVER (PARTITION BY k, kb, kc, site ORDER BY coalesce(events, 0) DESC, user) AS n FROM own)
  SELECT o.site, o.user, iif(s.career, 'career', 'results'), iif(s.career, s.at, NULL),
    (SELECT json_group_object(key, value) FROM json_each(json_object(${GROUPS.map((g) => `'${g}', s.w_${g}`).join(', ')})) WHERE value > 0),
    o.name, o.club, o.club_id, o.country, o.country_name, o.photo, o.born, o.hidden, o.belt, s.last, s.events, s.gold, s.silver, s.bronze,
    ${COUNTS.map((c) => `s.${c}`).join(', ')}, r.n > 1
  FROM own o JOIN sums s ON s.k = o.k AND s.kb = o.kb AND s.kc = o.kc JOIN ranked r ON r.site = o.site AND r.user = o.user`];

// Each academy's latest name (as its athletes' latest events give it), its podiums and events
// entered at the events read, and where it competes most: the city of the most events its athletes
// entered (ties to the latest), at the mean of those events' coordinates. ?1 site, ?2 the academies (JSON).
export const CLUBS = `INSERT OR REPLACE INTO clubs (site, club_id, club, podium_gold, podium_silver, podium_bronze, entered, lat, lng, city, country)
  WITH ids AS MATERIALIZED (SELECT DISTINCT value AS club_id FROM json_each(?2)),
  -- One pass over each academy's results, read through the academy index (CROSS JOIN keeps ids outer).
  podiums AS (SELECT e.club_id, sum(e.place = 1) AS gold, sum(e.place = 2) AS silver, sum(e.place = 3) AS bronze, count(DISTINCT e.event) AS entered
    FROM ids CROSS JOIN entries e WHERE e.site = ?1 AND e.club_id = ids.club_id AND e.fought = 1 GROUP BY e.club_id),
  cities AS (SELECT e.club_id, v.city, v.country, avg(v.lat) AS lat, avg(v.lng) AS lng,
      row_number() OVER (PARTITION BY e.club_id ORDER BY count(DISTINCT e.event) DESC, max(v.start) DESC) AS rank
    FROM ids CROSS JOIN entries e JOIN events v ON v.site = e.site AND v.event = e.event
    WHERE e.site = ?1 AND e.club_id = ids.club_id AND v.lat IS NOT NULL GROUP BY e.club_id, v.city, v.country)
  SELECT ?1, ids.club_id,
    (SELECT club FROM people p WHERE p.site = ?1 AND p.club_id = ids.club_id AND p.club IS NOT NULL ORDER BY p.seen DESC LIMIT 1),
    podiums.gold, podiums.silver, podiums.bronze, podiums.entered, c.lat, c.lng, c.city, c.country
  FROM ids LEFT JOIN podiums USING (club_id) LEFT JOIN cities c ON c.club_id = ids.club_id AND c.rank = 1`;

// An event's athletes, divisions and academies, kept on it. ?1 site, ?2 event. The + keeps the
// academy count on the event key, not the academy index, which reads every entry on the site.
export const EVENT_COUNTS = `UPDATE events SET
  athletes = (SELECT count(DISTINCT user) FROM entries e WHERE e.site = ?1 AND e.event = ?2),
  divisions = (SELECT coalesce(nullif(count(DISTINCT division) FILTER (WHERE fought = 1), 0), count(DISTINCT division)) FROM entries e WHERE e.site = ?1 AND e.event = ?2),
  teams = (SELECT count(DISTINCT +e.club_id) FROM entries e WHERE e.site = ?1 AND e.event = ?2),
  fought = (SELECT max(fought) FROM entries e WHERE e.site = ?1 AND e.event = ?2)
  WHERE site = ?1 AND event = ?2`;

// The rankings over the board under the finishes counted (?2, JSON): each total is the sum of the
// counted groups' columns. A record (won, lost) is the tally's where it holds a counted finish, else
// the results' own. ?1 site. `only` narrows the board's rows: a list writes "AND dup = 0" to leave a person's other
// accounts on the site out (+dup where an index other than board_ranked reads it).
const counted = (off) => { let out = []; try { out = JSON.parse(off); } catch {} return GROUPS.filter((g) => !out.includes(g)); };
const careersOf = (off, only = '') => {
  const on = counted(off);
  const sum = (prefix) => (on.length ? on.map((g) => `${prefix}_${g}`).join(' + ') : '0');
  return `careers AS (SELECT user, dup, at, source, types, name, club, club_id, country, country_name, photo, born, hidden, belt, last, events, gold, silver, bronze, ${cols('w')}, ${cols('rl')},
    ${sum('w')} AS wins,
    iif(source = 'results', ${sum('sl')}, NULL) AS losses,
    iif(${sum('rw')} + ${sum('rl')} > 0, ${sum('rw')}, iif(source = 'results', ${sum('w')}, NULL)) AS won,
    iif(${sum('rw')} + ${sum('rl')} > 0, ${sum('rl')}, iif(source = 'results', ${sum('sl')}, NULL)) AS lost,
    iif(${sum('rw')} + ${sum('rl')} > 0 OR source = 'results', json_object(${GROUPS.map((g) => `'${g}', rl_${g}`).join(', ')}), NULL) AS lost_types,
    w_walkover AS walkovers, w_submission AS submission, w_points AS points
  FROM board WHERE site = ?1 ${only})`;
};

// An entry shown: an athlete's results at an event, else their registration there while no results are
// read (`within` narrows the results that outrank it, as to one division). Entries are aliased e.
const shown = (within = '') => `(e.fought = 1 OR NOT EXISTS (SELECT 1 FROM entries x WHERE x.site = e.site AND x.event = e.event AND x.user = e.user${within} AND x.fought = 1))`;

const careerRow = (row) => ({ ...Object.fromEntries(Object.entries(row).filter(([k]) => !/^(w|rl)_/.test(k))), types: JSON.parse(row.types ?? '{}'), lost_types: row.lost_types ? JSON.parse(row.lost_types) : null });

// A sort is a fixed expression, or one finish type's count of wins (the type) or losses (lost_ and the type);
// ?dir=asc reverses it, blanks still last.
const flip = (sort, dir) => (dir === 'asc' ? sort.replace(/ DESC( NULLS LAST)?/g, ' ASC NULLS LAST') : sort);
// Ties go to the more decisive wins (submissions, then stoppages, points, decisions) and the less decisive
// losses; WORSE_LOSSES ranks the decisive losses first, for a list of losses. -x DESC flips with ?dir=asc as x DESC does.
const DECISIVE = ['submission', 'stoppage', 'points', 'decision'];
const BETTER_WINS = DECISIVE.map((g) => `w_${g} DESC`).join(', ');
const WORSE_LOSSES = DECISIVE.map((g) => `rl_${g} DESC`).join(', ');
const BETTER_LOSSES = DECISIVE.map((g) => `-rl_${g} DESC`).join(', ');
const lostBy = (key) => GROUPS.includes(key?.slice(5)) && key.startsWith('lost_') && `iif(lost IS NULL, NULL, rl_${key.slice(5)}) DESC NULLS LAST, lost DESC, ${WORSE_LOSSES}`;
const order = (sorts, key, dir) => flip(sorts[key] ?? (GROUPS.includes(key) ? `w_${key} DESC, wins DESC, ${BETTER_WINS}` : lostBy(key) || sorts.wins), dir);
const ATHLETE_SORTS = {
  wins: `wins DESC, ${BETTER_WINS}`,
  events: 'events DESC, wins DESC',
  submission: `submission DESC, wins DESC, ${BETTER_WINS}`,
  rate: 'submission * 1.0 / wins DESC, wins DESC',
  medals: 'gold DESC, silver DESC, bronze DESC, wins DESC',
  perEvent: 'wins * 1.0 / events DESC, wins DESC',
  last: 'last DESC, wins DESC',
  // Ties go to the longer record either way (-x ASC, which ?dir=asc leaves as is): at 0%, 0–2 before 0–1; then to how they came.
  winRate: `won * 1.0 / nullif(won + lost, 0) DESC NULLS LAST, -(won + lost) ASC, ${BETTER_WINS}, ${BETTER_LOSSES}`,
  losses: `lost DESC NULLS LAST, ${WORSE_LOSSES}, -(won + lost) ASC`,
};

async function athletes(env, params) {
  const f = filters(params);
  const sort = order(ATHLETE_SORTS, params.get('sort'), params.get('dir'));
  const club = /^\d{1,12}$/.test(params.get('club') ?? '') ? params.get('club') : '';
  // Only the filters set go in, so the default ranking (wins, walkovers left out) reads its page and its
  // count off board_record; ranked on the sort keys alone, then the page's rows read whole (CROSS JOIN, or
  // SQLite walks the whole board in board_record's order to find the page's rows).
  const args = [f.site];
  const arg = (value) => `?${args.push(value)}`;
  // One academy's are read through board_club (the + keeps board_record out of the filter and the order).
  const wins = club ? '+wins' : 'wins';
  // Everyone with a counted win or loss: an athlete who only lost under the finishes counted ranks too.
  const where = [`(${wins} > 0 OR lost > 0)`];
  if (f.wins) where.push(`${wins} >= ${arg(f.wins)}`);
  if (f.events) where.push(`coalesce(events, 0) >= ${arg(f.events)}`);
  if (f.belts !== '[]') where.push(`belt IN (SELECT value FROM json_each(${arg(f.belts)}))`);
  if (f.q) { const q = arg(f.q); where.push(`(name LIKE '%' || ${q} || '%' OR club LIKE '%' || ${q} || '%')`); }
  if (club) where.push(`club_id = ${arg(club)}`);
  if (f.country) where.push(`country = ${arg(f.country)}`);
  if (f.bornFrom !== 0 || f.bornTo !== 9999) where.push(`born BETWEEN ${arg(f.bornFrom)} + 1 AND ${arg(f.bornTo)}`);
  if (f.since) where.push(`last >= ${arg(f.since)}`);
  const matching = where.join(' AND ');
  const [limit, offset] = [arg(f.limit), arg(f.offset)];
  // Ranked by wins, the page's fewest wins are read off board_record first, so ties are sorted by finish among the
  // athletes with at least that many alone (the finishes left SQLite sorting every athlete: 3 s).
  const floor = !club && sort.startsWith('wins DESC')
    ? ` AND wins >= coalesce((SELECT wins FROM careers WHERE ${matching} ORDER BY wins DESC LIMIT 1 OFFSET ${limit} + ${offset} - 1), 0)` : '';
  const { results } = await env.DB.prepare(`WITH ${careersOf(f.off, club ? 'AND +dup = 0' : 'AND dup = 0')},
    top AS (SELECT user FROM careers WHERE ${matching}${floor} ORDER BY ${club ? sort.replace(/^wins /, '+wins ') : sort}, user LIMIT ${limit} OFFSET ${offset})
    SELECT careers.*, (SELECT count(*) FROM careers WHERE ${matching}) AS total FROM top CROSS JOIN careers USING (user) ORDER BY ${sort}, user`)
    .bind(...args).all();
  return json({ total: results[0]?.total ?? 0, offset: f.offset, rows: results.map(careerRow) });
}

const TEAM_SORTS = {
  wins: 'wins DESC',
  athletes: 'athletes DESC, wins DESC',
  average: 'wins * 1.0 / athletes DESC, wins DESC',
  submission: 'submission DESC, wins DESC',
  // Medals won for the academy (an older link's "medals" sorts the same).
  medals: 'podium_gold DESC, podium_silver DESC, podium_bronze DESC, wins DESC',
  podiums: 'podium_gold DESC, podium_silver DESC, podium_bronze DESC, wins DESC',
};

// An academy is its athletes with a readable career, under the academy their latest event gave.
async function teams(env, params) {
  const f = filters(params);
  const sort = flip(TEAM_SORTS[params.get('sort')] ?? TEAM_SORTS.wins, params.get('dir'));
  // Each academy's three athletes with the most wins come with it, read for the academies shown alone,
  // through board_club: the + keeps them off board_record, which walked every athlete once per academy and
  // took D1 past its CPU limit.
  const least = whole(params.get('athletes'), 3, 1000);
  const { results } = await env.DB.prepare(`WITH ${careersOf(f.off, 'AND +dup = 0')},
    members AS (SELECT * FROM careers
      WHERE club_id IS NOT NULL AND +wins >= ?4 AND (+wins > 0 OR lost > 0) AND coalesce(events, 0) >= ?5 AND (?6 = '[]' OR belt IN (SELECT value FROM json_each(?6))) AND (?11 = '' OR country = ?11) AND ((?12 = 0 AND ?13 = 9999) OR born BETWEEN ?12 + 1 AND ?13) AND (?14 = '' OR last >= ?14)),
    podiums AS (SELECT c.club_id, c.club, c.podium_gold, c.podium_silver, c.podium_bronze, c.entered,
        iif(o.lat IS NULL, c.lat, o.lat) AS lat, iif(o.lat IS NULL, c.lng, o.lng) AS lng, iif(o.lat IS NULL, c.city, o.city) AS city, iif(o.lat IS NULL, c.country, o.country) AS country,
        iif(o.lat IS NULL, iif(c.lat IS NULL, NULL, 'events'), o.source) AS placed
      FROM clubs c LEFT JOIN club_places o ON o.site = c.site AND o.club_id = c.club_id WHERE c.site = ?1),
    totals AS (SELECT m.club_id, p.club, p.city, p.country AS club_country, p.placed, p.lat, p.lng, ${KM('p.lat', 'p.lng', 15)} AS km, count(*) AS athletes, sum(wins) AS wins, sum(submission) AS submission, sum(points) AS points,
      sum(gold) AS gold, sum(silver) AS silver, sum(bronze) AS bronze,
      coalesce(p.podium_gold, 0) AS podium_gold, coalesce(p.podium_silver, 0) AS podium_silver, coalesce(p.podium_bronze, 0) AS podium_bronze, coalesce(p.entered, 0) AS entered,
      count(*) OVER () AS total
    FROM members m LEFT JOIN podiums p USING (club_id)
    WHERE (?7 = '' OR p.club LIKE '%' || ?7 || '%') AND (?17 = 0 OR ${KM('p.lat', 'p.lng', 15)} <= ?17)
    GROUP BY m.club_id HAVING count(*) >= ?8),
    shown AS (SELECT * FROM totals ORDER BY ${sort}, club_id LIMIT ?9 OFFSET ?10)
    SELECT *, (SELECT json_group_array(json_object('user', user, 'name', name, 'wins', wins, 'belt', belt, 'photo', photo, 'born', born))
        FROM (SELECT * FROM members t WHERE t.club_id = shown.club_id ORDER BY +wins DESC, user LIMIT 3)) AS top
    FROM shown ORDER BY ${sort}, club_id`)
    .bind(f.site, f.off, Date.now() - KEPT, f.wins, f.events, f.belts, f.q, least, f.limit, f.offset, f.country, f.bornFrom, f.bornTo, f.since, f.lat, f.lng, f.km).all();
  return json({ total: results[0]?.total ?? 0, offset: f.offset, rows: results.map((r) => ({ ...r, top: JSON.parse(r.top) })) });
}

// What one account holds, as the athlete page reads it.
const account = (env, f, site, user) => [
  env.DB.prepare(`WITH ${careersOf(f.off)} SELECT * FROM careers WHERE user = ?4`).bind(site, f.off, Date.now() - KEPT, user),
  env.DB.prepare('SELECT * FROM people WHERE site = ?1 AND user = ?2').bind(site, user),
  env.DB.prepare(`SELECT e.event, e.division, e.club, e.club_id, e.place, e.wins, e.losses, e.fought, e.bouts, v.title, v.start, v.city, v.country
    FROM entries e LEFT JOIN events v ON v.site = e.site AND v.event = e.event WHERE e.site = ?1 AND e.user = ?2 AND ${shown()} ORDER BY v.start DESC, e.event DESC`).bind(site, user),
  env.DB.prepare(`SELECT h.event, h.title, h.start, h.city, h.wins, h.image, h.gold, h.silver, h.bronze, v.event IS NOT NULL AS known
    FROM history h LEFT JOIN events v ON v.site = h.site AND v.event = h.event WHERE h.site = ?1 AND h.user = ?2 ORDER BY h.start DESC`).bind(site, user),
  // Each event's finishes won and lost, every loss and everyone met, as their profile's match lists gave them.
  env.DB.prepare(`SELECT event, start, title, out FROM outcomes WHERE site = ?1 AND user = ?2 ORDER BY start DESC`).bind(site, user),
  // When each belt began, as their profile dates them.
  env.DB.prepare("SELECT worn, starts FROM belts WHERE site = ?1 AND user = ?2").bind(site, user),
  // Belts in each art, rankings, academy and affiliation, match videos, as their profile shows them.
  env.DB.prepare('SELECT entry FROM profiles WHERE site = ?1 AND user = ?2').bind(site, user),
  // Everyone in their divisions, so each opponent the match lists name (by name alone) links to their page.
  env.DB.prepare(`SELECT DISTINCT e.event, e.user, p.name FROM entries mine CROSS JOIN entries e ON e.site = mine.site AND e.event = mine.event AND e.division = mine.division AND e.user != mine.user
    JOIN people p ON p.site = e.site AND p.user = e.user WHERE mine.site = ?1 AND mine.user = ?2`).bind(site, user),
];

async function athlete(env, params) {
  const f = filters(params);
  const user = params.get('id') ?? '';
  if (!/^\d{1,12}$/.test(user)) return json({ error: 'Bad athlete' }, 400);
  const { results: others } = await env.DB.prepare(`WITH ${MEMBERS('(SELECT ?1 AS site, ?2 AS user) f')}
    SELECT p.site, p.user, p.name, p.club FROM members m CROSS JOIN people p ON p.site = m.site AND p.user = m.user WHERE NOT (p.site = ?1 AND p.user = ?2)
    ORDER BY p.site = ?1 DESC, p.seen DESC LIMIT 10`).bind(f.site, user).all();
  const accounts = [{ site: f.site, user }, ...others];
  const read = await env.DB.batch(accounts.flatMap((a) => account(env, f, a.site, a.user)));
  // An opponent links to the one entrant in their divisions there who goes by that name.
  const key = (event, name) => `${event} ${String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const each = accounts.map(({ site }, i) => {
    const [career, person, entries, history, outcomes, belts, extras, rivals] = read.slice(i * 8, i * 8 + 8);
    const met = new Map();
    for (const r of rivals.results) { const k = key(r.event, r.name); met.set(k, met.has(k) && met.get(k) !== r.user ? null : r.user); }
    const link = (event, name, m) => ({ ...m, user: met.get(key(event, name)) ?? null });
    return {
      career: career.results[0] ? careerRow(career.results[0]) : null,
      person: person.results[0] ?? null,
      entries: entries.results.map((e) => ({ ...e, site, wins: JSON.parse(e.wins), losses: JSON.parse(e.losses), bouts: e.bouts ? JSON.parse(e.bouts) : null })),
      history: history.results.map((h) => ({ ...h, site })),
      outcomes: outcomes.results.map((o) => {
        const out = JSON.parse(o.out);
        return { ...o, site, out: { ...out, faced: (out.faced ?? []).map((m) => link(o.event, m.name, m)), losses: (out.losses ?? []).map((l) => link(o.event, l.opponent, l)) } };
      }),
      profile: extras.results[0] ? JSON.parse(extras.results[0].entry) : null,
      belts: belts.results[0] ? { worn: JSON.parse(belts.results[0].worn), starts: JSON.parse(belts.results[0].starts) } : null,
    };
  });
  const [me] = each;
  if (!me.career && !me.person && !me.entries.length) return json({ error: 'Not found' }, 404);
  // Each account's events, newest first; their profile, belts and who they are from this account, else another's.
  const newest = (a, b) => String(b.start ?? '').localeCompare(String(a.start ?? ''));
  return json({
    history: each.flatMap((a) => a.history).sort(newest),
    // The board sums each account's person (MERGE): this account's row, else another's.
    career: each.find((a) => a.career)?.career ?? null,
    person: me.person,
    entries: each.flatMap((a) => a.entries).sort(newest),
    outcomes: each.flatMap((a) => a.outcomes).sort(newest),
    profile: each.find((a) => a.profile)?.profile ?? null,
    belts: each.find((a) => a.belts)?.belts ?? null,
    accounts: others.map(({ site, user: id, name, club }) => ({ site, user: id, name, club })),
  }, 200, 'no-store'); // a profile just opened shows at once
}

async function team(env, params) {
  const f = filters(params);
  const club = params.get('id') ?? '';
  if (!/^\d{1,12}$/.test(club)) return json({ error: 'Bad team' }, 400);
  const [members, events] = await env.DB.batch([
    env.DB.prepare(`WITH ${careersOf(f.off)} SELECT p.user, p.name, p.club, p.country, p.country_name, p.photo, p.hidden, p.born, coalesce(c.belt, p.belt) AS belt, p.seen,
        c.wins, c.losses, c.source, c.walkovers, c.submission, c.points, c.types, c.gold, c.silver, c.bronze, c.events
      FROM people p LEFT JOIN careers c ON c.user = p.user WHERE p.site = ?1 AND p.club_id = ?4 AND coalesce(c.dup, 0) = 0`).bind(f.site, f.off, Date.now() - KEPT, club),
    // Grouped by +e.event, or SQLite walks every entry on the site for the order instead of this academy's.
    env.DB.prepare(`SELECT e.event, v.title, v.start, v.city, v.country, count(DISTINCT e.user) AS athletes, max(e.fought) AS fought,
        sum(e.place = 1) AS gold, sum(e.place = 2) AS silver, sum(e.place = 3) AS bronze, json_group_array(json_object('wins', json(e.wins), 'losses', json(e.losses))) AS records
      FROM entries e LEFT JOIN events v ON v.site = e.site AND v.event = e.event WHERE e.site = ?1 AND e.club_id = ?2
      GROUP BY +e.event ORDER BY v.start DESC, e.event DESC`).bind(f.site, club),
  ]);
  const named = members.results.filter((m) => m.club).sort((a, b) => b.seen.localeCompare(a.seen))[0];
  if (!members.results.length && !events.results.length) return json({ error: 'Not found' }, 404);
  return json({
    club: { id: club, name: named?.club ?? null },
    members: members.results.map((m) => ({ ...m, types: m.types ? JSON.parse(m.types) : null })),
    events: events.results.map((e) => ({ ...e, records: JSON.parse(e.records) })),
  });
}

// Grappling events, upcoming (soonest first, from today) or past (latest first), within `days` of today
// (0 for any), of a sport, with at least `min` athletes, within `km` of a place. The counts are kept on
// each event (EVENT_COUNTS): an upcoming one nobody opened has none yet and shows unless a minimum is
// set; a past one shows once read. Sorted by date, distance or size.
async function events(env, params) {
  const f = filters(params);
  const upcoming = params.get('when') !== 'past';
  const today = new Date().toISOString().slice(0, 10);
  const days = whole(params.get('days'), 0, 3660);
  const shift = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const [from, to] = upcoming ? [today, days ? shift(days) : '9999'] : [days ? shift(-days) : '', shift(-1)];
  const order = { distance: 'km IS NULL, km, start', athletes: 'athletes DESC, start' }[params.get('sort')] ?? (upcoming ? 'start, event' : 'start DESC, event DESC');
  // Both sites' events in one list, each with its site. AJP Tour files every event under Gi, so one whose
  // title says No-Gi counts as NoGi too.
  const { results } = await env.DB.prepare(`SELECT * FROM (SELECT v.site, v.event, v.title, v.start, v.city, v.country, v.organiser, v.lat, v.lng, v.url,
      coalesce(v.athletes, 0) AS athletes, coalesce(v.divisions, 0) AS divisions, coalesce(v.teams, 0) AS teams, v.fought, ${KM('v.lat', 'v.lng', 5)} AS km
    FROM events v
    WHERE substr(v.start, 1, 10) BETWEEN ?3 AND ?4 AND (?2 = '' OR v.title LIKE '%' || ?2 || '%' OR v.city LIKE '%' || ?2 || '%')
      AND (v.sports IS NULL OR EXISTS (SELECT 1 FROM json_each(v.sports) s WHERE s.value IN (SELECT value FROM json_each(?8)))
        OR (?1 = 'nogi' AND (v.title LIKE '%no-gi%' OR v.title LIKE '%nogi%' OR v.title LIKE '%no gi%')))
      AND coalesce(v.athletes, 0) >= max(?9, ?10))
    WHERE ?7 = 0 OR km <= ?7
    ORDER BY ${order}, site LIMIT ?11 OFFSET ?12`)
    .bind(params.get('sport') ?? '', f.q, from, to, f.lat, f.lng, f.km, JSON.stringify(SPORTS[params.get('sport')] ?? SPORTS.grappling), whole(params.get('min'), 0), upcoming ? 0 : 1, f.limit, f.offset).all();
  return json({ rows: results });
}

// Places to search from: any town by name (Open-Meteo's geocoder, over GeoNames; only the typed name
// leaves for it, and its answers are cached a day), in English and the reader's language (`lang`), as
// a local name matches only in its own; biggest first. Else the cities events were held in, best match
// then most events first. env.GEOCODER '' leaves the geocoder out.
async function places(env, params) {
  const f = filters(params);
  if (f.q.length < 2) return json({ rows: [] });
  const geocoder = env.GEOCODER ?? 'https://geocoding-api.open-meteo.com/v1/search';
  if (geocoder) {
    const langs = [...new Set(['en', /^[a-z]{2}$/.test(params.get('lang') ?? '') ? params.get('lang') : 'en'])];
    const ask = (language) => fetch(`${geocoder}?${new URLSearchParams({ name: f.q, count: '8', language, format: 'json' })}`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => (r.ok ? (await r.json()).results ?? [] : [])).catch(() => []);
    const found = [...new Map((await Promise.all(langs.map(ask))).flat().map((p) => [p.id, p])).values()].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 8);
    if (found.length) return json({ rows: found.map((p) => ({ city: p.name, region: p.admin1 ?? null, country: p.country_code ?? null, lat: p.latitude, lng: p.longitude })) });
  }
  const c = matcher(f.q, 'events_fts', 'city', 'city', 1);
  const { results } = await env.DB.prepare(`SELECT city, country, avg(lat) AS lat, avg(lng) AS lng, count(*) AS events, min(${c.tier}) AS tier FROM events
    WHERE lat IS NOT NULL AND city IS NOT NULL AND ${c.filter} GROUP BY city, country ORDER BY tier, events DESC LIMIT 8`)
    .bind(...c.tierBinds, ...c.filterBinds).all();
  return json({ rows: results.map(({ tier, ...r }) => r) });
}

async function event(env, params) {
  const f = filters(params);
  const id = params.get('id') ?? '';
  if (!/^\d{1,9}$/.test(id)) return json({ error: 'Bad event' }, 400);
  const [meta, entries] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM events WHERE site = ?1 AND event = ?2').bind(f.site, id),
    env.DB.prepare(`WITH ${careersOf(f.off)} SELECT e.user, e.division, e.club, e.club_id, e.place, e.wins, e.losses, e.fought, e.at,
        p.name, p.country, p.country_name, p.photo, p.hidden, p.born, coalesce(c.belt, p.belt) AS belt,
        c.wins AS career_wins, c.source AS career_source, c.types AS career_types, c.won AS career_won, c.lost AS career_lost, c.events AS career_events, c.gold AS career_gold, c.silver AS career_silver, c.bronze AS career_bronze
      FROM entries e LEFT JOIN people p ON p.site = e.site AND p.user = e.user LEFT JOIN careers c ON c.user = e.user
      WHERE e.site = ?1 AND e.event = ?4 AND ${shown()}`).bind(f.site, f.off, Date.now() - KEPT, id),
  ]);
  if (!meta.results.length && !entries.results.length) return json({ error: 'Not found' }, 404);
  return json({
    event: meta.results[0] ?? { event: id },
    entries: entries.results.map((e) => ({ ...e, wins: JSON.parse(e.wins), losses: JSON.parse(e.losses) })),
  });
}

// One division of an event: its athletes, each with their place, record and matches.
async function division(env, params) {
  const f = filters(params);
  const id = params.get('id') ?? '';
  const name = (params.get('name') ?? '').trim().slice(0, 200);
  if (!/^\d{1,9}$/.test(id) || !name) return json({ error: 'Bad division' }, 400);
  const [meta, entries] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM events WHERE site = ?1 AND event = ?2').bind(f.site, id),
    env.DB.prepare(`WITH ${careersOf(f.off)} SELECT e.user, e.division, e.club, e.club_id, e.place, e.wins, e.losses, e.fought, e.bouts, e.at,
        p.name, p.country, p.country_name, p.photo, p.hidden, p.born, coalesce(c.belt, p.belt) AS belt,
        c.wins AS career_wins, c.source AS career_source, c.types AS career_types, c.won AS career_won, c.lost AS career_lost, c.events AS career_events, c.gold AS career_gold
      FROM entries e LEFT JOIN people p ON p.site = e.site AND p.user = e.user LEFT JOIN careers c ON c.user = e.user
      WHERE e.site = ?1 AND e.event = ?4 AND trim(e.division) = ?5
        AND ${shown(' AND x.division = e.division')}`)
      .bind(f.site, f.off, Date.now() - KEPT, id, name),
  ]);
  if (!entries.results.length) return json({ error: 'Not found' }, 404);
  return json({
    event: meta.results[0] ?? { event: id },
    entries: entries.results.map((e) => ({ ...e, wins: JSON.parse(e.wins), losses: JSON.parse(e.losses), bouts: e.bouts ? JSON.parse(e.bouts) : null })),
  });
}

// Which rows a search matches (`filter`) and how well (`tier`: 0 the whole text, then starting with
// the query, then a word starting with it, then containing its words in any order), each with its
// binds. Words of 3 letters or more go through the table's trigram index (accents folded); a query
// with none scans. `starts` is the tier for a text that starts with the query (1, or 2 to count it
// as any word start); `cols` the indexed columns to match, `text` the one ranked. `site` keeps the
// site index from being picked over the matched rowids.
function matcher(q, fts, cols, text, starts) {
  const words = q.split(/\s+/).filter(Boolean);
  const phrase = words.join(' ');
  const long = words.filter((w) => [...w].length >= 3);
  const quote = (s) => `"${s.replaceAll('"', '""')}"`;
  const escape = (s) => s.replace(/[\\%_]/g, '\\$&');
  const indexed = `rowid IN (SELECT rowid FROM ${fts} WHERE ${fts} MATCH ?)`;
  const like = `${text} LIKE ? ESCAPE '\\'`;
  const short = words.filter((w) => !long.includes(w));
  const [filter, filterBinds] = long.length
    ? [[indexed, ...short.map(() => like)].join(' AND '), [`${cols} : (${long.map(quote).join(' AND ')})`, ...short.map((w) => `%${escape(w)}%`)]]
    : [words.map(() => like).join(' AND '), words.map((w) => `%${escape(w)}%`)];
  const [head, word] = long.length ? [[indexed, `${text} : ^${quote(phrase)}`], [indexed, `${text} : ${quote(` ${phrase}`)}`]] : [[like, `${escape(phrase)}%`], [like, `% ${escape(phrase)}%`]];
  return {
    site: long.length ? '+site' : 'site', filter, filterBinds,
    tier: `CASE WHEN ${head[0]} THEN iif(length(${text}) = ?, 0, ${starts}) WHEN ${word[0]} THEN 2 ELSE 3 END`,
    tierBinds: [head[1], [...phrase].length, word[1]],
  };
}

async function search(env, params) {
  const f = filters(params);
  if (f.q.length < 2) return json({ athletes: [], teams: [], events: [] });
  // An athlete's name matched at any word's start ranks by wins (the finishes counted); only the whole name comes first.
  const a = matcher(f.q, 'people_fts', 'name', 'name', 2);
  const t = matcher(f.q, 'people_fts', 'club', 'club', 2);
  const e = matcher(f.q, 'events_fts', '{title city}', 'title', 2);
  const on = counted(f.off);
  const wins = `coalesce((SELECT ${on.length ? on.map((g) => `w_${g}`).join(' + ') : '0'} FROM board b WHERE b.site = people.site AND b.user = people.user), 0)`;
  const [people, clubs, found] = await env.DB.batch([
    env.DB.prepare(`SELECT user, name, club, country, photo, hidden, ${wins} AS wins FROM people WHERE ${a.site} = ? AND ${a.filter} ORDER BY ${a.tier}, wins DESC, seen DESC LIMIT 8`)
      .bind(f.site, ...a.filterBinds, ...a.tierBinds),
    // min() makes the bare club the name of the best-matching athlete's row.
    env.DB.prepare(`SELECT club_id, club, athletes FROM (SELECT club_id, club, count(*) AS athletes, min(${t.tier}) AS tier FROM people
      WHERE ${t.site} = ? AND club_id IS NOT NULL AND ${t.filter} GROUP BY club_id) ORDER BY tier, athletes DESC LIMIT 6`)
      .bind(...t.tierBinds, f.site, ...t.filterBinds),
    env.DB.prepare(`SELECT event, title, start, city FROM events WHERE ${e.site} = ? AND ${e.filter} ORDER BY ${e.tier}, start DESC LIMIT 6`)
      .bind(f.site, ...e.filterBinds, ...e.tierBinds),
  ]);
  return json({ athletes: people.results, teams: clubs.results, events: found.results });
}

async function countries(env, params) {
  const f = filters(params);
  const { results } = await env.DB.prepare(`SELECT country, max(country_name) AS name, count(*) AS athletes FROM people WHERE site = ?1 AND country IS NOT NULL GROUP BY country ORDER BY athletes DESC`).bind(f.site).all();
  return json({ rows: results });
}

async function summary(env, params) {
  const f = filters(params);
  const row = await env.DB.prepare(`SELECT
      (SELECT count(*) FROM athletes WHERE site = ?1 AND kind = 'careers' AND entry ->> '$.wins' IS NOT NULL AND ?2 IS NOT NULL) AS careers,
      (SELECT count(*) FROM people WHERE site = ?1) AS people,
      (SELECT count(DISTINCT club_id) FROM people WHERE site = ?1) AS teams,
      (SELECT count(*) FROM events WHERE site = ?1) AS events,
      (SELECT max(at) FROM athletes WHERE site = ?1) AS updated`).bind(f.site, Date.now() - KEPT).first();
  return json(row);
}

export const API = { athletes, teams, athlete, team, events, event, division, search, summary, countries, places };
