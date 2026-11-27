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
  // The rules apart from the page: profile-model.js, and an event's Outcome (rules.js).
  const { FINISHES, LABELS, finishOf, pointsLine, normalize: person } = SCWRRules;
  const { clean } = SCWRRules.Outcome;
  const { plural, esc } = SCWRSite;
  const swatch = (b) => `<i class="scwr-belt" data-belt="${b}"></i>`;
  // Smoothcomp's finishes come finer than its own chips name them ("submission_armbar",
  // "decision_unanimous", "double-dq"); each counts under the chip its finish names (rules.js).
  // Each finish has its own hue: submission and points keep the green and blue of
  // Smoothcomp's wins ring, which gives several finishes one colour.
  const HUE = {
    submission: 'rgb(121, 186, 33)', stoppage: 'oklch(0.8 0.15 75)', fastest_escape: 'oklch(0.75 0.12 195)',
    points: 'rgb(6, 114, 167)', decision: 'oklch(0.68 0.15 300)', disqualification: 'rgb(198, 52, 52)',
  };
  const hue = (type) => HUE[type] ?? 'rgb(128, 128, 128)';
  const nameOf = (type) => LABELS[type] ?? LABELS.other;
  const order = (type) => FINISHES.indexOf(type);
  // The finishes counted, kept on this browser; one always stays picked.
  const PICKED = 'scwr:profile:finishes:3';
  let picked;
  try { picked = new Set(JSON.parse(localStorage.getItem(PICKED)).map(finishOf)); } catch {} // an older "escape" is a fastest escape
  if (!picked?.size) picked = new Set(['submission', 'fastest_escape', 'points', 'decision']);
  // Text from Smoothcomp (names, clubs, event titles) goes into markup escaped.
  // A refusal (a 429, or the failed fetch Cloudflare's challenge makes of one) is
  // tried again after 1, 2, 4 and 8 s. Some pages Smoothcomp never answers (Cloudflare
  // gives up on them after two minutes), so a page given 15 s fails for good.
  const read = async (kind, page, tries = 0) => {
    const url = new URL(pastUrl.replace('/past-events', `/${kind}`), location.href);
    url.searchParams.set('page', page);
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
      .catch((error) => { if (error.name === 'TimeoutError') throw error; return null; });
    if (response?.ok) return response.json();
    if ((response && response.status !== 429) || tries > 3) throw new Error(`${kind} unavailable`);
    await new Promise(done => setTimeout(done, 1000 * 2 ** tries));
    return read(kind, page, tries + 1);
  };
  // Pages from..count at once, each handed to each() as it lands; a page that fails is
  // left out and counted.
  const pages = async (kind, count, from, each) => {
    let failed = 0;
    const bodies = await Promise.all(Array.from({ length: Math.max(0, count - from + 1) }, (_, i) => read(kind, from + i)
      .then(body => (each?.(body), body), () => (failed++, {}))));
    return { data: bodies.flatMap(body => body.data ?? []), failed };
  };
  // Each event's result is kept for good once it is settled (started a week ago or
  // more), so a visit draws at once from what is kept and reads only what is new: both
  // lists run newest first, so reading stops at the first event already kept. If the
  // kept events and Smoothcomp's count stop agreeing, the whole history is read again,
  // on top of what is kept; when some match lists never load, at most once a day.
  // Kept in the extension's own storage (site.js store.load/save), which holds the athletes looked at latest.
  const STORE = 'profile:13:';
  const DAY = 864e5, { WEEK } = SCWRProfile;
  const keep = (key, value) => SCWRSite.store.save(key, value);
  // Settled events are shared through Mat Stats' own server, so whoever opens a profile
  // first reads its history for everyone after.
  const SERVER = 'https://mat-stats.mohamed3on.workers.dev';
  const ask = (path, body) => fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(path))));
  // Everything shown, worked out from the kept events with no request.
  const tally = (events) => SCWRProfile.tally(events, plan);
  async function readStats(whole = false) {
    reading = true;
    const past = got['past-events'];
    const total = past.meta?.total ?? 0;
    const key = STORE + pastUrl.match(/\/athlete\/(\d+)\//)?.[1];
    let kept = null;
    kept = await SCWRSite.store.load(key);
    const local = (kept?.events ?? []).map(e => ({ ...e, out: clean(e.out) }));
    // A copy from before every match kept its id (v 3) isn't kept: the count then falls short of Smoothcomp's,
    // so the whole history is read again once, and every event comes back with its match ids, whose cards give the points.
    const known = new Map(local.filter(e => e.settled && e.out.v === 3).map(e => [e.id, e]));
    // Nothing kept here, or the whole history read again: what any install already read
    // for this athlete.
    const site = ajp ? 'ajptour.com' : 'smoothcomp.com';
    const user = key.slice(STORE.length);
    const shared = new Set();
    // Copies from before every match kept its id are read again, and replace the server's.
    const theirs = known.size && !whole ? [] : (await ask('/outcomes', { site, user }).catch(() => ({}))).events ?? [];
    if (theirs.every(e => e?.out?.v === 3)) for (const e of theirs) {
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
    const all = whole || !known.size;
    let list = [...past.data];
    if (all) list.push(...(await pages('past-events', past.meta?.last_page ?? 1, 2)).data);
    else for (let page = 2; page <= (past.meta?.last_page ?? 1) && !list.some(e => known.has(e.id)); page++) list.push(...(await read('past-events', page)).data);
    const firstKept = list.findIndex(e => known.has(e.id));
    const news = all || firstKept < 0 ? list : list.slice(0, firstKept);
    // Kept and new events short of (or over) Smoothcomp's count: the whole history is read
    // again, the kept figures shown meanwhile, which also retries what it never sent.
    const count = news.length + [...known.values()].filter(e => !e.out.extra).length;
    if (!all && count !== total && !(Date.now() - kept?.gaps?.at < DAY)) return readStats(true);
    const listed = new Map(news.map(e => [e.id, e]));
    // Each event's result from its match list, an event only the match list holds dated by the belt list.
    const context = { name: document.title.split(' - ')[0], dated: new Map((got.skills?.data ?? []).flatMap(s => s.events ?? []).map(e => [e.id, e.event_start])), now: Date.now() };
    const entry = (e, event) => SCWRProfile.entry(e, event, context);
    // Their match lists, three events a page, newest first: all pages at once with nothing
    // kept, the figures so far shown as each lands; else page by page until every new event is found.
    const found = new Map();
    let failed = 0;
    if (all) ({ failed } = await pages('event-statistics', Math.ceil(total / 3), 1, (body) => {
      for (const event of body.data ?? []) found.set(event.id, event);
      show({ ...(whole && stats ? stats : tally([...found.values()].map(event => entry(listed.get(event.id), event)))), reading: [found.size, total] });
    }));
    else for (let page = 1; news.some(e => !found.has(e.id)) && page <= Math.ceil(total / 3); page++) {
      const body = await read('event-statistics', page).catch(() => (failed++, null));
      for (const event of body?.data ?? []) found.set(event.id, event);
      if (body && !(body.data ?? []).some(event => listed.has(event.id))) break;
    }
    const { fresh, events } = SCWRProfile.merge({ news, found, failed, known, all }, context);
    // Events still not counted (some match-list pages Smoothcomp never answers) come from the
    // matches Mat Stats' crawler read, where it has; it reads the rest first.
    const counted = new Set(events.map(e => e.id));
    const holes = (all ? list.map(e => e.id) : kept?.gaps?.ids ?? []).filter(id => !counted.has(id));
    if (holes.length) for (const e of (await ask('/crawled', { site, user, events: holes.slice(0, 400) }).catch(() => ({}))).events ?? []) {
      if (!Number.isSafeInteger(e?.id) || counted.has(e.id)) continue;
      counted.add(e.id);
      shared.add(e.id);
      events.push({ id: e.id, start_date: listed.get(e.id)?.start_date ?? e.start_date ?? null, title: e.title ?? null, out: clean(e.out), settled: true });
    }
    const { missing, unshared, gaps } = SCWRProfile.share({ events, fresh, shared, kept, total, holes, all, now: Date.now() });
    let sent = !!kept?.shared || shared.size > 0;
    if (unshared.length) sent = (await ask('/keep-outcomes', { site, user, events: unshared.slice(0, 400) }).then(() => true, () => false)) || sent;
    keep(key, { seen: Date.now(), shared: sent, events, gaps, scores: kept?.scores });
    // When each belt began, so the stats site splits the win rate by belt as this profile does.
    if (plan.belt) ask('/belts', { site, user, worn: plan.worn ?? [plan.belt], starts: (plan.starts ?? [null]).map(t => (Number.isFinite(t) ? t : null)) }).catch(() => {});
    // The event list rows read here join the athlete's history on the stats site: every
    // page on a first read, the new ones after.
    if (news.length) ask('/people', { site, athletes: { [user]: { name: document.title.split(' - ')[0].trim(), history: list.slice(0, 500).map(e => ({
      event: String(e.id), title: e.title, start: e.start_date, city: e.city, wins: e.wins, image: e.cover_image, medals: [e.medals?.gold, e.medals?.silver, e.medals?.bronze] })) } } }).catch(() => {});
    show({ ...tally(events), missing: Math.max(0, missing), total });
    reading = false;
    shareProfile();
    readPoints(events, { site, user, key, kept: kept?.scores ?? {} }).catch(() => {});
  }
  // Their points on the scoreboard (stats.points, profile-model.js scoresOf): the scores Mat Stats holds (their results'
  // matches, and the cards kept by match id), then the cards of the rest read here by match id (Smoothcomp answers them
  // unsigned), four at a time, and sent to Mat Stats, which keeps each by its id for everyone (worker.js scores). Kept with
  // their events, so a visit asks nothing once every score is known. If Mat Stats can't say which it holds, no card is
  // read: it may hold them all.
  async function readPoints(events, { site, user, key, kept }) {
    kept = { ...kept };
    const known = SCWRProfile.scoresOf(events, kept, []);
    const asked = known.filter(m => !m.score && m.id).map(m => m.id);
    const stored = known.some(m => !m.score) ? (await ask('/scored', { site, user, matches: asked }).catch(() => null))?.matches : [];
    const points = SCWRProfile.scoresOf(events, kept, stored ?? []);
    show({ ...stats, points });
    const before = Object.keys(kept).length;
    for (const m of points) if (m.id && m.score) kept[m.id] ??= m.score;
    const unread = stored ? points.filter(m => !m.score && m.id) : [];
    const read = new Map();
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < unread.length) {
        const m = unread[next++];
        const card = SCWRProfile.fromCard(await fetch(`/en/getBracketMatchData/${m.id}`, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).catch(() => null), user);
        if (!card) continue;
        kept[m.id] = card.score;
        (read.get(m.event) ?? read.set(m.event, []).get(m.event)).push({ match: m.id, stage: m.stage, group: m.division, users: card.users, s: card.s, clock: card.clock });
      }
    }));
    for (const [event, matches] of read) ask('/scores', { site, event: String(event), matches }).catch(() => {});
    if (Object.keys(kept).length > before) keep(key, { ...(await SCWRSite.store.load(key)), scores: kept });
    if (unread.length) show({ ...stats, points: SCWRProfile.scoresOf(events, kept, stored) });
  }
  // What else the profile shows goes to the stats site too: belts in each art, rankings, academy
  // and affiliation, match videos, and each event's cover. Sent once the responses settle.
  let sharing;
  function shareProfile() {
    clearTimeout(sharing);
    sharing = setTimeout(() => {
      const user = pastUrl?.match(/\/athlete\/(\d+)\//)?.[1];
      if (!user) return;
      const body = { site: ajp ? 'ajptour.com' : 'smoothcomp.com', user };
      if (got.skills?.data) body.skills = got.skills.data.map(s => ({ name: s.name, belt: s.belt, degree: s.degree, competed: s.competed_count, order: s.sort_order }));
      const ranks = ['federation', 'event'].map(o => got[`rankings:${o}`]).filter(Boolean);
      if (ranks.length) {
        body.rankings = ranks.flatMap(r => r.data ?? []).map(r => ({ placement: r.placement, name: r.name, owner: r.owner?.name, ownerId: r.owner?.id, type: r.owner?.type, toplist: r.toplist_id }));
        body.ranked = ranks.reduce((n, r) => n + (r.meta?.total ?? 0), 0);
      }
      const clubs = got['academy-affiliation']?.data;
      if (clubs) for (const k of ['academies', 'affiliations']) body[k] = (clubs[k] ?? []).map(c => ({ id: c.id, name: c.name, city: c.city, country: c.country, logo: c.logo }));
      if (got['match-videos']?.meta) body.videos = got['match-videos'].meta.total;
      body.images = Object.fromEntries((got['past-events']?.data ?? []).filter(e => e.cover_image).map(e => [e.id, e.cover_image]));
      ask('/profile', body).catch(() => {});
      // The career this page shows is the one participants pages read (careers.js), so the stats site ranks on it.
      const career = got['wins-and-medals']?.data;
      if (Array.isArray(career?.win_method_breakdown) && career.medals) ask('/keep', { site: body.site, careers: { [user]: { at: Date.now(),
        wins: Object.fromEntries(career.win_method_breakdown.map(t => [t.won_by, t.count])), medals: [career.medals.gold, career.medals.silver, career.medals.bronze],
        ...(Number.isSafeInteger(got['past-events']?.meta?.total) && { events: got['past-events'].meta.total }) } } }).catch(() => {});
    }, 1500);
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
  const rate = SCWRRules.winRate;
  // A rate takes its hue from red at 40% or under, through amber, to green at 85% and over.
  const tone = (w, l) => `color: ${SCWRRules.winTone(w, l)}`;
  // Wins read green and losses red, the dash between them neutral.
  const wl = (w, l) => `<span class="scwr-won">${w}</span><span class="scwr-dash">–</span><span class="scwr-lost">${l}</span>`;
  function filled() {
    const [wins, losses] = record(stats.types);
    const counted = [...picked].filter(t => stats.types[t]).sort((a, b) => order(a) - order(b)).map(nameOf).join(', ').toLowerCase();
    const belt = plan.whole && plan.belt ? swatch(plan.belt).replace('<i ', `<i role="img" aria-label="Every event at ${plan.belt}" title="Every event at ${plan.belt}" `) : '';
    let html = `<div class="scwr-rate" title="Share of matches won by ${counted || 'the finishes picked'}">${belt}`
      + (wins + losses ? `<span class="scwr-rate-figure" style="${tone(wins, losses)}">${rate(wins, losses)}</span><span class="gi-text-secondary">win rate ·</span><span class="scwr-record">${wl(wins, losses)}</span>`
        : '<span class="gi-text-secondary">No matches by these finishes</span>') + '</div>';
    // Their points on the scoreboard in the matches by the finishes picked whose score was read (readPoints).
    const pts = (stats.points ?? []).filter(m => picked.has(m.type)), got = pts.filter(m => m.score);
    if (got.length) {
      const [f, a] = got.reduce(([f, a], m) => [f + m.score[0], a + m.score[1]], [0, 0]);
      const line = pointsLine(f, a, got.length, pts.length);
      html += `<div class="scwr-points gi-text-xs gi-text-secondary" title="Points on the scoreboard, theirs and their opponents', in the matches whose score was read, by the finishes counted; walkovers and stoppages have none">`
        + `Points <span class="scwr-record">${wl(f.toLocaleString(), a.toLocaleString())}</span> · <span class="gi-font-medium">${line.each}</span> a match · ${line.total} over ${line.over}</div>`;
    }
    // While the match lists come in, how far it has got; after, the events whose match lists Smoothcomp never answers.
    const note = stats.reading ? `Reading events · ${stats.reading[0]} of ${stats.reading[1]}`
      : stats.missing ? `${stats.missing} of ${plural(stats.total, 'event')} not counted: Smoothcomp won't load their matches` : '';
    if (note) html += `<div class="scwr-progress gi-text-xs gi-text-secondary" role="status">${note}</div>`;
    // The age group and weight class they entered most in the year up to their latest event.
    const usual = [stats.usual?.age, stats.usual?.weight].filter(Boolean).join(' · ');
    if (usual) html += `<div class="scwr-usual gi-text-xs gi-text-secondary" title="The age group and weight class they entered most in the year up to their latest event">Usually ${esc(usual)}</div>`;
    // Each finish the athlete has won or lost by, its record on the chip, the most
    // matches first; pressed ones count.
    const matches = (type) => stats.types[type][0] + stats.types[type][1];
    const offered = Object.keys(stats.types).sort((a, b) => matches(b) - matches(a) || order(a) - order(b));
    html += `<div class="scwr-chips" role="group" aria-label="Finishes counted">${offered.map(type => {
      const [w, l] = stats.types[type];
      return `<button type="button" class="scwr-type gi-flex gi-items-center gi-gap-1.5 gi-py-0.5 gi-px-2 gi-text-xs gi-border gi-border-divider-secondary gi-rounded-full" data-type="${type}" aria-pressed="${picked.has(type)}">`
        + `<span class="gi-h-2.5 gi-w-2.5 gi-rounded-full" style="background: ${hue(type)};"></span>`
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
        + (loss.type ? `<span class="gi-h-2 gi-w-2 gi-rounded-full" style="background: ${hue(loss.type)};"></span>`
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
      + (key === 'all' ? '' : `<span class="gi-h-2.5 gi-w-2.5 gi-rounded-full" style="background: ${hue(key)};"></span>`)
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
    plan ??= SCWRProfile.planBelts(got.skills?.data);
    // Read once a visit: reading is true while it runs and false once done.
    if (reading == null) readStats().catch(() => { plan.loading = false; if (stats?.reading) show({ ...stats, reading: null }); else draw(); });
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
    this.scwrKind = String(url).match(/\/athlete\/\d+\/(wins-and-medals|past-events|skills|rankings|academy-affiliation|match-videos)\b/)?.[1];
    if (this.scwrKind === 'rankings') this.scwrKind += `:${new URL(url, location.href).searchParams.get('owner')}`;
    if (this.scwrKind === 'past-events') pastUrl ??= String(url);
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const kind = this.scwrKind;
    // The first answer of each kind is the page's own; later past-events pages are the reader paging.
    if (kind) this.addEventListener('load', () => {
      try { got[kind] ??= this.responseType === 'json' ? this.response : JSON.parse(this.responseText); draw(); if (reading === false) shareProfile(); } catch {}
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
