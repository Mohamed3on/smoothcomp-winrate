// The public site's reads. Every list takes the same quality filters: a site,
// the finish types counted, a belt, a country, and the fewest wins and events that count.
const SITES = ['smoothcomp.com', 'ajptour.com'];
const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
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
  };
}

// Each athlete's totals, kept up to date as results, match lists and event lists arrive, so a
// ranking reads one row per athlete instead of every result. Per finish, as [won, lost]:
// `rec` from the match lists of their profile where it was opened (walkovers never count there;
// its fastest escape is a career's fastest_escape) with the results read at every event those lists
// don't hold (for an athlete whose profile nobody opened, every event read); `seen` from every
// event read. Medals and events from the events read, `listed` the events their profile lists,
// `last` their latest event. ?1 site, ?2 the athletes (JSON).
export const TALLY = `INSERT OR REPLACE INTO tallies (site, user, rec, seen, gold, silver, bronze, events, listed, last)
  WITH us AS (SELECT DISTINCT value AS user FROM json_each(?2)),
  fe AS (SELECT e.* FROM entries e JOIN us USING (user) WHERE e.site = ?1 AND e.fought = 1),
  per AS (
    SELECT o.user, iif(j.key = 'escape', 'fastest_escape', j.key) AS t, j.value ->> 0 AS w, j.value ->> 1 AS l FROM outcomes o JOIN us USING (user), json_each(o.out, '$.types') j WHERE o.site = ?1
    UNION ALL SELECT f.user, j.key, j.value, 0 FROM fe f, json_each(f.wins) j WHERE NOT EXISTS (SELECT 1 FROM outcomes x WHERE x.site = ?1 AND x.user = f.user AND x.event = f.event)
    UNION ALL SELECT f.user, j.key, 0, j.value FROM fe f, json_each(f.losses) j WHERE NOT EXISTS (SELECT 1 FROM outcomes x WHERE x.site = ?1 AND x.user = f.user AND x.event = f.event)),
  rec AS (SELECT user, json_group_object(t, json_array(w, l)) AS rec FROM (SELECT user, t, sum(w) AS w, sum(l) AS l FROM per GROUP BY user, t) GROUP BY user),
  read AS (SELECT f.user, j.key AS t, j.value AS w, 0 AS l FROM fe f, json_each(f.wins) j UNION ALL SELECT f.user, j.key, 0, j.value FROM fe f, json_each(f.losses) j),
  seen AS (SELECT user, json_group_object(t, json_array(w, l)) AS seen FROM (SELECT user, t, sum(w) AS w, sum(l) AS l FROM read GROUP BY user, t) GROUP BY user),
  med AS (SELECT user, sum(place = 1) AS gold, sum(place = 2) AS silver, sum(place = 3) AS bronze, count(DISTINCT event) AS events FROM fe GROUP BY user),
  listed AS (SELECT h.user, count(*) AS listed, max(substr(h.start, 1, 10)) AS last FROM history h JOIN us USING (user) WHERE h.site = ?1 GROUP BY h.user),
  latest AS (SELECT f.user, max(substr(v.start, 1, 10)) AS last FROM fe f JOIN events v ON v.site = f.site AND v.event = f.event GROUP BY f.user)
  SELECT ?1, us.user, rec.rec, seen.seen, coalesce(med.gold, 0), coalesce(med.silver, 0), coalesce(med.bronze, 0), coalesce(med.events, 0), coalesce(listed.listed, 0),
    nullif(max(coalesce(listed.last, ''), coalesce(latest.last, '')), '')
  FROM us LEFT JOIN rec USING (user) LEFT JOIN seen USING (user) LEFT JOIN med USING (user) LEFT JOIN listed USING (user) LEFT JOIN latest USING (user)`;

