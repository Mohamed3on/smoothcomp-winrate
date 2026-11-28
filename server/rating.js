// Ratings (Glicko-1): how strong an athlete is from whom they beat and lost to, every match read in date order, each event
// a rating period. Backtested on 693k matches (2026-11-26/28): where both athletes had 5+ matches before, it picked the
// winner 69.3% of the time against the seed's 65.9% (belt, then win rate); an athlete new to the matches read who has a
// Smoothcomp career started from it (wins per event) and was picked right 62.5% of the time, against 52.5% without it.
// A belt starts GAP above the one below and a promotion lifts the rating by the steps gained; idle, the doubt (RD) grows
// back to 350 over twelve years (three, the usual, predicted no better and left every record's doubt near 180, so the
// rankings couldn't tell 126 matches from 7). Rebuilt nightly whole (rerate), so an older event read later counts in its place.
import '../rules.js';

const { beltOf, divisionOf, finishOf } = globalThis.SCWRRules;
const Q = Math.LN10 / 400;
const C2 = (350 ** 2 - 50 ** 2) / (365 * 12);
const GAP = 150;
// Kept and ranked: athletes rated with less doubt than this (about 34k on Smoothcomp on 2026-11-28), by mean - 2 doubt.
export const DOUBT = 200;
const g = (rd) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / Math.PI ** 2);
// White 0 … black 4; null unknown.
export const beltStep = (belt) => { const i = ADULT.indexOf(belt); return i < 0 ? null : i; };
const ADULT = ['white', 'blue', 'purple', 'brown', 'black'];
// Kids and teens meet only each other, so their ratings would sit on a scale of their own among the adults': their
// divisions (a kids' belt, or an age group under Juvenile) aren't rated (on the first run an orange belt ranked 5th).
// Read once a division name (its matches share it): reading every match's took the run from 6 s of CPU to 26 s.
const young = (division, seen) => seen.get(division) ?? seen.set(division, ['grey', 'yellow', 'orange', 'green'].includes(beltOf(division)) || /^(Kids|Teen)/.test(divisionOf(division).age ?? '')).get(division);
const stepOf = (division, seen) => seen.get(division) ?? seen.set(division, beltStep(beltOf(division))).get(division);

// Matches packed for a whole site's history: users[w[k]] beat users[l[k]] at belt step s[k] (-1 unknown); event e holds
// matches from starts[e] (its day days[e], days since 1970) to the next event's start.
export function packer() {
  const ids = new Map(), users = [];
  let w = new Int32Array(1 << 16), l = new Int32Array(1 << 16), s = new Int8Array(1 << 16), n = 0;
  const starts = [], days = [];
  const id = (u) => { let i = ids.get(u); if (i === undefined) { ids.set(u, (i = users.length)); users.push(u); } return i; };
  return {
    event(day) { starts.push(n); days.push(day); },
    match(winner, loser, step) {
      if (n === w.length) { const grow = (a, A) => { const b = new A(a.length * 2); b.set(a); return b; }; w = grow(w, Int32Array); l = grow(l, Int32Array); s = grow(s, Int8Array); }
      w[n] = id(winner); l[n] = id(loser); s[n] = step ?? -1; n++;
    },
    done: () => ({ users, w: w.subarray(0, n), l: l.subarray(0, n), s: s.subarray(0, n), starts: Int32Array.from(starts), days: Float64Array.from(days) }),
  };
}

// careers: Map of user → { wins (no walkovers), events } as their profile gives them now. Returns Map of user → { mean, doubt
// (as of `today`), matches }.
export function rate({ users, w, l, s, starts, days }, careers = new Map(), today = Date.now() / 864e5) {
  const N = users.length, E = starts.length;
  const end = (e) => (e + 1 < E ? starts[e + 1] : w.length);
  // A career counts what came before the matches read: its wins and events less those read.
  const wins = new Int32Array(N), seen = new Int32Array(N), last = new Int32Array(N).fill(-1);
  for (let e = 0; e < E; e++) for (let k = starts[e]; k < end(e); k++) { wins[w[k]]++; for (const i of [w[k], l[k]]) if (last[i] !== e) { last[i] = e; seen[i]++; } }
  const r = new Float64Array(N), rd = new Float64Array(N), day = new Float64Array(N), step = new Int8Array(N), n = new Int32Array(N), started = new Uint8Array(N);
  // As of `now`: started (from their career where there is one), promoted, its doubt grown since it last moved.
  const at = (i, st, now) => {
    if (!started[i]) {
      const c = careers.get(users[i]), cw = c ? c.wins - wins[i] : -1, ce = c ? c.events - seen[i] : 0, head = ce >= 1 && cw >= 0;
      started[i] = 1; step[i] = Math.max(0, st); day[i] = now;
      r[i] = 1500 + GAP * step[i] + (head ? Math.max(-300, Math.min(300, 200 * (cw / ce - 1.2))) : 0);
      rd[i] = head ? Math.max(120, 350 - 25 * ce) : 350;
    }
    if (st > step[i]) { r[i] += GAP * (st - step[i]); step[i] = st; rd[i] = Math.max(rd[i], 200); }
    rd[i] = Math.min(350, Math.sqrt(rd[i] ** 2 + C2 * Math.max(0, now - day[i]))); day[i] = now;
  };
  for (let e = 0; e < E; e++) {
    const games = new Map();
    for (let k = starts[e]; k < end(e); k++) {
      at(w[k], s[k], days[e]); at(l[k], s[k], days[e]);
      (games.get(w[k]) ?? games.set(w[k], []).get(w[k])).push(l[k], 1);
      (games.get(l[k]) ?? games.set(l[k], []).get(l[k])).push(w[k], 0);
    }
    // Everyone moves from the ratings before the event.
    const pre = new Map([...games.keys()].map((i) => [i, [r[i], rd[i]]]));
    for (const [i, gs] of games) {
      const [me, mine] = pre.get(i);
      let v = 0, sum = 0;
      for (let k = 0; k < gs.length; k += 2) {
        const [o, ord] = pre.get(gs[k]), gj = g(ord), x = 1 / (1 + 10 ** ((-gj * (me - o)) / 400));
        v += Q * Q * gj * gj * x * (1 - x); sum += gj * (gs[k + 1] - x);
      }
      const rd2 = 1 / (1 / mine ** 2 + v);
      r[i] = me + Q * rd2 * sum; rd[i] = Math.max(30, Math.sqrt(rd2)); n[i] += gs.length / 2;
    }
  }
  const out = new Map();
  for (let i = 0; i < N; i++) out.set(users[i], { mean: r[i], doubt: Math.min(350, Math.sqrt(rd[i] ** 2 + C2 * Math.max(0, today - day[i]))), matches: n[i] });
  return out;
}

