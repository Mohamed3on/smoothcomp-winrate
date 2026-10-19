// Smoothcomp already ships every bracket of an event in the participants
// payload, then renders four at a time behind infinite scroll. Show them all at
// once, biggest bracket first, and rank each bracket by its athletes' careers.

// A career is one request per athlete, so it is read only for brackets near the
// screen, a whole bracket at once, and kept for a week. Walkovers stay out unless
// switched on in the results page; every other win counts, since this page shows
// no switch that could explain one missing.
const CAREERS = 'careers';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const careers = SCWRSite.store.get(CAREERS, {});
const reading = new Map();
const typesOff = SCWRSite.store.get('results-prefs')?.typesOff;
const counted = (type) => type !== 'walkover' || (Array.isArray(typesOff) && !typesOff.includes(type));
const fresh = (user) => Date.now() - (careers[user]?.at ?? 0) < WEEK;

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

// Most wins first, then most by submission, most by points, and the younger
// athlete; anything still level keeps Smoothcomp's own order. The athletes view
// can lead with submissions or points instead. A career that is unread or hidden
// sorts after every known one, as does an unknown age.
function rank(group, lead = 0) {
  const key = (r) => {
    const t = tally(r.user_id) ?? [-1, -1, -1];
    return [t[lead], ...t, -(r.age ?? Infinity), -place.get(r.id)];
  };
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
  for (const entry of entries) if (entry.isIntersecting && order === null) read(heading(entry.target));
}, { rootMargin: '300px 0px' });

// Two lists in place of the brackets, over every athlete the filters and the age
// range leave. Athletes, one row each, ranked across brackets by career wins, or
// by wins by submission or on points: a row is the athlete's first registration,
// with every division they entered as its registration. Academies, ranked by the
// wins of their athletes' careers added up.
let order = null; // null lists brackets; 'academies' ranks academies; a figure of LEADS ranks athletes
const LEADS = ['wins', 'submission', 'points'];
let view; // the menu that picks it
let youngest = 0;
let oldest = Infinity;
const inAge = (r) => (!youngest && oldest === Infinity) || (Number.isFinite(r.age) && r.age >= youngest && r.age <= oldest);

// Each athlete once, as their first registration the filters leave.
function people() {
  const rows = new Map();
  for (const r of vm.participants.flatMap((g) => g.registrations)) {
    if (!r.filtered && inAge(r) && !rows.has(r.user_id ?? r.id)) rows.set(r.user_id ?? r.id, r);
  }
  return [...rows.values()];
}

function athletes() {
  const entries = Map.groupBy(vm.all.flatMap((g) => g.registrations.map((r) => [r, g.name])), ([r]) => r.user_id ?? r.id);
  const registrations = people().map((r) => {
    const mine = entries.get(r.user_id ?? r.id);
    return { ...r, approved: +mine.some(([e]) => e.approved === 1), categories: mine.map(([, name], i) => ({ category_value_id: i, value: name })) };
  });
  const name = plural(registrations.length, 'athlete');
  return draining
    ? { id: 'scwr-athletes', name: `${name}, reading careers…`, registrations }
    : { id: 'scwr-athletes', name, registrations: rank({ registrations }, LEADS.indexOf(order)) };
}

// Each academy with its athletes' careers added up: counted wins, by submission
// and on points, and medals. A hidden career adds nothing.
function academies() {
  const list = [...Map.groupBy(people(), (r) => r.club_id || r.clubName).values()].map((rows) => {
    const known = rows.filter((r) => tally(r.user_id));
    const sum = (figures) => known.reduce((total, r) => total.map((n, i) => n + figures(r)[i]), [0, 0, 0]);
    return { rows, known, tally: sum((r) => tally(r.user_id)), medals: sum((r) => careers[r.user_id].medals) };
  });
  return draining ? list : list.sort((a, b) => b.tally.reduce((order, n, i) => order || n - a.tally[i], 0) || a.rows[0].clubName.localeCompare(b.rows[0].clubName));
}

