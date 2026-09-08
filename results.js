// Keep the official results, with a sortable competition table above and records
// inline. Every number here is recomputed from the event's own match list.
(() => {
  const { placements, athleteKey, normalize } = SCWRModel;
  const { WIN_TYPES } = SCWRSite;
  const EVENT_ID = SCWRSite.eventId();
  const counting = () => ({ types: state.types });
  const state = {
    view: 'athletes', sort: 'wins', direction: -1, search: '', minimum: 1, minimumAge: 0,
    // Same default as the team rankings page: every decided win type but walkovers.
    types: WIN_TYPES.filter((t) => t !== 'walkover'),
    limit: 25, bracketSort: 'placement', open: new Set(),
    matchupOpen: false,
    academyA: '', academyB: '',
  };
  let model = null;
  let eventMatches = [];
  let academyNames = [];
  const matchDetails = new Map();
  const DETAIL_KEY = `match-details:${EVENT_ID}`;
  let detailCache = null;
  let summaries = new Map();
  let rows = [];
  let vm = null;
  let busy = false;
  let updatedAt = 0;
  const root = document.querySelector('#resultsView');
  if (!root || document.querySelector('.scwr-results')) return;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  // The panel inherits the host page's colours, so read the real backdrop once and
  // pick the ramp that will actually sit on it rather than guessing from the OS.
  function detectTheme() {
    for (let node = root; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const [r, g, b, a = 1] = (bg.match(/[\d.]+/g) ?? []).map(Number);
      if (!a || r === undefined) continue;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
    }
    return 'light';
  }

  const DEFAULT_SORT = { athletes: 'wins', academies: 'wins', brackets: 'size' };
  const VIEWS = {
    athletes: { label: 'Athletes', unit: ['athlete', 'athletes'] },
    academies: { label: 'Academies', unit: ['academy', 'academies'] },
    brackets: { label: 'Brackets', unit: ['bracket', 'brackets'] },
  };

  const percent = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);
  const unit = (n, one, many = `${one}s`) => (n === 1 ? one : many);
  const record = (s) => `${s.wins}–${s.losses}`;
  const WIN_LABEL = {
    submission: ['submission', 'submissions'], points: ['points', 'points'],
    decision: ['decision', 'decisions'], disqualification: ['DQ', 'DQs'], walkover: ['walkover', 'walkovers'],
  };
  const WIN_ABBR = { submission: 'sub', points: 'pts', decision: 'dec', disqualification: 'DQ', walkover: 'WO' };
  const breakdown = (types) => WIN_TYPES.filter((t) => types[t])
    .map((t) => `${types[t]} ${unit(types[t], ...(WIN_LABEL[t] ?? [t, `${t}s`]))}`).join(', ');
  const shortBreakdown = (types) => WIN_TYPES.filter((t) => types[t])
    .map((t) => `${types[t]} ${WIN_ABBR[t] ?? t}`).join(' · ');

  // The medal glyph is the header; the title carries the words for anyone whose
  // screen reader or font would otherwise announce "first place medal".
  const MEDAL_COLUMNS = [
    { key: 'golds', label: '🥇', medal: true, title: 'Gold medals', cell: (r) => medalCell(r, 0) },
    { key: 'silvers', label: '🥈', medal: true, title: 'Silver medals', cell: (r) => medalCell(r, 1) },
    { key: 'bronzes', label: '🥉', medal: true, title: 'Bronze medals', cell: (r) => medalCell(r, 2) },
  ];

  // Column definitions drive the header, the sort state and the cells, so the
  // athlete and academy tables stay one component with one sorting model.
  const COLUMNS = {
    athletes: [
      { key: 'name', label: 'Athlete', align: 'start', cell: identityCell, grow: true },
      { key: 'wins', label: 'W–L', title: 'Match record. Byes never count; walkovers follow the toggle.', cell: (r) => strong(record(r)) },
      { key: 'rate', label: 'Win %', title: 'Wins ÷ matches contested.', cell: (r) => strong(percent(r.rate)) },
      { key: 'finish', label: 'How they won', align: 'start', title: 'Every win, ordered from the most decisive finish to the least.', cell: barCell, wide: true },
      { key: 'conceded', label: 'How they lost', align: 'start', title: 'Every loss, ordered from the most decisive finish to the least. Sorts by the share that ended in a submission, so the hardest to finish come first.', cell: lossBarCell, wide: true, reverse: true },
      ...MEDAL_COLUMNS,
      { key: 'biggest', label: 'Bracket size', title: 'Competitors in the largest bracket they entered, whatever they placed.', cell: (r) => muted(r.biggestBracket || '—') },
    ],
    academies: [
      { key: 'name', label: 'Academy', align: 'start', cell: identityCell, grow: true },
      { key: 'wins', label: 'W–L', title: 'Combined record of every athlete from this academy.', cell: (r) => strong(record(r)) },
      { key: 'rate', label: 'Win %', title: 'Wins ÷ matches contested.', cell: (r) => strong(percent(r.rate)) },
      { key: 'finish', label: 'How they won', align: 'start', title: 'Every win, ordered from the most decisive finish to the least.', cell: barCell, wide: true },
      { key: 'conceded', label: 'How they lost', align: 'start', title: 'Every loss this academy took, ordered from the most decisive finish to the least. Sorts by the share that ended in a submission, so the hardest to finish come first.', cell: lossBarCell, wide: true, reverse: true },
      { key: 'depth', label: 'W/athlete', title: 'Wins per athlete entered. Separates a deep team from one carried by a single competitor.', cell: (r) => muted(r.depth ? r.depth.toFixed(1) : '—') },
      ...MEDAL_COLUMNS,
      { key: 'athletes', label: 'Athletes', title: 'Athletes this academy entered who appear in the published results.', cell: (r) => muted(r.athletes) },
    ],
    brackets: [
      { key: 'name', label: 'Division', align: 'start', cell: identityCell, grow: true },
      { key: 'size', label: 'Bracket size', title: 'Competitors in the published placement list.', cell: (r) => strong(r.size) },
      { key: 'wins', label: 'Gold medal', align: 'start', title: 'Who the published results awarded gold, and the record they posted in this bracket.', cell: (r) => personCell(r.champion, r.championExcluded ? 'Below minimum age' : 'Not awarded'), wide: true },
      { key: 'gap', label: 'Most wins', align: 'start', title: 'Whoever actually won the most matches here under the win types you are counting. Ties go to the medallist. Sorts by that leader\u2019s win count.', cell: leaderCell, wide: true },
      { key: 'gapCount', label: 'Gap', title: 'How many more wins the leader has than the gold medallist. Zero means the medal and the match wins agree.', cell: gapCell },
    ],
  };

  const strong = (value) => el('span', String(value), 'scwr-num');
  const muted = (value) => el('span', String(value), 'scwr-num scwr-num-muted');

  function medalCell(row, index) {
    const n = row.medals?.[index] ?? 0;
    const node = el('span', n ? String(n) : '·', `scwr-num scwr-medal scwr-medal-${index}`);
    if (!n) node.classList.add('scwr-num-muted');
    return node;
  }

  // Smoothcomp has no page to send a hidden profile to, so those stay plain text.
  const profileHref = (person) =>
    (person?.userId && !person.hidden ? SCWRSite.url.profile(person.userId) : null);

  // Only about a third of competitors have uploaded a photo, so initials are
  // part of the design rather than an error state: they keep every row the same
  // height and the column the same width.
  // A hidden profile gets initials even when a photo ships in the payload —
  // Smoothcomp serves it, but the athlete asked not to be shown.
  function avatar(person) {
    if (!('userId' in person)) return null;
    const words = person.name.split(/\s+/).filter(Boolean);
    const monogram = () => {
      const node = el('span', (words[0]?.[0] ?? '') + (words.length > 1 ? words.at(-1)[0] : ''), 'scwr-face scwr-monogram');
      node.setAttribute('aria-hidden', 'true');
      return node;
    };
    if (!person.logo || person.hidden) return monogram();
    const img = el('img', undefined, 'scwr-face');
    img.src = person.logo;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(monogram()), { once: true });
    return img;
  }

  const nameLine = (name, flag) => {
    if (!flag) return name;
    const line = el('span', undefined, 'scwr-named');
    line.append(name, flag);
    return line;
  };

  const BELT_TONES = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black', 'red'];
  const beltTone = (belt) => {
    const value = String(belt ?? '').toLowerCase().replace('gray', 'grey');
    const words = new Set(value.match(/[a-z]+/g) ?? []);
    return BELT_TONES.find((tone) => words.has(tone)) ?? null;
  };

  function beltSwatch(person) {
    const tone = beltTone(person?.belt);
    if (!tone) return null;
    const belt = el('span', undefined, 'scwr-belt');
    belt.dataset.belt = tone;
    belt.title = person.belt;
    belt.setAttribute('role', 'img');
    belt.setAttribute('aria-label', `${person.belt} belt or level`);
    return belt;
  }

  function ageChip(person) {
    if (!Number.isFinite(person?.age)) return null;
    const age = el('span', `${person.age} yrs`, 'scwr-age');
    age.title = `Age ${person.age}`;
    return age;
  }

  function detailsLine(person, detail) {
    const line = el('span', undefined, 'scwr-details');
    for (const badge of [beltSwatch(person), ageChip(person), detail]) if (badge) line.append(badge);
    return line;
  }

  // The flag is decoration; the country name rides along as the accessible label so
  // a missing glyph (or a region Unicode has no flag for) never loses the fact.
  function flagFor(person) {
    const glyph = SCWRSite.flag(person.country);
    if (!glyph || !person.countryName) return null;
    const node = el('span', undefined, 'scwr-flag');
    // Regions Unicode skipped arrive as drawn markup rather than a glyph.
    if (glyph.startsWith('<')) node.innerHTML = glyph;
    else node.textContent = glyph;
    node.title = person.countryName;
    node.setAttribute('aria-label', person.countryName);
    node.setAttribute('role', 'img');
    return node;
  }

  function identityCell(row) {
    const wrap = el('div', undefined, 'scwr-identity');
    const face = avatar(row);
    if (face) wrap.append(face);
    const text = el('div', undefined, 'scwr-identity-text');
    const name = row.href ? el('a', row.name, 'scwr-name') : el('span', row.name, 'scwr-name');
    if (row.href) name.href = row.href;
    const flag = flagFor(row);
    // 18 competitors here compete for regions Unicode has no flag for; the name
    // still carries the country so nothing is lost to a missing glyph.
    if (!flag && row.countryName) name.title = row.countryName;
    text.append(nameLine(name, flag));
    if (row.meta) {
      const meta = el('span', row.meta, 'scwr-meta');
      meta.title = row.meta;
      text.append(detailsLine(row, meta));
    }
    wrap.append(text);
    return wrap;
  }

  // Bar length is the total against the busiest row on screen; the ordinal ramp
  // inside it runs from the most decisive finish to the least. Wins and losses
  // share the renderer and the colours, so the two bars in a row read as one
  // sentence: what they did to people, and what was done to them.
  function bar(total, types, scale, ...noun) {
    const wrap = el('div', undefined, 'scwr-bar');
    if (!total) return wrap.append(el('span', '—', 'scwr-num scwr-num-muted')), wrap;
    const track = el('div', undefined, 'scwr-bar-track');
    track.style.width = `${Math.max(4, (total / (scale || 1)) * 100)}%`;
    for (const type of WIN_TYPES) {
      const n = types[type];
      if (!n) continue;
      const seg = el('i', undefined, `scwr-seg scwr-seg-${type}`);
      seg.style.flexGrow = String(n);
      seg.title = `${n} by ${type}`;
      track.append(seg);
    }
    const legend = el('span', shortBreakdown(types), 'scwr-bar-legend');
    legend.title = `${total} ${unit(total, ...noun)}: ${breakdown(types)}`;
    wrap.append(track, legend);
    return wrap;
  }
  function barCell(row, ctx) { return bar(row.wins, row.types, ctx.maxWins, 'win'); }
  function lossBarCell(row, ctx) { return bar(row.losses, row.lossTypes, ctx.maxLosses, 'loss', 'losses'); }

  function personCell(person, absent = 'Not awarded') {
    const wrap = el('div', undefined, 'scwr-identity');
    if (!person) return wrap.append(el('span', absent, 'scwr-meta')), wrap;
    const face = avatar(person);
    if (face) wrap.append(face);
    const text = el('div', undefined, 'scwr-identity-text');
    const href = profileHref(person);
    const name = href ? el('a', person.name, 'scwr-name') : el('span', person.name, 'scwr-name');
    if (href) name.href = href;
    const flag = flagFor(person);
    if (!flag && person.countryName) name.title = person.countryName;
    text.append(nameLine(name, flag));
    text.append(detailsLine(person,
      el('span', `${person.club || 'Unaffiliated'} · ${record(person)} here · ${breakdown(person.types) || 'no counted wins'}`, 'scwr-meta')));
    wrap.append(text);
    return wrap;
  }

  // When the medal and the match wins disagree, the mismatch is the whole point;
  // when they agree, this column should recede rather than repeat the name.
  function leaderCell(bracket) {
    if (!bracket.leader) return personCell(null, 'No decided matches');
    if (!bracket.gapCount) {
      const wrap = el('div', undefined, 'scwr-identity');
      wrap.append(el('span', 'Same athlete', 'scwr-meta scwr-agree'));
      wrap.append(el('span', `Gold also led on wins (${record(bracket.leader)})`, 'scwr-meta'));
      return wrap;
    }
    return personCell(bracket.leader);
  }

  function gapCell(bracket) {
    if (!bracket.leader) return muted('—');
    return bracket.gapCount ? el('span', `+${bracket.gapCount}`, 'scwr-num scwr-gap') : muted('0');
  }

  // Filters are a working setup, not per-event state, so they persist across
  // events and reloads. Search and expanded rows deliberately do not: a stored
  // search that hides everything is baffling on the next visit.
  const PREFS_KEY = 'results-prefs';
  const PERSISTED = ['view', 'sort', 'direction', 'minimumAge', 'minimum', 'types', 'bracketSort',
    'matchupOpen', 'academyA', 'academyB'];

  // Stored values are never trusted. A column can be renamed or dropped between
  // versions, and one bad field would otherwise take the whole table down.
  function restorePrefs() {
    const saved = SCWRSite.store.get(PREFS_KEY);
    if (!saved || typeof saved !== 'object') return;
    const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined);
    const restored = {
      view: oneOf(saved.view, Object.keys(VIEWS)),
      bracketSort: oneOf(saved.bracketSort, ['placement', 'size', 'wins', 'submissions']),
      direction: oneOf(saved.direction, [1, -1]),
      minimumAge: Number.isFinite(saved.minimumAge) && saved.minimumAge >= 0 && saved.minimumAge <= 120
        ? Math.floor(saved.minimumAge) : undefined,
      minimum: Number.isFinite(saved.minimum) && saved.minimum >= 0 ? Math.floor(saved.minimum) : undefined,
      types: Array.isArray(saved.types) ? WIN_TYPES.filter((t) => saved.types.includes(t)) : undefined,
      matchupOpen: typeof saved.matchupOpen === 'boolean' ? saved.matchupOpen : undefined,
      academyA: typeof saved.academyA === 'string' ? saved.academyA : undefined,
      academyB: typeof saved.academyB === 'string' ? saved.academyB : undefined,
    };
    for (const [key, value] of Object.entries(restored)) if (value !== undefined) state[key] = value;
    // Leaving every win type off would render an empty table with no way back.
    if (!state.types.length) state.types = WIN_TYPES.filter((t) => t !== 'walkover');
    // The sort has to name a column that still exists in the restored view.
    state.sort = COLUMNS[state.view].some((c) => c.key === saved.sort) ? saved.sort : DEFAULT_SORT[state.view];
  }

  function savePrefs() {
    SCWRSite.store.set(PREFS_KEY, Object.fromEntries(PERSISTED.map((k) => [k, state[k]])));
  }

  restorePrefs();

  const panel = el('section', undefined, 'scwr-results');
  panel.dataset.scwrTheme = detectTheme();
  panel.setAttribute('aria-labelledby', 'scwr-title');
  panel.innerHTML = `
    <header class="scwr-head">
      <div>
        <h2 id="scwr-title">Competition leaders</h2>
        <p class="scwr-sub">Recomputed from this event's own match list — not official Smoothcomp standings.</p>
      </div>
      <button type="button" class="scwr-btn" data-action="refresh">Refresh</button>
    </header>
    <div class="scwr-tabs" role="tablist" aria-label="Leaderboard view">
      ${Object.entries(VIEWS).map(([key, v], i) => `<button type="button" role="tab" class="scwr-tab" data-view="${key}"
        id="scwr-tab-${key}" aria-controls="scwr-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${v.label}</button>`).join('')}
      <button type="button" role="tab" class="scwr-tab scwr-matchup-tab" data-view="matchups"
        id="scwr-tab-matchups" aria-controls="scwr-matchup-slot" aria-selected="false" tabindex="-1">Matchups</button>
    </div>
    <div class="scwr-matchup-slot" id="scwr-matchup-slot" role="tabpanel" aria-labelledby="scwr-tab-matchups"></div>
    <div class="scwr-tools">
      <label class="scwr-field scwr-field-grow"><span>Search</span>
        <input data-filter="search" type="search" placeholder="Name, country, academy or division" autocomplete="off"></label>
      <label class="scwr-field scwr-field-narrow"><span>Minimum age</span>
        <span class="scwr-age-control" data-active="false">
          <input data-filter="minimumAge" type="number" inputmode="numeric" min="0" max="120" step="1"
            placeholder="All" list="scwr-age-presets" title="Uses the age Smoothcomp publishes for each competitor. Leave empty to show every age.">
        </span>
        <datalist id="scwr-age-presets">
          <option value="0"></option><option value="16"></option><option value="18"></option>
          <option value="30"></option><option value="35"></option><option value="40"></option>
        </datalist></label>
      <label class="scwr-field scwr-field-narrow" data-only="athletes academies"><span>Min. matches</span>
        <input data-filter="minimum" type="number" inputmode="numeric" min="0" step="1" value="1"
          list="scwr-minimum-presets" title="Hide anyone with fewer contested matches than this. 0 shows everyone.">
        <datalist id="scwr-minimum-presets">
          <option value="0"></option><option value="1"></option><option value="3"></option>
          <option value="5"></option><option value="10"></option><option value="20"></option>
        </datalist></label>
      <div class="scwr-field scwr-field-wide"><span id="scwr-types-label">Count these wins</span>
        <div class="scwr-chips" role="group" aria-labelledby="scwr-types-label"></div></div>
    </div>
    <p class="scwr-status" role="status" aria-live="polite">Reading the match list…</p>
    <div class="scwr-scroll">
      <table class="scwr-table" id="scwr-panel" role="tabpanel" aria-labelledby="scwr-tab-athletes">
        <thead></thead><tbody></tbody>
      </table>
    </div>
    <div class="scwr-foot">
      <button type="button" class="scwr-btn" data-action="more" hidden>Show more</button>
      <p class="scwr-note"></p>
      <ul class="scwr-key" aria-label="How matches ended, most decisive first"></ul>
    </div>
    <div class="scwr-official">
      <label class="scwr-field"><span>Order the official results below</span><select data-filter="bracketSort">
        <option value="placement">Best placement, then biggest field</option>
        <option value="size">Biggest fields first</option>
        <option value="wins">Most competition wins</option>
        <option value="submissions">Most submission wins</option></select></label>
    </div>`;
  root.before(panel);

  const status = panel.querySelector('.scwr-status');
  const matchupSlot = panel.querySelector('.scwr-matchup-slot');
  const tools = panel.querySelector('.scwr-tools');
  const scroll = panel.querySelector('.scwr-scroll');
  const foot = panel.querySelector('.scwr-foot');
  const officialControl = panel.querySelector('.scwr-official');
  const table = panel.querySelector('.scwr-table');
  const head = table.querySelector('thead');
  const body = table.querySelector('tbody');
  const note = panel.querySelector('.scwr-note');
  const more = panel.querySelector('[data-action="more"]');
  table.dataset.view = state.view;
  const chips = panel.querySelector('.scwr-chips');
  chips.replaceChildren(...WIN_TYPES.map((type) => {
    const chip = el('button', undefined, 'scwr-chip-toggle');
    chip.type = 'button';
    chip.dataset.type = type;
    chip.append(el('i', undefined, `scwr-seg scwr-seg-${type}`), el('span', WIN_LABEL[type][1]));
    return chip;
  }));
  function paintChips() {
    for (const chip of chips.children) {
      const on = state.types.includes(chip.dataset.type);
      chip.setAttribute('aria-pressed', String(on));
      chip.title = on
        ? `Counting ${WIN_LABEL[chip.dataset.type][1]}. Click to leave them out.`
        : `Ignoring ${WIN_LABEL[chip.dataset.type][1]}. Click to count them.`;
    }
  }
  const key = panel.querySelector('.scwr-key');
  key.replaceChildren(...WIN_TYPES.map((type) => {
    const item = el('li');
    item.append(el('i', undefined, `scwr-seg scwr-seg-${type}`), el('span', WIN_LABEL[type][1]));
    return item;
  }));

  function syncAcademyNames() {
    if (!model) return;
    const ranked = SCWRModel.leaderboard(model, {
      table: 'academies', types: state.types, sort: 'wins', direction: -1,
      minimum: 0, minimumAge: state.minimumAge, search: '',
    }).map((academy) => academy.name).filter((name) => name !== 'Unaffiliated');
    const seen = new Set(ranked.map(normalize));
    const extras = [];
    for (const name of eventMatches.flatMap((match) => match.sides ?? []).map((side) => side.club).filter(Boolean)) {
      const key = normalize(name);
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(name);
    }
    extras.sort((a, b) => a.localeCompare(b));
    academyNames = [...ranked, ...extras];
    const exact = (name) => academyNames.find((candidate) => normalize(candidate) === normalize(name));
    const savedA = exact(state.academyA);
    const savedB = exact(state.academyB);
    if (savedA && savedB && savedA !== savedB) {
      state.academyA = savedA;
      state.academyB = savedB;
      return;
    }

    // A first visit should demonstrate the feature, not land on an arbitrary
    // zero–zero. Count actual cross-academy pairings once and open the busiest
    // rivalry in this event; explicit selections remain sticky after that.
    const pairCounts = new Map();
    const countedMatches = new Set();
    for (const match of eventMatches) {
      if (countedMatches.has(match.id)) continue;
      countedMatches.add(match.id);
      if (match.sides?.length !== 2) continue;
      const winners = match.sides.filter((side) => side.won);
      if (winners.length !== 1 || winners[0].won === 'bye' || !state.types.includes(winners[0].won)) continue;
      if (match.sides.some((side) => !matchupSideAllowed(side))) continue;
      const clubs = match.sides.map((side) => exact(side.club)).filter(Boolean);
      if (clubs.length !== 2 || clubs[0] === clubs[1]) continue;
      const pair = clubs.slice().sort((a, b) => a.localeCompare(b));
      const key = pair.map(normalize).join('\0');
      const current = pairCounts.get(key) ?? { pair, count: 0 };
      current.count++;
      pairCounts.set(key, current);
    }
    const best = [...pairCounts.values()].sort((a, b) => b.count - a.count || a.pair[0].localeCompare(b.pair[0]))[0]?.pair;
    [state.academyA, state.academyB] = best ?? [academyNames[0] ?? '', academyNames[1] ?? ''];
  }

  function matchupSideAllowed(side) {
    if (!state.minimumAge) return true;
    let athlete = side.userId ? model.athletes.get(`user:${side.userId}`) : null;
    if (!athlete) {
      const candidates = [...model.athletes.values()].filter((person) =>
        normalize(person.name) === normalize(side.name) && normalize(person.club) === normalize(side.club));
      athlete = candidates.length === 1 ? candidates[0] : null;
    }
    return Number.isFinite(athlete?.age) && athlete.age >= state.minimumAge;
  }

  function matchupData() {
    return SCWRModel.headToHead(eventMatches, state.academyA, state.academyB, state.types, matchupSideAllowed);
  }

  function academyOptions(key) {
    const other = key === 'academyA' ? state.academyB : state.academyA;
    return academyNames.map((name) => {
      const option = new Option(name, name, false, state[key] === name);
      option.disabled = name === other;
      return option;
    });
  }

  function academyField(key, label) {
    const field = el('label', undefined, 'scwr-field scwr-h2h-field');
    field.append(el('span', label));
    const select = el('select');
    select.dataset.matchupAcademy = key;
    select.disabled = academyNames.length < 2;
    select.replaceChildren(...academyOptions(key));
    field.append(select);
    return field;
  }

  function swapButton() {
    const button = el('button', 'Swap', 'scwr-btn scwr-h2h-swap');
    button.type = 'button';
    button.dataset.matchupAction = 'swap';
    button.disabled = academyNames.length < 2;
    return button;
  }

  function matchupControls() {
    const controls = el('div', undefined, 'scwr-h2h-controls');
    controls.append(academyField('academyA', 'Academy one'), swapButton(), academyField('academyB', 'Academy two'));
    return controls;
  }

  function matchupTypes() {
    const field = el('div', undefined, 'scwr-field scwr-h2h-types');
    const label = el('span', 'Count these wins');
    const group = el('div', undefined, 'scwr-chips');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Win types counted in the academy matchup');
    for (const type of WIN_TYPES) {
      const button = el('button', undefined, 'scwr-chip-toggle');
      button.type = 'button';
      button.dataset.type = type;
      button.dataset.matchupType = type;
      button.append(el('i', undefined, `scwr-seg scwr-seg-${type}`), el('span', WIN_LABEL[type]?.[1] ?? type));
      group.append(button);
    }
    field.append(label, group);
    return field;
  }

  function matchupAgeFilter() {
    const field = el('label', undefined, 'scwr-field scwr-h2h-age');
    field.append(el('span', 'Minimum age'));
    const control = el('span', undefined, 'scwr-age-control');
    control.dataset.active = String(state.minimumAge > 0);
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '0';
    input.max = '120';
    input.step = '1';
    input.placeholder = 'All';
    input.value = state.minimumAge ? String(state.minimumAge) : '';
    input.dataset.filter = 'minimumAge';
    input.setAttribute('list', 'scwr-age-presets');
    input.title = 'Only count matches where both athletes meet this age.';
    control.append(input);
    field.append(control);
    return field;
  }

  function matchupFilters() {
    const filters = el('div', undefined, 'scwr-h2h-filters');
    filters.append(matchupAgeFilter(), matchupTypes());
    return filters;
  }

  function matchupSide(side, position, leads) {
    const article = el('article', undefined, `scwr-h2h-side scwr-h2h-side-${position}`);
    const heading = el('h4');
    heading.append(el('span', side.name || 'Choose an academy', 'scwr-h2h-side-name'));
    if (leads) heading.append(el('span', 'Leads', 'scwr-h2h-leads'));
    const wins = el('p', `${side.wins} ${unit(side.wins, 'win')}`, 'scwr-h2h-side-result');
    if (leads) wins.classList.add('scwr-h2h-lead');
    article.append(heading, wins, el('p', shortBreakdown(side.types) || 'No counted wins', 'scwr-h2h-side-mix'));
    return article;
  }

  // Every head-to-head figure on the band is read the same way: the leading side
  // in accent, the trailing side stepped back. Two numbers this small need no
  // chart — and when wins and points disagree, the colours flip between the two
  // lines, which is the whole story in one glance.
  function scoreline(a, b) {
    const node = el('strong');
    [a, b].forEach((value, index) => {
      if (index) node.append(el('i', '–', 'scwr-h2h-dash'));
      const digit = el('span', String(value));
      const other = index ? a : b;
      if (value > other) digit.classList.add('scwr-h2h-lead');
      else if (value < other) digit.classList.add('scwr-h2h-trails');
      node.append(digit);
    });
    return node;
  }

  function matchupSummary(h2h, kind) {
    const summary = el('section', undefined, `scwr-h2h-summary scwr-h2h-summary-${kind}`);
    const total = h2h.total || 0;
    const aggregate = el('div', undefined, 'scwr-h2h-aggregate');
    const record = scoreline(h2h.a.wins, h2h.b.wins);
    record.title = h2h.a.wins === h2h.b.wins
      ? `Level at ${h2h.a.wins}–${h2h.b.wins}.`
      : `${(h2h.a.wins > h2h.b.wins ? h2h.a : h2h.b).name} leads this rivalry.`;
    aggregate.append(record, el('small', `${total} ${unit(total, 'match', 'matches')}`));
    summary.append(
      matchupSide(h2h.a, 'a', h2h.a.wins > h2h.b.wins),
      aggregate,
      matchupSide(h2h.b, 'b', h2h.b.wins > h2h.a.wins),
    );
    return summary;
  }

  function matchupPerson(person, won) {
    const athlete = person?.userId ? model.athletes.get(`user:${person.userId}`) : null;
    const href = athlete ? profileHref(athlete) : null;
    const node = href ? el('a', undefined, 'scwr-h2h-person') : el('span', undefined, 'scwr-h2h-person');
    if (href) node.href = href;
    node.append(el('span', person?.name || 'Unnamed athlete', 'scwr-h2h-person-name'));
    for (const badge of athlete ? [flagFor(athlete), beltSwatch(athlete), ageChip(athlete)] : []) if (badge) node.append(badge);
    if (won) {
      node.classList.add('scwr-h2h-winner');
      node.append(el('span', 'Winner', 'scwr-h2h-winner-label'));
    }
    return node;
  }

  // Smoothcomp orders the sides by bracket seeding; the ledger row and the points
  // tally both read academy A first.
  function orientedSides(data, leftWon) {
    const sides = [data.left, data.right];
    if (Boolean(sides[1]?.isWinner) === leftWon) sides.reverse();
    return sides;
  }

  function matchFacts(sides, data) {
    const pair = (key) => sides.map((side) => Number(side?.[key]) || 0);
    const [scores, advantages, penalties] = ['score', 'advantage', 'penalty'].map(pair);
    const facts = [`${scores[0]}–${scores[1]}`];
    if (advantages.some(Boolean)) facts.push(`${advantages[0]}–${advantages[1]} adv`);
    if (penalties.some(Boolean)) facts.push(`${penalties[0]}–${penalties[1]} pen`);
    if (data.matchInfo?.time) facts.push(data.matchInfo.time);
    return facts.join(' \u00b7 ');
  }

  // Only what the ledger and the tally read. A whole event's raw payloads would
  // not fit local storage, and everything else in them is already on the page.
  const trimSide = (side) => ({
    score: Number(side?.score) || 0,
    advantage: Number(side?.advantage) || 0,
    penalty: Number(side?.penalty) || 0,
    isWinner: Boolean(side?.isWinner),
  });
  const trimDetail = (data) => ({
    left: trimSide(data.left), right: trimSide(data.right), matchInfo: { time: data.matchInfo?.time ?? null },
  });

  // A finished match's score never changes again, so it is kept between visits
  // and only the matches missing from the store are ever fetched.
  function storedDetails() {
    detailCache ??= SCWRSite.store.read(DETAIL_KEY)?.details ?? {};
    return detailCache;
  }

  function matchDetail(id) {
    const stored = storedDetails()[id];
    if (stored) return Promise.resolve(stored);
    if (!matchDetails.has(id)) {
      const request = fetch(SCWRSite.url.match(id), {
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' },
      }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then(trimDetail);
      // A failure drops out of the cache so the next render can try again.
      request.catch(() => matchDetails.delete(id));
      matchDetails.set(id, request);
    }
    return matchDetails.get(id);
  }

  // The points tally needs every counted match, so the ledger reads the whole set
  // at once and writes back whatever it had to fetch. A match that fails to load
  // leaves its row as the match list already described it and drops out of the tally.
  async function fillMatchDetails(entries, summary, h2h) {
    const read = (await Promise.all(entries.map((entry) => matchDetail(entry.id)
      .then((data) => ({ entry, data, sides: orientedSides(data, entry.leftWon) }))
      .catch(() => null)))).filter(Boolean);
    const cache = storedDetails();
    const fetched = read.filter(({ entry }) => !cache[entry.id]);
    for (const { entry, data } of fetched) cache[entry.id] = data;
    if (fetched.length) {
      SCWRSite.store.write(DETAIL_KEY, { details: cache }, eventMatches.every((m) => m.status === 'Finished'));
    }
    for (const { entry, data, sides } of read) {
      if (entry.node.isConnected) entry.node.textContent = matchFacts(sides, data);
    }
    const aggregate = summary.querySelector('.scwr-h2h-aggregate');
    if (!read.length || !aggregate?.isConnected) return;
    const points = [0, 1].map((i) => read.reduce((sum, { sides }) => sum + (Number(sides[i]?.score) || 0), 0));
    const line = el('p', undefined, 'scwr-h2h-points');
    line.append(el('span', 'Points'), scoreline(points[0], points[1]));
    line.title = read.length < entries.length
      ? `Points scored across the ${read.length} of ${entries.length} counted matches Smoothcomp published scores for.`
      : `Points scored across all ${read.length} counted ${unit(read.length, 'match', 'matches')}.`;
    aggregate.append(line);
  }

  function matchupLedger(h2h, entries) {
    const section = el('section', undefined, 'scwr-h2h-ledger');
    if (!h2h.matches.length) {
      section.append(el('p', 'No counted direct matches. Try another academy pair or count more win types.', 'scwr-h2h-empty'));
      return section;
    }
    for (const match of h2h.matches) {
      const winnerIsA = normalize(match.winner.academy) === normalize(state.academyA);
      const left = winnerIsA ? match.winner : match.loser;
      const right = winnerIsA ? match.loser : match.winner;
      const row = el('div', undefined, 'scwr-h2h-match');
      const detail = el('span', undefined, 'scwr-h2h-match-detail');
      const bracket = el('a', match.category || 'Division', 'scwr-h2h-division');
      bracket.href = SCWRSite.url.bracket(EVENT_ID, match.bracketId);
      const outcome = el('span', undefined, 'scwr-h2h-match-outcome');
      const facts = el('span', undefined, 'scwr-h2h-match-facts');
      entries.push({ id: match.id, leftWon: winnerIsA, node: facts });
      outcome.append(
        el('i', undefined, `scwr-seg scwr-seg-${match.winType}`),
        el('strong', WIN_LABEL[match.winType]?.[0] ?? match.winType),
        facts,
      );
      detail.append(bracket, outcome);
      row.append(matchupPerson(left, winnerIsA), detail, matchupPerson(right, !winnerIsA));
      section.append(row);
    }
    return section;
  }

  function matchupHeader(title, copy) {
    const header = el('header', undefined, 'scwr-h2h-head');
    const text = el('div');
    text.append(el('h3', title), el('p', copy, 'scwr-sub'));
    header.append(text);
    return header;
  }

  function matchupResults(h2h) {
    const entries = [];
    const summary = matchupSummary(h2h, 'lab');
    const ledger = matchupLedger(h2h, entries);
    return { summary, ledger, fill: () => fillMatchDetails(entries, summary, h2h) };
  }

  function labSurface(h2h) {
    const surface = el('div', undefined, 'scwr-h2h scwr-h2h-lab');
    const header = matchupHeader('Academy head-to-head', 'Aggregate record and every counted match where these academies met.');
    header.append(matchupFilters());
    const results = matchupResults(h2h);
    surface.append(header, matchupControls(), results.summary, results.ledger);
    return { surface, fill: results.fill };
  }

  function renderMatchupSurface() {
    matchupSlot.replaceChildren();
    matchupSlot.hidden = true;
    if (!model || !state.matchupOpen) return;
    syncAcademyNames();
    const lab = labSurface(matchupData());
    matchupSlot.append(lab.surface);
    matchupSlot.hidden = false;
    for (const button of matchupSlot.querySelectorAll('[data-matchup-type]')) {
      const on = state.types.includes(button.dataset.matchupType);
      button.setAttribute('aria-pressed', String(on));
    }
    lab.fill();
  }

  function renderMatchupResults() {
    const surface = matchupSlot.querySelector('.scwr-h2h');
    if (!surface) return;
    syncAcademyNames();
    for (const select of surface.querySelectorAll('[data-matchup-academy]')) {
      select.replaceChildren(...academyOptions(select.dataset.matchupAcademy));
    }
    const h2h = matchupData();
    const results = matchupResults(h2h);
    surface.querySelector('.scwr-h2h-summary')?.replaceWith(results.summary);
    surface.querySelector('.scwr-h2h-ledger')?.replaceWith(results.ledger);
    results.fill();
  }

  function columns() { return COLUMNS[state.view]; }

  function renderHead() {
    const tr = el('tr');
    tr.append(el('th', '#', 'scwr-rank-head'));
    for (const col of columns()) {
      const th = el('th', undefined, `scwr-col scwr-col-${col.key}`);
      if (col.align === 'start') th.classList.add('scwr-start');
      if (col.wide) th.classList.add('scwr-wide');
      if (col.grow) th.classList.add('scwr-grow');
      const button = el('button', undefined, 'scwr-sort');
      button.type = 'button';
      button.dataset.sort = col.key;
      button.append(el('span', col.label, undefined));
      button.append(el('i', undefined, 'scwr-caret'));
      if (col.medal) button.firstChild.classList.add('scwr-glyph');
      if (col.title) { button.title = col.title; button.setAttribute('aria-label', col.title); }
      if (state.sort === col.key) {
        th.setAttribute('aria-sort', state.direction === -1 ? 'descending' : 'ascending');
        th.classList.add('scwr-sorted');
        button.dataset.direction = state.direction === -1 ? 'desc' : 'asc';
      }
      th.append(button);
      tr.append(th);
    }
    head.replaceChildren(tr);
  }

  function detailRow(row, span) {
    const tr = el('tr', undefined, 'scwr-detail');
    tr.id = `scwr-detail-${row.key.replace(/[^a-z0-9_-]/gi, '-')}`;
    const cell = el('td');
    cell.colSpan = span;
    const grid = el('div', undefined, 'scwr-detail-grid');
    const list = state.view === 'academies'
      ? SCWRModel.rank(row.roster, 'wins').slice(0, 12).map((a) => ({
        label: a.name, href: profileHref(a),
        detail: `${record(a)} · ${percent(a.rate)} · ${breakdown(a.types) || 'no contested wins'}`,
        medals: a.medals,
      }))
      : row.entries.map((entry) => {
        const bracket = model.brackets.get(entry.bracketId);
        const one = SCWRModel.entryRecord(entry, state.types);
        return {
          label: bracket.name, href: SCWRSite.url.bracket(EVENT_ID, bracket.id),
          detail: `Placed ${entry.placement} of ${bracket.size} · ${record(one)} · ${breakdown(one.types) || 'no contested wins'}`,
          medals: entry.placement <= 3 ? [0, 1, 2].map((i) => (entry.placement === i + 1 ? 1 : 0)) : [0, 0, 0],
        };
      });
    for (const item of list) {
      const line = el('div', undefined, 'scwr-detail-row');
      const label = item.href ? el('a', item.label, 'scwr-name') : el('span', item.label, 'scwr-name');
      if (item.href) label.href = item.href;
      const place = item.medals.findIndex((n) => n);
      if (place > -1) line.append(el('i', undefined, `scwr-pip scwr-medal-${place}`));
      line.append(label, el('span', item.detail, 'scwr-meta'));
      grid.append(line);
    }
    if (state.view === 'academies' && row.roster.length > 12) {
      grid.append(el('p', `+ ${row.roster.length - 12} more ${unit(row.roster.length - 12, 'athlete')}`, 'scwr-meta'));
    }
    cell.append(grid);
    tr.append(cell);
    return tr;
  }

  function renderBody() {
    const cols = columns();
    const visible = rows.slice(0, state.limit);
    // One scale for every bar on screen, so lengths stay comparable.
    const ctx = {
      maxWins: Math.max(1, ...rows.map((r) => r.wins || 0)),
      maxLosses: Math.max(1, ...rows.map((r) => r.losses || 0)),
    };
    const nodes = [];
    visible.forEach((row, index) => {
      const tr = el('tr', undefined, 'scwr-row');
      tr.dataset.key = row.key;
      if (index < 3 && state.direction === -1) tr.classList.add('scwr-top');
      const rank = el('td', undefined, 'scwr-rank');
      if (state.view === 'brackets') {
        rank.textContent = String(index + 1);
      } else {
        const open = state.open.has(row.key);
        const toggle = el('button', String(index + 1), 'scwr-expand');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${row.name}`);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-controls', `scwr-detail-${row.key.replace(/[^a-z0-9_-]/gi, '-')}`);
        rank.append(toggle);
      }
      tr.append(rank);
      for (const col of cols) {
        const td = el('td', undefined, `scwr-col scwr-col-${col.key}`);
        if (col.align === 'start') td.classList.add('scwr-start');
        if (col.wide) td.classList.add('scwr-wide');
        if (col.grow) td.classList.add('scwr-grow');
        if (state.sort === col.key) td.classList.add('scwr-sorted');
        td.append(col.cell(row, ctx));
        tr.append(td);
      }
      if (state.view !== 'brackets') {
        const open = state.open.has(row.key);
        tr.classList.toggle('scwr-open', open);
        nodes.push(tr);
        if (open) nodes.push(detailRow(row, cols.length + 1));
      } else {
        nodes.push(tr);
      }
    });
    if (!visible.length) {
      const tr = el('tr', undefined, 'scwr-empty-row');
      const cell = el('td');
      cell.colSpan = cols.length + 1;
      const empty = el('div', undefined, 'scwr-empty');
      empty.append(el('p', `No ${VIEWS[state.view].unit[1]} match these filters.`, 'scwr-empty-title'));
      empty.append(el('p', state.search
        ? `Nothing matches “${state.search}”. Clear the search, or lower the minimum age and match filters.`
        : `Lower the minimum age${state.minimumAge ? ` below ${state.minimumAge}` : ''} or minimum match count${state.minimum > 1 ? ` below ${state.minimum}` : ''}.`, 'scwr-meta'));
      cell.append(empty);
      tr.append(cell);
      nodes.push(tr);
    }
    body.replaceChildren(...nodes);
  }

  // Sorting is the one moment worth animating: rows travel to their new rank so
  // the change reads as a re-order rather than a repaint.
  function flip(run) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = new Map();
    if (!reduced) {
      for (const tr of body.querySelectorAll('.scwr-row')) before.set(tr.dataset.key, tr.getBoundingClientRect().top);
    }
    run();
    if (reduced || !before.size) return;
    for (const tr of body.querySelectorAll('.scwr-row')) {
      const previous = before.get(tr.dataset.key);
      if (previous === undefined) continue;
      const delta = previous - tr.getBoundingClientRect().top;
      if (!delta) continue;
      tr.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }

  // Presentation the ranked data does not carry: profile links, and the one-line
  // caption printed under each name.
  const DECORATE = {
    brackets: (b) => Object.assign(b, {
      href: SCWRSite.url.bracket(EVENT_ID, b.id),
      meta: `${b.size} ${unit(b.size, 'competitor')}`,
    }),
    academies: (c) => Object.assign(c, {
      href: c.clubId ? SCWRSite.url.club(c.clubId) : null,
      meta: `${c.athletes} ${unit(c.athletes, 'athlete')} \u00b7 ${c.divisions} ${unit(c.divisions, 'entry', 'entries')}`,
    }),
    athletes: (s) => Object.assign(s, {
      href: profileHref(s),
      meta: [s.club || 'Unaffiliated', beltTone(s.belt) ? null : s.belt,
        `${s.divisions} ${unit(s.divisions, 'division')}`].filter(Boolean).join(' \u00b7 '),
    }),
  };

  function compute() {
    rows = SCWRModel.leaderboard(model, { ...state, table: state.view }).map(DECORATE[state.view]);
  }

  const TIEBREAK = 'ties go to more wins, then a higher win rate, then more golds, then a longer record, then A–Z';
  const EXPLAIN = {
    athletes: 'One row per athlete across every division they entered. Expand a row to see each bracket.',
    academies: 'Every athlete\'s record combined by academy. Expand a row to see who did the work.',
    brackets: 'The published gold medallist beside whoever won the most matches here under your win-type filter. Sort by Gap to find medals that match wins did not earn.',
  };

  function render({ animate = false } = {}) {
    if (!model) return;
    const matchupOnly = state.matchupOpen;
    for (const surface of [tools, status, scroll, foot, officialControl]) surface.hidden = matchupOnly;
    renderMatchupSurface();
    if (matchupOnly) return;
    table.dataset.view = state.view;
    for (const field of panel.querySelectorAll('[data-only]')) {
      field.hidden = !field.dataset.only.split(' ').includes(state.view);
    }
    const draw = () => { compute(); renderHead(); renderBody(); };
    if (animate) flip(draw); else draw();

    const total = rows.length;
    const shown = Math.min(total, state.limit);
    key.hidden = !columns().some((c) => c.key === 'finish');
    more.hidden = total <= state.limit;
    more.textContent = `Show ${Math.min(25, total - state.limit)} more`;
    const sorted = columns().find((c) => c.key === state.sort);
    const order = state.sort === 'name' ? (state.direction === 1 ? 'A–Z' : 'Z–A')
      : `${state.direction === -1 ? 'highest' : 'lowest'} first`;
    note.textContent = `${shown === total ? total : `${shown} of ${total}`} ${unit(total, ...VIEWS[state.view].unit)}` +
      ` · sorted by ${sorted?.label ?? state.sort}, ${order}` +
      `${state.sort === 'name' ? '' : ` — ${TIEBREAK}`} · ${EXPLAIN[state.view]}`;

    const countsWalkovers = state.types.includes('walkover');
    const parts = [
      `${model.athletes.size} athletes`, `${model.brackets.size} brackets`,
      `${model.fought} fought ${unit(model.fought, 'match', 'matches')}`,
      `${model.walkovers} ${unit(model.walkovers, 'walkover')} ${countsWalkovers ? 'counted' : 'excluded'}`,
      state.minimumAge ? `ages ${state.minimumAge}+` : 'all ages',
      `updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ];
    if (state.minimumAge) {
      const unknownAges = [...model.athletes.values()].filter((athlete) => !Number.isFinite(athlete.age)).length;
      if (unknownAges) parts.push(`${unknownAges} unknown ${unit(unknownAges, 'age')} excluded`);
    }
    if (model.unresolved) parts.push(`${model.unresolved} undecided ${unit(model.unresolved, 'match', 'matches')} excluded`);
    // Two very different situations used to share one warning. A fought match
    // that will not attach to a bracket really does leave a record short. A
    // walkover against someone missing from the published results does not:
    // the winner is credited, and the absentee has no record to shorten.
    const notes = [];
    if (model.unmatchedContested) {
      parts.push(`${model.unmatchedContested} fought ${unit(model.unmatchedContested, 'match', 'matches')} unmatched`);
      notes.push(`${model.unmatchedContested} contested ${unit(model.unmatchedContested, 'match', 'matches')} could not be attached to any published bracket, so the records involved are short by that much.`);
    }
    const noShows = model.unmatched - model.unmatchedContested;
    if (countsWalkovers && noShows) {
      parts.push(`${noShows} ${unit(noShows, 'walkover')} against a no-show`);
      notes.push(`${noShows} ${unit(noShows, 'walkover')} were awarded against competitors who never appear in the published results — withdrawals and no-shows. The walkover win is still counted for the athlete who received it; there is simply nobody on the other side to record the loss against.`);
    }
    status.textContent = parts.join(' · ');
    status.title = notes.join('\n\n');
  }

  function rebuildSummaries() {
    summaries = new Map([...model.athletes.values()].map((a) => [a.key, SCWRModel.summarize(a, model, counting())]));
  }

  function orderResults() {
    if (!vm || !model) return;
    const score = (r) => Math.max(0, ...placements(r).map((p) => summaries.get(athleteKey(p, r.bracket.id))?.[state.bracketSort] ?? 0));
    const size = (r) => model.brackets.get(String(r.bracket.id))?.size ?? 0;
    const best = (r) => Math.min(Infinity, ...placements(r).map((p) => Number(p.placement)));
    vm.eventResults = [...vm.eventResults].sort((a, b) => {
      if (state.bracketSort === 'placement') return best(a) - best(b) || size(b) - size(a);
      if (state.bracketSort === 'size') return size(b) - size(a);
      return score(b) - score(a) || size(b) - size(a);
    });
  }

  function decorate() {
    if (!model || !vm) return;
    observer.disconnect();
    for (const group of root.querySelectorAll('.result')) {
      const id = SCWRSite.bracketId(group.querySelector('a[href*="/bracket/"]')?.getAttribute('href'));
      const bracket = model.brackets.get(id);
      if (!bracket) continue;
      const heading = group.querySelector('h2');
      let size = heading?.querySelector('.scwr-bracket-size');
      if (heading && !size) { size = el('span', undefined, 'scwr-bracket-size'); heading.append(size); }
      if (size) size.textContent = ` ${bracket.size} ${unit(bracket.size, 'competitor')}`;
      const visible = vm.eventResults.find((r) => String(r.bracket.id) === id);
      const entries = placements(visible ?? {});
      const names = [...group.querySelectorAll('h3.name')].map((name) => ({ name, host: name.parentElement }));
      for (const badge of group.querySelectorAll('.badge.badge-default')) {
        if (badge.nextElementSibling) names.push({ name: badge.nextElementSibling, host: badge.parentElement });
      }
      for (const { name, host } of names) {
        const text = name.cloneNode(true);
        text.querySelectorAll('small, .flag-icon, .scwr-inline').forEach((n) => n.remove());
        const candidates = entries.filter((p) => normalize(p.target?.fullname) === normalize(text.textContent));
        const userId = SCWRSite.profileId(name.querySelector('a[href*="/profile/"]')?.getAttribute('href'));
        const p = userId ? candidates.find((c) => String(c.target?.user_id) === userId) : candidates.length === 1 ? candidates[0] : null;
        if (!p) continue;
        const key = athleteKey(p, id);
        const athlete = summaries.get(key);
        if (!athlete) continue;
        let inline = host.querySelector(':scope > .scwr-inline');
        if (!inline) { inline = el('div', undefined, 'scwr-inline'); host.append(inline); }
        const one = SCWRModel.entryRecord(bracket.entries.get(key), state.types);
        inline.replaceChildren(
          stat(record(one), 'here'), stat(record(athlete), 'event'),
          stat(percent(athlete.rate), 'win rate'), stat(athlete.submissions, unit(athlete.submissions, 'sub')),
          stat(athlete.golds, unit(athlete.golds, 'gold')),
        );
        inline.title = `Competition wins: ${breakdown(athlete.types) || 'none'}. Counting ${state.types.map((t) => WIN_LABEL[t][1]).join(', ')}; byes never count.`;
      }
    }
    observer.observe(root, { childList: true, subtree: true });
  }

  function stat(value, label) {
    const node = el('span', undefined, 'scwr-chip');
    node.append(el('b', String(value)), el('span', label));
    return node;
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  });

  async function post(path, label) {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(token ? { 'X-CSRF-TOKEN': token } : {}) },
      body: '{}',
    });
    if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
    return response.json();
  }

  async function fetchResults() {
    const data = await post(SCWRSite.url.data(EVENT_ID, 'results', 'getResults'), 'Results');
    if (!Array.isArray(data.eventResults) || data.isSearchResult) throw new Error('Full competition results unavailable.');
    return data.eventResults;
  }

  // Ages, belts and photos live only in the registration list. They are a bonus,
  // so a failure here must never cost the reader the standings.
  async function fetchRoster() {
    try {
      return SCWRModel.roster(await post(SCWRSite.url.data(EVENT_ID, 'participants'), 'Participants'));
    } catch {
      return null;
    }
  }

  function skeleton() {
    const cols = columns().length + 1;
    body.replaceChildren(...Array.from({ length: 8 }, () => {
      const tr = el('tr', undefined, 'scwr-row scwr-skeleton');
      for (let i = 0; i < cols; i++) {
        const td = el('td', undefined, 'scwr-col');
        td.append(el('span', undefined, 'scwr-shimmer'));
        tr.append(td);
      }
      return tr;
    }));
  }

  async function load(refresh = false) {
    if (busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    panel.querySelector('[data-action="refresh"]').disabled = true;
    status.textContent = 'Reading the match list…';
    renderHead();
    skeleton();
    try {
      const [results, data, people] = await Promise.all([
        fetchResults(), SCWRMatches.loadEvent((done, total) => { status.textContent = `Reading the match list · page ${done} of ${total}`; }, { refresh }),
        fetchRoster(),
      ]);
      eventMatches = data.matches;
      model = SCWRModel.attachRoster(SCWRModel.build(results, data.matches), people);
      updatedAt = data.at;
      rebuildSummaries();
      syncAcademyNames();
      render(); orderResults(); decorate();
    } catch (error) {
      // Put the numbers we already had back on screen; skeleton() cleared them,
      // and the message below promises they are still here.
      if (model) render(); else body.replaceChildren();
      status.textContent = `${model ? 'Showing the previous numbers. ' : ''}${error.message} Open the event's Matches page to check access, then hit Refresh.`;
    } finally {
      busy = false;
      panel.setAttribute('aria-busy', 'false');
      panel.querySelector('[data-action="refresh"]').disabled = false;
    }
  }

  function setView(view) {
    if (view === 'matchups') {
      if (state.matchupOpen) return;
      state.matchupOpen = true;
      for (const tab of panel.querySelectorAll('.scwr-tab')) {
        const on = tab.dataset.view === 'matchups';
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      savePrefs();
      return render();
    }
    if (state.view === view && !state.matchupOpen) return;
    state.matchupOpen = false;
    state.view = view;
    state.limit = 25;
    state.open.clear();
    state.sort = DEFAULT_SORT[view];
    state.direction = -1;
    for (const tab of panel.querySelectorAll('.scwr-tab')) {
      const on = tab.dataset.view === state.view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    table.setAttribute('aria-labelledby', `scwr-tab-${view}`);
    savePrefs();
    render();
  }

  panel.addEventListener('input', (event) => {
    const key = event.target.dataset.filter;
    if (!key) return;
    if (key === 'minimum' || key === 'minimumAge') {
      const value = Math.max(0, Math.floor(Number(event.target.value)) || 0);
      state[key] = key === 'minimumAge' ? Math.min(120, value) : value;
      event.target.value = key === 'minimumAge' && !state[key] ? '' : String(state[key]);
      if (key === 'minimumAge') event.target.parentElement.dataset.active = String(state.minimumAge > 0);
    } else {
      state[key] = event.target.value;
    }
    state.limit = 25;
    savePrefs();
    if (state.matchupOpen && key === 'minimumAge' && event.target.closest('.scwr-h2h-age')) {
      renderMatchupResults();
      return;
    }
    render();
    if (key === 'bracketSort') { orderResults(); decorate(); }
  });

  panel.addEventListener('click', (event) => {
    const matchupAction = event.target.closest('[data-matchup-action]')?.dataset.matchupAction;
    if (matchupAction === 'swap') {
      [state.academyA, state.academyB] = [state.academyB, state.academyA];
      savePrefs();
      renderMatchupSurface();
      matchupSlot.querySelector('[data-matchup-action="swap"]')?.focus();
      return;
    }

    const tab = event.target.closest('.scwr-tab');
    if (tab) return setView(tab.dataset.view);

    const chip = event.target.closest('.scwr-chip-toggle');
    if (chip) {
      const type = chip.dataset.type;
      const next = state.types.includes(type) ? state.types.filter((t) => t !== type) : [...state.types, type];
      if (!next.length) return; // never leave every win type off
      state.types = WIN_TYPES.filter((t) => next.includes(t));
      state.limit = 25;
      savePrefs();
      if (model) rebuildSummaries();
      paintChips();
      if (chip.dataset.matchupType) {
        for (const button of matchupSlot.querySelectorAll('[data-matchup-type]')) {
          button.setAttribute('aria-pressed', String(state.types.includes(button.dataset.matchupType)));
        }
        renderMatchupResults();
        orderResults();
        decorate();
        return;
      }
      render({ animate: true });
      orderResults();
      decorate();
      return;
    }

    const sort = event.target.closest('.scwr-sort');
    if (sort) {
      const key = sort.dataset.sort;
      const column = columns().find((c) => c.key === key);
      // Every column opens on its most useful end: biggest first, except names
      // and "how they lost", where the best story is the smallest number.
      const opening = key === 'name' || column?.reverse ? 1 : -1;
      state.direction = state.sort === key ? -state.direction : opening;
      state.sort = key;
      state.limit = 25;
      savePrefs();
      return render({ animate: true });
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'refresh') return load(true);
    if (action === 'more') { state.limit += 25; return render(); }

    const row = event.target.closest('.scwr-row');
    if (row && !event.target.closest('a') && state.view !== 'brackets') {
      state.open.has(row.dataset.key) ? state.open.delete(row.dataset.key) : state.open.add(row.dataset.key);
      render();
    }
  });

  panel.addEventListener('change', (event) => {
    const key = event.target.dataset.matchupAcademy;
    if (!key) return;
    state[key] = event.target.value;
    const other = key === 'academyA' ? 'academyB' : 'academyA';
    if (state[key] === state[other]) state[other] = academyNames.find((name) => name !== state[key]) ?? '';
    savePrefs();
    renderMatchupSurface();
    matchupSlot.querySelector(`[data-matchup-academy="${key}"]`)?.focus();
  });

  panel.addEventListener('keydown', (event) => {
    const tab = event.target.closest('.scwr-tab');
    if (!tab || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...panel.querySelectorAll('.scwr-tab')];
    const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    setView(next.dataset.view);
  });

  function syncControls() {
    for (const [key, value] of Object.entries({ minimum: state.minimum, bracketSort: state.bracketSort })) {
      const control = panel.querySelector(`[data-filter="${key}"]`);
      if (control) control.value = String(value);
    }
    const ageInput = panel.querySelector('[data-filter="minimumAge"]');
    ageInput.value = state.minimumAge ? String(state.minimumAge) : '';
    ageInput.parentElement.dataset.active = String(state.minimumAge > 0);
    for (const tab of panel.querySelectorAll('.scwr-tab')) {
      const on = tab.dataset.view === (state.matchupOpen ? 'matchups' : state.view);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    table.setAttribute('aria-labelledby', `scwr-tab-${state.view}`);
    paintChips();
  }

  syncControls();
  // Expanding a bracket re-renders the official list, so re-apply our order and
  // the inline records after the site has fetched it.
  SCWRSite.vm.find(root, (c) => Array.isArray(c.data?.eventResults) && !c.data.loading).then((found) => {
    if (!found) return;
    vm = found;
    SCWRSite.vm.after(vm, 'getResult', () => { orderResults(); requestAnimationFrame(decorate); });
    orderResults(); decorate();
  });
  load();
})();
