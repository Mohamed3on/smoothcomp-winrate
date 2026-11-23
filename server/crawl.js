// Results for events nobody opened with the extension, read by the server itself. Two kinds of
// Smoothcomp JSON answer without a browser: an event's schedule (every match: division, stage,
// winner, finish, and each side's registration) and a match's bracket card, which names both
// sides' users. Every past event Mat Stats knows of with no results yet is queued, newest first;
// each minute's run reads for 50 seconds, six requests at a time (a Worker's open connections),
// keeping what it has read, until every side is named. The event then goes in as a results page would send it, its medals from the
// final and bronze match, as the extension counts a division not yet published. A results page
// read later replaces it.
import '../rules.js';

const HOSTS = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const RUN = 50e3; // each run reads this long, then leaves the rest to the next minute's
const BUDGET = 5000; // requests per run, well under a paid Worker's 10,000
const ROUND = 300; // bracket cards asked for at a time
const AT_ONCE = 6;
// Smoothcomp answers a placed crawler in about 100 ms. When the median of a lane's last 30 requests
// passes this, it is straining (crawling at 80 requests a second took it to a second for everyone),
// so the lane stops until the next minute.
const SLOW = 300;
const DAY = 864e5;
const { finishOf, normalize } = globalThis.SCWRRules;

class Gone extends Error {}
class Busy extends Error {}

