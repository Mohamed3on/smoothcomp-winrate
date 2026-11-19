// Mat Stats: the shared career cache, browsable. No build step and no
// dependencies, like the extension. The URL holds every filter, so a ranking is
// a link you can send.
const WIN_TYPES = ['submission', 'stoppage', 'points', 'decision', 'disqualification', 'walkover'];
const TYPE_NAMES = { submission: 'Submission', stoppage: 'Stoppage', points: 'Points', decision: 'Decision', disqualification: 'DQ', walkover: 'Walkover' };
const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
const ALL = 2000; // every row a ranking has; nothing is paged away
const FIRST = 100;
const CHUNK = 200;
const FILTERS = ['site', 'off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'country', 'athletes'];
const DEFAULTS = { off: 'walkover', wins: '5' };
const PREFS = 'mat-stats:filters';

// Each view draws into the main element current when it started; a view still
// loading after the reader moved on writes into a detached one.
let mainNode = document.querySelector('#main');
const page = () => mainNode;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('en'));
const many = (n, word) => (n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : word.endsWith('ch') ? `${word}es` : `${word}s`);
const plural = (n, word) => `${fmt(n)} ${many(n, word)}`;
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

// ── State: the URL, with the last filters remembered for a bare visit ────────
function params() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].some((k) => FILTERS.includes(k))) {
    const kept = JSON.parse(localStorage.getItem(PREFS) ?? 'null') ?? DEFAULTS;
    for (const [k, v] of Object.entries(kept)) if (FILTERS.includes(k) && !p.has(k)) p.set(k, v);
  }
  if (!p.has('off')) p.set('off', DEFAULTS.off);
  return p;
}
const site = () => (params().get('site') === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com');
const home = () => (site() === 'ajptour.com' ? 'https://ajptour.com' : 'https://smoothcomp.com');
const off = () => new Set((params().get('off') ?? '').split(',').filter(Boolean));
const counted = (type) => !off().has(type);

// Links keep the filters, so following one keeps the ranking's terms.
function link(path, extra = {}) {
  const p = params();
  const keep = new URLSearchParams();
  for (const k of FILTERS) if (p.get(k) || (k === 'off' && p.has(k))) keep.set(k, p.get(k));
  for (const [k, v] of Object.entries(extra)) if (v == null || v === '') keep.delete(k); else keep.set(k, v);
  const q = keep.toString();
  return q ? `${path}?${q}` : path;
}

function setParams(changes, push = false) {
  const p = params();
  // An empty "off" is kept: it means every finish counts, not the default.
  for (const [k, v] of Object.entries(changes)) if (v == null || (v === '' && k !== 'off')) p.delete(k); else p.set(k, v);
  const prefs = Object.fromEntries(FILTERS.filter((k) => k !== 'site' && p.has(k)).map((k) => [k, p.get(k)]));
  localStorage.setItem(PREFS, JSON.stringify(prefs));
  history[push ? 'pushState' : 'replaceState'](null, '', `${location.pathname}?${p}`);
}

const cache = new Map();
async function api(route, query = {}) {
  const p = new URLSearchParams({ site: site(), off: params().get('off') ?? '' });
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') p.set(k, v);
  const url = `/api/${route}?${p}`;
  if (!cache.has(url)) cache.set(url, fetch(url).then(async (r) => {
    if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`), { status: r.status });
    return r.json();
  }).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

// ── Shared pieces ───────────────────────────────────────────────────────────
const svg = (...shapes) => `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" style="border-radius:2px">${shapes.join('')}</svg>`;
const band = (y, h, fill) => `<rect y="${y}" width="16" height="${h}" fill="${fill}"/>`;
const FLAG = {
  'gb-eng': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'gb-sct': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  'gb-wls': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
  kos: '\u{1F1FD}\u{1F1F0}',
  'ru-cri': svg(band(0, 12, '#0f8f3f'), band(5.2, 1.6, '#fff'), band(6.8, 5.2, '#c8102e'), '<rect width="2.6" height="12" fill="#e8a020"/>'),
  'ru-da': svg(band(0, 12, '#0f8f3f'), band(4, 4, '#1e4fa3'), band(8, 4, '#c8102e')),
  krd: svg(band(0, 12, '#e03a3e'), band(4, 4, '#fff'), band(8, 4, '#1a8f4c'), '<circle cx="8" cy="6" r="2.1" fill="#f5c518"/>'),
};
function flag(code, name) {
  const c = String(code ?? '').toLowerCase();
  const glyph = FLAG[c] ?? (/^[a-z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 97)) : null);
  return glyph ? `<span class="flag" role="img" aria-label="${esc(name ?? c.toUpperCase())}" title="${esc(name ?? c.toUpperCase())}">${glyph}</span>` : '';
}
const EXT = '<svg class="ext-mark" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// The age an athlete turns this year, from the birth year their latest event implied.
const age = (born) => (Number.isSafeInteger(born) ? `<span class="age" title="Age, give or take a year">${new Date().getUTCFullYear() - born}</span>` : '');
const belt = (b) => (BELTS.includes(b) ? `<span class="belt" data-belt="${b}" role="img" aria-label="${b} belt" title="${b[0].toUpperCase()}${b.slice(1)} belt"></span>` : '');
const initials = (name) => (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const avatar = (a, size = '') => (a.photo
  ? `<img class="avatar ${size}" src="${esc(a.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${esc(initials(a.name))}">`
  : `<span class="avatar ${size}" aria-hidden="true">${esc(initials(a.name))}</span>`);
const nameOf = (a) => a.name ?? null;
// A photo that fails to load gives way to the initials.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.initials) return;
  const span = document.createElement('span');
  span.className = img.className;
  span.textContent = img.dataset.initials;
  img.replaceWith(span);
}, true);

function who(a, { club = true } = {}) {
  const name = nameOf(a);
  const title = name ? esc(name) : `<span class="who-name unnamed" title="Their name arrives once someone opens an event they entered">Athlete ${esc(a.user)}</span>`;
  const academy = club && a.club ? (a.club_id ? `<a href="${link(`/academy/${a.club_id}`)}">${esc(a.club)}</a>` : esc(a.club)) : '';
  return `<div class="who">${avatar(a)}<div class="who-text"><div class="who-line">${name ? `<a class="who-name" href="${link(`/athlete/${a.user}`)}">${title}</a>` : `<a href="${link(`/athlete/${a.user}`)}">${title}</a>`}${flag(a.country, a.country_name)}${belt(a.belt)}${age(a.born)}</div>${academy ? `<div class="who-meta">${academy}</div>` : ''}</div></div>`;
}

const colour = (type) => (WIN_TYPES.includes(type) ? `var(--win-${type})` : 'var(--win-other)');
const order = (types) => Object.entries(types ?? {}).filter(([, n]) => n > 0)
  .sort(([a], [b]) => (WIN_TYPES.indexOf(a) + 1 || 99) - (WIN_TYPES.indexOf(b) + 1 || 99));
// Uploads are trusted as data, never as markup: every name read back is escaped.
const typeName = (t) => TYPE_NAMES[t] ?? esc(t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));

// Every win the reader counts, most decisive finish first: the same ramp as the extension.
function mix(types, { large = false, legend = true } = {}) {
  const shown = order(types).filter(([t]) => counted(t));
  const total = shown.reduce((n, [, c]) => n + c, 0);
  if (!total) return '<span class="muted small">No counted wins</span>';
  const title = shown.map(([t, c]) => `${typeName(t)} ${c}`).join(' · ');
  const lead = shown.slice(0, 3).map(([t, c]) => `<b>${c}</b> ${typeName(t).toLowerCase()}`).join(' · ');
  return `<div class="mix${large ? ' large' : ''}" title="${esc(title)}"><div class="track" role="img" aria-label="${esc(title)}">${shown.map(([t, c]) => `<i style="--c:${colour(t)};flex:${c}"></i>`).join('')}</div>${legend ? `<div class="legend">${lead}</div>` : ''}</div>`;
}
function keys(types) {
  return `<div class="keys">${order(types).map(([t, c]) => `<span class="${counted(t) ? '' : 'off'}" title="${counted(t) ? '' : 'Not counted: switched off in the filters'}"><i style="--c:${colour(t)}"></i>${typeName(t)} <b>${c}</b></span>`).join('')}</div>`;
}
// No Smoothcomp career: the figures are this athlete's results at the events read, losses included.
const fromResults = (a) => (a.source === 'results' ? `<div class="legend from" title="Smoothcomp serves no career for this athlete, so these are their results at the events Mat Stats has read">From results: ${record(a.wins, a.losses)} at ${plural(a.events, 'event')} read</div>` : '');
const medals = (g, s, b) => `<span class="medals" aria-label="${g} gold, ${s} silver, ${b} bronze">${[['g', g], ['s', s], ['b', b]].map(([k, n]) => `<span class="${k}${n ? '' : ' none'}">${fmt(n)}</span>`).join('')}</span>`;
const num = (n) => `<span class="num${n ? '' : ' zero'}">${fmt(n)}</span>`;
// What happened, whether or not it counts: a finish switched off reads dimmed, not zero.
const raw = (n, type) => (counted(type) ? num(n) : `<span class="zero" title="${TYPE_NAMES[type]} wins are switched off in the filters">${fmt(n)}</span>`);
const countWins = (bucket) => Object.entries(bucket ?? {}).reduce((n, [t, c]) => n + (counted(t) ? c : 0), 0);
function record(w, l) {
  return `<span class="record"><span class="${w ? 'w' : 'zero'}">${w}</span><span class="dash">–</span><span class="${l ? 'l' : 'zero'}">${l}</span></span>`;
}
const placeChip = (p) => (p ? `<span class="place p${p <= 3 ? p : ''}" title="${p === 1 ? 'Gold' : p === 2 ? 'Silver' : p === 3 ? 'Bronze' : `Placed ${p}`}">${p}</span>` : '<span class="muted">–</span>');
const perEvent = (wins, events) => (events ? (wins / events).toFixed(1) : '–');

const skeleton = (cols, rows = 12) => `<tbody>${Array.from({ length: rows }, () => `<tr>${Array.from({ length: cols }, () => '<td><span class="shimmer"></span></td>').join('')}</tr>`).join('')}</tbody>`;
const empty = (title, text, action = '') => `<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`;
const failed = (e) => empty('That didn’t load', `The stats server answered “${esc(e.message)}”. Try again in a moment.`, '<button class="button" data-action="retry">Try again</button>');

// Sorted headers: a button per sortable column, the current one marked.
function head(columns, sort) {
  return `<thead><tr>${columns.map((c) => {
    const cls = [c.align === 'start' ? 'start' : '', c.narrow ? 'hide-narrow' : ''].filter(Boolean).join(' ');
    const label = c.sort ? `<button type="button" data-sort="${c.sort}" title="${esc(c.title ?? `Rank by ${c.label.toLowerCase()}`)}">${c.label}</button>` : c.label;
    return `<th scope="col" class="${cls}" style="width:${c.width}"${c.sort && c.sort === sort ? ' aria-sort="descending"' : ''}>${label}</th>`;
  }).join('')}</tr></thead>`;
}

// FLIP: rows keyed by id slide from where they were to where they now rank.
function rerank(tbody, html) {
  const before = new Map([...tbody.querySelectorAll('tr[data-key]')].map((tr) => [tr.dataset.key, tr.getBoundingClientRect().top]));
  tbody.innerHTML = html;
  if (!before.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const tr of tbody.querySelectorAll('tr[data-key]')) {
    const was = before.get(tr.dataset.key);
    if (was == null) continue;
    const dy = was - tr.getBoundingClientRect().top;
    if (Math.abs(dy) < 1 || Math.abs(dy) > innerHeight) continue;
    tr.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => { tr.classList.add('moving'); tr.style.transform = ''; });
    tr.addEventListener('transitionend', () => tr.classList.remove('moving'), { once: true });
  }
}

// ── The filter band, shared by the athlete and academy rankings ─────────────
let countries;
async function filterBand({ sorts, minimumAthletes = false }) {
  const p = params();
  const belts = new Set((p.get('belt') ?? '').split(',').filter(Boolean));
  countries ??= {};
  countries[site()] ??= api('countries').then((r) => r.rows).catch(() => []);
  const list = await countries[site()];
  const country = p.get('country') ?? '';
  return `<form class="filters" role="search" aria-label="Filters" onsubmit="return false">
    <div class="group"><span class="label" id="types-label">Wins that count</span>
      <div class="chips" role="group" aria-labelledby="types-label">${WIN_TYPES.map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${counted(t)}"><span class="dot" style="--c:${colour(t)}"></span>${TYPE_NAMES[t]}</button>`).join('')}</div></div>
    <div class="group"><span class="label" id="belts-label">Belt</span>
      <div class="chips" role="group" aria-labelledby="belts-label">${BELTS.filter((b) => !['grey', 'yellow', 'orange', 'green'].includes(b) || belts.has(b)).map((b) => `<button type="button" class="chip belt-chip" data-belt="${b}" aria-pressed="${belts.has(b)}" title="${b[0].toUpperCase()}${b.slice(1)}"><span class="belt" data-belt="${b}"></span><span class="sr">${b}</span></button>`).join('')}</div></div>
    <div class="group"><span class="label" id="age-label">Age range</span><div class="range${p.get('agemin') || p.get('agemax') ? ' set' : ''}" role="group" aria-labelledby="age-label"><input type="number" min="3" max="99" name="agemin" value="${esc(p.get('agemin') ?? '')}" placeholder="Any" aria-label="Youngest age"><span aria-hidden="true">–</span><input type="number" min="3" max="99" name="agemax" value="${esc(p.get('agemax') ?? '')}" placeholder="Any" aria-label="Oldest age"></div></div>
    <label class="group"><span class="label">Min. wins</span><input class="field" type="number" min="0" step="1" name="wins" value="${esc(p.get('wins') ?? '')}" placeholder="Any"></label>
    <label class="group"><span class="label" title="Only careers read with an event count can pass a minimum">Min. events</span><input class="field" type="number" min="0" step="1" name="events" value="${esc(p.get('events') ?? '')}" placeholder="Any"></label>
    ${minimumAthletes ? `<label class="group"><span class="label">Min. athletes</span><input class="field" type="number" min="1" step="1" name="athletes" value="${esc(p.get('athletes') ?? '3')}"></label>` : ''}
    <label class="group"><span class="label">Country</span><select class="field" name="country"><option value="">All countries</option>${list.map((c) => `<option value="${esc(c.country)}"${c.country === country ? ' selected' : ''}>${esc(c.name ?? c.country.toUpperCase())} (${c.athletes})</option>`).join('')}</select></label>
    <label class="group"><span class="label">Rank by</span><select class="field" name="sort">${sorts.map(([v, label]) => `<option value="${v}"${v === (p.get('sort') ?? 'wins') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="group"><span class="label">Name</span><input class="field wide" type="search" name="q" value="${esc(p.get('q') ?? '')}" placeholder="Filter by name"></label>
    <div class="group reset"><span class="label" aria-hidden="true">&nbsp;</span><button type="button" class="button" data-action="reset">Reset</button></div>
  </form>`;
}

function bindFilters(form, reload) {
  let timer;
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip?.dataset.type) {
      const pressed = chip.getAttribute('aria-pressed') === 'true';
      const on = [...form.querySelectorAll('[data-type][aria-pressed="true"]')];
      if (pressed && on.length === 1) return; // never an empty allowlist
      chip.setAttribute('aria-pressed', String(!pressed));
      const offList = [...form.querySelectorAll('[data-type][aria-pressed="false"]')].map((c) => c.dataset.type);
      setParams({ off: offList.join(',') });
      reload(true);
    } else if (chip?.dataset.belt) {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      setParams({ belt: [...form.querySelectorAll('[data-belt][aria-pressed="true"]')].map((c) => c.dataset.belt).join(',') });
      reload(true);
    } else if (e.target.closest('[data-action="reset"]')) {
      localStorage.removeItem(PREFS);
      history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ ...DEFAULTS, ...(site() !== 'smoothcomp.com' && { site: site() }) })}`);
      render();
    }
  });
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (!name) return;
    clearTimeout(timer);
    timer = setTimeout(() => { setParams({ [name]: value }); reload(name === 'sort'); }, e.target.type === 'search' || e.target.type === 'number' ? 300 : 0);
  });
}

// One ranking: filters, a sortable ledger, and "show more".
async function ranking({ host, level = 'h1', key = 'user', title, intro, route, columns, row, sorts, unit, minimumAthletes, query = () => ({}), expand }) {
  const main = host ?? page();
  main.innerHTML = `<div class="head"><div><${level}>${title}</${level}><p>${intro}</p></div><span class="count" aria-live="polite"></span></div>
    <div class="band"></div><div class="ledger"><table>${head(columns, params().get('sort') ?? 'wins')}${skeleton(columns.length)}</table></div>`;
  main.querySelector('.band').outerHTML = await filterBand({ sorts, minimumAthletes });
  const form = main.querySelector('.filters');
  const table = main.querySelector('table');
  const count = main.querySelector('.count');
  let rows = [];
  let token = 0;
  let drawn = 0;
  const draw = (animate) => {
    const sort = params().get('sort') ?? 'wins';
    table.querySelector('thead').outerHTML = head(columns, sort);
    const tbody = table.querySelector('tbody');
    // The first rows draw at once and the rest follow in idle chunks: every row lands, none waits on a click.
    const mine = ++drawn;
    const html = rows.slice(0, FIRST).map((r, i) => row(r, i, sort)).join('');
    const rest = (from) => requestIdleCallback(() => {
      if (mine !== drawn || from >= rows.length) return;
      tbody.insertAdjacentHTML('beforeend', rows.slice(from, from + CHUNK).map((r, i) => row(r, from + i, sort)).join(''));
      rest(from + CHUNK);
    }, { timeout: 200 });
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}">${empty(`No ${many(2, unit)} match`, 'Lower the minimum wins or events, switch more finish types on, or clear the belt and country.', '<button class="button" data-action="reset">Reset filters</button>')}</td></tr>`;
    } else if (animate) rerank(tbody, html); else tbody.innerHTML = html;
    rest(FIRST);
    count.innerHTML = rows.length ? `<b>${fmt(rows.length)}</b> ${many(rows.length, unit)} match` : '';
  };
  const load = async (animate = false) => {
    const mine = ++token;
    const p = params();
    if (!animate) table.querySelector('tbody').outerHTML = skeleton(columns.length, 8);
    main.querySelector('.ledger').setAttribute('aria-busy', 'true');
    try {
      const data = await api(route, { ...filtersQuery(minimumAthletes), limit: ALL, ...query() });
      if (mine !== token) return;
      rows = data.rows;
      draw(animate);
    } catch (e) {
      if (mine !== token) return;
      table.querySelector('tbody').innerHTML = `<tr><td colspan="${columns.length}">${failed(e)}</td></tr>`;
    } finally {
      if (mine === token) main.querySelector('.ledger').removeAttribute('aria-busy');
    }
  };
  bindFilters(form, load);
  main.addEventListener('click', async (e) => {
    const sortButton = e.target.closest('th [data-sort]');
    if (sortButton) {
      setParams({ sort: sortButton.dataset.sort });
      form.querySelector('[name="sort"]').value = sortButton.dataset.sort;
      return load(true);
    }
    if (e.target.closest('[data-action="retry"]')) return load();
    if (e.target.closest('[data-action="reset"]') && !form.contains(e.target)) return form.querySelector('[data-action="reset"]').click();
    // A row opens in place to show what's behind it; links inside still navigate.
    const tr = expand && e.target.closest('tbody > tr[data-key]');
    if (!tr || (e.target.closest('a') && !e.target.closest('[data-action="expand"]'))) return;
    const open = tr.nextElementSibling?.classList.contains('detail') ? tr.nextElementSibling : null;
    tr.setAttribute('aria-expanded', String(!open));
    if (open) return open.remove();
    const detail = document.createElement('tr');
    detail.className = 'detail';
    detail.innerHTML = `<td colspan="${columns.length}">${skeleton(4, 3).replace(/<\/?tbody>/g, '')}</td>`;
    tr.after(detail);
    try { detail.firstElementChild.innerHTML = await expand(rows.find((r) => String(r[key]) === tr.dataset.key)); }
    catch (err) { detail.firstElementChild.innerHTML = failed(err); }
  });
  await load();
}

