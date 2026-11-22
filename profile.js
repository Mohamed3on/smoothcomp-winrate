// A profile's win rate, under Smoothcomp's own wins chart, then at each belt worn.
// It counts the finishes picked in the chips below it (submission and points until
// the reader picks others), never walkovers. Every page of the athlete's event list
// and match list is read at once: the matches give each finish won and lost, and the
// page's belt list dates each belt. What was read is kept until the athlete's
// events, wins or belts change.
(() => {
  const got = {};
  let pastUrl, plan, stats, reading;
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const color = (text) => {
    const named = BELTS.filter(b => new RegExp(`\\b${b}`, 'i').test(String(text).replace(/gray/i, 'grey')));
    return named.length === 1 ? named[0] : null;
  };
  const time = (e) => Date.parse(e.event_start ?? e.start_date);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const swatch = (b) => `<i class="scwr-belt" data-belt="${b}"></i>`;
  // Smoothcomp's finishes come finer than its own chips name them ("submission_armbar",
  // "decision_unanimous", "double-dq"); each counts under the chip it belongs to, in
  // that chip's dot colour.
  const FINISH = {
    submission: ['Submission', 'rgb(121, 186, 33)'], stoppage: ['Stoppage', 'rgb(121, 186, 33)'], points: ['Points', 'rgb(6, 114, 167)'],
    decision: ['Decision', 'rgb(6, 114, 167)'], disqualification: ['Disqualification', 'rgb(198, 52, 52)'],
  };
  const finish = (wonBy) => {
    const w = String(wonBy ?? '').toLowerCase();
    return /^sub/.test(w) ? 'submission' : /walk/.test(w) ? 'walkover' : /dq|disq/.test(w) ? 'disqualification'
      : /^point|advantage|penalt/.test(w) ? 'points' : /decision|referee|judge/.test(w) ? 'decision' : /stoppage|ko\b/.test(w) ? 'stoppage' : 'other';
  };
  // Anything else counts as Other, so no unknown name reaches the page or a tally's keys.
  const nameOf = (type) => FINISH[type]?.[0] ?? 'Other';
  const order = (type) => (type in FINISH ? Object.keys(FINISH).indexOf(type) : 99);
  // The finishes counted, kept on this browser; one always stays picked.
  const PICKED = 'scwr:profile:finishes';
  let picked;
  try { picked = new Set(JSON.parse(localStorage.getItem(PICKED))); } catch {}
  if (!picked?.size) picked = new Set(['submission', 'points']);
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
  // The athlete's matches at one event, as [won, lost] by finish, walkovers left out.
  // Each division registers them afresh: their seat is the registration in the most
  // of its matches (a round robin lists others' too), the profile's name settling a tie.
  const outcomes = (event) => {
    const name = document.title.split(' - ')[0].trim().toLowerCase();
    const out = {};
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
        out[type] ??= [0, 0];
        out[type][seat.isWinner ? 0 : 1]++;
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
    const worn = BELTS.filter(b => listed(b).some(s => s.competed_count > 0));
    // Every event at one belt: the overall rate is that belt's, so it only takes the belt.
    if (!belt || worn.every(b => b === belt)) return { belt, whole: true };
    const times = (b) => listed(b).flatMap(s => s.events ?? []).map(time);
    const starts = worn.map((b, i) => (!i ? -Infinity : listed(b).every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...times(b)) : Math.max(...times(worn[i - 1])) + 1));
    return { belt, worn, shown: new Set([belt, ...worn]).size, beltOf: (e) => worn[starts.findLastIndex(start => start <= time(e))] ?? worn[0] };
  }
  async function readStats() {
    reading = true;
    const past = got['past-events'];
    // The number in the key retires what an older count kept.
    const key = `scwr:profile:4:${pastUrl.match(/\/athlete\/(\d+)\//)?.[1]}`;
    const print = JSON.stringify([past.meta?.total, got['wins-and-medals'].data.win_method_breakdown, got.skills.data.map(s => [s.belt, s.competed_count])]);
    try {
      const kept = JSON.parse(localStorage.getItem(key));
      if (kept?.print === print) return (stats = kept.stats), draw();
    } catch {}
    plan.loading = true;
    draw();
    // Every page of both lists at once. The page has the events' first page; the event
    // count says how many match-list pages there are, at most, three events a page.
    const [more, matches] = await Promise.all([plan.whole ? [] : pages('past-events', past.meta?.last_page ?? 1, 2),
      pages('event-statistics', Math.ceil((past.meta?.total ?? 0) / 3), 1)]);
    const results = new Map(matches.map(event => [event.id, outcomes(event)]));
    const types = [...results.values()].reduce(add, {});
    let belts = null;
    if (!plan.whole) {
      const tally = new Map([plan.belt, ...plan.worn].map(b => [b, { events: 0, types: {} }]));
      for (const e of [...past.data, ...more]) {
        const t = tally.get(plan.beltOf(e));
        add(t.types, results.get(e.id) ?? {});
        t.events++;
      }
      // A lower belt no event fell to has nothing to show; the current one says it has no events yet.
      belts = [...tally].filter(([b, t]) => b === plan.belt || t.events).sort(([a], [b]) => BELTS.indexOf(b) - BELTS.indexOf(a));
    }
    stats = { types, belts };
    try { localStorage.setItem(key, JSON.stringify({ print, stats })); } catch {}
    draw();
  }
  // Placeholders hold the shape of what is being read: the rate, its chips, and a row per belt.
  const skeleton = () => '<div class="scwr-rate"><i class="scwr-skel" style="width: 150px; height: 12px"></i></div>'
    + `<div class="scwr-chips">${[96, 72, 80].map(w => `<i class="scwr-skel" style="width: ${w}px; height: 20px; border-radius: 999px"></i>`).join('')}</div>`
    + (plan.whole ? '' : `<div class="scwr-belt-split">${'<div class="scwr-split-row"><i class="scwr-skel" style="height: 8px"></i><i class="scwr-skel" style="height: 12px"></i><i class="scwr-skel" style="height: 6px"></i><i class="scwr-skel" style="height: 10px"></i></div>'.repeat(plan.shown)}</div>`);
  const record = (types) => [...picked].reduce(([w, l], type) => [w + (types[type]?.[0] ?? 0), l + (types[type]?.[1] ?? 0)], [0, 0]);
  const rate = (w, l) => `${Math.round((w / (w + l)) * 100)}%`;
  function filled() {
    const [wins, losses] = record(stats.types);
    const counted = [...picked].filter(t => stats.types[t]).sort((a, b) => order(a) - order(b)).map(nameOf).join(', ').toLowerCase();
    const belt = plan.whole && plan.belt ? swatch(plan.belt).replace('<i ', `<i role="img" aria-label="Every event at ${plan.belt}" title="Every event at ${plan.belt}" `) : '';
    let html = `<div class="scwr-rate gi-flex gi-justify-center gi-items-center gi-gap-1.5" title="Share of matches won by ${counted || 'the finishes picked'}">${belt}`
      + (wins + losses ? `<span class="gi-text-primary gi-font-medium">${rate(wins, losses)}</span><span class="gi-text-secondary">win rate · ${wins}–${losses}</span>`
        : '<span class="gi-text-secondary">No matches by these finishes</span>') + '</div>';
    // Each finish the athlete has won or lost by, its record on the chip; pressed ones count.
    const offered = Object.keys(stats.types).sort((a, b) => order(a) - order(b));
    html += `<div class="scwr-chips" role="group" aria-label="Finishes counted">${offered.map(type => {
      const [w, l] = stats.types[type];
      return `<button type="button" class="scwr-type gi-flex gi-items-center gi-gap-1.5 gi-py-0.5 gi-px-2 gi-text-xs gi-border gi-border-divider-secondary gi-rounded-full" data-type="${type}" aria-pressed="${picked.has(type)}">`
        + `<span class="gi-h-2.5 gi-w-2.5 gi-rounded-full" style="background: ${FINISH[type]?.[1] ?? 'rgb(128, 128, 128)'};"></span>`
        + `<span class="gi-font-medium">${nameOf(type)}</span><span class="gi-text-secondary">${w}–${l}</span></button>`;
    }).join('')}</div>`;
    if (!stats.belts) return html;
    // One bar per belt, highest first: its win rate, on a scale of all its matches.
    const row = ([b, t]) => {
      const [w, l] = record(t.types);
      const label = !t.events ? `No events at ${b} yet` : `${w + l ? `${rate(w, l)} of matches won` : 'No matches by these finishes'} at ${b}: `
        + `${plural(w, 'win')} and ${l} loss${l === 1 ? '' : 'es'} in ${plural(t.events, 'event')}`;
      return `<div class="scwr-split-row" role="img" aria-label="${label}" title="${label}">${swatch(b)}`
        + `<b class="gi-text-primary">${w + l ? rate(w, l) : '–'}</b>`
        + `<span class="scwr-split-track">${w + l ? `<span class="scwr-split-fill" data-belt="${b}" style="width: ${(w / (w + l)) * 100}%"></span>` : ''}</span>`
        + `<small class="gi-text-secondary">${w + l ? `${w}–${l}` : ''}</small></div>`;
    };
    return `${html}<div class="scwr-belt-split">${stats.belts.map(row).join('')}</div>`;
  }
  const draw = () => {
    const chart = document.querySelector('.match-statistics-content > div');
    if (!chart || !got['wins-and-medals'] || !got.skills || !Array.isArray(got['past-events']?.data) || !got['past-events'].meta?.total || !pastUrl) return;
    plan ??= planBelts();
    if (!reading) readStats().catch(() => { plan.loading = false; draw(); });
    const stage = stats ? 'done' : plan.loading ? 'loading' : '';
    const box = chart.querySelector('.scwr-more');
    if (!stage) return box?.remove();
    if (box?.dataset.stage === stage) return;
    const html = stats ? filled() : skeleton();
    if (box) {
      box.dataset.stage = stage;
      box.setAttribute('aria-busy', String(!stats));
      box.innerHTML = html;
    } else chart.insertAdjacentHTML('beforeend', `<div class="scwr-more gi-text-sm" data-stage="${stage}" aria-busy="${!stats}">${html}</div>`);
  };
  // A chip toggles its finish in or out, and every rate redraws at once.
  document.addEventListener('click', (event) => {
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
  // The chart renders after the responses land, and a re-render drops the block.
  new MutationObserver(draw).observe(document, { childList: true, subtree: true });
})();
