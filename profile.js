// A profile's wins per event entered, under Smoothcomp's own wins chart: the same
// figure the participants page sorts by. Both numbers come from responses the page
// asks for anyway (its career and its past events), so nothing extra is fetched.
// Below it, wins per event at the current belt against before it, walkovers aside
// too: the page's belt list says when the current belt began, the past-events pages
// back to then give those events' wins, and their match lists the walkovers in them.
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
  const read = async (kind, page) => {
    const url = new URL(pastUrl.replace('/past-events', `/${kind}`), location.href);
    url.searchParams.set('page', page);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${kind} unavailable`);
    return response.json();
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
  // The current belt's events are those after the last one at a lower belt, or from
  // its first when the belt list names all of them.
  async function readSplit() {
    splitting = true;
    const rows = (got.skills?.data ?? []).filter(s => /jiu|bjj/i.test(s.name) && color(s.belt)).sort((a, b) => b.sort_order - a.sort_order);
    const belt = color(rows[0]?.belt);
    const lower = rows.filter(s => BELTS.indexOf(color(s.belt)) < BELTS.indexOf(belt)).flatMap(s => s.events ?? []).map(time);
    if (!belt) return;
    // Every event at one belt: the overall figure is that belt's, so it only takes the belt.
    if (!lower.length) {
      split = { belt, whole: true };
      return draw();
    }
    const at = rows.filter(s => color(s.belt) === belt);
    const from = at.every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...at.flatMap(s => s.events ?? []).map(time)) : Math.max(...lower) + 1;
    const past = got['past-events'];
    const events = [...past.data];
    for (let page = 2; page <= past.meta.last_page && events.length && time(events.at(-1)) >= from; page++) events.push(...(await read('past-events', page)).data);
    const current = events.filter(e => time(e) >= from);
    // The match lists run newest first like the events, three a page; stop at the first older event.
    const ids = new Set(current.map(e => e.id));
    let given = 0;
    for (let page = 1, last = 1, done = !ids.size; !done && page <= last; page++) {
      const body = await read('event-statistics', page);
      last = body.meta?.last_page ?? 1;
      for (const event of body.data ?? []) {
        if (!ids.delete(event.id)) { done = true; break; }
        given += walkovers(event);
      }
      done ||= !ids.size;
    }
    // The belts worn before, lowest first, each only if events were entered in it.
    const worn = BELTS.slice(0, BELTS.indexOf(belt)).filter(b => rows.some(s => color(s.belt) === b && s.competed_count > 0));
    split = { belt, worn, wins: current.reduce((n, e) => n + e.wins, 0) - given, events: current.length };
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
    // One bar per side, scaled to the larger figure; the belts worn label each side.
    const sides = [[[split.belt], split.wins, split.events, `at ${split.belt}`], [split.worn, wins - split.wins, events - split.events, `before ${split.belt}`]].filter((side, i) => !i || side[2]);
    if (sides.some(([, w, n]) => n < 0 || w < 0)) return;
    const top = Math.max(...sides.map(([, w, n]) => (n ? w / n : 0))) || 1;
    const row = ([belts, w, n, when]) => {
      const label = n ? `${(w / n).toFixed(1)} wins per event ${when}, walkovers aside: ${w} in ${n} event${n === 1 ? '' : 's'}` : `No events ${when} yet`;
      return `<div class="scwr-split-row" role="img" aria-label="${label}" title="${label}">`
        + `<span class="scwr-split-belts">${belts.map(swatch).join('')}</span>`
        + `<b class="gi-text-primary">${n ? (w / n).toFixed(1) : '–'}</b>`
        + `<span class="scwr-split-track">${n ? `<span class="scwr-split-fill" data-belt="${belts.at(-1) ?? split.belt}" style="width: ${(w / n / top) * 100}%"></span>` : ''}</span>`
        + `<small class="gi-text-secondary">${n} event${n === 1 ? '' : 's'}</small></div>`;
    };
    chart.insertAdjacentHTML('beforeend', `<div class="scwr-belt-split gi-text-sm" style="--belts: ${Math.max(1, split.worn.length)}">${sides.map(row).join('')}</div>`);
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