// The filters every ranking request carries.
function filtersQuery(minimumAthletes) {
  const p = params();
  return { belt: p.get('belt'), wins: p.get('wins'), events: p.get('events'), agemin: p.get('agemin'), agemax: p.get('agemax'), country: p.get('country'), athletes: p.get('athletes') ?? (minimumAthletes ? 3 : null), sort: p.get('sort'), q: p.get('q') };
}

// ── Views ───────────────────────────────────────────────────────────────────
const ATHLETE_SORTS = [['wins', 'Wins'], ['submission', 'Submissions'], ['points', 'Wins on points'], ['stoppage', 'Stoppages'], ['decision', 'Decisions'],
  ['rate', 'Submission rate'], ['medals', 'Medals'], ['events', 'Events entered'], ['perEvent', 'Wins per event']];

const athleteColumns = (club = true) => [
    { label: '#', width: '52px', align: 'start' },
    { label: 'Athlete', width: club ? '30%' : '26%', align: 'start' },
    { label: 'Wins', width: '9%', sort: 'wins', title: 'Career wins of the finish types switched on' },
    { label: 'How they won', width: '22%', align: 'start', title: 'Career wins by finish, most decisive first' },
    { label: 'Subs', width: '8%', sort: 'submission', title: 'Rank by submission wins', narrow: true },
    { label: 'Points', width: '8%', sort: 'points', title: 'Rank by wins on points', narrow: true },
    { label: 'Medals', width: '15%', sort: 'medals', title: 'Rank by golds, then silvers, then bronzes' },
    { label: 'Events', width: '8%', sort: 'events', narrow: true },
    { label: 'Per event', width: '8%', sort: 'perEvent', title: 'Wins per event entered', narrow: true },
];
const athleteRow = (club = true) => (a, i, sort) => `<tr data-key="${a.user}">
      <td class="start rank">${i + 1}</td>
      <td class="start">${who(a, { club })}</td>
      <td class="${sort === 'wins' ? 'sorted' : ''}">${num(a.wins)}</td>
      <td class="start">${mix(a.types)}${fromResults(a)}</td>
      <td class="hide-narrow ${sort === 'submission' || sort === 'rate' ? 'sorted' : ''}" title="${a.wins ? `${Math.round((a.submission / a.wins) * 100)}% of counted wins` : ''}">${raw(a.submission, 'submission')}</td>
      <td class="hide-narrow ${sort === 'points' ? 'sorted' : ''}">${raw(a.points, 'points')}</td>
      <td class="${sort === 'medals' ? 'sorted' : ''}">${medals(a.gold, a.silver, a.bronze)}</td>
      <td class="hide-narrow ${sort === 'events' ? 'sorted' : ''}">${a.events == null ? '<span class="muted" title="Event count not read yet">–</span>' : num(a.events)}</td>
      <td class="hide-narrow ${sort === 'perEvent' ? 'sorted' : ''}">${perEvent(a.wins, a.events)}</td>
    </tr>`;