// How a run spent its time, logged when it ends: requests, their average wait, how long at least
// one was in flight (the rest went to the database and the counting), and events finished.
function client() {
  let used = 0, waited = 0, open = 0, since = 0, busy = 0;
  const recent = [];
  const started = Date.now();
  const until = started + RUN;
  const left = () => (Date.now() < until ? BUDGET - used : 0);
  const get = async (url) => {
    if (!left()) throw new Busy('budget');
    if (recent.length >= 30 && [...recent].sort((a, b) => a - b)[15] > SLOW) throw new Busy('slow');
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

// Where a match falls in its division, for listing them in the order fought: pool matches by number,
// then the knockout rounds up to the final.
const ROUNDS = ['Eighth-finals', 'Quarterfinals', 'Semifinals', 'Bronze match', 'Final'];
// A bracket's places, by the round each side won or went out in, as Smoothcomp's published results
// give them (checked on 25902): bronze-match loser 4th, quarterfinal losers 5th, eighth-final 9th,
// the round before 17th. Semifinal losers are 3rd where no bronze match is fought.
const OUT = { Final: 2, 'Bronze match': 4, Quarterfinals: 5, 'Eighth-finals': 9 };
const placeOf = (stage, won, bronze) => (won ? ({ Final: 1, 'Bronze match': 3 })[stage] ?? null
  : OUT[stage] ?? (Number(/^(\d+)(?:st|nd|rd|th)-finals$/i.exec(stage ?? '')?.[1]) + 1 || (stage === 'Semifinals' && !bronze ? 3 : null)));
const round = (stage) => Number(/^Match (\d+)\//.exec(stage ?? '')?.[1] ?? NaN) || (ROUNDS.includes(stage) ? 1001 + ROUNDS.indexOf(stage) : 1000);

// The event as a results page would send it: each athlete's divisions, wins and losses by finish,
// and a place where the matches give one. A bracket's final and bronze match give its medals (both
// semifinal losers share bronze when there is no bronze match); a round robin (matches named
// "Match 2/10" alone) ranks everyone by wins, then submissions, then who beat whom, which gave
// Smoothcomp's own order in 131 of 132 round robins checked. No-shows (walkover losses alone) are
// left out, as published results leave them out.
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
    for (const [id, , stage, finish, sides] of [...matches].sort((a, b) => round(a[2]) - round(b[2]) || a[0] - b[0])) {
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
    if (matches.every((m) => /^Match \d+\/\d+$/.test(m[2])) && matches.some((m) => m[3])) {
      const h2h = (a, b) => (beat.has(`${a.user.id}>${b.user.id}`) ? -1 : beat.has(`${b.user.id}>${a.user.id}`) ? 1 : 0);
      shown.sort((a, b) => b.w - a.w || b.sub - a.sub || h2h(a, b)).forEach((x, i) => { x.e.place = i + 1; });
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

// Every known event that has ended with no results, newest first; ids from profiles' event lists too.
export async function queue(env) {
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT k.site, k.event, 'queued', max(k.start), max(k.title), max(k.city), 0, ?1 FROM (
      SELECT site, event, start, title, city FROM events UNION ALL SELECT site, event, start, title, city FROM history) k
    WHERE k.start < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.site = k.site AND e.event = k.event AND e.fought = 1)
    GROUP BY k.site, k.event`).bind(Date.now()).run();
  // Events a results page sent without matches: read for those alone.
  await env.DB.prepare(`INSERT OR IGNORE INTO crawls (site, event, state, start, title, city, next, at)
    SELECT e.site, e.event, 'queued', v.start, v.title, v.city, 0, ?1 FROM entries e JOIN events v ON v.site = e.site AND v.event = e.event
    WHERE e.fought = 1 AND v.start < datetime('now', '-1 day') GROUP BY e.site, e.event HAVING max(e.bouts IS NOT NULL) = 0`).bind(Date.now()).run();
  // Results can still be corrected after an event: one read under ten days after it started is
  // read again once ten days have passed.
  await env.DB.prepare(`UPDATE crawls SET state = 'queued', data = NULL, next = 0, tries = 0 WHERE state = 'done' AND wrote IS NOT NULL
    AND wrote < unixepoch(start) * 1000 + 864000000 AND unixepoch('now') > unixepoch(start) + 864000`).run();
}

export async function crawl(env, record, addBouts) {
  const { get, left, report } = client();
  let done = 0, why = 'time';
  try { why = (await lane(env, record, addBouts, get, left, () => done++)) ?? why; } finally { report(done, why); }
}

async function lane(env, record, addBouts, get, left, finished) {
  const now = Date.now();
  while (left() > 10) {
    // Taken and held in one statement, so lanes running side by side never take the same event.
    const job = await env.DB.prepare(`UPDATE crawls SET next = ?2 WHERE rowid = (SELECT rowid FROM crawls WHERE state IN ('queued', 'reading') AND next <= ?1 ORDER BY priority DESC, start DESC LIMIT 1) RETURNING *`)
      .bind(Date.now(), Date.now() + 10 * 60e3).first();
    if (!job) return;
    const host = HOSTS[job.site];
    const save = (state, data, next = 0, tries = job.tries) => env.DB.prepare('UPDATE crawls SET state = ?3, data = ?4, next = ?5, tries = ?6, at = ?7 WHERE site = ?1 AND event = ?2')
      .bind(job.site, job.event, state, data == null ? null : JSON.stringify(data), next, tries, Date.now()).run();
    let data = job.data ? JSON.parse(job.data) : null;
    try {
      if (!data) {
        const read = await schedule(get, `${host}/en/event/${job.event}`);
        // Matches still to finish at an event under four days old: it may still be on.
        if (!read.over && Date.parse(job.start) > now - 4 * DAY) { await save('queued', null, now + 6 * 3600e3); continue; }
        // Kept only if this run ends before the event is done (the catch below).
        data = { matches: read.matches, ends: read.ends, users: {}, tried: [] };
      }
      try { await name(get, host, Object.assign(data, { left })); } finally { delete data.left; delete data.room; }
      // Results a page sent meanwhile stand.
      // (A crawl reading an event again replaces its own copy: results written by the time it last wrote.)
      const has = await env.DB.prepare('SELECT 1 FROM entries WHERE site = ?1 AND event = ?2 AND fought = 1 AND at > ?3 LIMIT 1').bind(job.site, job.event, job.wrote ?? 0).first();
      const { athletes, records } = results(data, job.start);
      // Results a page sent stand; the matches are added to them.
      if (has) await addBouts(env, job.site, job.event, athletes);
      else {
        const iso = (t) => (t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null);
        await record(env, { site: job.site, event: job.event, records, athletes, read: Date.now(),
          meta: { title: job.title, start: iso(job.start), end: iso(data.ends), city: job.city } });
        await env.DB.prepare('UPDATE crawls SET wrote = ?3 WHERE site = ?1 AND event = ?2').bind(job.site, job.event, Date.now()).run();
      }
      finished();
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
