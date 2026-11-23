// A profile's win rate, under Smoothcomp's own wins chart, then at each belt worn.
// It counts the finishes picked in the chips below it (submission, fastest escape, points and decision until
// the reader picks others), never walkovers. Every page of the athlete's event list
// and match list is read at once: the matches give each finish won and lost, and the
// page's belt list dates each belt. What was read is kept until the athlete's
// events, wins or belts change.
(() => {
  const got = {};
  let pastUrl, plan, stats, reading;
  // AJP Tour's profile is Smoothcomp's older page: the wins ring sits in .user-statistics,
  // and Smoothcomp's utility classes that this block uses are filled in by profile.css.
  const ajp = location.hostname === 'ajptour.com';
  if (ajp) document.documentElement.classList.add('scwr-ajp');
  const CARD = ajp ? '.user-statistics' : '.match-statistics-content';
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const color = (text) => {
    const named = BELTS.filter(b => new RegExp(`\\b${b}`, 'i').test(String(text).replace(/gray/i, 'grey')));
    return named.length === 1 ? named[0] : null;
  };
  const time = (e) => Date.parse(e.event_start ?? e.start_date);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Opponents are known by name, as registrations change per event.
  const person = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const swatch = (b) => `<i class="scwr-belt" data-belt="${b}"></i>`;
  // Smoothcomp's finishes come finer than its own chips name them ("submission_armbar",
  // "decision_unanimous", "double-dq"); each counts under the chip it belongs to. Each
  // finish has its own hue: submission and points keep the green and blue of
  // Smoothcomp's wins ring, which gives several finishes one colour.
  const FINISH = {
    submission: ['Submission', 'rgb(121, 186, 33)'], stoppage: ['Stoppage', 'oklch(0.8 0.15 75)'], escape: ['Fastest escape', 'oklch(0.75 0.12 195)'],
    points: ['Points', 'rgb(6, 114, 167)'], decision: ['Decision', 'oklch(0.68 0.15 300)'], disqualification: ['Disqualification', 'rgb(198, 52, 52)'],
  };
  const finish = (wonBy) => {
    const w = String(wonBy ?? '').toLowerCase();
    return /^sub/.test(w) ? 'submission' : /escape/.test(w) ? 'escape' : /walk/.test(w) ? 'walkover' : /dq|disq/.test(w) ? 'disqualification'
      : /^point|advantage|penalt/.test(w) ? 'points' : /decision|referee|judge/.test(w) ? 'decision' : /stoppage|ko\b/.test(w) ? 'stoppage' : 'other';
  };
  // Anything else counts as Other, so no unknown name reaches the page or a tally's keys.
  const nameOf = (type) => FINISH[type]?.[0] ?? 'Other';
  const order = (type) => (type in FINISH ? Object.keys(FINISH).indexOf(type) : 99);
  // The finishes counted, kept on this browser; one always stays picked.
  const PICKED = 'scwr:profile:finishes:3';
  let picked;
  try { picked = new Set(JSON.parse(localStorage.getItem(PICKED))); } catch {}
  if (!picked?.size) picked = new Set(['submission', 'escape', 'points', 'decision']);
  // Text from Smoothcomp (names, clubs, event titles) goes into markup escaped.
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  // How a match ended, with the detail Smoothcomp gives ("submission_armbar" reads
  // "Submission (armbar)"); the detail keeps letters only.
  const how = (wonBy, type) => {
    const detail = String(wonBy ?? '').toLowerCase().replace(/^(submission|decision|points)/, '').replace(/[^a-z]+/g, ' ').trim();
    return detail && ['submission', 'decision', 'points'].includes(type) ? `${nameOf(type)} (${detail})` : nameOf(type);
  };
  // A refusal (a 429, or the failed fetch Cloudflare's challenge makes of one) is
  // tried again after 1, 2, 4 and 8 s.
  const read = async (kind, page, tries = 0) => {
    const url = new URL(pastUrl.replace('/past-events', `/${kind}`), location.href);
    url.searchParams.set('page', page);
    const response = await fetch(url, { headers: { Accept: 'application/json' } }).catch(() => null);
    if (response?.ok) return response.json();
    if ((response && response.status !== 429) || tries > 3) throw new Error(`${kind} unavailable`);
    await new Promise(done => setTimeout(done, 1000 * 2 ** tries));
    return read(kind, page, tries + 1);
  };
  const pages = (kind, count, from) => Promise.all(Array.from({ length: Math.max(0, count - from + 1) }, (_, i) => read(kind, from + i)))
    .then(bodies => bodies.flatMap(body => body.data ?? []));
  const add = (into, types) => {
    for (const [type, [won, lost]] of Object.entries(types)) {
      into[type] ??= [0, 0];
      into[type][0] += won;
      into[type][1] += lost;
    }
    return into;
  };
  // The athlete's matches at one event, as [won, lost] by finish, and each loss with
  // who beat them, in what division and how; each win names the same, for a
  // head-to-head. Walkovers left out. v 2 marks the wins' details.
  // Each division registers them afresh: their seat is the registration in the most
  // of its matches (a round robin lists others' too), the profile's name settling a tie.
  const outcomes = (event) => {
    const name = document.title.split(' - ')[0].trim().toLowerCase();
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
        const type = finish(m.wonBy);
        if (!seat || type === 'walkover' || !(seat.isWinner || seat.isLoser)) continue;
        out.types[type] ??= [0, 0];
        out.types[type][seat.isWinner ? 0 : 1]++;
        const other = m.seats.find(s => s !== seat);
        if (other?.name) out.faced.push({ name: other.name, club: other.club ?? null, image: other.image ?? null, reg: other.event_registration_id ?? null, won: !!seat.isWinner,
          ...(seat.isWinner ? { type, how: how(m.wonBy, type), division: group.group ?? null, bracket: m.bracket_id ?? null, stage: m.name ?? null } : {}) });
        if (seat.isLoser) out.losses.push({ type, how: how(m.wonBy, type), opponent: other?.name ?? null, club: other?.club ?? null, division: group.group ?? null,
          reg: other?.event_registration_id ?? null, image: other?.image ?? null, bracket: m.bracket_id ?? null, stage: m.name ?? null });
      }
    }
    return out;
  };
  // Each belt's events run from its first when the belt list names all of them, else
  // from just after the last one listed at the belt below. Events without a belt
  // (no-gi levels, absolutes) take the belt worn at the time.
  function planBelts() {
    const rows = (got.skills?.data ?? []).filter(s => /jiu|bjj/i.test(s.name) && color(s.belt)).sort((a, b) => b.sort_order - a.sort_order);
    const belt = color(rows[0]?.belt);
    const listed = (b) => rows.filter(s => color(s.belt) === b);
    // The current belt is worn even when Smoothcomp counts no events at it (levels like
    // "Intermediate (Blue)" don't count toward a belt).
    const worn = BELTS.filter(b => b === belt || listed(b).some(s => s.competed_count > 0));
    // Every event at one belt: the overall rate is that belt's, so it only takes the belt.
    if (!belt || worn.every(b => b === belt)) return { belt, whole: true };
    const times = (b) => listed(b).flatMap(s => s.events ?? []).map(time);
    const starts = worn.map((b, i) => (!i ? -Infinity : times(b).length && listed(b).every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...times(b)) : Math.max(...times(worn[i - 1])) + 1));
    return { belt, worn, shown: new Set([belt, ...worn]).size, beltOf: (e) => worn[starts.findLastIndex(start => start <= time(e))] ?? worn[0] };
  }
  // Each event's result is kept for good once it is settled (started a week ago or
  // more), so a visit draws at once from what is kept and reads only what is new: both
  // lists run newest first, so reading stops at the first event already kept. If the
  // kept events and Smoothcomp's count stop agreeing, the whole history is read again.
  const STORE = 'scwr:profile:12:';
  const WEEK = 7 * 864e5;
  for (const k of Object.keys(localStorage)) if (/^scwr:profile:\d+:/.test(k) && !k.startsWith(STORE)) localStorage.removeItem(k);
  // Storage full: the athletes looked at longest ago give way.
  const keep = (key, value) => {
    for (let tries = 0; tries < 8; tries++) {
      try { return localStorage.setItem(key, JSON.stringify(value)); } catch {}
      const kept = Object.keys(localStorage).filter(k => k.startsWith(STORE) && k !== key)
        .map(k => { try { return [k, JSON.parse(localStorage.getItem(k)).seen ?? 0]; } catch { return [k, 0]; } }).sort((a, b) => a[1] - b[1]);
      if (!kept.length) return;
      for (const [k] of kept.slice(0, Math.ceil(kept.length / 2))) localStorage.removeItem(k);
    }
  };
  // Settled events are shared through Mat Stats' own server, so whoever opens a profile
  // first reads its history for everyone after.
  const SERVER = 'https://mat-stats.mohamed3on.workers.dev';
  const ask = (path, body) => fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(path))));
  // What is read back, kept here or shared, keeps only the shape this script makes.
  const finishes = [...Object.keys(FINISH), 'other'];
  const clean = (out) => {
    const types = {};
    for (const type of finishes) {
      const pair = out?.types?.[type];
      if (Array.isArray(pair)) types[type] = [Number(pair[0]) || 0, Number(pair[1]) || 0];
    }
    return { types, losses: (Array.isArray(out?.losses) ? out.losses : []).filter(l => finishes.includes(l?.type)),
      faced: (Array.isArray(out?.faced) ? out.faced : []).filter(m => typeof m?.name === 'string'), ...(out?.v === 2 ? { v: 2 } : {}), ...(out?.extra === true ? { extra: true } : {}) };
  };
  // Everything shown, worked out from the kept events with no request; newest first, so
  // each rival takes the club and photo of the latest meeting.
  function tally(events) {
    events = [...events].sort((a, b) => (Date.parse(b.start_date) || 0) - (Date.parse(a.start_date) || 0));
    const types = events.map(e => e.out.types).reduce(add, {});
    const losses = events.flatMap(e => e.out.losses.map(loss => ({ ...loss, event: e.id, title: e.title, date: e.start_date })));
    // Their wins, for a head-to-head: who, where and when only.
    const wins = events.flatMap(e => e.out.faced.filter(f => f.won).map(f => ({ ...f, won: true, opponent: f.name, event: e.id, title: e.title, date: e.start_date })));
    let belts = null;
    if (!plan.whole) {
      const by = new Map([plan.belt, ...plan.worn].map(b => [b, { events: 0, types: {} }]));
      for (const e of events) {
        if (!Date.parse(e.start_date)) continue;
        const t = by.get(plan.beltOf(e));
        add(t.types, e.out.types);
        t.events++;
      }
      // A lower belt no event fell to has nothing to show; the current one says it has no events yet.
      belts = [...by].filter(([b, t]) => b === plan.belt || t.events).sort(([a], [b]) => BELTS.indexOf(b) - BELTS.indexOf(a));
    }
    // Everyone who beat them, with the whole head-to-head: opponents are known by name,
    // as registrations change per event, and the newest meeting gives the club, photo
    // and registration to link.
    const met = new Map();
    for (const e of events) for (const f of e.out.faced) {
      const who = person(f.name);
      if (!met.has(who)) met.set(who, { key: who, name: f.name, club: f.club, image: f.image, reg: f.reg, event: e.id, w: 0, l: 0 });
      met.get(who)[f.won ? 'w' : 'l']++;
    }
    const rivals = [...met.values()].filter(r => r.l > 1).sort((a, b) => b.l - a.l || a.w - b.w).slice(0, 5);
    return { types, belts, losses, wins, rivals };
  }
  async function readStats(whole = false) {
    reading = true;
    const past = got['past-events'];
    const total = past.meta?.total ?? 0;
    const key = STORE + pastUrl.match(/\/athlete\/(\d+)\//)?.[1];
    let kept = null;
    try { kept = whole ? null : JSON.parse(localStorage.getItem(key)); } catch {}
    const local = (kept?.events ?? []).map(e => ({ ...e, out: clean(e.out) }));
    const known = new Map(local.filter(e => e.settled).map(e => [e.id, e]));
    // Nothing kept here: what any install already read for this athlete (not when the
    // whole history is being read again, as what was kept no longer added up).
    const site = ajp ? 'ajptour.com' : 'smoothcomp.com';
    const user = key.slice(STORE.length);
    const shared = new Set();
    // Copies from before wins kept their details are read again, and replace the server's.
    const theirs = known.size || whole ? [] : (await ask('/outcomes', { site, user }).catch(() => ({}))).events ?? [];
    if (theirs.every(e => e?.out?.v === 2)) for (const e of theirs) {
      if (!Number.isSafeInteger(e?.id) || !(Date.parse(e.start_date) || e.out?.extra === true)) continue;
      // An event under a week old is read again here, as its results can still change.
      if (Date.now() - Date.parse(e.start_date) <= WEEK) continue;
      known.set(e.id, { id: e.id, start_date: Date.parse(e.start_date) ? e.start_date : null, title: typeof e.title === 'string' ? e.title : null, out: clean(e.out), settled: true });
      shared.add(e.id);
    }
    if (known.size) show(tally(local.length ? local : [...known.values()]));
    else { plan.loading = true; draw(); }
    // The events since the newest kept one: the page has the first page of them, and
    // further pages are read only while none of a page is kept (all at once when none is).
    let list = [...past.data];
    if (!known.size) list.push(...await pages('past-events', past.meta?.last_page ?? 1, 2));
    else for (let page = 2; page <= (past.meta?.last_page ?? 1) && !list.some(e => known.has(e.id)); page++) list.push(...(await read('past-events', page)).data);
    const firstKept = list.findIndex(e => known.has(e.id));
    const news = firstKept < 0 ? list : list.slice(0, firstKept);
    // Their match lists, three events a page, newest first: all pages at once with nothing
    // kept, else page by page until every new event is found.
    const wanted = new Set(news.map(e => e.id));
    const found = new Map();
    if (!known.size) for (const event of await pages('event-statistics', Math.ceil(total / 3), 1)) found.set(event.id, event);
    else for (let page = 1; [...wanted].some(id => !found.has(id)) && page <= Math.ceil(total / 3); page++) {
      const body = await read('event-statistics', page);
      for (const event of body.data ?? []) found.set(event.id, event);
      if (!(body.data ?? []).some(event => wanted.has(event.id))) break;
    }
    const empty = { v: 2, types: {}, losses: [], faced: [] };
    const fresh = news.map(e => {
      const event = found.get(e.id);
      return { id: e.id, start_date: e.start_date, title: event?.title ?? e.title ?? null, out: event ? outcomes(event) : empty, settled: Date.now() - Date.parse(e.start_date) > WEEK };
    });
    // A match list can hold an event the event list leaves out (an event under two
    // ids): its matches count all the same, dated by the belt list when it names it.
    if (!known.size) {
      const dated = new Map((got.skills?.data ?? []).flatMap(s => s.events ?? []).map(e => [e.id, e.event_start]));
      for (const event of found.values()) {
        if (news.some(e => e.id === event.id)) continue;
        const start = dated.get(event.id) ?? null;
        fresh.push({ id: event.id, start_date: start, title: event.title ?? null, out: { ...outcomes(event), extra: true }, settled: !start || Date.now() - Date.parse(start) > WEEK });
      }
    }
    const events = [...fresh, ...[...known.values()]];
    if (events.filter(e => !e.out.extra).length !== total && !whole && known.size) return readStats(true);
    // Settled events the server lacks go to it: all of them the first time this browser
    // shares an athlete, then only the newly settled. Events under a week old go every
    // visit, as read again, so the stats site counts what this profile counts.
    const unshared = events.filter(e => (e.settled ? !shared.has(e.id) && (!kept?.shared || fresh.includes(e)) : fresh.includes(e)));
    let sent = !!kept?.shared || shared.size > 0;
    if (unshared.length) sent = (await ask('/keep-outcomes', { site, user, events: unshared.slice(0, 400) }).then(() => true, () => false)) || sent;
    keep(key, { seen: Date.now(), shared: sent, events });
    // The event list rows read here join the athlete's history on the stats site: every
    // page on a first read, the new ones after.
    if (news.length) ask('/people', { site, athletes: { [user]: { name: document.title.split(' - ')[0].trim(), history: list.slice(0, 500).map(e => ({
      event: String(e.id), title: e.title, start: e.start_date, city: e.city, wins: e.wins, medals: [e.medals?.gold, e.medals?.silver, e.medals?.bronze] })) } } }).catch(() => {});
    show(tally(events));
  }
  // New figures replace the shown ones in place, without the opening or the bars regrowing.
  let rev = 0;
  function show(next) {
    stats = next;
    rev++;
    draw();
  }
  // Placeholders hold the shape of what is being read: the rate, its chips, and a row per belt.
  const skeleton = () => '<div class="scwr-rate"><i class="scwr-skel" style="width: 150px; height: 12px"></i></div>'
    + `<div class="scwr-chips">${[96, 72, 80].map(w => `<i class="scwr-skel" style="width: ${w}px; height: 20px; border-radius: 999px"></i>`).join('')}</div>`
    + (plan.whole ? '' : `<div class="scwr-belt-split">${'<div class="scwr-split-row"><i class="scwr-skel" style="height: 8px"></i><i class="scwr-skel" style="height: 12px"></i><i class="scwr-skel" style="height: 6px"></i><i class="scwr-skel" style="height: 10px"></i></div>'.repeat(plan.shown)}</div>`);
  const record = (types) => [...picked].reduce(([w, l], type) => [w + (types[type]?.[0] ?? 0), l + (types[type]?.[1] ?? 0)], [0, 0]);
  const rate = (w, l) => `${Math.round((w / (w + l)) * 100)}%`;
  // A rate takes its hue from red at 40% or under, through amber, to green at 85% and over.
  const tone = (w, l) => `color: oklch(0.8 0.14 ${25 + 120 * Math.min(1, Math.max(0, (w / (w + l) - 0.4) / 0.45))})`;
  // Wins read green and losses red, the dash between them neutral.
  const wl = (w, l) => `<span class="scwr-won">${w}</span><span class="scwr-dash">–</span><span class="scwr-lost">${l}</span>`;
  function filled() {
    const [wins, losses] = record(stats.types);
    const counted = [...picked].filter(t => stats.types[t]).sort((a, b) => order(a) - order(b)).map(nameOf).join(', ').toLowerCase();
    const belt = plan.whole && plan.belt ? swatch(plan.belt).replace('<i ', `<i role="img" aria-label="Every event at ${plan.belt}" title="Every event at ${plan.belt}" `) : '';
    let html = `<div class="scwr-rate" title="Share of matches won by ${counted || 'the finishes picked'}">${belt}`
      + (wins + losses ? `<span class="scwr-rate-figure" style="${tone(wins, losses)}">${rate(wins, losses)}</span><span class="gi-text-secondary">win rate ·</span><span class="scwr-record">${wl(wins, losses)}</span>`
        : '<span class="gi-text-secondary">No matches by these finishes</span>') + '</div>';
    // Each finish the athlete has won or lost by, its record on the chip, the most
    // matches first; pressed ones count.
    const matches = (type) => stats.types[type][0] + stats.types[type][1];
    const offered = Object.keys(stats.types).sort((a, b) => matches(b) - matches(a) || order(a) - order(b));
    html += `<div class="scwr-chips" role="group" aria-label="Finishes counted">${offered.map(type => {
      const [w, l] = stats.types[type];
      return `<button type="button" class="scwr-type gi-flex gi-items-center gi-gap-1.5 gi-py-0.5 gi-px-2 gi-text-xs gi-border gi-border-divider-secondary gi-rounded-full" data-type="${type}" aria-pressed="${picked.has(type)}">`
        + `<span class="gi-h-2.5 gi-w-2.5 gi-rounded-full" style="background: ${FINISH[type]?.[1] ?? 'rgb(128, 128, 128)'};"></span>`
        + `<span class="gi-font-medium">${nameOf(type)}</span><span class="scwr-record">${wl(w, l)}</span></button>`;
    }).join('')}</div>`;
    // Nobody beating them twice is itself worth saying, when they have lost at all.
    // The headline goes to the rivals they are furthest behind (losses less wins), all
    // who tie on it; none when they are level with or ahead of every rival.
    const behind = Math.max(0, ...(stats.rivals ?? []).map(r => r.l - r.w));
    const more = (behind ? `<div class="scwr-nemesis gi-text-sm"><span class="gi-text-secondary gi-text-xs">Lost most to</span><div>${stats.rivals.filter(r => r.l - r.w === behind).map(r => rival(r)).join('')}</div></div>`
      : stats.rivals && !stats.rivals.length && stats.losses.length > 1 ? '<div class="scwr-nemesis gi-text-sm gi-text-secondary">No one has beaten them twice</div>' : '')
      + (stats.losses.length && !document.querySelector('.match-statistics-action button') ? `<button type="button" class="scwr-losses-open gi-text-sm">See losses${CHEVRON}</button>` : '');
    if (!stats.belts) return html + more;
    // One bar per belt, highest first: its win rate, on a scale of all its matches.
    const row = ([b, t]) => {
      const [w, l] = record(t.types);
      const label = !t.events ? `No events at ${b} yet` : `${w + l ? `${rate(w, l)} of matches won` : 'No matches by these finishes'} at ${b}: `
        + `${plural(w, 'win')} and ${l} loss${l === 1 ? '' : 'es'} in ${plural(t.events, 'event')}`;
      return `<div class="scwr-split-row" role="img" aria-label="${label}" title="${label}">${swatch(b)}`
        + (w + l ? `<b style="${tone(w, l)}">${rate(w, l)}</b>` : '<b class="gi-text-secondary">–</b>')
        + `<span class="scwr-split-track">${w + l ? `<span class="scwr-split-fill" data-belt="${b}" style="width: ${(w / (w + l)) * 100}%"></span>` : ''}</span>`
        + `<small class="scwr-record">${w + l ? wl(w, l) : ''}</small></div>`;
    };
    return `${html}<div class="scwr-belt-split">${stats.belts.map(row).join('')}</div>${more}`;
  }
  const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // Every loss, newest first, in a dialog dressed in the card's own colours; pills
  // narrow it to one finish. The belt beside each is the one worn on that date.
  let dialog, showing = 'all';
  // One opponent who beat them more than once: photo, name and academy (from their
  // newest meeting), and the whole head-to-head. In the dialog each is a button that
  // narrows the list to every match between them.
  function rival(r, pick) {
    const face = avatar({ image: r.image, opponent: r.name });
    if (pick) return `<button type="button" class="scwr-rival" data-rival="${esc(r.key)}" aria-pressed="${showing === `rival:${r.key}`}" title="Every match against ${esc(r.name)}">${face}`
      + `<span class="scwr-rival-who"><span class="gi-font-medium">${esc(r.name)}</span>${r.club ? `<span class="gi-text-secondary gi-text-xs">${esc(r.club)}</span>` : ''}</span><span class="scwr-record">${wl(r.w, r.l)}</span></button>`;
    const meeting = { opponent: r.name, club: r.club, reg: r.reg, event: r.event };
    const who = `<span class="scwr-rival-who">${named(meeting, 'who')}${r.club ? named(meeting, 'club') : ''}</span>`;
    return `<span class="scwr-rival" title="${r.w} won, ${r.l} lost against ${esc(r.name)}">${face}${who}<span class="scwr-record">${wl(r.w, r.l)}</span></span>`;
  }
  // Who beat them and their academy link through the event's participants page: a
  // match list names registrations, not accounts, and that page knows whose each is
  // (participants.js goes on from there). It is a plain link, so a new tab works too.
  const locale = () => location.pathname.split('/')[1] || 'en';
  const avatar = (loss) => {
    let photo = null;
    try { photo = loss.image && /(^|\.)smoothcomp\.com$/.test(new URL(loss.image).hostname) ? loss.image : null; } catch {}
    const initials = String(loss.opponent ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return photo ? `<img class="scwr-face" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="scwr-face" aria-hidden="true">${esc(initials)}</span>`;
  };
  const named = (loss, kind) => {
    const text = esc(kind === 'who' ? loss.opponent ?? 'Unknown opponent' : loss.club);
    const cls = kind === 'who' ? 'gi-font-medium' : 'gi-text-secondary gi-text-xs';
    if (loss.reg == null) return `<span class="${cls}">${text}</span>`;
    return `<a class="${cls}" href="/${esc(locale())}/event/${Number(loss.event)}/participants#scwr-find=${Number(loss.reg)}-${kind}">${text}</a>`;
  };
  function lossList() {
    const against = showing.startsWith('rival:') && showing.slice(6);
    const shown = against ? [...stats.losses, ...stats.wins].filter(m => person(m.opponent) === against).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
      : stats.losses.filter(loss => showing === 'all' || loss.type === showing);
    const day = (date) => (Date.parse(date) ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    return shown.map(loss => {
      const belt = plan.whole ? plan.belt : loss.date && plan.beltOf({ start_date: loss.date });
      return `<li class="scwr-loss">${avatar(loss)}<div>`
        + `<div class="scwr-loss-who">${named(loss, 'who')}${loss.club ? named(loss, 'club') : ''}</div>`
        + `<div class="scwr-loss-how gi-text-xs gi-text-secondary">${against ? `<span class="scwr-${loss.won ? 'won">Won' : 'lost">Lost'}</span>${loss.type ? '<span>·</span>' : ''}` : ''}`
        + (loss.type ? `<span class="gi-h-2 gi-w-2 gi-rounded-full" style="background: ${FINISH[loss.type]?.[1] ?? 'rgb(128, 128, 128)'};"></span>`
          + `<span class="scwr-${loss.won ? 'won' : 'lost'}">${esc(loss.how)}</span>${loss.stage ? `<span>·</span><span>${esc(loss.stage)}</span>` : ''}` : '')
        // The bracket it was lost in, linked; then the event and its date.
        + (loss.division ? `<span>·</span>${loss.bracket ? `<a href="/${esc(locale())}/event/${Number(loss.event)}/bracket/${Number(loss.bracket)}">${esc(loss.division)}</a>` : `<span>${esc(loss.division)}</span>`}` : '') + '</div>'
        + `<div class="scwr-loss-how gi-text-xs gi-text-secondary"><a href="/${esc(locale())}/event/${Number(loss.event)}">${esc(loss.title ?? 'Event')}</a>${loss.date ? `<span>·</span><span>${day(loss.date)}</span>` : ''}</div></div>${belt ? swatch(belt).replace('<i ', `<i title="${belt} belt then" `) : ''}</li>`;
    }).join('');
  }
  function filters() {
    const counts = {};
    for (const loss of stats.losses) counts[loss.type] = (counts[loss.type] ?? 0) + 1;
    const pill = (key, label, n) => `<button type="button" class="scwr-loss-filter gi-flex gi-items-center gi-gap-1.5 gi-py-0.5 gi-px-2 gi-text-xs gi-border gi-border-divider-secondary gi-rounded-full" data-show="${key}" aria-pressed="${showing === key}">`
      + (key === 'all' ? '' : `<span class="gi-h-2.5 gi-w-2.5 gi-rounded-full" style="background: ${FINISH[key]?.[1] ?? 'rgb(128, 128, 128)'};"></span>`)
      + `<span class="gi-font-medium">${label}</span><span class="scwr-count">${n}</span></button>`;
    return pill('all', 'All', stats.losses.length) + Object.keys(counts).sort((a, b) => counts[b] - counts[a] || order(a) - order(b)).map(type => pill(type, nameOf(type), counts[type])).join('');
  }
  function openLosses() {
    // The card's colour sits on whichever ancestor first paints one.
    let card = document.querySelector(CARD);
    while (card.parentElement && /^(transparent|rgba\(.*, 0\))$/.test(getComputedStyle(card).backgroundColor)) card = card.parentElement;
    card = getComputedStyle(card);
    dialog ??= document.body.appendChild(document.createElement('dialog'));
    dialog.className = 'scwr-losses-dialog gi-text-sm';
    dialog.setAttribute('aria-labelledby', 'scwr-losses-title');
    dialog.style.cssText = `--card: ${card.backgroundColor}; color: ${card.color};`;
    showing = 'all';
    dialog.innerHTML = `<header><h2 id="scwr-losses-title">Losses</h2><span class="gi-text-secondary">${esc(document.title.split(' - ')[0].trim())}</span>`
      + `<button type="button" class="scwr-losses-close" aria-label="Close">${CROSS}</button></header>`
      + (stats.rivals?.length ? `<section class="scwr-rivals" aria-label="Lost most to"><span class="gi-text-secondary gi-text-xs">Lost most to</span><div>${stats.rivals.map(r => rival(r, true)).join('')}</div></section>` : '')
      + `<div class="scwr-loss-filters" role="group" aria-label="Show losses by">${filters()}</div><ol class="scwr-loss-list">${lossList()}</ol>`;
    dialog.showModal();
  }
  const draw = () => {
    const chart = document.querySelector(ajp ? CARD : `${CARD} > div`);
    if (!chart || !got['wins-and-medals'] || !got.skills || !Array.isArray(got['past-events']?.data) || !got['past-events'].meta?.total || !pastUrl) return;
    plan ??= planBelts();
    if (!reading) readStats().catch(() => { plan.loading = false; draw(); });
    // See losses sits beside Smoothcomp's own See all wins, made of the same parts
    // (its scoped style attributes and its chevron) so the two read as a pair.
    const theirs = document.querySelector('.match-statistics-action button:not(.scwr-losses-open)');
    if (stats?.losses.length && theirs && !theirs.parentElement.querySelector('.scwr-losses-open')) {
      const ours = theirs.cloneNode(true);
      ours.classList.add('scwr-losses-open');
      ours.type = 'button';
      ours.querySelector('span').textContent = 'See losses';
      theirs.after(ours);
    }
    const stage = stats ? `done${rev}` : plan.loading ? 'loading' : '';
    const box = chart.querySelector('.scwr-more');
    if (!stage) return box?.remove();
    if (box?.dataset.stage === stage) return;
    const html = stats ? filled() : skeleton();
    if (box) {
      if (box.dataset.stage.startsWith('done')) box.dataset.settled = '';
      box.dataset.stage = stage;
      box.setAttribute('aria-busy', String(!stats));
      box.innerHTML = html;
    } else chart.insertAdjacentHTML('beforeend', `<div class="scwr-more gi-text-sm" data-stage="${stage}" aria-busy="${!stats}">${html}</div>`);
  };
  document.addEventListener('click', (event) => {
    if (!stats) return;
    if (event.target.closest?.('.scwr-losses-open')) return openLosses();
    // The dialog closes from its button or a click on the dim around it.
    if (event.target === dialog || event.target.closest?.('.scwr-losses-close')) return dialog.close();
    // A finish pill, or a rival (pressed again, back to every loss).
    const filter = event.target.closest?.('.scwr-loss-filter, .scwr-rival[data-rival]');
    if (filter) {
      const next = filter.dataset.show ?? `rival:${filter.dataset.rival}`;
      showing = filter.dataset.rival && showing === next ? 'all' : next;
      for (const r of dialog.querySelectorAll('.scwr-rival[data-rival]')) r.setAttribute('aria-pressed', String(showing === `rival:${r.dataset.rival}`));
      dialog.querySelector('h2').textContent = showing.startsWith('rival:') ? 'Head-to-head' : 'Losses';
      dialog.querySelector('.scwr-loss-filters').innerHTML = filters();
      dialog.querySelector('.scwr-loss-list').innerHTML = lossList();
      dialog.querySelector('.scwr-loss-list').scrollTop = 0;
      return filter.dataset.show && dialog.querySelector(`.scwr-loss-filter[data-show="${showing}"]`)?.focus();
    }
    // A chip toggles its finish in or out, and every rate redraws at once.
    const chip = event.target.closest?.('.scwr-type');
    const box = chip?.closest('.scwr-more');
    if (!chip || !stats) return;
    const type = chip.dataset.type;
    if (!picked.has(type)) picked.add(type);
    else if (picked.size > 1) picked.delete(type);
    try { localStorage.setItem(PICKED, JSON.stringify([...picked])); } catch {}
    box.dataset.settled = '';
    box.innerHTML = filled();
    box.querySelector(`.scwr-type[data-type="${type}"]`)?.focus();
  });
  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.scwrKind = String(url).match(/\/athlete\/\d+\/(wins-and-medals|past-events|skills)\b/)?.[1];
    if (this.scwrKind === 'past-events') pastUrl ??= String(url);
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const kind = this.scwrKind;
    // The first answer of each kind is the page's own; later past-events pages are the reader paging.
    if (kind) this.addEventListener('load', () => {
      try { got[kind] ??= this.responseType === 'json' ? this.response : JSON.parse(this.responseText); draw(); } catch {}
    });
    return send.apply(this, args);
  };
  // AJP's page reads none of these itself, and AJP answers them unsigned.
  const id = location.pathname.match(/\/profile\/(\d+)/)?.[1];
  if (ajp && id) {
    pastUrl = `/en/athlete/${id}/past-events`;
    for (const kind of ['wins-and-medals', 'skills', 'past-events']) fetch(`/en/athlete/${id}/${kind}`, { headers: { Accept: 'application/json' } })
      .then(r => r.json()).then(body => { got[kind] ??= body; draw(); }).catch(() => {});
  }
  // The chart renders after the responses land, and a re-render drops the block.
  new MutationObserver(draw).observe(document, { childList: true, subtree: true });
})();