function athletesView() {
  return ranking({
    title: 'Athletes',
    intro: 'Every athlete Mat Stats has read, pooled into one ranking: their Smoothcomp career, or their results at the events read when Smoothcomp serves no career. Choose which finishes count as wins; walkovers start switched off.',
    route: 'athletes', unit: 'athlete', columns: athleteColumns(), row: athleteRow(), sorts: ATHLETE_SORTS,
  });
}

// One academy's athletes under the reader's filters, every one of them.
async function roster(club) {
  const { rows } = await api('athletes', { ...filtersQuery(), sort: 'wins', limit: ALL, club });
  if (!rows.length) return '<p class="muted small roster-empty">No athlete here passes the filters.</p>';
  return `<table class="roster"><tbody>${rows.map((a, i) => `<tr><td class="start rank" style="width:40px">${i + 1}</td><td class="start">${who(a, { club: false })}</td><td style="width:9%">${num(a.wins)}</td>
    <td class="start" style="width:28%">${mix(a.types)}${fromResults(a)}</td><td style="width:16%">${medals(a.gold, a.silver, a.bronze)}</td><td style="width:8%" class="hide-narrow">${a.events == null ? '<span class="muted">–</span>' : num(a.events)}</td></tr>`).join('')}</tbody></table>
    <p class="roster-foot"><a class="ext" href="${link(`/academy/${club}`)}">Academy page</a></p>`;
}