// Smoothcomp draws the athletes; the extension draws the academies, in Smoothcomp's
// own row markup so its styles apply. The academy icon stands for a photo, then
// come the name and most common country, the athletes, the most common
// affiliation, the careers added up, and the athletes who carry them, most wins first.
let box; // where the academies are drawn, under Smoothcomp's own list
const common = (rows, key) => [...Map.groupBy(rows.filter((r) => r[key]), (r) => r[key]).values()].sort((a, b) => b.length - a.length)[0]?.[0];

function academy({ rows, known, tally: t, medals }) {
  const home = common(rows, 'cn');
  const team = common(rows, 'affiliation_id');
  const hidden = rows.filter((r) => r.user_id && fresh(r.user_id)).length - known.length;
  const roster = rank({ registrations: known }).slice(0, 10).map((r) => `<div><div>${esc(`${r.firstname} ${r.lastname}`)} ${tally(r.user_id)[0]}</div></div>`).join('')
    + (known.length > 10 ? `<div><div>${known.length - 10} more</div></div>` : '');
  return '<div class="profile-card"><div class="participant-tr participant-tr-main flex-center"><div class="participant-td participant-td-athlete">'
    + '<div class="profile-image-wrapper scwr-crest"><span class="icon-academy"></span></div><div class="profile-card-name font-size-medium truncate">'
    + `<a class="truncate block" href="${rows[0].club_url}"><span>${esc(rows[0].clubName)}</span></a>`
    + (home ? `<div class="profile-country truncate flex-center" style="height: auto"><span class="flag-icon margin-right-xs-4 flag-icon-${home.cn.toLowerCase()}"></span>`
      + `<div class="truncate muted country-name"><span class="font-size-tiny">${esc(home.country)}</span></div></div>` : '')
    + `</div></div><div class="participant-td participant-td-birth"><div>${rows.length}</div>${hidden ? `<div class="muted font-size-tiny">${hidden} hidden</div>` : ''}</div>`
    + `<div class="participant-td participant-td-club">${team ? `<a class="truncate block" href="${team.affiliation_url}">${esc(team.affiliationName)}</a>` : ''}</div>`
    + `<div class="participant-td scwr-career">${known.length ? figures(t, medals) : draining ? PLACEHOLDER.repeat(COLUMNS.length) : '<div class="muted">Hidden profiles</div>'}</div>`
    + `<div class="participant-td participant-td-registration">${roster}</div></div></div>`;
}

function drawAcademies() {
  const list = academies();
  const name = plural(list.length, 'academy', 'academies');
  box.innerHTML = list.length ? `<div class="margin-bottom-xs-64"><div class="heading-container flex-center"><h2 class="group-name margin-xs-0">${draining ? `${name}, reading careers…` : name}</h2></div>`
    + '<div class="participants-table-head participant-tr muted margin-bottom-xs-8 participants-desktop"><span class="participant-td participant-td-athlete padding-left-xs-0 margin-right-xs-4">Academy</span>'
    + '<span class="participant-td participant-td-birth">Athletes</span><span class="participant-td participant-td-club">Affiliation</span>'
    + `<span class="participant-td scwr-career">${COLUMNS.map((label) => `<span>${label}</span>`).join('')}</span></div>`
    + `<div class="profile-cards participants-desktop">${list.map(academy).join('')}</div></div>` : '';
}

// Academies are drawn with everything else on screen; Smoothcomp's list stands empty.
function show() {
  if (order === 'academies') {
    vm.visible = [];
    return queue();
  }
  const rows = new Map([...document.querySelectorAll('#registrations .profile-card')].map((row) => [row, row.getBoundingClientRect().top]));
  const group = athletes();
  vm.visible = group.registrations.length ? [Object.freeze([group])] : [];
  vm.$nextTick(() => { slide(rows); queue(); });
}