// Every athlete with something to rank, with who they are. A career is Smoothcomp's;
// with none readable (a profile not public, or not read yet), an athlete's results at
// the events Mat Stats has read stand in: wins by finish, losses, placements, events.
// The record (`won`, `lost`) is their tally's under the finishes counted.
// ?1 site, ?2 the finish types left out (JSON), ?3 oldest career kept.
const CAREERS = `t AS (SELECT * FROM tallies WHERE site = ?1),
  readable AS (
    SELECT user, at, entry FROM athletes WHERE site = ?1 AND kind = 'careers' AND at > ?3 AND entry ->> '$.wins' IS NOT NULL),
  base AS (
    SELECT readable.user, at, 'career' AS source, entry ->> '$.wins' AS types, NULL AS losses,
      coalesce(entry ->> '$.medals[0]', 0) AS gold, coalesce(entry ->> '$.medals[1]', 0) AS silver, coalesce(entry ->> '$.medals[2]', 0) AS bronze,
      nullif(max(coalesce(entry ->> '$.events', 0), coalesce(t.listed, 0)), 0) AS events
    FROM readable LEFT JOIN t USING (user)
    UNION ALL
    SELECT t.user, NULL, 'results', coalesce((SELECT json_group_object(key, value ->> 0) FROM json_each(t.seen) WHERE value ->> 0 > 0), '{}'),
      (SELECT total(value ->> 1) FROM json_each(t.seen) WHERE key NOT IN (SELECT value FROM json_each(?2))), t.gold, t.silver, t.bronze, t.events
    FROM t WHERE t.events > 0 AND t.user NOT IN (SELECT user FROM readable)),
  counted AS (
  SELECT b.*, (SELECT total(value) FROM json_each(b.types) WHERE key NOT IN (SELECT value FROM json_each(?2))) AS wins FROM base b),
  careers AS (
  SELECT b.user, b.at, b.source, b.losses, b.wins,
    coalesce((SELECT iif(count(*), total(value ->> 0), NULL) FROM json_each(tl.rec) WHERE key NOT IN (SELECT value FROM json_each(?2))), iif(b.source = 'results', b.wins, NULL)) AS won,
    coalesce((SELECT iif(count(*), total(value ->> 1), NULL) FROM json_each(tl.rec) WHERE key NOT IN (SELECT value FROM json_each(?2))), iif(b.source = 'results', b.losses, NULL)) AS lost,
    coalesce(b.types ->> '$.walkover', 0) AS walkovers,
    coalesce(b.types ->> '$.submission', 0) AS submission,
    coalesce(b.types ->> '$.points', 0) AS points,
    b.types, b.gold, b.silver, b.bronze, b.events,
    p.name, p.club, p.club_id, p.country, p.country_name, p.photo, p.born, p.hidden, coalesce(r.entry ->> '$.belt', p.belt) AS belt, tl.last
  FROM counted b
  LEFT JOIN t tl ON tl.user = b.user
  LEFT JOIN people p ON p.site = ?1 AND p.user = b.user
  LEFT JOIN athletes r ON r.site = ?1 AND r.user = b.user AND r.kind = 'ranks')`;

const careerRow = (row) => ({ ...row, types: JSON.parse(row.types ?? '{}') });