const TEAM_SORTS = [['wins', 'Total wins'], ['average', 'Wins per athlete'], ['athletes', 'Athletes'], ['submission', 'Submissions'], ['medals', 'Career medals'], ['podiums', 'Podiums at events read']];

function academiesView() {
  const columns = [
    { label: '#', width: '52px', align: 'start' },
    { label: 'Academy', width: '24%', align: 'start' },
    { label: 'Athletes', width: '8%', sort: 'athletes', title: 'Athletes with a career that passes the filters' },
    { label: 'Wins', width: '8%', sort: 'wins', title: 'Their career wins added up' },
    { label: 'Per athlete', width: '9%', sort: 'average', narrow: true },
    { label: 'Medals', width: '15%', sort: 'medals', title: 'Their career medals added up' },
    { label: 'Podiums', width: '13%', sort: 'podiums', title: 'Golds, silvers and bronzes at the events Mat Stats has results for', narrow: true },
    { label: 'Top athletes', width: '23%', align: 'start' },
  ];
  return ranking({
    title: 'Academies',
    intro: 'Each academy ranked by its athletes added up, careers or results, under the same filters. Open a row for every athlete behind it. An athlete counts for the academy their latest event lists.',
    route: 'teams', unit: 'academy', columns, sorts: TEAM_SORTS, minimumAthletes: true,
    key: 'club_id', expand: (t) => roster(t.club_id),
    row: (t, i, sort) => `<tr data-key="${t.club_id}" aria-expanded="false">
      <td class="start rank">${i + 1}</td>
      <td class="start"><div class="who-text"><a class="who-name" href="${link(`/academy/${t.club_id}`)}">${esc(t.club ?? `Academy ${t.club_id}`)}</a><span class="who-meta">${t.entered ? plural(t.entered, 'event') + ' with results' : 'No results read yet'}</span></div></td>
      <td class="${sort === 'athletes' ? 'sorted' : ''}">${num(t.athletes)}</td>
      <td class="${sort === 'wins' ? 'sorted' : ''}">${num(t.wins)}</td>
      <td class="hide-narrow ${sort === 'average' ? 'sorted' : ''}">${(t.wins / t.athletes).toFixed(1)}</td>
      <td class="${sort === 'medals' ? 'sorted' : ''}">${medals(t.gold, t.silver, t.bronze)}</td>
      <td class="hide-narrow ${sort === 'podiums' ? 'sorted' : ''}">${medals(t.podium_gold, t.podium_silver, t.podium_bronze)}</td>
      <td class="start"><div class="top3">${t.top.map((a) => `<a href="${link(`/athlete/${a.user}`)}">${avatar(a)}<span>${esc(a.name ?? `Athlete ${a.user}`)}</span><b>${fmt(a.wins)}</b></a>`).join('')}${t.athletes > t.top.length ? `<button type="button" class="all" data-action="expand" aria-label="Show all ${t.athletes} athletes of ${esc(t.club ?? 'this academy')}">All ${t.athletes} athletes</button>` : ''}</div></td>
    </tr>`,
  });
}

