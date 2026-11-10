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
  for (const user of Object.keys(ranks)) if (Date.now() - ranks[user].at >= WEEK) delete ranks[user];
  SCWRSite.store.set('ranks', ranks);
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
let first; // each bracket's index in Smoothcomp's own order
const ranked = new Set();

// Most wins first, then most by submission, most by points, and the younger
// athlete; anything still level keeps Smoothcomp's own order. The athletes view
// can lead with submissions instead. A career that is unread or hidden
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

// The medal a bracket's ranking points to at each place: first gold, second
// silver, third bronze; a fourth place wins nothing. A call is sure when the
// athlete's wins are known and no one else in it has as many; a tie, or a career
// of their own not known, makes it a ring. A hidden rival ranks last, as in the
// bracket, rather than clouding every call beside them.
const MEDALS = ['gold', 'silver', 'bronze'];
function calls(rows) {
  const wins = rows.map((r) => tally(r.user_id)?.[0]);
  return rows.map((r, i) => i < 3 && {
    medal: i,
    sure: rows.length === 1 || (wins[i] !== undefined && wins.every((w, j) => j === i || w !== wins[i])),
  });
}
const dot = (call) => (call ? `<i class="scwr-medal" data-medal="${MEDALS[call.medal]}"${call.sure ? '' : ' data-tied'}></i>` : '');

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

// How stacked each bracket is: its athletes' counted career wins added up, and
// per athlete whose career is known. Brackets sharing a name count together.
function strengths(groups = vm.all) {
  return new Map([...Map.groupBy(groups, (g) => g.name)].map(([name, groups]) => {
    const known = groups.flatMap((g) => g.registrations).map((r) => r.user_id && tally(r.user_id)).filter(Boolean);
    const wins = known.reduce((sum, t) => sum + t[0], 0);
    return [name, [wins, known.length && wins / known.length]];
  }));
}

// Biggest bracket first, or the most stacked: most wins, then most per athlete;
// anything level keeps Smoothcomp's own order.
let stack = false;
function arrange(groups) {
  const strength = stack && strengths(groups);
  return groups.map((g) => {
    return [g, [...(strength ? strength.get(g.name) : []), g.registrations.length, -first.get(g.name)]];
  }).sort(([, a], [, b]) => a.reduce((order, x, i) => order || b[i] - x, 0)).map(([g]) => g);
}

// A stacked order needs every career in the event, read as the athletes view
// reads them; the brackets reorder once the last one lands.
function stacking() {
  for (const g of vm.all) for (const r of g.registrations) if (r.user_id && !fresh(r.user_id)) pending.add(String(r.user_id));
  drain();
  if (draining) queue(); else restack();
}

// Unapproved athletes are shown, faded, unless the page is switched to approved
// only; then they leave the data, so every count, ranking and pick leaves them out
// too, and a bracket left empty goes.
let source; // every bracket as the payload has it
let approvedOnly = SCWRSite.store.get('approved-only', false);
function admit() {
  const groups = source.map((g) => ({ ...g, registrations: g.registrations.filter((r) => !approvedOnly || r.approved === 1) }))
    .filter((g) => g.registrations.length || !approvedOnly);
  vm.all = Object.freeze(arrange(groups.map((g) => (ranked.has(g.name) ? { ...g, registrations: rank(g) } : g))));
}

function restack() {
  const groups = () => document.querySelectorAll('#registrations .participant-group');
  const before = tops(groups(), heading);
  for (const g of vm.all) ranked.add(g.name);
  vm.all = Object.freeze(arrange(vm.all.map((g) => ({ ...g, registrations: rank(g) }))));
  vm.updateResults();
  vm.$nextTick(() => slide(moved(before, groups(), heading)));
}

