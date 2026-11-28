// Ratings (whole-history): how strong an athlete is from whom they beat and lost to, every match read fit at once
// (Bradley-Terry with Gaussian priors), so a result is judged by everything known of both sides, later results too: a loss
// to a newcomer who went on to win the division counts as one to a strong athlete. Each belt reached has its own strength,
// tied to the last belt's GAP higher (sd TAU); the first starts from the belt, and from their Smoothcomp career (wins per
// event) where one was read. Backtested on 693k matches (2026-11-28), each event predicted from a fit of the matches before
// it: where both athletes had 5+ matches before, 70.7% of winners picked, against 69.4% for Glicko (the first version, which
// judged each event once, in date order) and 65.9% for the seed (belt, then win rate); a newcomer with a career 62.4%,
// against 49.9%. Fading older matches (a 1–2 year half-life) predicted worse. Rebuilt nightly whole (rerate).
import '../rules.js';

const { beltOf, divisionOf, finishOf } = globalThis.SCWRRules;
const K = Math.LN10 / 400;
const GAP = 150;
const TAU = 150;
// Kept and ranked: athletes rated with less doubt than this (69k of 174k adults on Smoothcomp, 2026-11-28), by mean - 3 doubt: at 2, five good matches outranked 8-1 over twelve.
export const DOUBT = 200;
// White 0 … black 4; null unknown.
export const beltStep = (belt) => { const i = ADULT.indexOf(belt); return i < 0 ? null : i; };
const ADULT = ['white', 'blue', 'purple', 'brown', 'black'];
// Kids and teens meet only each other, so their ratings would sit on a scale of their own among the adults': their
// divisions (a kids' belt, or an age group under Juvenile) aren't rated (on the first run an orange belt ranked 5th).
// Read once a division name (its matches share it): reading every match's took the run from 6 s of CPU to 26 s.
const young = (division, seen) => seen.get(division) ?? seen.set(division, ['grey', 'yellow', 'orange', 'green'].includes(beltOf(division)) || /^(Kids|Teen)/.test(divisionOf(division).age ?? '')).get(division);
const stepOf = (division, seen) => seen.get(division) ?? seen.set(division, beltStep(beltOf(division))).get(division);

// Matches packed for a whole site's history: users[w[k]] beat users[l[k]], the winner at belt step s[k] and the loser at t[k]
// (-1 unknown); event e holds
// matches from starts[e] (its day days[e], days since 1970) to the next event's start.
export function packer() {
  const ids = new Map(), users = [];
  let w = new Int32Array(1 << 16), l = new Int32Array(1 << 16), s = new Int8Array(1 << 16), t = new Int8Array(1 << 16), n = 0;
  const starts = [], days = [];
  const id = (u) => { let i = ids.get(u); if (i === undefined) { ids.set(u, (i = users.length)); users.push(u); } return i; };
  return {
    event(day) { starts.push(n); days.push(day); },
    match(winner, loser, step, other = step) {
      if (n === w.length) { const grow = (a, A) => { const b = new A(a.length * 2); b.set(a); return b; }; w = grow(w, Int32Array); l = grow(l, Int32Array); s = grow(s, Int8Array); t = grow(t, Int8Array); }
      w[n] = id(winner); l[n] = id(loser); s[n] = step ?? -1; t[n] = other ?? -1; n++;
    },
    done: () => ({ users, w: w.subarray(0, n), l: l.subarray(0, n), s: s.subarray(0, n), t: t.subarray(0, n), starts: Int32Array.from(starts), days: Float64Array.from(days) }),
  };
}