async function eventsView() {
  const main = page();
  const columns = [
    { label: 'Date', width: '12%', align: 'start' },
    { label: 'Event', width: '36%', align: 'start' },
    { label: 'Athletes', width: '10%' },
    { label: 'Divisions', width: '10%', narrow: true },
    { label: 'Academies', width: '10%', narrow: true },
    { label: 'Read from', width: '14%', align: 'start' },
  ];
  main.innerHTML = `<div class="head"><div><h1>Events</h1><p>Every event an install has opened on Smoothcomp, newest first. Events with results carry podiums and records; the rest list who entered.</p></div><span class="count"></span></div>
    <div class="ledger"><table>${head(columns)}${skeleton(columns.length, 8)}</table></div>`;
  try {
    const { rows } = await api('events', { limit: 200 });
    main.querySelector('.count').innerHTML = rows.length ? `<b>${fmt(rows.length)}</b> event${rows.length === 1 ? '' : 's'}` : '';
    main.querySelector('tbody').innerHTML = rows.length ? rows.map((e) => `<tr>
      <td class="start quiet">${date(e.start)}</td>
      <td class="start"><div class="who-text"><a class="who-name" href="${link(`/event/${e.event}`)}">${esc(e.title ?? `Event ${e.event}`)}</a><span class="who-meta">${[e.city, e.organiser].filter(Boolean).map(esc).join(' · ')}</span></div></td>
      <td>${num(e.athletes)}</td><td class="hide-narrow">${num(e.divisions)}</td><td class="hide-narrow">${num(e.teams)}</td>
      <td class="start">${e.fought ? 'Results' : '<span class="muted">Entrants only</span>'}</td>
    </tr>`).join('') : `<tr><td colspan="${columns.length}">${empty('No events yet', 'An event appears here once someone with Mat Stats opens its results or participants page on Smoothcomp.')}</td></tr>`;
  } catch (e) {
    main.querySelector('tbody').innerHTML = `<tr><td colspan="${columns.length}">${failed(e)}</td></tr>`;
  }
}

const notFound = (what) => `${empty(`No ${what} here`, `Mat Stats has nothing under this ${what} on ${site() === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}. It may be on the other site, or nobody has read it yet.`)}`;