// Opening either reads every career it still lacks, twelve at a time. Until the
// last one lands, the heading says so and the rows keep the page's own order,
// filling in as a bracket's do; then the list ranks.
const pending = new Set();
let draining = null;
function ranking() {
  for (const r of people()) if (r.user_id && !fresh(r.user_id)) pending.add(String(r.user_id));
  if (pending.size) {
    draining ??= Promise.all(Array.from({ length: 12 }, async () => {
      for (const user of pending) {
        pending.delete(user);
        await readCareer(user);
        queue();
      }
    })).then(() => {
      draining = null;
      save();
      if (order !== null) show();
    });
  }
  show();
}

// The registration column only repeats the bracket title, so the career takes
// its place; participants.css hides the original. Each column is drawn like
// Smoothcomp's own: a figure over a muted line, as the birth year sits over the age.
const COLUMNS = ['Wins', 'Medals'];
const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
// A zero steps back to Smoothcomp's muted ink, so the eye lands on the figures that count.
const column = (n, figure, line) => `<div><div${n ? '' : ' class="muted"'}>${figure}</div><div class="muted font-size-tiny">${line}</div></div>`;
const figures = (t, [gold, silver, bronze]) => column(t[0], `<b>${t[0]}</b>`, `${plural(t[1], 'sub')} · ${t[2]} pts`)
  + (gold + silver + bronze ? column(gold, `${gold} gold`, `${silver} silver · ${bronze} bronze`) : '<div class="muted">No medals</div>');
// The placeholder takes the shape of what replaces it, so nothing moves when it lands.
const PLACEHOLDER = '<div><div><i class="scwr-pulse"></i></div><div class="font-size-tiny"><i class="scwr-pulse"></i></div></div>';

function draw(cell, user) {
  const t = user && tally(user);
  const medals = t && careers[user].medals;
  const state = user === 'head' ? user : t ? `${t}|${medals}` : !user ? '' : fresh(user) ? 'hidden' : reading.has(user) || pending.has(user) ? 'reading' : '';
  if (cell.dataset.state === state) return;
  cell.dataset.state = state;
  cell.title = '';
  if (state === 'head') {
    cell.innerHTML = COLUMNS.map((label) => `<span>${label}</span>`).join('');
  } else if (t) {
    cell.innerHTML = figures(t, medals);
    const by =(keep) => Object.entries(careers[user].wins).filter(([type]) => counted(type) === keep)
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
  if (order === 'academies') drawAcademies(); else if (box.firstChild) box.replaceChildren();
  painter.observe(document.querySelector('#registrations'), { childList: true, subtree: true });
}

let queued = false;
const painter = new MutationObserver(queue);
function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(); });
}

// Over the list, the biggest brackets the signed-in athlete could enter and would
// top-seed. Their gender and birth date come from their settings and their belt
// from their profile, kept a week; their weight is theirs to give, kept per site.
// Who is signed in is known once the list mounts: Cloudflare's Rocket Loader runs
// the page's inline scripts, `window.userId` among them, after this one.
let me;
const esc = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
let panel;
let picking = 0;

async function profile() {
  const kept = SCWRSite.store.get('profile');
  if (kept?.user === me && Date.now() - kept.at < WEEK) return kept;
  const get = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r : Promise.reject(r.status)));
  const [settings, skills] = await Promise.all([
    get(SCWRSite.url.settings(me)).then((r) => r.text()),
    get(SCWRSite.url.skills(me)).then((r) => r.json()),
  ]);
  const field = (label) => settings.match(new RegExp(`label="${label}"[^>]*?value="([^"]*)"`))?.[1];
  const found = {
    user: me,
    at: Date.now(),
    gender: field('Gender')?.[0],
    birth: field('Birthdate'),
    belt: skills.data?.find((skill) => /jiu|bjj/i.test(skill.name))?.belt?.toLowerCase(),
  };
  if (!found.gender || !found.birth) throw new Error('unreadable settings');
  SCWRSite.store.set('profile', found);
  return found;
}

