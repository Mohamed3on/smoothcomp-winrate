// The rules every part of Mat Stats counts by: the extension's pages, the server and the stats
// site. One file, loaded three ways: as a script tag before the page scripts (manifest.json, and
// background.js imports it), and imported for its effect by the server (server/*.js) and the site
// (site/src/lib/rules.ts). It sets one global and touches nothing else, so it runs in all three.
globalThis.SCWRRules = (() => {
  // Text compared as people read it: any spacing, any case, one Unicode form.
  const normalize = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

  // How a match ended. Smoothcomp's codes come finer than its own chips name them
  // ("submission_armbar", "decision_unanimous", "double-dq", "tko", a judo "fullippon"); each
  // counts under one finish, most decisive first. A forfeit is a walkover by another name, and
  // a profile's older "escape" is a fastest escape.
  const FINISHES = ['submission', 'stoppage', 'fastest_escape', 'points', 'decision', 'disqualification', 'walkover', 'other'];
  const LABELS = { submission: 'Submission', stoppage: 'Stoppage', fastest_escape: 'Fastest escape', points: 'Points', decision: 'Decision', disqualification: 'Disqualification', walkover: 'Walkover', other: 'Other' };
  // The first finish with a pattern the code matches, else other. Patterns are SQL LIKE's
  // (% any run of characters, any case), so the server's queries group by the same rule.
  const RULES = [
    ['submission', ['sub%']],
    ['fastest_escape', ['%escape%']],
    ['walkover', ['%walk%', '%forfeit%']],
    ['disqualification', ['%dq%', '%disq%']],
    ['points', ['point%', '%advantage%', '%penalt%']],
    ['decision', ['%decision%', '%referee%', '%judge%']],
    ['stoppage', ['%stoppage%', '%ko', '%ko %', '%ko-%']],
  ];
  const like = (pattern) => new RegExp(`^${pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const MATCHERS = RULES.map(([finish, patterns]) => [finish, patterns.map(like)]);
  const finishOf = (code) => {
    const w = String(code ?? '').toLowerCase();
    return MATCHERS.find(([, res]) => res.some((re) => re.test(w)))?.[0] ?? 'other';
  };
  // The same rule as a SQL expression over a column of codes.
  const finishSql = (column) => `CASE ${RULES.map(([finish, patterns]) => `WHEN ${patterns.map((p) => `${column} LIKE '${p}'`).join(' OR ')} THEN '${finish}'`).join(' ')} ELSE 'other' END`;
  // The detail a code gives: "submission_armbar" is "Submission (armbar)"; none for a bare one.
  const detailOf = (code) => {
    const w = String(code ?? '').toLowerCase();
    const kind = ['submission', 'decision', 'points'].find((k) => w.startsWith(k));
    const rest = kind && w.slice(kind.length).replace(/[^a-z]+/g, ' ').trim();
    return rest ? `${LABELS[kind]} (${rest})` : null;
  };
  // How a match ended, as a line reads it: the detail where the code gives one, else the finish.
  const howOf = (code) => detailOf(code) ?? LABELS[finishOf(code)];

  // Belts, lowest first. A label names one belt, or none: "Purple/Brown" and "All belts" name none.
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const beltsIn = (label) => BELTS.filter((b) => new RegExp(`\\b${b}`, 'i').test(String(label ?? '').replace(/gray/i, 'grey')));
  const beltOf = (label) => {
    const named = beltsIn(label);
    return named.length === 1 ? named[0] : null;
  };
  // Organisers name the registration field that grades an athlete "Belt", "Level", "Rank",
  // "Skill level" or "Grade", depending on the event and whether the division is gi or no-gi.
  const isGrade = (field) => /belt|level|rank|skill|grade/i.test(String(field ?? ''));

  // An athlete's record, event by event: their profile's match lists where one was read (with the
  // results' walkovers there, which match lists leave out), else the results read there.
  // `outcomes` are { event, start, out } as profiles give them, `entries` { event, start, division,
  // wins, losses, fought } as results do. Each event comes back as { event, start, types: { finish:
  // [won, lost] }, divisions }, oldest first. The server's TALLY counts the same (tests/records.test.cjs).
  const add = (into, finish, w, l) => {
    const t = (into[finish] ??= [0, 0]);
    t[0] += w;
    t[1] += l;
    return into;
  };
  function eventRecords(outcomes = [], entries = []) {
    const listed = new Set(outcomes.map((o) => String(o.event)));
    const by = new Map();
    const at = (event, start) => by.get(event) ?? by.set(event, { event, start: start ?? null, types: {}, divisions: [] }).get(event);
    for (const o of outcomes) {
      const r = at(String(o.event), o.start);
      for (const [t, [w, l]] of Object.entries(o.out?.types ?? {})) add(r.types, finishOf(t), Number(w) || 0, Number(l) || 0);
      r.divisions.push(...[...(o.out?.faced ?? []), ...(o.out?.losses ?? [])].map((m) => m.division).filter(Boolean));
    }
    for (const e of entries.filter((x) => x.fought)) {
      const r = at(String(e.event), e.start);
      r.start ??= e.start ?? null;
      const counts = listed.has(r.event) ? (t) => finishOf(t) === 'walkover' : () => true;
      for (const [t, n] of Object.entries(e.wins ?? {})) if (counts(t)) add(r.types, finishOf(t), Number(n) || 0, 0);
      for (const [t, n] of Object.entries(e.losses ?? {})) if (counts(t)) add(r.types, finishOf(t), 0, Number(n) || 0);
      if (!listed.has(r.event)) r.divisions.push(e.division);
    }
    return [...by.values()].sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')));
  }
  // Every event's [won, lost] by finish, summed.
  const totals = (records) => records.reduce((into, r) => {
    for (const [t, [w, l]] of Object.entries(r.types)) add(into, t, w, l);
    return into;
  }, {});
  // The record at each belt worn, highest first, as a profile's belt list dates them: `worn` lowest
  // first, `starts` when each began (the first null, or -Infinity). An event takes the belt worn on its
  // date, and an undated one counts only overall; the current belt shows even with no events yet.
  function beltSplit(records, worn, starts) {
    const by = new Map(worn.map((belt) => [belt, { belt, types: {}, events: 0 }]));
    for (const r of records) {
      const t = Date.parse(r.start ?? '');
      if (Number.isNaN(t)) continue;
      const b = by.get(worn[starts.findLastIndex((s) => (s ?? -Infinity) <= t)] ?? worn[0]);
      for (const [f, [w, l]] of Object.entries(r.types)) add(b.types, f, w, l);
      b.events++;
    }
    return [...by.values()].filter((b) => b.belt === worn[worn.length - 1] || b.events).reverse();
  }
  // Everyone who beat them more than once, with the whole head-to-head. Opponents are known by name,
  // as registrations change per event. `meetings` run newest first, each { name, won, ... }, and the
  // newest gives the rest (club, photo). Furthest behind first, then the most losses.
  function rivalsOf(meetings) {
    const met = new Map();
    for (const { won, ...m } of meetings) {
      const key = normalize(m.name);
      if (!key) continue;
      if (!met.has(key)) met.set(key, { ...m, key, w: 0, l: 0 });
      met.get(key)[won ? 'w' : 'l']++;
    }
    return [...met.values()].filter((r) => r.l > 1).sort((a, b) => b.l - b.w - (a.l - a.w) || b.l - a.l);
  }

  // Places in a division whose results aren't published, read off its matches as Smoothcomp's
  // published results give them (checked on 25902). A bracket's final and bronze match give its
  // medals, the bronze-match loser 4th, quarterfinal losers 5th, eighth-final 9th, the round before
  // 17th; semifinal losers share 3rd where no bronze match is fought (`bronze`: whether one is).
  const OUT = { Final: 2, 'Bronze match': 4, Quarterfinals: 5, 'Eighth-finals': 9 };
  const placeOf = (stage, won, bronze) => (won ? ({ Final: 1, 'Bronze match': 3 })[stage] ?? null
    : OUT[stage] ?? (Number(/^(\d+)(?:st|nd|rd|th)-finals$/i.exec(stage ?? '')?.[1]) + 1 || (stage === 'Semifinals' && !bronze ? 3 : null)));
  // Where a match falls in its division, for the order fought: pool matches by number, then the
  // knockout rounds up to the final.
  const ROUNDS = ['Eighth-finals', 'Quarterfinals', 'Semifinals', 'Bronze match', 'Final'];
  const roundOf = (stage) => Number(/^Match (\d+)\//.exec(stage ?? '')?.[1] ?? NaN) || (ROUNDS.includes(stage) ? 1001 + ROUNDS.indexOf(stage) : 1000);
  // A round robin is a division whose every match is named like "Match 2/10". Once fought, it ranks
  // everyone by wins, then submissions, then who beat whom (Smoothcomp's own order in 131 of 132
  // checked). `rows` are { key, wins, subs }, `beat(a, b)` whether a beat b; places by key.
  const isPool = (stages) => stages.length > 0 && stages.every((s) => /^Match \d+\/\d+$/.test(s ?? ''));
  const poolPlaces = (rows, beat) => new Map([...rows].sort((a, b) => b.wins - a.wins || b.subs - a.subs || (beat(a.key, b.key) ? -1 : beat(b.key, a.key) ? 1 : 0)).map((r, i) => [r.key, i + 1]));

  // A bracket's seeding, best first, which points to its medals: the higher belt (only a bracket of
  // mixed belts tells them apart), then the best win rate where their record is known, then wins per
  // event, the most wins, most by submission, most on points, and the younger athlete; any figure
  // unknown ranks after every known one. A seed is { belt, won, lost, wins, events, submission, points, born }
  // (belt: a BELTS name, the one the division names where it names one; born: a higher number is younger).
  // The rate is ranked as if they had also won and lost ten more, so a short record leans to 50% (the
  // average, as every match has a winner) and experience counts: 23–4 ranks as 70%, below 229–79 at 73%.
  // At one rate, more matches first. A record holding under half their career wins is a partial read
  // (match lists from only some of their profile's pages), so it isn't rated: its rate is guessed from
  // their career wins and 1.4 losses for each event they didn't win (what results show: 518k losses over
  // 358k non-gold entries on Smoothcomp, round robins losing more than once), so 84 wins over 57 events
  // doesn't seed below an 0–1; never fewer losses than the partial read shows. A seed's gold is their career golds.
  const rated = ({ won, lost, wins }) => won + lost > 0 && !(wins > 2 * won);
  const rateOf = (won, lost) => [(won + 10) / (won + lost + 20), won + lost];
  const seedKey = ({ belt, won, lost, wins, events, gold, submission, points, born }) => [
    BELTS.indexOf(belt), ...(rated({ won, lost, wins }) ? rateOf(won, lost) : wins != null && events ? rateOf(wins, Math.max(lost ?? 0, 1.4 * (events - (gold ?? 0)))) : [-1, -1]), wins != null && events ? wins / events : -1,
    wins ?? -1, submission ?? -1, points ?? -1, born ?? -Infinity,
  ];
  const bySeed = (a, b) => {
    const [x, y] = [seedKey(a), seedKey(b)];
    return x.reduce((order, n, i) => order || (y[i] === n ? 0 : y[i] > n ? 1 : -1), 0);
  };
  // A medal call is sure when the athlete's rate or wins per event is known and nobody else in the
  // bracket has the same belt, rate, matches and wins per event; else it is a maybe.
  const sureSeed = (seeds, i) => {
    const k = seedKey(seeds[i]);
    return (k[1] >= 0 || k[3] >= 0) && seeds.every((s, j) => j === i || seedKey(s).slice(0, 4).some((n, m) => n !== k[m]));
  };

  return { rated, seedKey, bySeed, sureSeed, normalize, FINISHES, LABELS, finishOf, finishSql, detailOf, howOf, BELTS, beltsIn, beltOf, isGrade, eventRecords, totals, beltSplit, rivalsOf, placeOf, roundOf, isPool, poolPlaces };
})();