async function athleteView(user) {
  const main = page();
  main.innerHTML = `<div class="profile"><span class="avatar big"></span><div><span class="shimmer" style="width:240px;height:24px"></span></div></div>`;
  let data;
  try { data = await api('athlete', { id: user }); } catch (e) {
    main.innerHTML = e.status === 404 ? notFound('athlete') : failed(e);
    return;
  }
  const { career, person, entries, seen } = data;
  const a = { user, ...(person ?? {}), ...(career ?? {}), name: person?.name ?? career?.name, hidden: person?.hidden };
  document.title = `${a.name ?? `Athlete ${user}`} · Mat Stats`;
  const academy = a.club ? (a.club_id ? `<a href="${link(`/academy/${a.club_id}`)}">${esc(a.club)}</a>` : esc(a.club)) : null;
  const facts = [
    a.country || a.country_name ? `<span>${flag(a.country, a.country_name)}${esc(a.country_name ?? a.country?.toUpperCase())}</span>` : '',
    BELTS.includes(a.belt) ? `<span>${belt(a.belt)}${a.belt[0].toUpperCase()}${a.belt.slice(1)} belt</span>` : '',
    academy ? `<span>${academy}</span>` : '',
    `<a class="ext" href="${home()}/en/profile/${user}" rel="noopener">Profile on ${site() === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'} ${EXT}</a>`,
  ].filter(Boolean).join('');
  const fought = entries.filter((e) => e.fought);
  const eventWins = fought.reduce((n, e) => n + countWins(e.wins), 0);
  const eventLosses = fought.reduce((n, e) => n + countWins(e.losses), 0);
  main.innerHTML = `<div class="profile">${avatar(a, 'big')}<div><h1>${esc(a.name ?? `Athlete ${user}`)}</h1><div class="facts">${facts}</div></div></div>
    ${career ? `<dl class="tape" style="--n:5">
      <div><dd>${career.source === 'results' ? record(career.wins, career.losses) : fmt(career.wins)}</dd><dt class="label">${career.source === 'results' ? 'Record, counted finishes' : 'Wins counted'}</dt></div>
      <div><dd>${fmt(career.submission)}${career.wins && counted('submission') ? `<span class="note"> · ${Math.round((career.submission / career.wins) * 100)}% of wins</span>` : ''}</dd><dt class="label">Submissions</dt></div>
      <div><dd>${medals(career.gold, career.silver, career.bronze)}</dd><dt class="label">Medals</dt></div>
      <div><dd>${fmt(career.events)}</dd><dt class="label">${career.source === 'results' ? 'Events read' : 'Events entered'}</dt></div>
      <div><dd>${perEvent(career.wins, career.events)}</dd><dt class="label">Wins per event</dt></div>
    </dl>
    <div class="panel">${mix(career.types, { large: true, legend: false })}${keys(career.types)}
      <p class="small muted" style="margin-top:var(--s-3)">${career.source === 'results'
        ? `From results: Smoothcomp serves no career for this ${a.hidden ? 'profile, which it marks not public' : 'athlete yet'}, so these are their wins, losses and placements at the ${plural(career.events, 'event')} Mat Stats has read.`
        : `Career as Smoothcomp lists it, read ${date(new Date(career.at).toISOString())}. Smoothcomp lists no career losses.`}</p></div>`
    : `<div class="panel"><p>${a.hidden ? 'Smoothcomp serves no career for this profile: its page says it is not public.' : 'No career read in the last 30 days. It arrives when someone with Mat Stats opens a participants page this athlete is on.'}${seen ? ` Results pages have shown ${record(seen.wins, seen.losses)} across ${plural(seen.events, 'event')}, walkovers aside.` : ''}</p></div>`}
    <section><div class="head"><div><h2>Events</h2><p>${fought.length ? `${record(eventWins, eventLosses)} at the ${plural(new Set(fought.map((e) => e.event)).size, 'event')} with results here, counting the finishes switched on.` : 'Events this athlete entered that Mat Stats has seen.'}</p></div></div>
    <div class="ledger"><table><thead><tr><th class="start" style="width:12%">Date</th><th class="start" style="width:28%">Event</th><th class="start">Division</th><th class="start hide-narrow" style="width:16%">Academy</th><th style="width:7%">Place</th><th style="width:7%">Record</th></tr></thead><tbody>
    ${entries.length ? entries.map((e, i) => { const first = entries[i - 1]?.event !== e.event; return `<tr class="${first ? '' : 'same'}"><td class="start quiet">${first ? date(e.start) : ''}</td><td class="start">${first ? `<a class="who-name" href="${link(`/event/${e.event}`)}">${esc(e.title ?? `Event ${e.event}`)}</a>` : ''}</td><td class="start quiet">${esc(e.division)}</td>
      <td class="start hide-narrow quiet">${e.club ? (e.club_id ? `<a href="${link(`/academy/${e.club_id}`)}">${esc(e.club)}</a>` : esc(e.club)) : ''}</td><td>${e.fought ? placeChip(e.place) : '<span class="muted small">Entered</span>'}</td><td>${e.fought ? record(countWins(e.wins), countWins(e.losses)) : ''}</td></tr>`; }).join('')
    : `<tr><td colspan="6">${empty('No events seen yet', 'Events appear once someone with Mat Stats opens a results or participants page this athlete is on.')}</td></tr>`}
    </tbody></table></div></section>`;
}

