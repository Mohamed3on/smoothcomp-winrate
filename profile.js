// A profile's wins per event entered, under Smoothcomp's own wins chart: the same
// figure the participants page sorts by. Both numbers come from responses the page
// asks for anyway (its career and its past events), so nothing extra is fetched.
(() => {
  const got = {};
  const draw = () => {
    const breakdown = got['wins-and-medals']?.data?.win_method_breakdown;
    const events = got['past-events']?.meta?.total;
    const chart = document.querySelector('.match-statistics-content > div');
    if (!Array.isArray(breakdown) || !Number.isInteger(events) || !events || !chart || chart.querySelector('.scwr-per-event')) return;
    const wins = breakdown.reduce((n, t) => n + (t.won_by === 'walkover' ? 0 : t.count), 0);
    chart.insertAdjacentHTML('beforeend', `<div class="scwr-per-event gi-flex gi-justify-center gi-items-center gi-gap-1.5 gi-text-sm gi-py-2" title="Wins, walkovers aside, per event entered">`
      + `<span class="gi-text-primary gi-font-medium">${(wins / events).toFixed(1)}</span>`
      + `<span class="gi-text-secondary">wins per event · ${wins} in ${events} event${events === 1 ? '' : 's'}</span></div>`);
  };
  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.scwrKind = String(url).match(/\/athlete\/\d+\/(wins-and-medals|past-events)\b/)?.[1];
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const kind = this.scwrKind;
    if (kind) this.addEventListener('load', () => {
      try { got[kind] = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); draw(); } catch {}
    });
    return send.apply(this, args);
  };
  // The chart renders after the responses land, and a re-render drops the line.
  new MutationObserver(draw).observe(document, { childList: true, subtree: true });
})();
