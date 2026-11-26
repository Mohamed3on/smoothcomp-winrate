// The profile page's rules, apart from the page: when each belt began and how one visit's reads join
// what was kept (an event's Outcome is rules.js'). No DOM, no
// network, no storage, so tests/profile.test.cjs holds them to the shapes Smoothcomp sends.
const SCWRProfile = (() => {
  const { BELTS, beltOf, eventRecords, totals, beltSplit, rivalsOf, usualDivision, normalize, SCORELESS, Outcome } = SCWRRules;
  const WEEK = 7 * 864e5;
  const time = (e) => Date.parse(e.event_start ?? e.start_date);

  // When each belt began, from the profile's belt list (`skills`). Each belt's events run from its
  // first when the list names all of them, else from just after the last one listed at the belt
  // below. Events without a belt (no-gi levels, absolutes) take the belt worn at the time.
  function planBelts(skills) {
    const rows = (skills ?? []).filter(s => /jiu|bjj/i.test(s.name) && beltOf(s.belt)).sort((a, b) => b.sort_order - a.sort_order);
    const belt = beltOf(rows[0]?.belt);
    const listed = (b) => rows.filter(s => beltOf(s.belt) === b);
    // The current belt is worn even when Smoothcomp counts no events at it (levels like
    // "Intermediate (Blue)" don't count toward a belt).
    const worn = BELTS.filter(b => b === belt || listed(b).some(s => s.competed_count > 0));
    // Every event at one belt: the overall rate is that belt's, so it only takes the belt.
    if (!belt || worn.every(b => b === belt)) return { belt, whole: true };
    const times = (b) => listed(b).flatMap(s => s.events ?? []).map(time);
    const starts = worn.map((b, i) => (!i ? -Infinity : times(b).length && listed(b).every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...times(b)) : Math.max(...times(worn[i - 1])) + 1));
    return { belt, worn, starts, shown: new Set([belt, ...worn]).size, beltOf: (e) => worn[starts.findLastIndex(start => start <= time(e))] ?? worn[0] };
  }

  // Everything shown, from the kept events, by the rules the stats site counts by too; newest
  // first, so each rival takes the club and photo of the latest meeting.
  function tally(events, plan) {
    events = [...events].sort((a, b) => (Date.parse(b.start_date) || 0) - (Date.parse(a.start_date) || 0));
    const records = eventRecords(events.map(e => ({ event: e.id, start: e.start_date, out: e.out })), []);
    const losses = events.flatMap(e => e.out.losses.map(loss => ({ ...loss, event: e.id, title: e.title, date: e.start_date })));
    // Their wins, for a head-to-head: who, where and when only.
    const wins = events.flatMap(e => e.out.faced.filter(f => f.won).map(f => ({ ...f, won: true, opponent: f.name, event: e.id, title: e.title, date: e.start_date })));
    // A lower belt no event fell to has nothing to show; the current one says it has no events yet.
    const belts = plan.whole ? null : beltSplit(records, plan.worn, plan.starts).map(b => [b.belt, b]);
    // Everyone who beat them more than once, the newest meeting giving the club, photo and registration to link.
    const rivals = rivalsOf(events.flatMap(e => e.out.faced.map(f => ({ name: f.name, won: f.won, club: f.club, image: f.image, reg: f.reg, event: e.id })))).slice(0, 5);
    return { types: totals(records), belts, losses, wins, rivals, usual: usualDivision(records) };
  }

  // One event as kept (its Outcome, rules.js): `listed` the event list's row, `event` its match list. A match list can hold an
  // event the event list leaves out (an event under two ids): its matches count all the same (`extra`), dated by the belt list
  // (`dated`) where it names it. Settled a week after it started.
  function entry(listed, event, { name, dated, now }) {
    const start = listed ? listed.start_date : dated.get(event.id) ?? null;
    const out = Outcome.fromMatchList(event, name, listed);
    return { id: listed?.id ?? event.id, start_date: start, title: event?.title ?? listed?.title ?? null, out, settled: (!listed && !start) || now - Date.parse(start) > WEEK };
  }

  // One visit's reads joined to what is kept. `news` the event list's rows not kept yet, `found` the
  // match lists read by id, `failed` how many of their pages never answered, `known` the kept
  // settled events by id, `all` whether the whole history was read. With a page unanswered, an
  // event missing from the match lists may be on it: it is left out, unkept, so the next visit reads
  // it again. What is kept fills in what didn't load; on a whole read, events Smoothcomp no longer
  // lists go, but for those only a match list holds.
  function merge({ news, found, failed, known, all }, context) {
    const listed = new Map(news.map(e => [e.id, e]));
    const fresh = news.filter(e => !failed || found.has(e.id)).map(e => entry(e, found.get(e.id), context));
    if (all) for (const event of found.values()) if (!listed.has(event.id)) fresh.push(entry(null, event, context));
    const ids = new Set(fresh.map(e => e.id));
    return { fresh, events: [...fresh, ...[...known.values()].filter(e => !ids.has(e.id) && (!all || listed.has(e.id) || e.out.extra))] };
  }

  // What a visit sends and keeps. Settled events the server lacks go to it: all of them the first
  // time this browser shares an athlete (`kept.shared` unset), then only the newly read; events under
  // a week old go every visit, as read again, so the stats site counts what the profile counts.
  // `holes` the listed events still not counted: while any is missing, when a whole read last
  // left them out (tried again a day later, not every visit) and which (the crawler is asked each visit).
  function share({ events, fresh, shared, kept, total, holes, all, now }) {
    const counted = new Set(events.map(e => e.id));
    const missing = total - events.filter(e => !e.out.extra).length;
    const unshared = events.filter(e => (e.settled ? !shared.has(e.id) && (!kept?.shared || fresh.includes(e)) : fresh.includes(e)));
    return { missing, unshared, gaps: missing > 0 ? { at: all ? now : kept?.gaps?.at, ids: holes.filter(id => !counted.has(id)) } : undefined };
  }

  // Each of their matches with a score to read (not a walkover or a stoppage, rules.js SCORELESS) as
  // { id, event, type, division, stage, score }, score [theirs, the opponent's] points or null: kept on this
  // browser by match id (`kept`), else one Mat Stats holds (`stored`, worker.js scored) by the match id, else
  // by the same event, division, result, opponent and round, names spelt either way ("Hüseyin", "Huseyin").
  function scoresOf(events, kept, stored) {
    const fold = (s) => normalize(s).normalize('NFD').replace(/\p{M}/gu, '');
    const meeting = (event, division, won, opponent, stage) => `${event}|${fold(division)}|${!!won}|${fold(opponent)}|${stage ?? ''}`;
    const byId = new Map(stored.filter(m => m.match).map(m => [Number(m.match), m]));
    const byMeeting = new Map(stored.map(m => [meeting(m.event, m.division, m.won, m.opponent, m.stage), m]));
    return events.flatMap(e => [...e.out.faced.filter(f => f.won).map(f => ({ ...f, opponent: f.name })), ...e.out.losses.map(l => ({ ...l, won: false }))]
      .filter(m => m.type && !SCORELESS.includes(m.type))
      .map((m) => {
        const s = (m.match && byId.get(Number(m.match))) || byMeeting.get(meeting(e.id, m.division, m.won, m.opponent, m.stage));
        return { id: m.match ?? null, event: e.id, type: m.type, division: m.division ?? null, stage: m.stage ?? null,
          score: (m.match && kept[m.match]) || (s ? [s.us[0], s.them[0]] : null) };
      }));
  }

  // A match card (Smoothcomp's getBracketMatchData) as theirs: `score` [theirs, the opponent's] points, and the
  // users, [points, advantages, penalties] and clock Mat Stats keeps (worker.js scores); null when neither side is them.
  function fromCard(card, user) {
    const sides = [card?.left, card?.right];
    const mine = sides.findIndex(p => p?.id != null && String(p.id) === String(user));
    if (mine < 0 || sides[1 - mine]?.id == null) return null;
    const trio = (p) => [p.score, p.advantage, p.penalty].map(n => (Number.isSafeInteger(n) ? n : 0));
    const time = card.matchInfo?.time, left = card.matchInfo?.timeRemaining;
    return { score: [trio(sides[mine])[0], trio(sides[1 - mine])[0]], users: sides.map(p => String(p.id)), s: sides.map(trio),
      clock: [/^\d+:\d\d$/.test(time ?? '') ? Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]) : null, Number.isSafeInteger(left) ? Math.round(left / 1000) : null] };
  }

  return { planBelts, tally, entry, merge, share, scoresOf, fromCard, WEEK };
})();
