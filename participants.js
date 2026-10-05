// Smoothcomp already ships every bracket of an event in the participants
// payload, then renders four at a time behind infinite scroll. Show them all at
// once, biggest bracket first, and rank each bracket by its athletes' careers.

const approved = (group) => group.registrations.filter((r) => r.approved === 1).length;

// A career is one request per athlete, so it is read only for brackets near the
// screen, a whole bracket at once, and kept for a day. Wins count the way the
// results page counts them: walkovers stay out unless switched on there.
const CAREERS = 'careers';
const DAY = 24 * 60 * 60 * 1000;
const careers = SCWRSite.store.get(CAREERS, {});
const reading = new Map();
const typesOff = SCWRSite.store.get('results-prefs')?.typesOff;
const counted = (type) => !(Array.isArray(typesOff) ? typesOff : ['walkover']).includes(type);
const fresh = (user) => Date.now() - (careers[user]?.at ?? 0) < DAY;

function readCareer(user) {
  if (!reading.has(user)) {
    reading.set(user, fetch(SCWRSite.url.career(user), { credentials: 'include' }).then(async (response) => {
      // A hidden profile answers 403, which asking again will not change; a busy
      // server might, so that athlete stays unread until the bracket is next seen.
      if (response.status === 429 || response.status >= 500) return;
      const data = response.ok ? (await response.json()).data : null;
      careers[user] = { at: Date.now(), ...(data && {
        wins: Object.fromEntries(data.win_method_breakdown.map((t) => [t.won_by, t.count])),
        medals: [data.medals.gold, data.medals.silver, data.medals.bronze],
      }) };
    }).catch(() => {}).finally(() => reading.delete(user)));
  }
  return reading.get(user);
}

function save() {
  for (const user of Object.keys(careers)) if (!fresh(user)) delete careers[user];
  SCWRSite.store.set(CAREERS, careers);
}

// Counted wins, wins by submission and wins by points; null while the career
// is unread or hidden.
function tally(user) {
  const career = fresh(user) ? careers[user] : null;
  if (!career?.wins) return null;
  const n = (type) => (counted(type) ? career.wins[type] ?? 0 : 0);
  return [Object.keys(career.wins).reduce((sum, type) => sum + n(type), 0), n('submission'), n('points')];
}

let vm;
let place; // each registration's index in Smoothcomp's own order
const ranked = new Set();

// Most wins first, then most by submission, most by points, and the older
// athlete; anything still level keeps Smoothcomp's own order. A career that is
// unread or hidden sorts after every known one.
function rank(group) {
  const key = (r) => [...(tally(r.user_id) ?? [-1, -1, -1]), r.age ?? -1, -place.get(r.id)];
  return group.registrations.map((r) => [r, key(r)])
    .sort(([, a], [, b]) => a.reduce((order, x, i) => order || b[i] - x, 0))
    .map(([r]) => r);
}

// The heading holds the name exactly as the payload has it, stray spaces included.
const heading = (group) => group.querySelector('.group-name')?.textContent;

// The data keeps the new order for every later filter to rebuild from. On
// screen, only the chunks holding these brackets are swapped, so Vue redraws
// them alone rather than every bracket on the page.
function rerank(names) {
  const rows = new Map();
  for (const group of document.querySelectorAll('#registrations .participant-group')) {
    if (!names.has(heading(group))) continue;
    for (const row of group.querySelectorAll('.profile-card')) rows.set(row, row.getBoundingClientRect().top);
  }
  const swap = (g) => (names.has(g.name) ? { ...g, registrations: rank(g) } : g);
  vm.all = Object.freeze(vm.all.map(swap));
  vm.visible = vm.visible.map((chunk) => (chunk.some((g) => names.has(g.name)) ? chunk.map(swap) : chunk));
  vm.$nextTick(() => { slide(rows); queue(); });
}

// A row that changes place slides there, unless the reader asked for less motion.
function slide(rows) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const [row, top] of rows) {
    const shift = top - row.getBoundingClientRect().top;
    if (shift && row.isConnected) {
      row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
    }
  }
}

// Every athlete in the bracket is asked at once, and the bracket is ranked when
// the last one answers. Brackets sharing a name are read and ranked together.
async function read(name) {
  // Ids as strings, the way the rows' profile links give them back.
  const users = new Set(vm.all.filter((g) => g.name === name).flatMap((g) => g.registrations.map((r) => r.user_id && String(r.user_id))));
  const missing = [...users].filter((user) => user && !fresh(user));
  if (!missing.length && ranked.has(name)) return;
  const batch = Promise.all(missing.map(readCareer));
  queue();
  await batch;
  if (missing.length) save();
  ranked.add(name);
  rerank(new Set([name]));
}

