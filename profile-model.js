// The profile page's rules, apart from the page: which seat in a match list is theirs, when each
// belt began, what a kept copy may hold, and how one visit's reads join what was kept. No DOM, no
// network, no storage, so tests/profile.test.cjs holds them to the shapes Smoothcomp sends.
const SCWRProfile = (() => {
  const { BELTS, beltOf, finishOf, howOf, eventRecords, totals, beltSplit, rivalsOf, usualDivision } = SCWRRules;
  const WEEK = 7 * 864e5;
  const time = (e) => Date.parse(e.event_start ?? e.start_date);
  // A match list's finish, or a kept one's (an older copy says "escape"); walkovers never count here.
  const finished = (type) => (typeof type === 'string' && type && finishOf(type) !== 'walkover' ? finishOf(type) : null);

  // The athlete's matches at one event, as [won, lost] by finish, and each loss with who beat
  // them, in what division and how; each win names the same, for a head-to-head. Walkovers left
  // out. v 2 marks the wins' details. Each division registers them afresh: their seat is the
  // registration in the most of its matches (a round robin lists others' too), their name (as
  // the profile gives it) settling a tie.
  function outcomes(event, name) {
    name = String(name ?? '').trim().toLowerCase();
    const out = { v: 2, types: {}, losses: [], faced: [] };
    for (const group of Object.values(event.matches ?? {})) {
      const matches = group.matches ?? [];
      const seen = new Map();
      for (const m of matches) for (const s of m.seats ?? []) {
        const id = s.event_registration_id;
        seen.set(id, { n: (seen.get(id)?.n ?? 0) + 1, named: s.name?.trim().toLowerCase() === name });
      }
      const most = Math.max(0, ...[...seen.values()].map(s => s.n));
      const top = [...seen].filter(([, s]) => s.n === most);
      const mine = (top.length === 1 && most > 1 ? top[0] : top.find(([, s]) => s.named))?.[0];
      if (mine == null) continue;
      for (const m of matches) {
        const seat = m.seats?.find(s => s.event_registration_id === mine);
        const type = finishOf(m.wonBy);
        if (!seat || type === 'walkover' || !(seat.isWinner || seat.isLoser)) continue;
        out.types[type] ??= [0, 0];
        out.types[type][seat.isWinner ? 0 : 1]++;
        const other = m.seats.find(s => s !== seat);
        if (other?.name) out.faced.push({ name: other.name, club: other.club ?? null, image: other.image ?? null, reg: other.event_registration_id ?? null, won: !!seat.isWinner,
          ...(seat.isWinner ? { type, how: howOf(m.wonBy), division: group.group ?? null, bracket: m.bracket_id ?? null, stage: m.name ?? null, match: m.id ?? null } : {}) });
        if (seat.isLoser) out.losses.push({ type, how: howOf(m.wonBy), opponent: other?.name ?? null, club: other?.club ?? null, division: group.group ?? null,
          reg: other?.event_registration_id ?? null, image: other?.image ?? null, bracket: m.bracket_id ?? null, stage: m.name ?? null, match: m.id ?? null });
      }
    }
    return out;
  }

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

  // What is read back, kept on this browser or shared, keeps only the shape outcomes() makes.
  function clean(out) {
    const types = {};
    for (const [type, pair] of Object.entries(out?.types && typeof out.types === 'object' ? out.types : {})) {
      const t = finished(type);
      if (t && Array.isArray(pair)) types[t] = [(types[t]?.[0] ?? 0) + (Number(pair[0]) || 0), (types[t]?.[1] ?? 0) + (Number(pair[1]) || 0)];
    }
    return { types, losses: (Array.isArray(out?.losses) ? out.losses : []).filter(l => finished(l?.type)).map(l => ({ ...l, type: finished(l.type) })),
      faced: (Array.isArray(out?.faced) ? out.faced : []).filter(m => typeof m?.name === 'string').map(m => (m.type ? { ...m, type: finished(m.type) ?? undefined } : m)),
      ...(out?.v === 2 ? { v: 2 } : {}), ...(out?.extra === true ? { extra: true } : {}) };
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

  // One event as kept: `listed` the event list's row, `event` its match list. A match list can hold an
  // event the event list leaves out (an event under two ids): its matches count all the same
  // (`extra`), dated by the belt list (`dated`) where it names it. Settled a week after it started.
  function entry(listed, event, { name, dated, now }) {
    const start = listed ? listed.start_date : dated.get(event.id) ?? null;
    const out = !event ? { v: 2, types: {}, losses: [], faced: [] } : listed ? outcomes(event, name) : { ...outcomes(event, name), extra: true };
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

  return { outcomes, planBelts, clean, tally, entry, merge, share, WEEK };
})();