// A sort is a fixed expression, or one finish type's count.
const order = (sorts, key) => sorts[key] ?? (TYPE.test(key ?? '') && !/['"]/.test(key) ? `coalesce(types ->> '$."${key}"', 0) DESC, wins DESC` : sorts.wins);
const ATHLETE_SORTS = {
  wins: 'wins DESC',
  events: 'events DESC, wins DESC',
  submission: 'submission DESC, wins DESC',
  rate: 'submission * 1.0 / wins DESC, wins DESC',
  medals: 'gold DESC, silver DESC, bronze DESC, wins DESC',
  perEvent: 'wins * 1.0 / events DESC, wins DESC',
  last: 'last DESC, wins DESC',
  winRate: 'won * 1.0 / nullif(won + lost, 0) DESC NULLS LAST, won + lost DESC, wins DESC',
};

async function athletes(env, params) {
  const f = filters(params);
  const sort = order(ATHLETE_SORTS, params.get('sort'));
  const club = /^\d{1,12}$/.test(params.get('club') ?? '') ? params.get('club') : '';
  const { results } = await env.DB.prepare(`WITH ${CAREERS}
    SELECT *, count(*) OVER () AS total FROM careers
    WHERE wins >= ?4 AND wins > 0 AND coalesce(events, 0) >= ?5 AND (?6 = '[]' OR belt IN (SELECT value FROM json_each(?6))) AND (?7 = '' OR name LIKE '%' || ?7 || '%' OR club LIKE '%' || ?7 || '%')
      AND (?8 = '' OR club_id = ?8) AND (?11 = '' OR country = ?11) AND ((?12 = 0 AND ?13 = 9999) OR born BETWEEN ?12 + 1 AND ?13) AND (?14 = '' OR last >= ?14)
    ORDER BY ${sort}, user LIMIT ?9 OFFSET ?10`)
    .bind(f.site, f.off, Date.now() - KEPT, f.wins, f.events, f.belts, f.q, club, f.limit, f.offset, f.country, f.bornFrom, f.bornTo, f.since).all();
  return json({ total: results[0]?.total ?? 0, offset: f.offset, rows: results.map(careerRow) });
}

const TEAM_SORTS = {
  wins: 'wins DESC',
  athletes: 'athletes DESC, wins DESC',
  average: 'sum(wins) * 1.0 / count(*) DESC, wins DESC',
  submission: 'submission DESC, wins DESC',
  medals: 'gold DESC, silver DESC, bronze DESC, wins DESC',
  podiums: 'podium_gold DESC, podium_silver DESC, podium_bronze DESC, wins DESC',
};

// An academy is its athletes with a readable career, under the academy their latest event gave.
async function teams(env, params) {
  const f = filters(params);
  const sort = TEAM_SORTS[params.get('sort')] ?? TEAM_SORTS.wins;
  // Each academy's three athletes with the most wins come with it.
  const least = whole(params.get('athletes'), 3, 1000);
  const { results } = await env.DB.prepare(`WITH ${CAREERS},
    members AS (SELECT *, row_number() OVER (PARTITION BY club_id ORDER BY wins DESC) AS place FROM careers
      WHERE club_id IS NOT NULL AND wins >= ?4 AND wins > 0 AND coalesce(events, 0) >= ?5 AND (?6 = '[]' OR belt IN (SELECT value FROM json_each(?6))) AND (?11 = '' OR country = ?11) AND ((?12 = 0 AND ?13 = 9999) OR born BETWEEN ?12 + 1 AND ?13) AND (?14 = '' OR last >= ?14)),
    podiums AS (SELECT club_id, sum(place = 1) AS podium_gold, sum(place = 2) AS podium_silver, sum(place = 3) AS podium_bronze, count(DISTINCT event) AS entered
      FROM entries WHERE site = ?1 AND fought = 1 AND club_id IS NOT NULL GROUP BY club_id),
    names AS (SELECT club_id, club FROM (SELECT club_id, club, row_number() OVER (PARTITION BY club_id ORDER BY seen DESC) AS latest FROM people WHERE site = ?1 AND club_id IS NOT NULL AND club IS NOT NULL) WHERE latest = 1)
    SELECT m.club_id, n.club, count(*) AS athletes, sum(wins) AS wins, sum(submission) AS submission, sum(points) AS points,
      sum(gold) AS gold, sum(silver) AS silver, sum(bronze) AS bronze,
      coalesce(p.podium_gold, 0) AS podium_gold, coalesce(p.podium_silver, 0) AS podium_silver, coalesce(p.podium_bronze, 0) AS podium_bronze, coalesce(p.entered, 0) AS entered,
      json_group_array(json_object('user', user, 'name', name, 'wins', wins, 'belt', belt, 'photo', photo, 'born', born)) FILTER (WHERE m.place <= 3) AS top,
      count(*) OVER () AS total
    FROM members m LEFT JOIN names n USING (club_id) LEFT JOIN podiums p USING (club_id)
    WHERE ?7 = '' OR n.club LIKE '%' || ?7 || '%'
    GROUP BY m.club_id HAVING count(*) >= ?8
    ORDER BY ${sort}, m.club_id LIMIT ?9 OFFSET ?10`)
    .bind(f.site, f.off, Date.now() - KEPT, f.wins, f.events, f.belts, f.q, least, f.limit, f.offset, f.country, f.bornFrom, f.bornTo, f.since).all();
  return json({ total: results[0]?.total ?? 0, offset: f.offset, rows: results.map((r) => ({ ...r, top: JSON.parse(r.top) })) });
}

async function athlete(env, params) {
  const f = filters(params);
  const user = params.get('id') ?? '';
  if (!/^\d{1,12}$/.test(user)) return json({ error: 'Bad athlete' }, 400);
  const [career, person, entries, seen, history, outcomes, belts, extras] = await env.DB.batch([
    env.DB.prepare(`WITH ${CAREERS} SELECT * FROM careers WHERE user = ?4`).bind(f.site, f.off, Date.now() - KEPT, user),
    env.DB.prepare('SELECT * FROM people WHERE site = ?1 AND user = ?2').bind(f.site, user),
    env.DB.prepare(`SELECT e.event, e.division, e.club, e.club_id, e.place, e.wins, e.losses, e.fought, v.title, v.start, v.city, v.country
      FROM entries e LEFT JOIN events v ON v.site = e.site AND v.event = e.event WHERE e.site = ?1 AND e.user = ?2 AND (e.fought = 1 OR NOT EXISTS (SELECT 1 FROM entries x WHERE x.site = e.site AND x.event = e.event AND x.user = e.user AND x.fought = 1)) ORDER BY v.start DESC, e.event DESC`).bind(f.site, user),
    env.DB.prepare('SELECT sum(wins) AS wins, sum(losses) AS losses, count(*) AS events FROM records WHERE site = ?1 AND user = ?2').bind(f.site, user),
    env.DB.prepare(`SELECT h.event, h.title, h.start, h.city, h.wins, h.image, h.gold, h.silver, h.bronze, v.event IS NOT NULL AS known
      FROM history h LEFT JOIN events v ON v.site = h.site AND v.event = h.event WHERE h.site = ?1 AND h.user = ?2 ORDER BY h.start DESC`).bind(f.site, user),
    // Each event's finishes won and lost, every loss and everyone met, as their profile's match lists gave them.
    env.DB.prepare(`SELECT event, start, title, out FROM outcomes WHERE site = ?1 AND user = ?2 ORDER BY start DESC`).bind(f.site, user),
    // When each belt began, as their profile dates them.
    env.DB.prepare("SELECT worn, starts FROM belts WHERE site = ?1 AND user = ?2").bind(f.site, user),
    // Belts in each art, rankings, academy and affiliation, match videos, as their profile shows them.
    env.DB.prepare('SELECT entry FROM profiles WHERE site = ?1 AND user = ?2').bind(f.site, user),
  ]);
  if (!career.results.length && !person.results.length && !entries.results.length) return json({ error: 'Not found' }, 404);
  return json({
    history: history.results,
    career: career.results[0] ? careerRow(career.results[0]) : null,
    person: person.results[0] ?? null,
    entries: entries.results.map((e) => ({ ...e, wins: JSON.parse(e.wins), losses: JSON.parse(e.losses) })),
    seen: seen.results[0]?.events ? seen.results[0] : null,
    outcomes: outcomes.results.map((o) => ({ ...o, out: JSON.parse(o.out) })),
    profile: extras.results[0] ? JSON.parse(extras.results[0].entry) : null,
    belts: belts.results[0] ? { worn: JSON.parse(belts.results[0].worn), starts: JSON.parse(belts.results[0].starts) } : null,
  }, 200, 'no-store'); // a profile just opened shows at once
}

async function team(env, params) {
  const f = filters(params);
  const club = params.get('id') ?? '';
  if (!/^\d{1,12}$/.test(club)) return json({ error: 'Bad team' }, 400);
  const [members, events] = await env.DB.batch([
    env.DB.prepare(`WITH ${CAREERS} SELECT p.user, p.name, p.club, p.country, p.country_name, p.photo, p.hidden, p.born, coalesce(c.belt, p.belt) AS belt, p.seen,
        c.wins, c.losses, c.source, c.walkovers, c.submission, c.points, c.types, c.gold, c.silver, c.bronze, c.events
      FROM people p LEFT JOIN careers c ON c.user = p.user WHERE p.site = ?1 AND p.club_id = ?4`).bind(f.site, f.off, Date.now() - KEPT, club),
    env.DB.prepare(`SELECT e.event, v.title, v.start, v.city, v.country, count(DISTINCT e.user) AS athletes, max(e.fought) AS fought,
        sum(e.place = 1) AS gold, sum(e.place = 2) AS silver, sum(e.place = 3) AS bronze, json_group_array(json_object('wins', json(e.wins), 'losses', json(e.losses))) AS records
      FROM entries e LEFT JOIN events v ON v.site = e.site AND v.event = e.event WHERE e.site = ?1 AND e.club_id = ?2
      GROUP BY e.event ORDER BY v.start DESC, e.event DESC`).bind(f.site, club),
  ]);
  const named = members.results.filter((m) => m.club).sort((a, b) => b.seen.localeCompare(a.seen))[0];
  if (!members.results.length && !events.results.length) return json({ error: 'Not found' }, 404);
  return json({
    club: { id: club, name: named?.club ?? null },
    members: members.results.map((m) => ({ ...m, types: m.types ? JSON.parse(m.types) : null })),
    events: events.results.map((e) => ({ ...e, records: JSON.parse(e.records) })),
  });
}

async function events(env, params) {
  const f = filters(params);
  const { results } = await env.DB.prepare(`SELECT v.event, v.title, v.start, v.city, v.country, v.organiser,
      count(DISTINCT e.user) AS athletes, coalesce(nullif(count(DISTINCT e.division) FILTER (WHERE e.fought = 1), 0), count(DISTINCT e.division)) AS divisions, count(DISTINCT e.club_id) AS teams, max(e.fought) AS fought
    FROM events v LEFT JOIN entries e ON e.site = v.site AND e.event = v.event
    WHERE v.site = ?1 AND (?2 = '' OR v.title LIKE '%' || ?2 || '%' OR v.city LIKE '%' || ?2 || '%')
    GROUP BY v.event ORDER BY v.start DESC, v.event DESC LIMIT ?3 OFFSET ?4`).bind(f.site, f.q, f.limit, f.offset).all();
  return json({ rows: results });
}

async function event(env, params) {
  const f = filters(params);
  const id = params.get('id') ?? '';
  if (!/^\d{1,9}$/.test(id)) return json({ error: 'Bad event' }, 400);
  const [meta, entries] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM events WHERE site = ?1 AND event = ?2').bind(f.site, id),
    env.DB.prepare(`WITH ${CAREERS} SELECT e.user, e.division, e.club, e.club_id, e.place, e.wins, e.losses, e.fought, e.at,
        p.name, p.country, p.country_name, p.photo, p.hidden, p.born, coalesce(c.belt, p.belt) AS belt,
        c.wins AS career_wins, c.source AS career_source, c.types AS career_types, c.gold AS career_gold, c.silver AS career_silver, c.bronze AS career_bronze
      FROM entries e LEFT JOIN people p ON p.site = e.site AND p.user = e.user LEFT JOIN careers c ON c.user = e.user
      WHERE e.site = ?1 AND e.event = ?4 AND (e.fought = 1 OR NOT EXISTS (SELECT 1 FROM entries x WHERE x.site = e.site AND x.event = e.event AND x.user = e.user AND x.fought = 1))`).bind(f.site, f.off, Date.now() - KEPT, id),
  ]);
  if (!meta.results.length && !entries.results.length) return json({ error: 'Not found' }, 404);
  return json({
    event: meta.results[0] ?? { event: id },
    entries: entries.results.map((e) => ({ ...e, wins: JSON.parse(e.wins), losses: JSON.parse(e.losses) })),
  });
}

