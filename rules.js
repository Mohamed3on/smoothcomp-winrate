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
  // The finishes whose score is never read: a walkover has none, and a stoppage ends a match its points don't settle.
  const SCORELESS = ['walkover', 'stoppage'];
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
    // An event their profile lists that they didn't show at (`absent`: no match, win or medal there) isn't theirs, unless the results say they fought.
    outcomes = outcomes.filter((o) => !o.out?.absent);
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
  // An entry whose every match was a walkover: they fought no one there, so it isn't one of their events
  // (a bracket of one, with no match at all, still is). playedSql asks the opposite of an entries row in SQL.
  const noShow = (e) => {
    const finishes = [...Object.keys(e.wins ?? {}), ...Object.keys(e.losses ?? {})];
    return finishes.length > 0 && finishes.every((t) => finishOf(t) === 'walkover');
  };
  const playedSql = (e) => `(SELECT count(*) = 0 OR sum(${finishSql('key')} != 'walkover') > 0 FROM (SELECT key FROM json_each(${e}.wins) UNION ALL SELECT key FROM json_each(${e}.losses)))`;
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

  // The age group and weight class a division's name gives, each null where it names none (or, for
  // age, a part names two, like "Juveniles - Adults"). Organisers split names with "/"; an age in years
  // decides over words ("Pre Teen (10 - 11 yrs)" is kids), and of the parts the narrowest wins ("Adult
  // Gi / Master 1 (30+)" is Master 1). Weight is the class's limit as written ("de 40,4 até 44,3 kg" is
  // −44.3 kg, a bare "88,30 kg" too), "+" a floor, without a unit where it gives none; open weight is
  // "Open"; a class named but not weighed ("PESADO") reads as its name.
  const AGES = ['Kids', 'Teen', 'Juvenile', 'Adult', 'Master'];
  // A weight with no unit: "-71", "+105", "160 - 169.9 (Welter Weight)", "105 to 110", "19.9 & Under".
  const BARE = /^\s*([-+])?\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|to)\s*(\d+(?:[.,]\d+)?))?\s*((?:&|and)\s*(?:under|below|over|above))?\s*(?:\([^)]*\))?\s*$/i;
  const CLASS = /^\s*((super|ultra|light|medium|meio)[- ]?)?(rooster|galo|pluma|feather|pena|light|leve|middle|m[eé]dio|heavy|pesad\p{L}*|welter|cruiser)(\s*weight)?\s*(#?\d|i+)?\s*$/iu;
  const byAge = (n) => (n <= 12 ? 'Kids' : n <= 17 ? 'Teen' : n < 30 ? 'Adult' : 'Master');
  function ageIn(part) {
    if (/\d\s*\+?\s*(kg|lbs?)\b/i.test(part)) return null;
    const master = /\bmasters?\s*(\d)\b/i.exec(part);
    if (master) return `Master ${master[1]}`;
    if (/\binfanto/i.test(part)) return 'Teen';
    // Years as a range or an age ("11-12 anos", "Pee Wee I (7yrs)", a bare "10-11"), the oldest deciding;
    // an under-age ("U15", "BU13", "8U") the one below it; a floor ("18+", "18 & above", "Director (40+)") adult or master.
    const bare = /^\s*(\d+)\s*(?:-|&)\s*(\d+)\s*$/.exec(part);
    const years = /(\d+)\s*(?:(?:-|&)\s*(\d+)\s*)?(?:years?|yrs|anos|años|y\.?o)/i.exec(part) ?? (bare && bare[2] - bare[1] <= 3 && +bare[2] <= 17 ? bare : null);
    if (years && +(years[2] ?? years[1]) < 30) return byAge(+(years[2] ?? years[1]));
    const under = /(?:\b|[a-z])u ?(\d{1,2})\b|\b(\d+)u\b/i.exec(part);
    if (under) return byAge(+(under[1] ?? under[2]) - 1);
    const floor = /(?<![\d.,])(\d+)\s*(?:\+|(?:&|and)\s*(?:above|over|older))|\+\s*(\d+)(?![\d.,])/i.exec(part);
    if (floor && (!BARE.test(part) || +(floor[1] ?? floor[2]) <= 40)) return +(floor[1] ?? floor[2]) >= 30 ? 'Master' : 'Adult';
    const named = new Set([
      [/\bmaster|\bveteran/i, 'Master'], [/\bjuvenil/i, 'Juvenile'], [/\b(teen|cadet)/i, 'Teen'],
      [/\b(kid|infant|junior|youth|pee wee|mighty mi|mirim|children)/i, 'Kids'], [/\b(adult|amateur|professional|senior)/i, 'Adult'],
    ].filter(([re]) => re.test(part)).map(([, age]) => age));
    if (named.has('Teen') || named.has('Juvenile')) named.delete('Kids');
    if (named.has('Master') && /senior/i.test(part)) named.delete('Adult');
    return named.size === 1 ? [...named][0] : null;
  }
  const rank = (age) => (age ? AGES.indexOf(age.replace(/ \d$/, '')) + (/\d$/.test(age) ? 1 : 0) : -1);
  function weightIn(part) {
    if (/\b(open|absolut)/i.test(part)) return 'Open';
    const m = [...part.matchAll(/(\d+(?:[.,]\d+)?)\s*\+?\s*(kg|lbs?)\b/gi)].pop();
    // Unitless, unless it reads as an age ("10-11") or is lighter than anyone over five.
    const bare = !m && BARE.exec(part);
    if (!m && !bare) return CLASS.test(part) ? part.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()) : null;
    if (bare && (ageIn(part) || parseFloat(bare[3] ?? bare[2]) < 18)) return null;
    const n = parseFloat((m ? m[1] : bare[3] ?? bare[2]).replace(',', '.'));
    const unit = m ? (/kg/i.test(m[2]) ? ' kg' : ' lbs') : '';
    if (n >= (unit === ' kg' ? 300 : 600)) return 'Open';
    return `${/\+|acima|above|over|more than|mais de/i.test(part) ? '+' : '−'}${n}${unit}`;
  }
  // Whom a division is for: "f" or "m", null for a mixed one or one that doesn't say ("Female" and "Women" hold no word "male" or "men").
  const SEXES = [['f', /\b(female|women|woman|womens|feminin[oa]|femenin[oa]|femmes?|girls?|ladies|damer?)\b/i], ['m', /\b(male|men|man|mens|masculin[oa]?|hommes?|boys?|herrar|herren)\b|men['‘’]s/i]];
  const sexOf = (name) => { const named = SEXES.filter(([, re]) => re.test(name)).map(([s]) => s); return named.length === 1 ? named[0] : null; };
  function divisionOf(name) {
    const parts = String(name ?? '').split('/');
    // A field listing three age groups or more ("TOURNOI NOGI U17/JUNIORS/SENIORS/MASTERS") is the event's, not the division's.
    const age = String(name ?? '').split(/\s\/|\/\s/).flatMap((f) => { const a = f.split('/').map(ageIn); return new Set(a.filter(Boolean)).size >= 3 ? [] : a; }).reduce((best, a) => (rank(a) >= rank(best) ? a : best), null);
    return { age, weight: parts.map(weightIn).find(Boolean) ?? null, sex: sexOf(String(name ?? '')) };
  }
  // The age group and weight class an athlete entered most over the year to their latest event, each
  // counted once an event; a tie goes to the newer. Open weight doesn't count, nor a limit with no unit ("−169.9": kg or lbs?).
  // Organisers draw one class differently (−84.9 kg, −185 lbs, −85 kg): a limit counts every event with one
  // within 1.5 kg of it, then the events at it exactly, so the class shows as most of them write it. `records` as eventRecords gives them.
  function usualDivision(records) {
    const dated = records.filter((r) => !Number.isNaN(Date.parse(r.start ?? ''))).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
    const since = dated.length ? Date.parse(dated[0].start) - 365 * 864e5 : 0;
    const ages = new Map();
    const sexes = new Map();
    const weights = [];
    for (const r of dated.filter((x) => Date.parse(x.start) >= since)) {
      const seen = r.divisions.map(divisionOf);
      for (const a of new Set(seen.map((d) => d.age).filter(Boolean))) ages.set(a, (ages.get(a) ?? 0) + 1);
      for (const s of new Set(seen.map((d) => d.sex).filter(Boolean))) sexes.set(s, (sexes.get(s) ?? 0) + 1);
      weights.push(new Set(seen.map((d) => d.weight).filter((x) => x && x !== 'Open' && !/^[−+][\d.]+$/.test(x))));
    }
    const most = (counts) => [...counts].reduce((best, x) => (!best || x[1] > best[1] ? x : best), null)?.[0] ?? null;
    const kg = (w) => { const m = /^([−+])([\d.]+) (kg|lbs)$/.exec(w); return m && [m[1], m[2] * (m[3] === 'lbs' ? 0.45359237 : 1)]; };
    const near = (a, b) => a === b || (kg(a) && kg(b) && kg(a)[0] === kg(b)[0] && Math.abs(kg(a)[1] - kg(b)[1]) <= 1.5);
    const score = (w) => [weights.filter((e) => [...e].some((x) => near(x, w))).length, weights.filter((e) => e.has(w)).length];
    const weight = [...new Set(weights.flatMap((e) => [...e]))].map((w) => [w, score(w)])
      .reduce((best, x) => (!best || x[1][0] > best[1][0] || (x[1][0] === best[1][0] && x[1][1] > best[1][1]) ? x : best), null)?.[0] ?? null;
    return { age: most(ages), weight, sex: most(sexes) };
  }

  // The bracket an athlete ranks in, from their usual division: whom ('m', 'f'), the age group without its level ("Master 1"
  // is Master), and the weight class of WEIGHTS nearest their usual limit (101: over 100 kg). One list serves men, women and
  // kids: 94%, 90% and 91% of athletes with a usual weight (2026-11-25) are within 2 kg of their class. A floor ("+94 kg") takes
  // the first class above it; a class named but not weighed ("Pesado") gives none.
  const WEIGHTS = [20, 25, 30, 35, 40, 44, 48, 53, 57, 62, 66, 70, 74, 77, 80, 85, 88, 91, 94, 100];
  const weightName = (n) => (n > 100 ? '+100 kg' : `−${n} kg`);
  function bracketOf({ sex = null, age = null, weight = null } = {}) {
    const m = /^([−+])([\d.]+) (kg|lbs)$/.exec(weight ?? '');
    const kg = m && m[2] * (m[3] === 'lbs' ? 0.45359237 : 1);
    const cls = !m ? null : m[1] === '+' ? WEIGHTS.find((n) => n > kg) ?? 101 : kg > 100.6 ? 101 : WEIGHTS.reduce((best, n) => (Math.abs(n - kg) < Math.abs(best - kg) ? n : best));
    return { sex, age: age?.replace(/ \d$/, '') ?? null, weight: cls };
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

  // An event's results read off Smoothcomp's JSON, which answers a server or any page without a sign-in: the
  // crawler (server/crawl.js) and the stats site's Read results now (site read-now.tsx) read the same way, each
  // fetching as suits it. First the schedule's mats (mats.json) and their match lists (mat/<id>/matches.json), kept
  // small: [id, division, stage, finish (one winner, finished), sides, bracket], a side being [registration, won,
  // name, club, country, affiliation]. Whether every match is finished, and when the last mat ends.
  function scheduleOf(mats, lists) {
    const seen = new Map();
    let over = true;
    for (const m of lists.flatMap((l) => (Array.isArray(l) ? l : []))) {
      const sides = (m?.seats ?? []).filter((s) => s.type === 'registration' && s.event_registration_id);
      if (!sides.length || seen.has(m.id)) continue;
      const winners = sides.filter((s) => s.isWinner);
      const finish = m.state === 'finished' && sides.length === 2 && winners.length === 1 && m.wonBy ? String(m.wonBy) : null;
      if (m.state !== 'finished') over = false;
      seen.set(m.id, [m.id, m.group ?? '', m.name ?? '', finish, sides.map((s) => [s.event_registration_id, !!s.isWinner, s.name ?? null, s.club || null, s.country || null, s.affiliation || null]), Number(m.bracket_id) || null]);
    }
    const ends = Math.max(0, ...mats.map((m) => Date.parse(m?.estimated_end) || 0));
    return { matches: [...seen.values()], over, ends: ends || null };
  }

  // Then each match's bracket card (getBracketMatchData/<id>): who each side is (their user, academy, affiliation, age,
  // photo), and the score, kept for the matches whose card is read. Cards are read only to name everyone (a card for
  // every match would be about 2.5 times the requests), `room` at a time: matches naming two unknown sides first.
  // `read(matches)` gives each one's card (null or an Error where it failed), whose sides are left to another match.
  // `data` is { matches, users: {}, tried: [] } and keeps what is read, so a read cut off goes on where it stopped;
  // those no card named stay unnamed (`missed`).
  // Sides Mat Stats already knows (`known`, as stats.js known gives an event's): a match it keeps names both sides, who
  // won it and whom they beat, with the score where one was read, so no card is read for them. `known` is { matches:
  // [[match, user, won, opponent, us, them, clock, division, stage, opponent's name]], people: { user: { name, club, ... } } }.
  // A match is found by its id, else (a results page keeps none) by its division, round and the two who fought it, spelt
  // as either list spells them; a round robin's numbered match is the only one of its number there.
  const fold = (name) => normalize(name).normalize('NFD').replace(/\p{M}/gu, '');
  const matchKey = (division, stage, a, b) => `${normalize(division)}|${stage}|${/^Match \d+\//.test(stage ?? '') ? '' : [fold(a), fold(b)].sort().join('+')}`;
  function knownSides(data, { matches = [], people = {} } = {}) {
    const by = new Map();
    for (const k of matches) if (k[2] && k[3]) by.set(k[0] ?? matchKey(k[7], k[8], people[k[1]]?.name, k[9]), k);
    data.cards ??= {};
    for (const m of data.matches) {
      const k = by.get(m[0]) ?? (m[4].length === 2 ? by.get(matchKey(m[1], m[2], m[4][0][2], m[4][1][2])) : undefined);
      const won = m[4].findIndex((s) => s[1]);
      if (!k || !m[3] || m[4].length !== 2 || won < 0) continue;
      const ids = won ? [k[3], k[1]] : [k[1], k[3]];
      m[4].forEach((s, i) => {
        const p = people[ids[i]] ?? {};
        data.users[s[0]] ??= { id: String(ids[i]), name: p.name ?? s[2], club: p.club ?? s[3], clubId: p.club_id ?? null, affiliation: p.affiliation ?? s[5],
          country: p.country ?? (s[4] ? String(s[4]).toLowerCase() : null), countryName: p.country_name ?? null, age: p.born ? new Date().getUTCFullYear() - p.born : null,
          photo: p.photo ?? null, hidden: p.hidden ? true : null };
      });
      if (k[4] && k[5]) data.cards[m[0]] = { s: won ? [k[5], k[4]] : [k[4], k[5]], t: k[6] ?? [null, null] };
    }
  }

  const scored = (m) => m[3] && finishOf(m[3]) !== 'walkover' && m[4].length === 2;
  const seconds = (t) => (/^\d+:\d\d$/.test(t ?? '') ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);
  async function nameSides(data, room, read) {
    const users = data.users;
    data.cards ??= {};
    const tried = new Set(data.tried);
    const open = (reg) => !(reg in users) && !(data.missed ?? []).includes(reg);
    for (;;) {
      const space = room();
      const want = new Set(data.matches.flatMap((m) => m[4].map((s) => s[0])).filter(open));
      const out = [];
      const taken = new Set();
      // Of two matches naming as many, a scored one first, so more matches keep their score.
      const rank = data.matches.filter((m) => !tried.has(m[0])).map((m) => [m, m[4].filter((s) => want.has(s[0])).length]).sort((a, b) => b[1] - a[1] || scored(b[0]) - scored(a[0]));
      for (const [m] of rank) {
        if (out.length >= space) break;
        const fresh = m[4].filter((s) => want.has(s[0]) && !taken.has(s[0]));
        if (!fresh.length) continue;
        fresh.forEach((s) => taken.add(s[0]));
        out.push(m);
      }
      if (!out.length) {
        // Nothing left to try for these: they stay unnamed.
        data.missed = [...new Set([...(data.missed ?? []), ...want])];
        return;
      }
      const cards = await read(out);
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
            photo: /^https:/.test(p.profile_image ?? '') ? p.profile_image : null,
            // The card's `public` is true for hidden profiles too (2268210), so it can only ever say hidden.
            hidden: p.public === false || null };
          score[k] = [p.score, p.advantage, p.penalty].map((n) => (Number.isSafeInteger(n) ? n : 0));
        }
        // The score per seat ([points, advantages, penalties]) and the clock: when the match ended and the seconds left
        // (the card gives those in milliseconds).
        if (scored(m) && score[0] && score[1]) data.cards[m[0]] = { s: score, t: [seconds(card.matchInfo?.time), Number.isSafeInteger(card.matchInfo?.timeRemaining) ? Math.round(card.matchInfo.timeRemaining / 1000) : null] };
      });
      data.tried = [...tried];
    }
  }

  // The event as a results page would send it (/record): each athlete's divisions, wins and losses by finish, and a
  // place where the matches give one (placeOf, poolPlaces), in the order fought, its medals from the final and bronze
  // match, as the extension counts a division not yet published. No-shows (walkover losses alone) are left out, as
  // published results leave them out. `start` is the event's, for the age the server keeps a birth year from.
  function eventResults(data, start) {
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
      for (const [id, , stage, finish, sides, bracket] of [...matches].sort((a, b) => roundOf(a[2]) - roundOf(b[2]) || a[0] - b[0])) {
        const card = data.cards?.[id];
        const seats = sides.map(of);
        if (!finish) continue;
        sides.forEach((s, i) => {
          const x = seats[i];
          if (!x) return;
          // Who they met: the other side, named as their bracket card names them where it was read.
          const k = 1 - i;
          const them = sides[k] && (data.users[sides[k][0]] ?? null);
          if (sides[k]) x.e.bouts.push({ won: s[1], type: finish, opponent: them?.name ?? sides[k][2], user: them?.id ?? null, club: them?.club ?? sides[k][3], stage, bracket, match: id,
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

  // Two of Smoothcomp's pages (which answer a server or any page, no sign-in) read by the crawler and by the stats site when
  // one is opened. An event's (its accommodations page, unchallenged): how many athletes its menu counts, the badge on its
  // Athletes link; none (null) while the organiser keeps the list hidden, or nobody has entered.
  const registeredIn = (html) => {
    const n = String(html).match(/Athletes\s*<span class="badge">([^<]*)<\/span>/)?.[1].replace(/\D/g, '');
    return n ? Number(n) : null;
  };
  // An academy's (/en/club/<id>): where it says it is, when it set that (data-profile): its map pin, its town and street.
  const coord = (v, max) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) && Math.abs(n) <= max ? n : null; };
  const unescape = (s) => s.replace(/&(quot|amp|#0?39|lt|gt);/g, (_, e) => ({ quot: '"', amp: '&', '#039': "'", '#39': "'", lt: '<', gt: '>' })[e]);
  const words = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);
  function clubPlace(html) {
    let p;
    try { p = JSON.parse(unescape(String(html).match(/data-profile="(\{[^"]*\})"/)?.[1] ?? 'null')); } catch { return null; }
    if (!p || typeof p !== 'object') return null;
    const lat = coord(p.location_lat, 90), lng = coord(p.location_long, 180);
    const pinned = lat != null && lng != null && (lat !== 0 || lng !== 0);
    return { lat: pinned ? lat : null, lng: pinned ? lng : null, city: words(p.city, 100), country: /^[A-Z]{2}$/.test(p.country_code ?? '') ? p.country_code : null, address: words(p.address, 200) };
  }

  return { rated, seedKey, bySeed, sureSeed, normalize, FINISHES, LABELS, finishOf, finishSql, SCORELESS, detailOf, howOf, BELTS, beltsIn, beltOf, isGrade, eventRecords, noShow, playedSql, totals, beltSplit, rivalsOf, divisionOf, usualDivision, WEIGHTS, weightName, bracketOf, placeOf, roundOf, isPool, poolPlaces, scheduleOf, knownSides, nameSides, eventResults, registeredIn, clubPlace };
})();