const watcher = new IntersectionObserver((entries) => {
  for (const entry of entries) if (entry.isIntersecting) read(heading(entry.target));
}, { rootMargin: '300px 0px' });

// The registration column only repeats the bracket title, so the career takes
// its place; participants.css hides the original. Each column is drawn like
// Smoothcomp's own: a figure over a muted line, as the birth year sits over the age.
const COLUMNS = ['Wins', 'Medals'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A zero steps back to Smoothcomp's muted ink, so the eye lands on the figures that count.
const column = (n, figure, line) => `<div><div${n ? '' : ' class="muted"'}>${figure}</div><div class="muted font-size-tiny">${line}</div></div>`;
// The placeholder takes the shape of what replaces it, so nothing moves when it lands.
const PLACEHOLDER = '<div><div><i class="scwr-pulse"></i></div><div class="font-size-tiny"><i class="scwr-pulse"></i></div></div>';

function draw(cell, user) {
  const t = user && tally(user);
  const medals = t && careers[user].medals;
  const state = user === 'head' ? user : t ? `${t}|${medals}` : !user ? '' : fresh(user) ? 'hidden' : reading.has(user) ? 'reading' : '';
  if (cell.dataset.state === state) return;
  cell.dataset.state = state;
  cell.title = '';
  if (state === 'head') {
    cell.innerHTML = COLUMNS.map((label) => `<span>${label}</span>`).join('');
  } else if (t) {
    const [gold, silver, bronze] = medals;
    cell.innerHTML = column(t[0], `<b>${t[0]}</b>`, `${plural(t[1], 'sub')} · ${t[2]} pts`)
      + (gold + silver + bronze ? column(gold, `${gold} gold`, `${silver} silver · ${bronze} bronze`) : '<div class="muted">No medals</div>');
    const by = (keep) => Object.entries(careers[user].wins).filter(([type]) => counted(type) === keep)
      .map(([type, n]) => `${n} by ${type}`).join(', ');
    cell.title = `${plural(t[0], 'career win')}: ${by(true) || 'none'}${by(false) ? `, not counting ${by(false)}` : ''}.`;
  } else if (state === 'hidden') {
    cell.innerHTML = '<div class="muted">Hidden profile</div>';
    cell.title = 'Smoothcomp does not share a hidden profile\'s record.';
  } else {
    cell.innerHTML = state === 'reading' ? PLACEHOLDER.repeat(COLUMNS.length) : '';
  }
}

function paint() {
  painter.disconnect();
  for (const group of document.querySelectorAll('#registrations .participant-group')) {
    watcher.observe(group);
    for (const row of group.querySelectorAll('.participants-table-head, .participants-desktop .participant-tr-main')) {
      const slot = row.querySelector(':scope > .participant-td-registration');
      if (!slot) continue;
      let cell = slot.nextElementSibling;
      if (!cell?.classList.contains('scwr-career')) {
        cell = document.createElement(slot.tagName);
        cell.className = 'participant-td scwr-career';
        slot.after(cell);
      }
      draw(cell, row.classList.contains('participants-table-head') ? 'head'
        : SCWRSite.profileId(row.querySelector('a[href*="/profile/"]')?.getAttribute('href')));
    }
  }
  painter.observe(document.querySelector('#registrations'), { childList: true, subtree: true });
}

let queued = false;
const painter = new MutationObserver(queue);
function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(); });
}

// The list is fetched after mount, so wait for it to land — a large entry list on
// a slow connection takes a while, but not forever.
SCWRSite.vm.find('#registrations', (c) => c.proxy?.all?.length, { timeout: 60000 }).then((found) => {
  if (!found) return;
  vm = found;
  place = new Map(vm.all.flatMap((g) => g.registrations.map((r, i) => [r.id, i])));
  // Brackets whose every career is already kept are ranked before the first draw.
  for (const g of vm.all) if (g.registrations.every((r) => !r.user_id || fresh(r.user_id))) ranked.add(g.name);
  // Every filter path — search, country, quick filter — funnels through here,
  // and each one rebuilds `visible` from the first chunk alone.
  SCWRSite.vm.after(vm, 'updateResults', () => {
    vm.visible = vm.chunks.slice();
    vm.nextChunk = vm.chunks.length; // leaves the scroll handler nothing to do
  });
  // `participants` maps `all` in order, so sorting the source sorts the filtered
  // views too. The array is frozen; sort a copy.
  vm.all = Object.freeze([...vm.all].sort((a, b) => approved(b) - approved(a))
    .map((g) => (ranked.has(g.name) ? { ...g, registrations: rank(g) } : g)));
  vm.updateResults();
  queue();
});