// careers: Map of user → { wins (no walkovers), events } as their profile gives them now. Returns Map of user → { mean, doubt,
// matches }: their latest belt's strength and how sure the fit is of it (sd).
export function rate({ users, w, l, s, t, starts }, careers = new Map()) {
  const N = users.length, E = starts.length, M = w.length;
  const end = (e) => (e + 1 < E ? starts[e + 1] : M);
  // A career counts what came before the matches read: its wins and events less those read.
  const wins = new Int32Array(N), seen = new Int32Array(N), last = new Int32Array(N).fill(-1), n = new Int32Array(N);
  for (let e = 0; e < E; e++) for (let k = starts[e]; k < end(e); k++) { wins[w[k]]++; n[w[k]]++; n[l[k]]++; for (const i of [w[k], l[k]]) if (last[i] !== e) { last[i] = e; seen[i]++; } }
  // Nodes: an athlete at a belt, made as they reach it (the highest belt of their divisions so far, this event's too).
  const top = new Int8Array(N).fill(-1), at = new Int32Array(N).fill(-1);
  const nStep = [], prev = [], mean = [], sd = [];
  const nodeOf = (i) => {
    const cur = at[i];
    if (cur >= 0 && nStep[cur] >= top[i]) return cur;
    const st = Math.max(0, top[i]);
    if (cur < 0) {
      const c = careers.get(users[i]), cw = c ? c.wins - wins[i] : -1, ce = c ? c.events - seen[i] : 0, head = ce >= 1 && cw >= 0;
      mean.push(1500 + GAP * st + (head ? Math.max(-300, Math.min(300, 200 * (cw / ce - 1.2))) : 0)); sd.push(head ? Math.max(120, 350 - 25 * ce) : 350);
    } else { mean.push(0); sd.push(TAU); }
    nStep.push(st); prev.push(cur);
    return (at[i] = nStep.length - 1);
  };
  const a = new Int32Array(M), b = new Int32Array(M);
  for (let e = 0; e < E; e++) {
    for (let k = starts[e]; k < end(e); k++) { top[w[k]] = Math.max(top[w[k]], s[k]); top[l[k]] = Math.max(top[l[k]], t[k]); }
    for (let k = starts[e]; k < end(e); k++) { a[k] = nodeOf(w[k]); b[k] = nodeOf(l[k]); }
  }
  // The fit: Newton steps on every node at once (damped), from each node's prior, until no strength moves a point.
  const V = nStep.length, th = new Float64Array(V), g = new Float64Array(V), h = new Float64Array(V);
  for (let v = 0; v < V; v++) th[v] = prev[v] < 0 ? mean[v] : th[prev[v]] + GAP * (nStep[v] - nStep[prev[v]]);
  for (let sweep = 0; sweep < 300; sweep++) {
    g.fill(0); h.fill(0);
    for (let k = 0; k < M; k++) {
      const x = 1 / (1 + 10 ** (-(th[a[k]] - th[b[k]]) / 400)), y = K * (1 - x), z = K * K * x * (1 - x);
      g[a[k]] += y; g[b[k]] -= y; h[a[k]] += z; h[b[k]] += z;
    }
    for (let v = 0; v < V; v++) {
      if (prev[v] < 0) { g[v] -= (th[v] - mean[v]) / sd[v] ** 2; h[v] += 1 / sd[v] ** 2; continue; }
      const r = th[v] - th[prev[v]] - GAP * (nStep[v] - nStep[prev[v]]);
      g[v] -= r / TAU ** 2; g[prev[v]] += r / TAU ** 2; h[v] += 1 / TAU ** 2; h[prev[v]] += 1 / TAU ** 2;
    }
    let moved = 0;
    for (let v = 0; v < V; v++) { const d = (0.9 * g[v]) / h[v]; th[v] += d; moved = Math.max(moved, Math.abs(d)); }
    if (moved < 1 && sweep >= 10) break;
  }
  // The doubt: what the matches tell of each node, with what the belt before tells through the tie (its own doubt and
  // TAU's), carried belt to belt (nodes are made in order). Read off the fit's own curvature, the tie counted as if the belt
  // before were known: 2 matches, one up a belt (2923560), had ±288 and led their bracket.
  const told = new Float64Array(V), vr = new Float64Array(V);
  for (let k = 0; k < M; k++) { const x = 1 / (1 + 10 ** (-(th[a[k]] - th[b[k]]) / 400)), z = K * K * x * (1 - x); told[a[k]] += z; told[b[k]] += z; }
  for (let v = 0; v < V; v++) vr[v] = 1 / (told[v] + 1 / (prev[v] < 0 ? sd[v] ** 2 : vr[prev[v]] + TAU ** 2));
  const out = new Map();
  for (let i = 0; i < N; i++) if (at[i] >= 0) out.set(users[i], { mean: th[at[i]], doubt: Math.sqrt(vr[at[i]]), matches: n[i] });
  return out;
}

const SITES = ['smoothcomp.com', 'ajptour.com'];
// Each event's matches once (a match is read from its winner's entry), walkovers and no-shows left out.
// With each side's own belt (their ranking row's), which a division above it never lifts them past (rerate).
const MATCHES = `SELECT e.event, e.user AS w, b.value ->> 'user' AS l, e.division AS d, b.value ->> 'type' AS t, b.value ->> 'stage' AS st, bw.belt AS wb, bl.belt AS lb
  FROM json_each(?2) ev CROSS JOIN entries e ON e.site = ?1 AND e.event = ev.value CROSS JOIN json_each(e.bouts) b
    LEFT JOIN board bw ON bw.site = ?1 AND bw.user = e.user LEFT JOIN board bl ON bl.site = ?1 AND bl.user = b.value ->> 'user'
  WHERE e.fought = 1 AND b.value ->> 'won' = 1 AND b.value ->> 'user' IS NOT NULL`;
// Upserts only the rows that change (D1 bills each row and index entry written): each night's matches move whole pools a
// point or two, so a row is rewritten once a figure moves 3 or more, or its matches change. ?2: [[user, rating, mean, doubt, matches]].
const KEEP = `INSERT INTO ratings (site, user, rating, mean, doubt, matches)
  SELECT ?1, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?2) WHERE true
  ON CONFLICT (site, user) DO UPDATE SET rating = excluded.rating, mean = excluded.mean, doubt = excluded.doubt, matches = excluded.matches
  WHERE matches IS NOT excluded.matches OR abs(rating - excluded.rating) >= 3 OR abs(mean - excluded.mean) >= 3 OR abs(doubt - excluded.doubt) >= 3`;

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
          // A division's belt, but never above the athlete's own: one who competed up (a blue belt in a no-gi "Advanced
          // (Purple/Brown/Black)", 903979) stays at their belt, as the site keeps them; a division at a belt they hold still lifts them.
          const at = stepOf(m.d, steps), cap = (own) => { const c = beltStep(own); return at == null || c == null ? at : Math.min(at, c); };
          pack.match(m.w, m.l, cap(m.wb), cap(m.lb));
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
    for (const [user, x] of rate(pack.done(), careers)) {
      if (x.doubt < DOUBT) rows.push([user, Math.round(x.mean - 3 * x.doubt), Math.round(x.mean), Math.round(x.doubt), x.matches]);
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