// A row that changes place slides there. One coming from more than a screen away
// fades in where it lands instead, so nothing streaks across the page, and with
// less motion every row does. A row with nowhere to come from just appears.
function slide(rows) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const [row, top] of rows) {
    const shift = top - row.getBoundingClientRect().top;
    if (!shift || !row.isConnected) continue;
    if (still || Math.abs(shift) > innerHeight) row.animate({ opacity: [0, 1] }, { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    else row.animate({ transform: [`translateY(${shift}px)`, 'none'] }, { duration: 280, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
  }
}

// Rows drawn afresh slide from where the row of the same name stood.
const tops = (rows, key) => new Map([...rows].map((row) => [key(row), row.getBoundingClientRect().top]));
const moved = (before, rows, key) => new Map([...rows].map((row) => [row, before.get(key(row))]));

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
// by wins by submission: a row is the athlete's first registration,
// with every division they entered as its registration. Academies, ranked by the
// wins of their athletes' careers added up.
let order = null; // null lists brackets; 'academies' ranks academies; a figure of LEADS ranks athletes
const LEADS = ['wins', 'submission'];
let view; // the menu that picks it
let youngest = 0;
let oldest = Infinity;
const inAge = (r) => (!youngest && oldest === Infinity) || (Number.isFinite(r.age) && r.age >= youngest && r.age <= oldest);
// The belts picked, kept per site; none picked, or every one offered, leaves every
// athlete in, a belt still unknown included.
const belts = new Set(SCWRSite.store.get('belts', []));
let offered = [];
const inBelt = (r) => !belts.size || offered.every((b) => belts.has(b)) || belts.has(belt(r.user_id ?? r.id));

// The belts the athletes every other filter leaves wear, rank order, each a
// toggle; a belt picked stays offered, so nothing is filtered out unseen.
let picker;
function offerBelts() {
  const worn = new Set(people(false).map((r) => belt(r.user_id ?? r.id)));
  offered = BELTS.filter((b) => worn.has(b) || belts.has(b));
  if (picker.dataset.offered === String(offered)) return;
  picker.dataset.offered = offered;
  picker.innerHTML = '<span>Belt</span>' + offered.map((b) => `<button type="button" aria-pressed="${belts.has(b)}"`
    + ` title="${b[0].toUpperCase()}${b.slice(1)}"><i class="scwr-belt" data-belt="${b}"></i></button>`).join('');
}

// Each athlete once, as their first registration the filters leave.
function people(byBelt = true) {
  const rows = new Map();
  for (const r of vm.participants.flatMap((g) => g.registrations)) {
    if (!r.filtered && inAge(r) && (!byBelt || inBelt(r)) && !rows.has(r.user_id ?? r.id)) rows.set(r.user_id ?? r.id, r);
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

// A division under an athlete opens its bracket over the list: everyone in it,
// ranked as the brackets view ranks them, the athlete it was opened from marked,
// and Smoothcomp's own bracket once it is drawn. Careers the list did not need,
// say an age the range left out, are read while it is open. An athlete resting
// under the pointer in an academy's roster shows each of their brackets the same way.
let sheet; // the bracket, a popover
let shown; // the division or roster athlete it was opened from

function bracket(names, user) {
  const missing = [];
  sheet.innerHTML = names.map((name) => {
    const groups = vm.all.filter((g) => g.name.trim() === name);
    const rows = rank({ registrations: groups.flatMap((g) => g.registrations) });
    const called = calls(rows);
    const drawn = groups.find((g) => g.bracket_id)?.bracket_id;
    const career = (r) => {
      const t = r.user_id && tally(r.user_id);
      if (t) return `<span><b>${t[0]}</b> ${t[0] === 1 ? 'win' : 'wins'}<span class="muted font-size-tiny">${plural(t[1], 'sub')} · ${t[2]} pts</span></span>`;
      return `<span class="muted">${!r.user_id ? '' : fresh(r.user_id) ? 'Hidden' : '<i class="scwr-pulse"></i>'}</span>`;
    };
    missing.push(...rows.map((r) => r.user_id && String(r.user_id)).filter((u) => u && !fresh(u)));
    return `<section><header><strong>${esc(name)}</strong><p class="muted">${plural(rows.length, 'athlete')}`
      + (drawn ? ` · <a href="${SCWRSite.url.bracket(SCWRSite.eventId(), drawn)}" target="_blank">Open bracket</a>` : '')
      + '</p></header><ol>' + rows.map((r, i) => `<li${String(r.user_id) === user ? ' class="scwr-this"' : ''}${r.approved === 1 ? '' : ' title="Not approved" data-unapproved'}>`
        + `<span class="muted">${i + 1}</span>${dot(called[i])}<span>${r.user_id ? `<a href="${SCWRSite.url.profile(r.user_id)}">` : '<span>'}${esc(`${r.firstname} ${r.lastname}`)}${r.user_id ? '</a>' : '</span>'}`
        + `<span class="muted font-size-tiny">${esc(r.clubName ?? '')}</span></span>${career(r)}</li>`).join('') + '</ol></section>';
  }).join('');
  return missing;
}

function reveal(source, names, user) {
  shown = source;
  const missing = bracket(names, user);
  sheet.showPopover({ source });
  if (missing.length) Promise.all(missing.map(readCareer)).then(() => { save(); if (shown === source) bracket(names, user); });
}

function open(division) {
  const again = shown === division;
  if (sheet.matches(':popover-open')) sheet.hidePopover();
  shown?.removeAttribute('aria-expanded');
  shown = null;
  if (again) return;
  division.setAttribute('aria-expanded', 'true');
  reveal(division, [division.textContent.trim()],
    SCWRSite.profileId(division.closest('.profile-card')?.querySelector('a[href*="/profile/"]')?.getAttribute('href')));
}

// A roster athlete's brackets show after a short rest and stay while the pointer
// crosses into them; moving to another athlete swaps them after a brief pause, so
// passing over a neighbour on the way into them keeps them.
let resting;
let aimed;
function hover(link) {
  if (link === aimed) return;
  aimed = link;
  clearTimeout(resting);
  const peeking = box.contains(shown);
  if (link === shown || (!link && !peeking)) return;
  resting = setTimeout(() => {
    // Swapping one athlete's brackets for another's skips the drop.
    sheet.toggleAttribute('data-swap', Boolean(link) && sheet.matches(':popover-open'));
    if (sheet.matches(':popover-open')) sheet.hidePopover();
    if (!link) return;
    const user = SCWRSite.profileId(link.getAttribute('href'));
    reveal(link, [...new Set(vm.all.filter((g) => g.registrations.some((r) => String(r.user_id) === user)).map((g) => g.name.trim()))], user);
  }, link && !peeking ? 350 : 150);
}

// Each athlete's medal calls, one per bracket they would place in, gold first,
// each naming its bracket.
let foreseen = new Map();
const id = (r) => String(r.user_id ?? r.id);
function foresee() {
  foreseen = new Map();
  for (const [name, groups] of Map.groupBy(vm.all, (g) => g.name.trim())) {
    const rows = rank({ registrations: groups.flatMap((g) => g.registrations) });
    calls(rows).forEach((call, i) => call && foreseen.set(id(rows[i]), [...foreseen.get(id(rows[i])) ?? [], { ...call, name }]));
  }
  for (const list of foreseen.values()) list.sort((a, b) => a.medal - b.medal);
}

// Each academy with its athletes' careers added up: counted wins, by submission
// and on points, and medals, then the medals their brackets point to. A hidden
// career adds nothing.
function academies() {
  foresee();
  const list = [...Map.groupBy(people(), (r) => r.club_id || r.clubName).values()].map((rows) => {
    const known = rows.filter((r) => tally(r.user_id));
    const sum = (figures) => known.reduce((total, r) => total.map((n, i) => n + figures(r)[i]), [0, 0, 0]);
    const expected = [0, 0, 0];
    for (const r of rows) for (const call of foreseen.get(id(r)) ?? []) expected[call.medal]++;
    return { rows, known, tally: sum((r) => tally(r.user_id)), medals: sum((r) => careers[r.user_id].medals), expected };
  });
  return draining ? list : list.sort((a, b) => b.tally.reduce((order, n, i) => order || n - a.tally[i], 0) || a.rows[0].clubName.localeCompare(b.rows[0].clubName));
}

// Smoothcomp draws the athletes; the extension draws the academies, in Smoothcomp's
// own row markup so its styles apply. The photo's tile holds the academy's place
// once the list ranks, then come the name and most common country, the athletes,
// the most common affiliation, the careers added up, and under them every athlete,
// most wins first: a grid of wins beside names, the first few until shown in full.
let box; // where the academies are drawn, under Smoothcomp's own list
const common = (rows, key) => [...Map.groupBy(rows.filter((r) => r[key]), (r) => r[key]).values()].sort((a, b) => b.length - a.length)[0]?.[0];
const expanded = new Set(); // academies whose every athlete is shown
let revealed = null; // the academy just shown in full, whose added names fade in once
let glide = null; // where each academy stood before the list ranked again
const FEW = 9;
const club = (card) => card.dataset.academy;

// An athlete's belt is the first one belt any of their registrations' belt or
// level names: "All belts" or a no-gi "Purple/Brown/Black" name no single belt, so
// the gi division beside it decides. An athlete with only those wears the latest
// BJJ belt their profile lists, read once and kept a week; with none there either,
// no belt.
const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
const oneBelt = (text) => {
  const named = BELTS.filter((b) => new RegExp(`\\b${b}`, 'i').test(text.replace(/gray/i, 'grey')));
  return named.length === 1 ? named[0] : null;
};
const ranks = SCWRSite.store.get('ranks', {}); // a user's profile belt, as { at, belt }
const needsRank = (user) => !belt(user) && Date.now() - (ranks[user]?.at ?? 0) >= WEEK;
async function readRank(user) {
  const response = await fetch(SCWRSite.url.skills(user), { credentials: 'include' }).catch(() => null);
  if (!response || response.status === 429 || response.status >= 500) return;
  const skills = response.ok ? (await response.json().catch(() => null))?.data ?? [] : [];
  const latest = skills.filter((skill) => /jiu|bjj/i.test(skill.name)).sort((a, b) => b.sort_order - a.sort_order)[0];
  ranks[user] = { at: Date.now(), belt: latest?.belt && oneBelt(latest.belt) };
}
let beltOf;
function belt(key) {
  if (!beltOf) {
    const values = new Map((vm.categories ?? []).filter((c) => /belt|level|rank|grade/i.test(c.category_name)).map((c) => {
      return [c.id, oneBelt(c.name)];
    }));
    beltOf = new Map();
    for (const e of source.flatMap((g) => g.registrations)) {
      const key = String(e.user_id ?? e.id);
      if (!beltOf.get(key)) beltOf.set(key, e.categories?.map((c) => values.get(c.category_value_id)).find(Boolean));
    }
  }
  return beltOf.get(String(key)) || ranks[key]?.belt;
}

// Each athlete: wins, then their photo or initials, wearing a filled dot once
// approved and a hollow one until then, the name, belt and age.
function member(r) {
  const t = r.user_id && tally(r.user_id);
  const hidden = r.user_id && !t && fresh(r.user_id);
  const wins = t ? `<b${t[0] ? '' : ' class="muted"'}>${t[0]}</b>` : `<b class="muted">${hidden ? '–' : ''}</b>`;
  const tag = r.user_id ? 'a' : 'span';
  const name = esc(`${r.firstname} ${r.lastname}`);
  const grade = belt(r.user_id ?? r.id);
  const approved = r.approved === 1;
  const called = foreseen.get(id(r)) ?? [];
  const face = r.profile_image_id && r.profile_image ? `<img src="${esc(r.profile_image)}" alt="" loading="lazy" decoding="async">`
    : esc([r.firstname, r.lastname].map((part) => String(part ?? '').trim().charAt(0)).join('').toUpperCase());
  const about = [name, t ? plural(t[0], 'career win') : hidden && 'hidden profile', grade && `${grade} belt`,
    called.length && `expected ${MEDALS.map((m, i) => [called.filter((c) => c.medal === i).length, m]).filter(([n]) => n).map((pair) => pair.join(' ')).join(', ')}`,
    Number.isFinite(r.age) && `${r.age} years old`, !approved && 'not approved'].filter(Boolean).join(', ');
  return `<${tag}${r.user_id ? ` href="${SCWRSite.url.profile(r.user_id)}"` : ''}${String(r.user_id) === me ? ' class="scwr-you"' : ''}`
    + `${approved ? '' : ' data-unapproved'} aria-label="${about}">${wins}<i class="scwr-face"${approved ? ' data-approved' : ''}>${face}</i><span>${name}</span>`
    + (called.length ? `<i class="scwr-medals">${called.map(dot).join('')}</i>` : '')
    + `<i class="scwr-belt"${grade ? ` data-belt="${grade}"` : ''}></i>${Number.isFinite(r.age) ? `<small>${r.age}y</small>` : ''}</${tag}>`;
}

function academy({ rows, known, tally: t, medals, expected }, i) {
  const home = common(rows, 'cn');
  const team = common(rows, 'affiliation_id');
  const hidden = rows.filter((r) => r.user_id && fresh(r.user_id)).length - known.length;
  const key = String(rows[0].club_id || rows[0].clubName);
  const all = rank({ registrations: rows });
  const full = expanded.has(key);
  const roster = (full || all.length <= FEW + 1 ? all : all.slice(0, FEW)).map(member).join('')
    + (all.length > FEW + 1 ? `<button type="button" class="scwr-more" data-academy="${esc(key)}" aria-expanded="${full}">${full ? 'Show fewer' : `Show all ${all.length}`}</button>` : '');
  return `<div class="profile-card" data-academy="${esc(key)}"><div class="participant-tr participant-tr-main flex-center"><div class="participant-td participant-td-athlete">`
    + `<div class="profile-image-wrapper scwr-crest">${draining ? '<span class="icon-academy"></span>' : `<b>${i + 1}</b>`}</div><div class="profile-card-name font-size-medium truncate">`
    + `<a class="truncate block" href="${esc(rows[0].club_url)}"><span>${esc(rows[0].clubName)}</span></a>`
    + (home ? `<div class="profile-country truncate flex-center" style="height: auto"><span class="flag-icon margin-right-xs-4 flag-icon-${esc(home.cn.toLowerCase())}"></span>`
      + `<div class="truncate muted country-name"><span class="font-size-tiny">${esc(home.country)}</span></div></div>` : '')
    + `</div></div><div class="participant-td participant-td-birth"><div>${rows.length}</div>${hidden ? `<div class="muted font-size-tiny">${hidden} hidden</div>` : ''}</div>`
    + `<div class="participant-td participant-td-club">${team ? `<a class="truncate block" href="${esc(team.affiliation_url)}">${esc(team.affiliationName)}</a>` : ''}</div>`
    + `<div class="participant-td scwr-career">${known.length ? figures(t, medals) : draining ? PLACEHOLDER.repeat(COLUMNS.length) : '<div class="muted">Hidden profiles</div><div></div>'}`
      + `${draining ? PLACEHOLDER : haul(expected)}</div>`
    + `<div class="scwr-roster"${revealed === key ? ' data-revealed' : ''}>${roster}</div></div></div>`;
}

// Every career landing redraws the list, so a focused toggle is focused again,
// and what moves only moves on the draw it was asked for.
function drawAcademies() {
  if (box.contains(shown)) return; // the list holds still under an athlete's brackets
  const list = academies();
  const name = plural(list.length, 'academy', 'academies');
  const focused = box.contains(document.activeElement) && document.activeElement.dataset.academy;
  box.innerHTML = list.length ? `<div class="margin-bottom-xs-64"><div class="heading-container flex-center"><h2 class="group-name margin-xs-0">${draining ? `${name}, reading careers…` : name}</h2></div>`
    + '<div class="participants-table-head participant-tr muted margin-bottom-xs-8 participants-desktop"><span class="participant-td participant-td-athlete padding-left-xs-0 margin-right-xs-4">Academy</span>'
    + '<span class="participant-td participant-td-birth">Athletes</span><span class="participant-td participant-td-club">Affiliation</span>'
    + `<span class="participant-td scwr-career">${[...COLUMNS, 'Expected'].map((label) => `<span>${label}</span>`).join('')}</span></div>`
    + `<div class="profile-cards participants-desktop">${list.map(academy).join('')}</div></div>` : '';
  if (focused) [...box.querySelectorAll('.scwr-more')].find((b) => b.dataset.academy === focused)?.focus();
  if (glide) slide(moved(glide, box.querySelectorAll('.profile-card'), club));
  glide = revealed = null;
}

// Academies are drawn with everything else on screen; Smoothcomp's list stands empty.
function show() {
  offerBelts();
  if (order === 'academies') {
    vm.visible = [];
    glide = tops(box.querySelectorAll('.profile-card'), club);
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
  for (const r of people(false)) if (r.user_id && needsRank(r.user_id)) pending.add(String(r.user_id));
  drain();
  show();
}

function drain() {
  if (pending.size) {
    draining ??= Promise.all(Array.from({ length: 12 }, async () => {
      for (const user of pending) {
        pending.delete(user);
        if (!fresh(user)) await readCareer(user);
        if (order !== null && needsRank(user)) await readRank(user);
        queue();
      }
    })).then(() => {
      draining = null;
      save();
      if (order !== null) show(); else if (stack) restack();
    });
  }
}

// The registration column only repeats the bracket title, so the career takes
// its place; participants.css hides the original. Each column is drawn like
// Smoothcomp's own: a figure over a muted line, as the birth year sits over the age.
const COLUMNS = ['Wins', 'Medals'];
const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;
// A zero steps back to Smoothcomp's muted ink, so the eye lands on the figures that count.
const column = (n, figure, line) => `<div><div${n ? '' : ' class="muted"'}>${figure}</div><div class="muted font-size-tiny">${line}</div></div>`;
const haul = ([gold, silver, bronze]) => (gold + silver + bronze ? column(gold, `${gold} gold`, `${silver} silver · ${bronze} bronze`) : '<div class="muted">No medals</div>');
const figures = (t, medals) => column(t[0], `<b>${t[0]}</b>`, `${plural(t[1], 'sub')} · ${t[2]} pts`) + haul(medals);
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
  const strength = stack && !draining && strengths();
  for (const group of document.querySelectorAll('#registrations .participant-group')) {
    watcher.observe(group);
    // A stacked order says what it ranks by beside each bracket's name.
    const container = group.querySelector(':scope > .heading-container');
    let label = container?.querySelector('.scwr-stack');
    if (stack && container) {
      if (!label) {
        label = document.createElement('span');
        label.className = 'muted scwr-stack';
        container.append(label);
      }
      const [wins, each] = strength ? strength.get(heading(group)) : [];
      const text = strength ? `${plural(wins, 'win')} · ${+each.toFixed(1)} per athlete` : 'Reading careers…';
      if (label.textContent !== text) label.textContent = text;
    } else label?.remove();
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
  // In the athletes list, each athlete wears their belt after their name.
  for (const link of document.querySelectorAll('#registrations .profile-card-name > a[href*="/profile/"]')) {
    let swatch = link.querySelector(':scope > .scwr-belt');
    const grade = LEADS.includes(order) && belt(SCWRSite.profileId(link.getAttribute('href')));
    if (!grade) { swatch?.remove(); continue; }
    if (!swatch) {
      swatch = document.createElement('i');
      swatch.className = 'scwr-belt';
      link.append(swatch);
    }
    swatch.dataset.belt = grade;
    swatch.title = `${grade[0].toUpperCase()}${grade.slice(1)} belt`;
  }
  // Each division an athlete entered opens its bracket and, once every career is
  // read, leads with the medal that bracket points to for them.
  if (LEADS.includes(order)) {
    if (!draining) foresee();
    for (const division of document.querySelectorAll('#registrations .participant-td-registration > div')) {
      if (!division.role) {
        division.setAttribute('role', 'button');
        division.setAttribute('aria-haspopup', 'dialog');
        division.tabIndex = 0;
      }
      const user = SCWRSite.profileId(division.closest('.profile-card')?.querySelector('a[href*="/profile/"]')?.getAttribute('href'));
      const call = !draining && foreseen.get(user)?.find((c) => c.name === division.textContent.trim());
      const medal = call ? dot(call) : '';
      const held = division.querySelector(':scope > .scwr-medal');
      if ((held?.outerHTML ?? '') === medal) continue;
      held?.remove();
      division.insertAdjacentHTML('afterbegin', medal);
      division.ariaDescription = call ? `${call.sure ? 'Expected' : 'Maybe'} ${MEDALS[call.medal]}` : null;
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
// top-seed. Their gender and birth date come from their settings and their latest belt
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
    belt: skills.data?.filter((skill) => /jiu|bjj/i.test(skill.name)).sort((a, b) => b.sort_order - a.sort_order)[0]?.belt?.toLowerCase(),
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
  first = new Map(vm.all.map((g, i) => [g.name, i]).reverse());
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
  source = vm.all;
  admit();
  vm.updateResults();
  queue();
  // Under the search, which list to show: the brackets, every athlete, or
  // every academy; and for the last two, an age range, open at either end.
  const list = document.querySelector('#registrations');
  view = document.createElement('select');
  view.className = 'scwr-view';
  view.dataset.scwrTheme = list.dataset.scwrTheme = SCWRSite.theme(list);
  view.setAttribute('aria-label', 'List');
  view.innerHTML = '<option value="">Brackets, biggest first</option><option value="stacked">Brackets, most wins</option>'
    + '<hr><option value="wins">Athletes, most wins</option>'
    + '<option value="submission">Athletes, most submission wins</option>'
    + '<hr><option value="academies">Academies, most wins</option>';
  const ages = document.createElement('div');
  ages.className = 'scwr-ages';
  ages.dataset.scwrTheme = view.dataset.scwrTheme;
  ages.hidden = true;
  ages.setAttribute('role', 'group');
  ages.setAttribute('aria-label', 'Age');
  ages.innerHTML = '<span>Age</span><input type="number" min="0" max="120" placeholder="Any" aria-label="From">'
    + '<span>–</span><input type="number" min="0" max="120" placeholder="Any" aria-label="To">';
  // The belts ride beside the age range.
  picker = document.createElement('div');
  picker.className = 'scwr-belts';
  picker.dataset.scwrTheme = view.dataset.scwrTheme;
  picker.hidden = true;
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Belt');
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const b = button.firstChild.dataset.belt;
    if (!belts.delete(b)) belts.add(b);
    button.setAttribute('aria-pressed', belts.has(b));
    SCWRSite.store.set('belts', [...belts]);
    if (order !== null) ranking();
  });
  const approved = document.createElement('label');
  approved.className = 'scwr-approved';
  approved.dataset.scwrTheme = view.dataset.scwrTheme;
  approved.innerHTML = '<input type="checkbox">Approved only';
  const bar = document.createElement('div');
  bar.className = 'scwr-bar';
  bar.append(view, ages, picker, approved);
  const search = list.querySelector('.well');
  if (search) search.after(bar); else list.before(bar);
  box = document.createElement('div');
  box.className = 'container container-fluid-large scwr-academies';
  box.dataset.scwrTheme = view.dataset.scwrTheme;
  list.append(box);
  box.addEventListener('click', (event) => {
    const key = event.target.closest('.scwr-more')?.dataset.academy;
    if (!key) return;
    if (expanded.delete(key)) revealed = null;
    else { expanded.add(key); revealed = key; }
    queue();
  });
  sheet = document.createElement('div');
  sheet.className = 'scwr-bracket';
  sheet.dataset.scwrTheme = view.dataset.scwrTheme;
  sheet.popover = 'auto';
  sheet.setAttribute('role', 'dialog');
  list.after(sheet);
  sheet.addEventListener('toggle', (event) => {
    if (event.newState === 'open') return;
    sheet.removeAttribute('data-swap');
    const held = box.contains(shown);
    shown?.removeAttribute('aria-expanded');
    shown = aimed = null;
    if (held) queue();
  });
  document.addEventListener('pointerover', (event) => {
    if (order === 'academies' && event.pointerType === 'mouse') {
      hover(sheet.contains(event.target) ? shown : event.target.closest('.scwr-academies .scwr-roster > a'));
    }
  });
  // Tabbing onto a roster athlete shows their brackets as resting the pointer does.
  document.addEventListener('focusin', (event) => {
    if (order === 'academies' && !sheet.contains(event.target)) hover(event.target.closest('.scwr-academies .scwr-roster > a'));
  });
  const division = (target) => LEADS.includes(order) && target.closest?.('.participant-td-registration > [role="button"]');
  list.addEventListener('click', (event) => { const d = division(event.target); if (d) open(d); });
  list.addEventListener('keydown', (event) => {
    const d = (event.key === 'Enter' || event.key === ' ') && division(event.target);
    if (d) { event.preventDefault(); open(d); }
  });
  // The list chosen is kept per site, as the age range is.
  view.addEventListener('change', () => {
    SCWRSite.store.set('view', view.value);
    stack = view.value === 'stacked';
    order = stack ? null : view.value || null;
    if (order === null) pending.clear();
    list.classList.toggle('scwr-ranked', order !== null);
    ages.hidden = picker.hidden = order === null;
    if (stack) return stacking();
    vm.all = Object.freeze(arrange(vm.all));
    vm.updateResults();
  });
  // Kept per site. Athletes shown again need their careers, so the brackets on
  // screen are seen afresh and read what they lack.
  const only = approved.querySelector('input');
  only.checked = approvedOnly;
  only.addEventListener('change', () => {
    approvedOnly = only.checked;
    SCWRSite.store.set('approved-only', approvedOnly);
    admit();
    vm.updateResults();
    watcher.disconnect();
    queue();
    if (stack) stacking();
    if (me) pick();
  });
  // Typed either way round, the range reads low to high; it applies once typing
  // pauses, and is kept per site, as the weight is.
  let typing;
  const ends = [...ages.querySelectorAll('input')];
  ages.addEventListener('input', () => {
    const [from, to] = ends.map((input) => (input.value === '' ? null : Math.max(0, +input.value)));
    youngest = Math.min(from ?? 0, to ?? Infinity);
    oldest = Math.max(from ?? 0, to ?? Infinity);
    SCWRSite.store.set('ages', [from, to]);
    clearTimeout(typing);
    typing = setTimeout(() => order !== null && ranking(), 400);
  });
  SCWRSite.store.get('ages', []).forEach((end, i) => { ends[i].value = end ?? ''; });
  ages.dispatchEvent(new Event('input'));
  view.value = SCWRSite.store.get('view') ?? '';
  if (view.selectedIndex < 0) view.value = '';
  if (view.value) view.dispatchEvent(new Event('change'));
  me = window.userId && String(window.userId);
  if (me) {
    mount();
    pick();
  }
});