async function academyView(club) {
  const main = page();
  main.innerHTML = `<span class="shimmer" style="width:300px;height:28px"></span>`;
  let data;
  try { data = await api('team', { id: club }); } catch (e) {
    main.innerHTML = e.status === 404 ? notFound('academy') : failed(e);
    return;
  }
  const name = data.club.name ?? `Academy ${club}`;
  document.title = `${name} · Mat Stats`;
  const members = data.members.filter((m) => m.wins != null).sort((a, b) => b.wins - a.wins || (b.gold - a.gold));
  const unread = data.members.filter((m) => m.wins == null);
  const sum = (k) => members.reduce((n, m) => n + (m[k] ?? 0), 0);
  const podium = (k) => data.events.reduce((n, e) => n + e[k], 0);
  const recordOf = (e) => e.records.reduce(([w, l], r) => [w + countWins(r.wins), l + countWins(r.losses)], [0, 0]);
  main.innerHTML = `<div class="profile"><div><h1>${esc(name)}</h1><div class="facts"><span>${plural(data.members.length, 'athlete')} seen</span><a class="ext" href="${home()}/en/club/${club}" rel="noopener">Academy on ${site() === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'} ${EXT}</a></div></div></div>
    <dl class="tape" style="--n:5">
      <div><dd>${fmt(sum('wins'))}</dd><dt class="label">Career wins counted</dt></div>
      <div><dd>${members.length ? (sum('wins') / members.length).toFixed(1) : '–'}</dd><dt class="label">Per athlete</dt></div>
      <div><dd>${medals(sum('gold'), sum('silver'), sum('bronze'))}</dd><dt class="label">Career medals</dt></div>
      <div><dd>${medals(podium('gold'), podium('silver'), podium('bronze'))}</dd><dt class="label">Podiums at events read</dt></div>
      <div><dd>${fmt(data.events.length)}</dd><dt class="label">Events seen</dt></div>
    </dl>
    <section class="members"></section>
    ${unread.length ? `<section><div class="head"><div><h2>Not ranked yet</h2><p>${plural(unread.length, 'athlete')} Mat Stats has seen here with nothing to rank yet: no Smoothcomp career read and no results at an event read. They rank once either arrives.</p></div></div>
    <div class="ledger"><table><tbody>${unread.map((m) => `<tr><td class="start">${who(m, { club: false })}</td><td class="start muted small" style="width:40%">${m.hidden ? 'Profile not public; no results read' : 'Career not read yet'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section><div class="head"><div><h2>Events</h2><p>Where this academy’s athletes competed, as far as Mat Stats has seen.</p></div></div>
    <div class="ledger"><table><thead><tr><th class="start" style="width:12%">Date</th><th class="start">Event</th><th style="width:10%">Athletes</th><th style="width:20%">Podiums</th><th style="width:12%">Record</th></tr></thead><tbody>
    ${data.events.length ? data.events.map((e) => { const [w, l] = recordOf(e); return `<tr><td class="start quiet">${date(e.start)}</td><td class="start"><a class="who-name" href="${link(`/event/${e.event}`)}">${esc(e.title ?? `Event ${e.event}`)}</a></td><td>${num(e.athletes)}</td>
      <td>${e.fought ? medals(e.gold, e.silver, e.bronze) : '<span class="muted small">Entrants only</span>'}</td><td>${e.fought ? record(w, l) : ''}</td></tr>`; }).join('')
    : `<tr><td colspan="5">${empty('No events seen yet', 'Events appear once someone with Mat Stats opens one this academy entered.')}</td></tr>`}
    </tbody></table></div></section>`;
  // Its athletes as a full ranking, under the same filters as every other.
  await ranking({
    host: main.querySelector('.members'), level: 'h2', title: 'Athletes',
    intro: 'Every athlete here with a career or results to rank, under the filters. Change what counts, the belt, the ages or the minimums to re-rank them.',
    route: 'athletes', unit: 'athlete', columns: athleteColumns(false), row: athleteRow(false), sorts: ATHLETE_SORTS, query: () => ({ club }),
  });
}

async function eventView(id) {
  const main = page();
  main.innerHTML = `<span class="shimmer" style="width:360px;height:28px"></span>`;
  let data;
  try { data = await api('event', { id }); } catch (e) {
    main.innerHTML = e.status === 404 ? notFound('event') : failed(e);
    return;
  }
  const { event, entries } = data;
  const title = event.title ?? `Event ${id}`;
  document.title = `${title} · Mat Stats`;
  const fought = entries.some((e) => e.fought);
  const careerOf = (e) => (e.career_wins == null ? null : Object.entries(JSON.parse(e.career_types ?? '{}')).reduce((n, [t, c]) => n + (counted(t) ? c : 0), 0));
  // One row per athlete: their divisions, best place, record here.
  const athletes = [...Map.groupBy(entries, (e) => e.user).values()].map((rows) => ({
    ...rows[0], rows,
    w: rows.reduce((n, r) => n + countWins(r.wins), 0),
    l: rows.reduce((n, r) => n + countWins(r.losses), 0),
    best: Math.min(...rows.map((r) => r.place ?? 999)),
    career: careerOf(rows[0]),
  }));
  const divisions = [...Map.groupBy(entries, (e) => e.division)].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  const academies = [...Map.groupBy(entries.filter((e) => e.club_id || e.club), (e) => e.club_id ?? e.club).values()].map((rows) => ({
    id: rows[0].club_id, name: rows[0].club,
    athletes: new Set(rows.map((r) => r.user)).size,
    g: rows.filter((r) => r.place === 1).length, s: rows.filter((r) => r.place === 2).length, b: rows.filter((r) => r.place === 3).length,
    w: rows.reduce((n, r) => n + countWins(r.wins), 0), l: rows.reduce((n, r) => n + countWins(r.losses), 0),
    career: rows.reduce((n, r) => n + (careerOf(r) ?? 0), 0),
  })).sort(fought ? (a, b) => b.g - a.g || b.s - a.s || b.b - a.b || b.w - a.w : (a, b) => b.career - a.career || b.athletes - a.athletes);
  const matches = athletes.reduce((n, a) => n + a.w, 0);
  const tabs = fought ? [['podiums', 'Podiums', divisions.length], ['academies', 'Academies', academies.length], ['athletes', 'Athletes', athletes.length]]
    : [['athletes', 'Athletes', athletes.length], ['divisions', 'Divisions', divisions.length], ['academies', 'Academies', academies.length]];
  const nameLink = (e) => (e.name ? `<a href="${link(`/athlete/${e.user}`)}">${esc(e.name)}</a>` : `<a class="muted" href="${link(`/athlete/${e.user}`)}">Athlete ${esc(e.user)}</a>`);
  const academyLink = (t) => (t.id ? `<a class="who-name" href="${link(`/academy/${t.id}`)}">${esc(t.name ?? `Academy ${t.id}`)}</a>` : `<span class="who-name">${esc(t.name)}</span>`);
  const panes = {
    podiums: () => `<div class="ledger"><table><thead><tr><th class="start">Division</th><th class="start" style="width:22%">Gold</th><th class="start" style="width:22%">Silver</th><th class="start" style="width:22%">Bronze</th></tr></thead><tbody>
      ${divisions.map((d) => { const at = (p) => d.rows.filter((r) => r.place === p); return `<tr><td class="start"><div class="who-text"><span class="who-name" title="${esc(d.name)}">${esc(d.name)}</span><span class="who-meta">${plural(d.rows.length, 'athlete')}</span></div></td>
        ${[1, 2, 3].map((p) => `<td class="start"><div class="podium">${at(p).map((r) => `<span class="who-line">${placeChip(p)} ${nameLink(r)}</span>`).join('') || '<span class="muted">–</span>'}</div></td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`,
    academies: () => `<div class="ledger"><table><thead><tr><th class="start" style="width:52px">#</th><th class="start">Academy</th><th style="width:12%">Athletes</th>${fought ? '<th style="width:20%">Medals</th><th style="width:14%">Record</th>' : '<th style="width:20%">Career wins</th>'}</tr></thead><tbody>
      ${academies.map((t, i) => `<tr><td class="start rank">${i + 1}</td><td class="start">${academyLink(t)}</td><td>${num(t.athletes)}</td>${fought ? `<td>${medals(t.g, t.s, t.b)}</td><td>${record(t.w, t.l)}</td>` : `<td>${num(t.career)}</td>`}</tr>`).join('')}</tbody></table></div>`,
    athletes: () => {
      const list = [...athletes].sort(fought ? (a, b) => a.best - b.best || b.w - a.w || a.l - b.l : (a, b) => (b.career ?? -1) - (a.career ?? -1));
      return `<div class="ledger"><table><thead><tr><th class="start" style="width:52px">#</th><th class="start">Athlete</th><th class="start hide-narrow" style="width:30%">Division</th>${fought ? '<th style="width:8%">Place</th><th style="width:10%">Record</th>' : ''}<th style="width:12%" title="Career wins of the finish types switched on">Career wins</th></tr></thead><tbody>
      ${list.map((a, i) => `<tr><td class="start rank">${i + 1}</td><td class="start">${who(a)}</td><td class="start hide-narrow"><span class="who-meta" title="${esc(a.rows.map((r) => r.division).join('\n'))}">${esc(a.rows[0].division)}${a.rows.length > 1 ? ` +${a.rows.length - 1}` : ''}</span></td>
        ${fought ? `<td>${placeChip(a.best < 999 ? a.best : null)}</td><td>${record(a.w, a.l)}</td>` : ''}<td>${a.career == null ? '<span class="muted">–</span>' : num(a.career)}</td></tr>`).join('')}</tbody></table></div>`;
    },
    divisions: () => `<div class="ledger"><table><thead><tr><th class="start">Division</th><th style="width:10%">Athletes</th><th class="start" style="width:42%">Strongest entrants, by career wins</th></tr></thead><tbody>
      ${divisions.map((d) => { const top = d.rows.map((r) => ({ ...r, career: careerOf(r) })).filter((r) => r.career != null).sort((a, b) => b.career - a.career).slice(0, 3); return `<tr><td class="start"><span class="who-name" title="${esc(d.name)}">${esc(d.name)}</span></td><td>${num(d.rows.length)}</td>
        <td class="start"><div class="top3">${top.map((r) => `<a href="${link(`/athlete/${r.user}`)}">${avatar(r)}<span>${esc(r.name ?? `Athlete ${r.user}`)}</span><b>${fmt(r.career)}</b></a>`).join('') || '<span class="muted small">No careers read yet</span>'}</div></td></tr>`; }).join('')}</tbody></table></div>`,
  };
  const smoothcomp = `${home()}/en/event/${id}/${fought ? 'results' : 'participants'}`;
  main.innerHTML = `<div class="profile"><div><h1>${esc(title)}</h1><div class="facts">${[date(event.start), [event.city && esc(event.city), event.country && flag(event.country)].filter(Boolean).join(' '), event.organiser && esc(event.organiser), fought ? `${plural(matches, 'match')} won, counted finishes` : 'Entrants only, no results read yet'].filter(Boolean).map((f) => `<span>${f}</span>`).join('')}<a class="ext" href="${smoothcomp}" rel="noopener">On ${site() === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'} ${EXT}</a></div></div></div>
    ${entries.length ? `<div class="tabs" role="tablist">${tabs.map(([k, label, n], i) => `<button type="button" role="tab" id="tab-${k}" aria-controls="pane" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-tab="${k}">${label}<span class="count">${fmt(n)}</span></button>`).join('')}</div><div id="pane" role="tabpanel" aria-labelledby="tab-${tabs[0][0]}">${panes[tabs[0][0]]()}</div>`
    : empty('Nobody listed yet', 'This event’s entrants arrive when someone with Mat Stats opens its participants or results page.')}`;
  const list = main.querySelector('.tabs');
  list?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    for (const b of list.querySelectorAll('[data-tab]')) { b.setAttribute('aria-selected', String(b === tab)); b.tabIndex = b === tab ? 0 : -1; }
    const pane = main.querySelector('#pane');
    pane.setAttribute('aria-labelledby', tab.id);
    pane.innerHTML = panes[tab.dataset.tab]();
  });
  list?.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = [...list.querySelectorAll('[data-tab]')];
    const next = all[(all.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    next.focus();
    next.click();
  });
}

// ── Find: athletes, academies and events by name ────────────────────────────
const find = document.querySelector('#find');
const found = document.querySelector('#found');
let findTimer;
function closeFind() { found.hidden = true; find.setAttribute('aria-expanded', 'false'); }
find.addEventListener('input', () => {
  clearTimeout(findTimer);
  const q = find.value.trim();
  if (q.length < 2) return closeFind();
  findTimer = setTimeout(async () => {
    const r = await api('search', { q }).catch(() => null);
    if (find.value.trim() !== q) return;
    const groups = r ? [
      ['Athletes', r.athletes.map((a) => `<a role="option" href="${link(`/athlete/${a.user}`)}">${avatar(a)}<span>${esc(a.name)}<span class="muted small"> · ${esc(a.club ?? '')}</span></span></a>`)],
      ['Academies', r.teams.map((t) => `<a role="option" href="${link(`/academy/${t.club_id}`)}"><span>${esc(t.club)}<span class="muted small"> · ${plural(t.athletes, 'athlete')}</span></span></a>`)],
      ['Events', r.events.map((e) => `<a role="option" href="${link(`/event/${e.event}`)}"><span>${esc(e.title)}<span class="muted small"> · ${date(e.start)}</span></span></a>`)],
    ].filter(([, items]) => items.length) : [];
    found.innerHTML = groups.length ? groups.map(([label, items]) => `<h4>${label}</h4>${items.join('')}`).join('') : `<p>${r ? `Nothing matches “${esc(q)}”.` : 'Search is unavailable right now.'}</p>`;
    found.hidden = false;
    find.setAttribute('aria-expanded', 'true');
  }, 200);
});
find.addEventListener('keydown', (e) => {
  const options = [...found.querySelectorAll('a')];
  const at = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  if (e.key === 'Escape') { closeFind(); return; }
  if (e.key === 'Enter' && options.length) { e.preventDefault(); (options[at] ?? options[0]).click(); return; }
  if (!['ArrowDown', 'ArrowUp'].includes(e.key) || !options.length) return;
  e.preventDefault();
  const next = (at + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
  options.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
  options[next].scrollIntoView({ block: 'nearest' });
});
document.addEventListener('click', (e) => { if (!e.target.closest('.find')) closeFind(); });

// ── Site switch and routing ─────────────────────────────────────────────────
const sitePick = document.querySelector('#site');
sitePick.addEventListener('change', () => {
  setParams({ site: sitePick.value === 'smoothcomp.com' ? '' : sitePick.value, country: '' });
  // Ids are per site, so a profile page goes back to its list.
  const section = location.pathname.match(/^\/(athlete|academy|event)\//)?.[1];
  if (section) history.replaceState(null, '', link({ athlete: '/', academy: '/academies', event: '/events' }[section]));
  render();
});

const ROUTES = [
  [/^\/(athletes)?$/, athletesView, 'athletes'],
  [/^\/academies$/, academiesView, 'academies'],
  [/^\/events$/, eventsView, 'events'],
  [/^\/athlete\/(\d+)$/, athleteView, 'athletes'],
  [/^\/academy\/(\d+)$/, academyView, 'academies'],
  [/^\/event\/(\d+)$/, eventView, 'events'],
];

async function render() {
  closeFind();
  sitePick.value = site();
  const [pattern, view, section] = ROUTES.find(([re]) => re.test(location.pathname)) ?? [];
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.href = link(a.getAttribute('href').split('?')[0]);
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.querySelector('.mark').href = link('/');
  document.title = section ? `${section[0].toUpperCase()}${section.slice(1)} · Mat Stats` : 'Mat Stats';
  const fresh = mainNode.cloneNode(false); // drop the last view's listeners
  mainNode.replaceWith(fresh);
  mainNode = fresh;
  if (!view) { fresh.innerHTML = empty('No page here', 'Try the athlete ranking instead.', `<a class="button" href="${link('/')}">Athletes</a>`); return; }
  await view(...(location.pathname.match(pattern).slice(1).filter(Boolean)));
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.target) return;
  e.preventDefault();
  if (a.getAttribute('href') !== location.pathname + location.search) history.pushState(null, '', a.getAttribute('href'));
  render().then(() => { scrollTo(0, 0); mainNode.focus({ preventScroll: true }); });
});
addEventListener('popstate', render);
render();
