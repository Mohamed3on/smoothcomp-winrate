// Pure result/match joins for one event: who fought whom, who won, and how the
// leaderboards rank them. Shared by the results page and the regression tests.
const SCWRModel = (() => {
  const { isYouth } = SCWRSite;
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
          userId: p.target?.user_id ? String(p.target.user_id) : null,
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
    finish: 'finishRate', submissionRate: 'submissionRate', golds: 'golds', podiums: 'podiums',
    silvers: 'silvers', bronzes: 'bronzes', biggest: 'biggestBracket', biggestGold: 'biggestGold', gap: 'gap', divisions: 'divisions', athletes: 'athletes', depth: 'depth', size: 'size',
  };

  // Descending by default: every metric here reads "more is better". Ties fall
  // through a fixed chain — more wins, then a higher win rate, then more golds,
  // then name — so a re-sort never reshuffles rows that genuinely tie.
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
        a.name.localeCompare(b.name);
    });
  }

  // Which brackets a set of filters leaves standing. Division and age group are
  // read off the bracket name because that is the only place Smoothcomp records them.
  function scopeBrackets(model, { division = 'all', age = 'all' } = {}) {
    return new Set([...model.brackets.values()].filter((b) => {
      const nogi = /no[ -]?gi/i.test(b.name);
      return (division === 'all' || (division === 'nogi' ? nogi : !nogi)) &&
        (age === 'all' || (age === 'youth' ? isYouth(b.name) : !isYouth(b.name)));
    }).map((b) => b.id));
  }

  // Every entrant of one bracket with the record they posted in it, plus the two
  // people the brackets view is actually about: who was awarded gold, and who won
  // the most matches. Ties go to the better placement, so the medallist only
  // loses the slot when someone strictly out-won them.
  function bracketRow(bracket, model, types) {
    const entrants = [...bracket.entries.values()].map((entry) => ({
      ...model.athletes.get(entry.key), ...entryRecord(entry, types), placement: entry.placement,
    }));
    const champion = entrants.find((p) => p.placement === 1) ?? null;
    const leader = entrants.slice().sort((x, y) =>
      y.wins - x.wins || x.losses - y.losses || x.placement - y.placement)[0] ?? null;
    return {
      ...bracket, key: bracket.id, champion, leader,
      wins: champion?.wins ?? 0,
      leaderWins: leader?.wins ?? 0,
      gapCount: Math.max(0, (leader?.wins ?? 0) - (champion?.wins ?? 0)),
    };
  }

  // One ranked table. `view` is everything the page has chosen — which table,
  // which win types count, and how the reader has narrowed it down. Returns data
  // only: the page adds its own links and captions.
  function leaderboard(model, view) {
    const { table, types, search = '', minimum = 0, sort, direction = -1 } = view;
    const bracketIds = scopeBrackets(model, view);
    const query = normalize(search);
    const matches = (text) => normalize(text).includes(query);

    if (table === 'brackets') {
      const rows = [...model.brackets.values()]
        .filter((b) => bracketIds.has(b.id) && matches(b.name))
        .map((b) => bracketRow(b, model, types));
      const field = { name: 'name', wins: 'wins', gap: 'leaderWins', gapCount: 'gapCount' }[sort] ?? 'size';
      return rows.sort((a, b) => (sort === 'name'
        ? direction * a.name.localeCompare(b.name)
        : (a[field] - b[field]) * direction || b.gapCount - a.gapCount || b.size - a.size));
    }

    const people = [...model.athletes.values()]
      .map((a) => summarize(a, model, { types, bracketIds }))
      .filter((s) => s.entries.length);

    const rows = table === 'academies'
      ? academies(people).filter((c) => c.total >= minimum &&
        matches(`${c.name} ${c.roster.map((a) => a.name).join(' ')}`))
      : people.filter((s) => s.total >= minimum &&
        matches([s.name, s.club, ...s.entries.map((e) => model.brackets.get(e.bracketId).name)].join(' ')));
    return rank(rows, sort, direction);
  }

  return { build, summarize, entryRecord, academies, leaderboard, rank, placements, athleteKey, normalize, METRICS };
})();