async function search(env, params) {
  const f = filters(params);
  if (f.q.length < 2) return json({ athletes: [], teams: [], events: [] });
  const like = `%${f.q}%`;
  const [people, clubs, found] = await env.DB.batch([
    env.DB.prepare('SELECT user, name, club, country, photo, hidden FROM people WHERE site = ?1 AND name LIKE ?2 ORDER BY seen DESC LIMIT 8').bind(f.site, like),
    env.DB.prepare('SELECT club_id, club, count(*) AS athletes FROM people WHERE site = ?1 AND club LIKE ?2 AND club_id IS NOT NULL GROUP BY club_id ORDER BY athletes DESC LIMIT 6').bind(f.site, like),
    env.DB.prepare('SELECT event, title, start, city FROM events WHERE site = ?1 AND (title LIKE ?2 OR city LIKE ?2) ORDER BY start DESC LIMIT 6').bind(f.site, like),
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
      (SELECT count(*) FROM athletes WHERE site = ?1 AND kind = 'careers' AND at > ?2 AND entry ->> '$.wins' IS NOT NULL) AS careers,
      (SELECT count(*) FROM people WHERE site = ?1) AS people,
      (SELECT count(DISTINCT club_id) FROM people WHERE site = ?1) AS teams,
      (SELECT count(*) FROM events WHERE site = ?1) AS events,
      (SELECT max(at) FROM athletes WHERE site = ?1) AS updated`).bind(f.site, Date.now() - KEPT).first();
  return json(row);
}

export const API = { athletes, teams, athlete, team, events, event, search, summary, countries };
