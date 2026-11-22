// A profile's wins per event entered, under Smoothcomp's own wins chart: the same
// figure the participants page sorts by. Both numbers come from responses the page
// asks for anyway (its career and its past events), so nothing extra is fetched.
// Below it, wins per event at each belt worn, walkovers aside too: the page's belt
// list dates each belt, every past-events page gives each event's wins, and every
// match-list page the walkovers in them.
(() => {
  const got = {};
  let pastUrl, split, splitting;
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const color = (text) => {
    const named = BELTS.filter(b => new RegExp(`\\b${b}`, 'i').test(String(text).replace(/gray/i, 'grey')));
    return named.length === 1 ? named[0] : null;
  };
  const time = (e) => Date.parse(e.event_start ?? e.start_date);
  const swatch = (b) => `<i class="scwr-belt" data-belt="${b}"></i>`;
  const figure = (wins, events, label) => `<span class="gi-text-primary gi-font-medium">${(wins / events).toFixed(1)}</span>`
    + `<span class="gi-text-secondary">${label} · ${wins} in ${events} event${events === 1 ? '' : 's'}</span>`;
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
  // Walkovers the athlete won at one event. Each division registers them afresh, so
  // their seat is the one in all of a division's matches, or, in a one-match
  // division, the one under the profile's name.
  const walkovers = (event) => {
    const name = document.title.split(' - ')[0].trim().toLowerCase();
    return Object.values(event.matches ?? {}).reduce((n, group) => {
      const matches = group.matches ?? [];
      const seen = new Map();
      for (const m of matches) for (const s of m.seats ?? []) seen.set(s.event_registration_id, (seen.get(s.event_registration_id) ?? 0) + 1);
      const theirs = (s) => (matches.length > 1 ? seen.get(s.event_registration_id) === matches.length : s.name?.trim().toLowerCase() === name);
      return n + matches.filter(m => m.wonBy === 'walkover' && m.seats?.some(s => s.isWinner && theirs(s))).length;
    }, 0);
  };
  // Each belt's events run from its first when the belt list names all of them, else
  // from just after the last one listed at the belt below. Events without a belt
  // (no-gi levels, absolutes) take the belt worn at the time.
  async function readSplit() {
    splitting = true;
    const rows = (got.skills?.data ?? []).filter(s => /jiu|bjj/i.test(s.name) && color(s.belt)).sort((a, b) => b.sort_order - a.sort_order);
    const belt = color(rows[0]?.belt);
    if (!belt) return;
    const listed = (b) => rows.filter(s => color(s.belt) === b);
    const worn = BELTS.filter(b => listed(b).some(s => s.competed_count > 0));
    // Every event at one belt: the overall figure is that belt's, so it only takes the belt.
    if (worn.every(b => b === belt)) {
      split = { belt, whole: true };
      return draw();
    }
    const times = (b) => listed(b).flatMap(s => s.events ?? []).map(time);
    const starts = worn.map((b, i) => (!i ? -Infinity : listed(b).every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...times(b)) : Math.max(...times(worn[i - 1])) + 1));
    const beltOf = (e) => worn[starts.findLastIndex(start => start <= time(e))] ?? worn[0];
    // Every page of both lists at once. The page has the events' first page; the event
    // count says how many match-list pages there are, at most, three events a page.
    const past = got['past-events'];
    const pages = (kind, count, from) => Promise.all(Array.from({ length: Math.max(0, count - from + 1) }, (_, i) => read(kind, from + i)))
      .then(bodies => bodies.flatMap(body => body.data ?? []));
    const [more, matches] = await Promise.all([pages('past-events', past.meta?.last_page ?? 1, 2), pages('event-statistics', Math.ceil((past.meta?.total ?? 0) / 3), 1)]);
    const events = [...past.data, ...more];
    const given = new Map(matches.map(event => [event.id, walkovers(event)]));
    const tally = new Map([belt, ...worn].map(b => [b, { wins: 0, events: 0 }]));
    for (const e of events) {
      const t = tally.get(beltOf(e));
      t.wins += (e.wins ?? 0) - (given.get(e.id) ?? 0);
      t.events++;
    }
    // A lower belt no event fell to has nothing to show; the current one says it has no events yet.
    split = { belt, belts: [...tally].filter(([b, t]) => b === belt || t.events).sort(([a], [b]) => BELTS.indexOf(b) - BELTS.indexOf(a)) };
    draw();
  }
  const draw = () => {
    const breakdown = got['wins-and-medals']?.data?.win_method_breakdown;
    const events = got['past-events']?.meta?.total;
    const chart = document.querySelector('.match-statistics-content > div');
    if (!Array.isArray(breakdown) || !Number.isInteger(events) || !events || !chart) return;
    const wins = breakdown.reduce((n, t) => n + (t.won_by === 'walkover' ? 0 : t.count), 0);
    if (!chart.querySelector('.scwr-per-event')) {
      chart.insertAdjacentHTML('beforeend', `<div class="scwr-per-event gi-flex gi-justify-center gi-items-center gi-gap-1.5 gi-text-sm gi-py-2" title="Wins, walkovers aside, per event entered">`
        + `${figure(wins, events, 'wins per event')}</div>`);
    }
    if (!splitting && got.skills && Array.isArray(got['past-events']?.data) && pastUrl) readSplit().catch(() => {});
    if (!split) return;
    const line = chart.querySelector('.scwr-per-event');
    if (split.whole) {
      if (!line.querySelector('.scwr-belt')) line.insertAdjacentHTML('afterbegin', swatch(split.belt).replace('<i ', `<i role="img" aria-label="Every event at ${split.belt}" title="Every event at ${split.belt}" `));
      return;
    }
    if (chart.querySelector('.scwr-belt-split')) return;
    // One bar per belt, highest first, scaled to the best figure.
    const top = Math.max(...split.belts.map(([, t]) => (t.events ? t.wins / t.events : 0))) || 1;
    const row = ([b, { wins: w, events: n }]) => {
      const label = n ? `${(w / n).toFixed(1)} wins per event at ${b}, walkovers aside: ${w} in ${n} event${n === 1 ? '' : 's'}` : `No events at ${b} yet`;
      return `<div class="scwr-split-row" role="img" aria-label="${label}" title="${label}">${swatch(b)}`
        + `<b class="gi-text-primary">${n ? (w / n).toFixed(1) : '–'}</b>`
        + `<span class="scwr-split-track">${n ? `<span class="scwr-split-fill" data-belt="${b}" style="width: ${(w / n / top) * 100}%"></span>` : ''}</span>`
        + `<small class="gi-text-secondary">${n} event${n === 1 ? '' : 's'}</small></div>`;
    };
    chart.insertAdjacentHTML('beforeend', `<div class="scwr-belt-split gi-text-sm">${split.belts.map(row).join('')}</div>`);
  };
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
  // The chart renders after the responses land, and a re-render drops the lines.
  new MutationObserver(draw).observe(document, { childList: true, subtree: true });
})();
