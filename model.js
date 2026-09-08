// Pure result/match joins for one event: who fought whom, who won, and how the
// leaderboards rank them. Shared by the results page and the regression tests.
const SCWRModel = (() => {
  const normalize = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const placements = (r) => [...(r.top3 ?? []), ...(r.after3 ?? [])];
  const athleteKey = (p, bracketId) => p.target?.user_id
    ? `user:${p.target.user_id}` : `placement:${bracketId}:${p.id}`;
  const identity = (name, club) => `${normalize(name)}\0${normalize(club)}`;
  const category = (name) => normalize(name).replace(/\s*\(day\s+\d+\)\s*$/, '');

  function build(results, matches) {
    const athletes = new Map();
    const brackets = new Map();
    const categories = new Map();
    for (const result of results) {
      if (result.published === false || !result.bracket?.id) continue;
      const id = String(result.bracket.id);
      const bracket = { id, name: result.group.name, size: Number(result.placements), entries: new Map(), names: new Map() };
      for (const p of placements(result)) {
        const key = athleteKey(p, id);
        if (bracket.entries.has(key)) continue;
        const entry = { key, placement: Number(p.placement), bracketId: id, wins: {}, losses: {} };
        bracket.entries.set(key, entry);
        const nameKey = identity(p.target?.fullname, p.club?.name);
        const sameName = bracket.names.get(nameKey) ?? [];
        sameName.push(key);
        bracket.names.set(nameKey, sameName);
        const athlete = athletes.get(key) ?? {
          key, name: p.target?.fullname || 'Unnamed athlete',
          club: p.club?.name || '', clubId: p.club?.id ? String(p.club.id) : null,
          country: p.target?.country || null, countryName: p.target?.country_human || null,
          userId: p.target?.user_id ? String(p.target.user_id) : null,
          logo: p.target?.logo_image || null,
          hidden: Boolean(p.target?.hide_public_profile), entries: [],
        };
        athlete.hidden ||= Boolean(p.target?.hide_public_profile);
        athlete.entries.push(entry);
        athletes.set(key, athlete);
      }
      brackets.set(id, bracket);
      const siblings = categories.get(category(bracket.name)) ?? [];
      siblings.push(bracket);
      categories.set(category(bracket.name), siblings);
    }
    let unmatched = 0;
    let unmatchedContested = 0;
    let walkovers = 0;
    let unresolved = 0;
    let completed = 0;
    const seen = new Set();
    for (const match of matches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      const winners = match.sides.filter((s) => s.won);
      if (winners.length !== 1 || match.sides.length !== 2 || winners[0].won === 'bye') {
        unresolved++;
        continue;
      }
      completed++;
      const isWalkover = winners[0].won === 'walkover';
      if (isWalkover) walkovers++;
      // Round-robin pools can link to a different bracket ID than the final
      // published placement list. Join those pools by the exact division name,
      // only when it identifies one published result bracket.
      const categoryMatches = categories.get(category(match.cat)) ?? [];
      const bracket = brackets.get(String(match.bracketId)) ?? (categoryMatches.length === 1 ? categoryMatches[0] : null);
      for (const side of match.sides) {
        let key = side.userId ? `user:${side.userId}` : null;
        if (!key) {
          const candidates = bracket?.names.get(identity(side.name, side.club)) ?? [];
          if (candidates.length === 1) key = candidates[0];
        }
        const entry = bracket?.entries.get(key);
        if (!entry) { unmatched++; if (!isWalkover) unmatchedContested++; continue; }
        const bucket = side === winners[0] ? entry.wins : entry.losses;
        bucket[winners[0].won] = (bucket[winners[0].won] ?? 0) + 1;
      }
    }
    return { athletes, brackets, unmatched, unmatchedContested, unresolved, completed, walkovers, fought: completed - walkovers };
  }

  // Every direct meeting between two named academies, plus the aggregate record.
  // This works from the match feed rather than the published placements so the
  // ledger and its total can never disagree about which bouts were counted.
  function headToHead(matches, academyA, academyB, types = null, includeSide = null) {
    const names = [String(academyA ?? ''), String(academyB ?? '')];
    const keys = names.map(normalize);
    const allowed = types ? new Set(types) : null;
    const sides = names.map((name) => ({ name, wins: 0, types: {} }));
    const meetings = [];
    const seen = new Set();

    if (!keys[0] || !keys[1] || keys[0] === keys[1]) return { a: sides[0], b: sides[1], total: 0, matches: meetings };

    for (const match of matches ?? []) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      if (match.sides?.length !== 2) continue;
      const indexed = match.sides.map((side) => ({ side, academy: keys.indexOf(normalize(side.club)) }));
      if (indexed.some(({ academy }) => academy < 0) || indexed[0].academy === indexed[1].academy) continue;
      if (includeSide && indexed.some(({ side }) => !includeSide(side))) continue;
      const winners = indexed.filter(({ side }) => side.won);
      if (winners.length !== 1 || winners[0].side.won === 'bye') continue;
      const winType = winners[0].side.won;
      if (allowed && !allowed.has(winType)) continue;
      const winner = winners[0];
      const loser = indexed.find(({ side }) => side !== winner.side);
      sides[winner.academy].wins++;
      sides[winner.academy].types[winType] = (sides[winner.academy].types[winType] ?? 0) + 1;
      meetings.push({
        id: String(match.id), bracketId: String(match.bracketId), category: match.cat || '', winType,
        winner: { ...winner.side, academy: names[winner.academy] },
        loser: { ...loser.side, academy: names[loser.academy] },
      });
    }
    // The ledger reads in the incumbent finish order the aggregate bar and the
    // win-type chips already use, so the marker column scans top to bottom the
    // way the bar scans left to right. Divisions group under it — day 1 and day
    // 2 of one bracket together — and match order settles the rest.
    const rank = (t) => (SCWRSite.WIN_TYPES.indexOf(t) < 0 ? SCWRSite.WIN_TYPES.length : SCWRSite.WIN_TYPES.indexOf(t));
    meetings.sort((x, y) => rank(x.winType) - rank(y.winType)
      || category(x.category).localeCompare(category(y.category))
      || (Number(x.id) || 0) - (Number(y.id) || 0));
    return { a: sides[0], b: sides[1], total: meetings.length, matches: meetings };
  }

  // Smoothcomp's match list publishes no scores, so dominance is measured by how
  // decisively a match ended: finishes landed versus finishes conceded.
  const derive = (row, wins, losses, types, lossTypes, medals) => ({
    ...row, wins, losses, types, lossTypes, medals,
    total: wins + losses,
    rate: wins + losses ? wins / (wins + losses) : null,
    submissions: types.submission ?? 0,
    submitted: lossTypes.submission ?? 0,
    // Share of this athlete's wins that ended the match outright.
    finishRate: wins ? (types.submission ?? 0) / wins : null,
    // Share of every match they contested that they finished.
    submissionRate: wins + losses ? (types.submission ?? 0) / (wins + losses) : null,
    // The mirror of finishRate: share of their losses that ended with them
    // finished. Null when they never lost, which sorts as the best possible.
    concededRate: losses ? (lossTypes.submission ?? 0) / losses : null,
    golds: medals[0],
    silvers: medals[1],
    bronzes: medals[2],
    podiums: medals[0] + medals[1] + medals[2],
  });

  // `types` is an explicit allowlist of win types; without one, everything but
  // byes counts, and walkovers only when asked for.
  function summarize(athlete, model, { walkovers = false, types = null, bracketIds = null } = {}) {
    const entries = athlete.entries.filter((e) => !bracketIds || bracketIds.has(e.bracketId));
    const skip = (type) => (types
      ? !types.includes(type)
      : (type === 'walkover' && !walkovers) || type === 'bye');
    const counts = (bucket) => Object.entries(bucket).reduce((n, [type, count]) =>
      n + (skip(type) ? 0 : count), 0);
    const tally = (pick) => {
      const out = {};
      entries.forEach((e) => Object.entries(pick(e)).forEach(([type, count]) => {
        if (skip(type)) return;
        out[type] = (out[type] ?? 0) + count;
      }));
      return out;
    };
    const medals = [1, 2, 3].map((place) => entries.filter((e) => e.placement === place).length);
    const size = (e) => model.brackets.get(e.bracketId).size;
    const goldSizes = entries.filter((e) => e.placement === 1).map(size);
    return {
      ...derive(athlete, entries.reduce((n, e) => n + counts(e.wins), 0),
        entries.reduce((n, e) => n + counts(e.losses), 0),
        tally((e) => e.wins), tally((e) => e.losses), medals),
      entries,
      divisions: entries.length,
      biggestGold: Math.max(0, ...goldSizes),
      biggestBracket: Math.max(0, ...entries.map(size)),
    };
  }

  // The participants payload is the only place Smoothcomp publishes a real age, a
  // belt or a photo for everyone who entered; the results payload carries none of
  // it. Registrations repeat per division, so the first one for a user wins.
  function roster(payload) {
    const labels = new Map((payload?.categories ?? []).map((c) => [c.id, c]));
    // Organisers name the same field "Belt", "Level" or "Rank", depending on the
    // event and whether the division is gi or no-gi.
    const grade = (registration) => {
      for (const { category_value_id: id } of registration.categories ?? []) {
        const value = labels.get(id);
        if (value && /^(belt|level|rank)$/i.test(value.category_name)) return value.name;
      }
      return null;
    };
    const people = new Map();
    for (const group of payload?.participants ?? []) {
      for (const r of group.registrations ?? []) {
        if (!r.user_id || people.has(String(r.user_id))) continue;
        const age = r.age === null || r.age === '' ? NaN : Number(r.age);
        people.set(String(r.user_id), {
          age: Number.isFinite(age) ? age : null,
          birth: r.birth || null,
          country: r.country || null,
          // A competitor with no photo still ships a placeholder URL, so the
          // image id is the only reliable test.
          photo: r.profile_image_id && r.profile_image && !/placeholder/i.test(r.profile_image)
            ? r.profile_image : null,
          belt: grade(r),
        });
      }
    }
    return people;
  }

  // Fold the roster onto athletes already built from the published results.
  function attachRoster(model, people) {
    if (!people?.size) return model;
    for (const athlete of model.athletes.values()) {
      const entry = athlete.userId ? people.get(athlete.userId) : null;
      if (!entry) continue;
      athlete.age = entry.age;
      athlete.belt = entry.belt;
      // The results payload already carries the code; the roster only knows the name.
      athlete.countryName ||= entry.country;
      // Only fills a gap: a photo already in the results payload stays authoritative.
      if (!athlete.logo) athlete.logo = entry.photo;
    }
    return model;
  }

  // One bracket entry's record under a win-type allowlist. Cheaper than a full
  // summarize when every entrant in a bracket has to be compared, which is what
  // the brackets view does on every render.
  // An athlete with no entry in the bracket has an empty record rather than an
  // error: the published placements can refresh out from under a rendered page.
  function entryRecord(entry, types) {
    const pick = (bucket) => Object.fromEntries(Object.entries(bucket ?? {}).filter(([type]) => types.includes(type)));
    const sum = (bucket) => Object.values(bucket).reduce((n, count) => n + count, 0);
    const wins = pick(entry?.wins);
    return { wins: sum(wins), losses: sum(pick(entry?.losses)), types: wins };
  }

  // Academy standings reuse the athlete summaries so both tables sort identically.
  function academies(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = normalize(row.club) || '\0unaffiliated';
      const club = map.get(key) ?? {
        key, name: row.club || 'Unaffiliated', club: '', clubId: null, roster: [],
        wins: 0, losses: 0, types: {}, lossTypes: {}, medals: [0, 0, 0], divisions: 0, biggestGold: 0,
      };
      club.roster.push(row);
      club.clubId ??= row.clubId ?? null;
      club.wins += row.wins;
      club.losses += row.losses;
      club.divisions += row.divisions;
      club.biggestGold = Math.max(club.biggestGold, row.biggestGold);
      row.medals.forEach((n, i) => { club.medals[i] += n; });
      for (const [type, n] of Object.entries(row.types)) club.types[type] = (club.types[type] ?? 0) + n;
      for (const [type, n] of Object.entries(row.lossTypes)) club.lossTypes[type] = (club.lossTypes[type] ?? 0) + n;
      map.set(key, club);
    }
    return [...map.values()].map((club) => ({
      ...derive(club, club.wins, club.losses, club.types, club.lossTypes, club.medals),
      athletes: club.roster.length,
      // Wins per athlete separates a deep academy from one carried by a single competitor.
      depth: club.roster.length ? club.wins / club.roster.length : 0,
    }));
  }

  const METRICS = {
    wins: 'wins', losses: 'losses', rate: 'rate', submissions: 'submissions', submitted: 'submitted',
    finish: 'finishRate', conceded: 'concededRate', submissionRate: 'submissionRate', golds: 'golds', podiums: 'podiums',
    silvers: 'silvers', bronzes: 'bronzes', biggest: 'biggestBracket', biggestGold: 'biggestGold', gap: 'gap', divisions: 'divisions', athletes: 'athletes', depth: 'depth', size: 'size',
  };

  // Descending by default: every metric here reads "more is better". Ties fall
  // through a fixed chain — more wins, then a higher win rate, then more golds,
  // then a longer record, then name — so a re-sort never reshuffles rows that
  // genuinely tie. The record length is what separates two winless athletes:
  // 0–6 is a more convincing 0% than 0–2, so it ranks first either way.
  function rank(rows, sort, direction = -1) {
    const metric = METRICS[sort] ?? sort;
    const value = (row) => {
      const v = row[metric];
      return typeof v === 'number' ? v : v == null ? -1 : v;
    };
    return [...rows].sort((a, b) => {
      if (metric === 'name') return direction * a.name.localeCompare(b.name);
      const primary = (value(a) - value(b)) * direction;
      return primary || b.wins - a.wins || (b.rate ?? -1) - (a.rate ?? -1) ||
        b.golds - a.golds || (b.biggestGold ?? 0) - (a.biggestGold ?? 0) ||
        b.total - a.total || a.name.localeCompare(b.name);
    });
  }

  // Age comes from Smoothcomp's participant payload, never from competition-
  // specific division names. When a minimum is active, an unknown age cannot
  // safely be treated as eligible; with no minimum, everybody remains visible.
  const meetsMinimumAge = (athlete, minimumAge) =>
    minimumAge <= 0 || (Number.isFinite(athlete?.age) && athlete.age >= minimumAge);

  // Every entrant of one bracket with the record they posted in it, plus the two
  // people the brackets view is actually about: who was awarded gold, and who won
  // the most matches. Ties go to the better placement, so the medallist only
  // loses the slot when someone strictly out-won them.
  function bracketRow(bracket, model, types, minimumAge) {
    const awardedChampion = [...bracket.entries.values()].find((entry) => entry.placement === 1);
    const entrants = [...bracket.entries.values()]
      .filter((entry) => meetsMinimumAge(model.athletes.get(entry.key), minimumAge))
      .map((entry) => ({
        ...model.athletes.get(entry.key), ...entryRecord(entry, types), placement: entry.placement,
      }));
    if (!entrants.length) return null;
    const champion = entrants.find((p) => p.placement === 1) ?? null;
    const leader = entrants.slice().sort((x, y) =>
      y.wins - x.wins || x.losses - y.losses || x.placement - y.placement)[0] ?? null;
    return {
      ...bracket, key: bracket.id, champion, leader,
      championExcluded: Boolean(awardedChampion && !champion),
      wins: champion?.wins ?? 0,
      leaderWins: leader?.wins ?? 0,
      gapCount: Math.max(0, (leader?.wins ?? 0) - (champion?.wins ?? 0)),
    };
  }

  // One ranked table. `view` is everything the page has chosen — which table,
  // which win types count, and how the reader has narrowed it down. Returns data
  // only: the page adds its own links and captions.
  function leaderboard(model, view) {
    const { table, types, search = '', minimum = 0, minimumAge = 0, sort, direction = -1 } = view;
    const ageFloor = Number.isFinite(minimumAge) ? Math.max(0, Math.floor(minimumAge)) : 0;
    const query = normalize(search);
    const matches = (text) => normalize(text).includes(query);

    if (table === 'brackets') {
      const rows = [...model.brackets.values()]
        .filter((b) => matches(b.name))
        .map((b) => bracketRow(b, model, types, ageFloor))
        .filter(Boolean);
      const field = { name: 'name', wins: 'wins', gap: 'leaderWins', gapCount: 'gapCount' }[sort] ?? 'size';
      return rows.sort((a, b) => (sort === 'name'
        ? direction * a.name.localeCompare(b.name)
        : (a[field] - b[field]) * direction || b.gapCount - a.gapCount || b.size - a.size));
    }

    const people = [...model.athletes.values()]
      .filter((a) => meetsMinimumAge(a, ageFloor))
      .map((a) => summarize(a, model, { types }));

    const rows = table === 'academies'
      // An academy is findable by any of its athletes, so it inherits their
      // countries too — searching "Ukraine" surfaces the clubs that brought some.
      ? academies(people).filter((c) => c.total >= minimum &&
        matches([c.name, ...c.roster.flatMap((a) => [a.name, a.countryName])].join(' ')))
      : people.filter((s) => s.total >= minimum &&
        matches([s.name, s.club, s.countryName,
          ...s.entries.map((e) => model.brackets.get(e.bracketId).name)].join(' ')));
    return rank(rows, sort, direction);
  }

  return { build, headToHead, summarize, entryRecord, academies, roster, attachRoster, leaderboard, rank, placements, athleteKey, normalize, METRICS };
})();
