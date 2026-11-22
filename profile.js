// A profile's wins per event entered, under Smoothcomp's own wins chart: the same
// figure the participants page sorts by. Both numbers come from responses the page
// asks for anyway (its career and its past events), so nothing extra is fetched.
// Beside it, wins per event at the current belt against before it: the page's belt
// list says when the current belt began, and only the past-events pages back to
// then are read beyond the page's own first one.
(() => {
  const got = {};
  let pastUrl, split, splitting;
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const color = (text) => {
    const named = BELTS.filter(b => new RegExp(`\\b${b}`, 'i').test(String(text).replace(/gray/i, 'grey')));
    return named.length === 1 ? named[0] : null;
  };
  const time = (e) => Date.parse(e.event_start ?? e.start_date);
  const figure = (wins, events, label) => `<span class="gi-text-primary gi-font-medium">${(wins / events).toFixed(1)}</span>`
    + `<span class="gi-text-secondary">${label} · ${wins} in ${events} event${events === 1 ? '' : 's'}</span>`;
  // The current belt's events are those after the last one at a lower belt, or from
  // its first when the belt list names all of them. Per-event wins count walkovers,
  // so both sides here do.
  async function readSplit() {
    splitting = true;
    const rows = (got.skills?.data ?? []).filter(s => /jiu|bjj/i.test(s.name) && color(s.belt)).sort((a, b) => b.sort_order - a.sort_order);
    const belt = color(rows[0]?.belt);
    const lower = rows.filter(s => BELTS.indexOf(color(s.belt)) < BELTS.indexOf(belt)).flatMap(s => s.events ?? []).map(time);
    if (!belt || !lower.length) return;
    const at = rows.filter(s => color(s.belt) === belt);
    const from = at.every(s => (s.events?.length ?? 0) >= s.competed_count)
      ? Math.min(...at.flatMap(s => s.events ?? []).map(time)) : Math.max(...lower) + 1;
    const past = got['past-events'];
    const events = [...past.data];
    for (let page = 2; page <= past.meta.last_page && events.length && time(events.at(-1)) >= from; page++) {
      const url = new URL(pastUrl, location.href);
      url.searchParams.set('page', page);
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      events.push(...(await response.json()).data);
    }
    const current = events.filter(e => time(e) >= from);
    split = { belt, wins: current.reduce((n, e) => n + e.wins, 0), events: current.length };
    draw();
  }
  const draw = () => {
    const breakdown = got['wins-and-medals']?.data?.win_method_breakdown;
    const events = got['past-events']?.meta?.total;
    const chart = document.querySelector('.match-statistics-content > div');
    if (!Array.isArray(breakdown) || !Number.isInteger(events) || !events || !chart) return;
    if (!chart.querySelector('.scwr-per-event')) {
      const wins = breakdown.reduce((n, t) => n + (t.won_by === 'walkover' ? 0 : t.count), 0);
      chart.insertAdjacentHTML('beforeend', `<div class="scwr-per-event gi-flex gi-justify-center gi-items-center gi-gap-1.5 gi-text-sm gi-py-2" title="Wins, walkovers aside, per event entered">`
        + `${figure(wins, events, 'wins per event')}</div>`);
    }
    if (!splitting && got.skills && Array.isArray(got['past-events']?.data) && pastUrl) readSplit().catch(() => {});
    if (!split || chart.querySelector('.scwr-belt-split')) return;
    const all = breakdown.reduce((n, t) => n + t.count, 0);
    const before = events - split.events;
    if (before < 1) return;
    const row = (html) => `<div class="gi-flex gi-justify-center gi-items-center gi-gap-1.5">${html}</div>`;
    chart.insertAdjacentHTML('beforeend', `<div class="scwr-belt-split gi-text-sm gi-pb-2" title="Wins, walkovers included, per event entered at the current belt and before it">`
      + row(split.events ? figure(split.wins, split.events, `per event at ${split.belt}`) : `<span class="gi-text-secondary">No events at ${split.belt} yet</span>`)
      + row(figure(all - split.wins, before, `per event before ${split.belt}`)) + '</div>');
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