function age(birth) {
  const born = new Date(birth);
  const now = new Date();
  return now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
}

// Six careers in flight at most, however many brackets are eligible.
async function pool(users) {
  const waiting = [...users];
  await Promise.all(Array.from({ length: 6 }, async () => { while (waiting.length) await readCareer(waiting.shift()); }));
}

function mount() {
  panel = document.createElement('div');
  panel.className = 'container container-fluid-large scwr-picks';
  panel.innerHTML = `<div class="scwr-picks-head"><h6>Brackets you'd top-seed</h6><span class="scwr-picks-wins"></span>`
    + '<label><input type="number" min="20" max="250" step="0.1" placeholder="Weight"><span class="muted">kg</span></label></div><div></div>';
  const list = document.querySelector('#registrations');
  panel.dataset.scwrTheme = SCWRSite.theme(list);
  list.before(panel);
  const input = panel.querySelector('input');
  input.value = SCWRSite.store.get('weight') ?? '';
  input.addEventListener('change', () => { SCWRSite.store.set('weight', +input.value || null); pick(); });
  // From the athletes view, a pick goes back to the brackets before scrolling to its own.
  panel.lastChild.addEventListener('click', (event) => {
    const name = event.target.closest('[data-name]')?.dataset.name;
    if (!name) return;
    if (order !== null) {
      view.value = '';
      view.dispatchEvent(new Event('change'));
    }
    vm.$nextTick(() => {
      const group = [...document.querySelectorAll('#registrations .participant-group')].find((g) => heading(g) === name);
      group?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });
}

async function pick() {
  const run = ++picking;
  const say = (html) => { if (run === picking) panel.lastChild.innerHTML = html; };
  const weight = SCWRSite.store.get('weight');
  if (!weight) return say('');
  say('<p class="muted">Reading careers…</p>');
  let you;
  try {
    you = await profile();
  } catch {
    return say('<p class="muted">Smoothcomp would not share your profile.</p>');
  }
  if (!you.belt) return say('<p class="muted">Your Smoothcomp profile has no BJJ belt.</p>');
  const athlete = { id: me, gender: you.gender, belt: you.belt, age: age(you.birth), weight };
  const groups = SCWRPicks.eligible(vm.all, new Map((vm.categories ?? []).map((c) => [c.id, c])), athlete);
  const users = new Set([me, ...groups.flatMap((g) => g.registrations.map((r) => r.user_id && String(r.user_id)))]);
  await pool([...users].filter((user) => user && !fresh(user)));
  save();
  athlete.tally = tally(me);
  if (!athlete.tally) return say('<p class="muted">Smoothcomp would not share your record.</p>');
  if (run === picking) panel.querySelector('.scwr-picks-wins').textContent = plural(athlete.tally[0], 'win');
  const { top, closest } = SCWRPicks.picks(groups, athlete, tally);
  // A bracket already entered wears the accent and says so beside its name.
  const row = (s, lead) => `<button type="button" class="scwr-pick${s.entered ? ' scwr-entered' : ''}" data-name="${esc(s.group.name)}">`
    + `<span><span title="${esc(s.group.name)}">${esc(s.group.name)}</span>${s.entered ? '<span class="scwr-entered-label">Entered</span>' : ''}</span>`
    + `<span>${plural(s.size, 'athlete')}</span>`
    + `<span class="muted">${[lead, s.hidden && `${s.hidden} hidden`].filter(Boolean).join(' · ')}</span></button>`;
  const gap = closest && closest.rival - athlete.tally[0];
  say(top.length ? top.map((s) => row(s, s.rival !== null && `next best ${plural(s.rival, 'win')}`)).join('')
    : `<p class="muted">No eligible bracket you'd top-seed${closest ? ' — closest:' : '.'}</p>`
      + (closest ? row(closest, gap ? `${plural(gap, 'win')} short` : 'level on wins') : ''));
}

// The list is fetched after mount, so wait for it to land — a large entry list on
// a slow connection takes a while, but not forever.
SCWRSite.vm.find('#registrations', (c) => c.proxy?.all?.length, { timeout: 60000 }).then((found) => {
  if (!found) return;
  vm = found;
  place = new Map(vm.all.flatMap((g) => g.registrations.map((r, i) => [r.id, i])));
  // Smoothcomp hides a bracket's unapproved athletes unless a search is on, and
  // that is all `isSearching` decides. Keeping it on shows them; participants.css marks them.
  Object.defineProperty(vm.$.ctx, 'isSearching', { get: () => true });
  // Brackets whose every career is already kept are ranked before the first draw.
  for (const g of vm.all) if (g.registrations.every((r) => !r.user_id || fresh(r.user_id))) ranked.add(g.name);
  // Every filter path — search, country, quick filter — funnels through here,
  // and each one rebuilds `visible` from the first chunk alone.
  SCWRSite.vm.after(vm, 'updateResults', () => {
    if (order === null) vm.visible = vm.chunks.slice(); else ranking();
    vm.nextChunk = vm.chunks.length; // leaves the scroll handler nothing to do
  });
  // `participants` maps `all` in order, so sorting the source sorts the filtered
  // views too. The array is frozen; sort a copy.
  vm.all = Object.freeze([...vm.all].sort((a, b) => b.registrations.length - a.registrations.length)
    .map((g) => (ranked.has(g.name) ? { ...g, registrations: rank(g) } : g)));
  vm.updateResults();
  queue();
  // Beside the page title, which list to show: the brackets, every athlete, or
  // every academy; and for the last two, an age range, open at either end.
  const list = document.querySelector('#registrations');
  view = document.createElement('select');
  view.className = 'scwr-view';
  view.dataset.scwrTheme = SCWRSite.theme(list);
  view.setAttribute('aria-label', 'List');
  view.innerHTML = '<option value="">Brackets, biggest first</option><hr><option value="wins">Athletes, most wins</option>'
    + '<option value="submission">Athletes, most submission wins</option><option value="points">Athletes, most wins on points</option>'
    + '<hr><option value="academies">Academies, most wins</option>';
  const ages = document.createElement('div');
  ages.className = 'scwr-ages';
  ages.dataset.scwrTheme = view.dataset.scwrTheme;
  ages.hidden = true;
  ages.setAttribute('role', 'group');
  ages.setAttribute('aria-label', 'Age');
  ages.innerHTML = '<span>Age</span><input type="number" min="0" max="120" placeholder="Any" aria-label="From">'
    + '<span>–</span><input type="number" min="0" max="120" placeholder="Any" aria-label="To">';
  const title = list.parentElement.querySelector('h1');
  if (title) title.after(view, ages); else list.before(view, ages);
  box = document.createElement('div');
  box.className = 'container container-fluid-large';
  list.append(box);
  view.addEventListener('change', () => {
    order = view.value || null;
    if (order === null) pending.clear();
    list.classList.toggle('scwr-ranked', order !== null);
    ages.hidden = order === null;
    vm.updateResults();
  });
  // Typed either way round, the range reads low to high; it applies once typing pauses.
  let typing;
  ages.addEventListener('input', () => {
    const [from, to] = [...ages.querySelectorAll('input')].map((input) => (input.value === '' ? null : Math.max(0, +input.value)));
    youngest = Math.min(from ?? 0, to ?? Infinity);
    oldest = Math.max(from ?? 0, to ?? Infinity);
    clearTimeout(typing);
    typing = setTimeout(() => order !== null && ranking(), 400);
  });
  me = window.userId && String(window.userId);
  if (me) {
    mount();
    pick();
  }
});