const SITES = ['smoothcomp.com', 'ajptour.com'];
// Each event's matches once (a match is read from its winner's entry), walkovers and no-shows left out.
const MATCHES = `SELECT e.event, e.user AS w, b.value ->> 'user' AS l, e.division AS d, b.value ->> 'type' AS t, b.value ->> 'stage' AS st
  FROM json_each(?2) ev CROSS JOIN entries e ON e.site = ?1 AND e.event = ev.value CROSS JOIN json_each(e.bouts) b
  WHERE e.fought = 1 AND b.value ->> 'won' = 1 AND b.value ->> 'user' IS NOT NULL`;
// Upserts only the rows that change (D1 bills each row and index entry written). ?2: [[user, rating, mean, doubt, matches]].
const KEEP = `INSERT INTO ratings (site, user, rating, mean, doubt, matches)
  SELECT ?1, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?2) WHERE true
  ON CONFLICT (site, user) DO UPDATE SET rating = excluded.rating, mean = excluded.mean, doubt = excluded.doubt, matches = excluded.matches
  WHERE (rating, mean, doubt, matches) IS NOT (excluded.rating, excluded.mean, excluded.doubt, excluded.matches)`;

// D1 serves one query at a time and refuses all (the site's too) past a 10 s window's share ("overloaded", on the
// first run's 100 events a read): each read or write here waits as long again as it took, so it holds D1 half the time
// at most, and an overloaded one waits 15 s and tries again (three times).
async function paced(run, rest = (ms) => new Promise((done) => setTimeout(done, ms))) {
  for (let tries = 0; ; tries++) {
    const t = Date.now();
    try { const out = await run(); await rest(Date.now() - t); return out; } catch (e) {
      if (tries >= 3 || !/overloaded/i.test(e?.message)) throw e;
      await rest(15e3);
    }
  }
}

// The nightly rebuild of every site's ratings, from every match read (crawler.js, once a day).
export async function rerate(env, now = Date.now(), rest) {
  for (const site of SITES) {
    const { results: events } = await env.DB.prepare(`SELECT event, start FROM events INDEXED BY events_start WHERE site = ?1 AND start IS NOT NULL
      AND EXISTS (SELECT 1 FROM entries e WHERE e.site = ?1 AND e.event = events.event AND e.fought = 1) ORDER BY start, event`).bind(site).all();
    const pack = packer(), ages = new Map(), steps = new Map();
    for (let i = 0; i < events.length; i += 25) {
      const some = events.slice(i, i + 25);
      const { results } = await paced(() => env.DB.prepare(MATCHES).bind(site, JSON.stringify(some.map((e) => e.event))).all(), rest);
      const of = Map.groupBy(results, (m) => m.event);
      for (const { event, start } of some) {
        pack.event(Date.parse(start) / 864e5);
        const once = new Set();
        for (const m of of.get(event) ?? []) {
          const key = `${m.d}|${m.st}|${[m.w, m.l].sort()}`;
          if (finishOf(m.t) === 'walkover' || m.w === m.l || once.has(key) || young(m.d, ages)) continue;
          once.add(key);
          pack.match(m.w, m.l, stepOf(m.d, steps));
        }
      }
    }
    const careers = new Map();
    const { results: kept } = await env.DB.prepare("SELECT user, entry FROM athletes WHERE site = ?1 AND kind = 'careers'").bind(site).all();
    for (const { user, entry } of kept) {
      const c = JSON.parse(entry);
      if (c.wins) careers.set(user, { wins: Object.entries(c.wins).reduce((t, [k, v]) => t + (finishOf(k) === 'walkover' ? 0 : v), 0), events: c.events ?? 0 });
    }
    const rows = [];
    for (const [user, x] of rate(pack.done(), careers, now / 864e5)) {
      if (x.doubt < DOUBT) rows.push([user, Math.round(x.mean - 2 * x.doubt), Math.round(x.mean), Math.round(x.doubt), x.matches]);
    }
    const keep = new Set(rows.map((row) => row[0]));
    const { results: had } = await env.DB.prepare('SELECT user FROM ratings WHERE site = ?1').bind(site).all();
    const gone = had.map((row) => row.user).filter((user) => !keep.has(user));
    const writes = [];
    for (let i = 0; i < rows.length; i += 500) writes.push(env.DB.prepare(KEEP).bind(site, JSON.stringify(rows.slice(i, i + 500))));
    for (let i = 0; i < gone.length; i += 1000) writes.push(env.DB.prepare('DELETE FROM ratings WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2))').bind(site, JSON.stringify(gone.slice(i, i + 1000))));
    for (const write of writes) await paced(() => write.run(), rest);
    console.log('rate', site, { events: events.length, rated: rows.length, gone: gone.length });
  }
}
