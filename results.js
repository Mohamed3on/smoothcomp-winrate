// Keep the official results, with a sortable competition table above and records
// inline. Every number here is recomputed from the event's own match list.
(() => {
  const { placements, athleteKey, normalize } = SCWRModel;
  const { WIN_TYPES } = SCWRSite;
  const EVENT_ID = SCWRSite.eventId();
  const counting = () => ({ types: state.types });
  const state = {
    view: 'athletes', sort: 'wins', direction: -1, search: '', minimum: 1, division: 'all', age: 'all',
    // Same default as the team rankings page: every decided win type but walkovers.
    types: WIN_TYPES.filter((t) => t !== 'walkover'),
    limit: 25, bracketSort: 'placement', open: new Set(),
  };
  let model = null;
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
  const count = (n) => (n ? String(n) : '·');
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
      { key: 'submissions', label: 'Subs', title: 'Wins by submission.', cell: (r) => strong(count(r.submissions)) },
      { key: 'submitted', label: 'Sub’d', title: 'Times they were submitted. Low is dominant.', cell: (r) => muted(count(r.submitted)), reverse: true },
      ...MEDAL_COLUMNS,
      { key: 'biggest', label: 'Bracket size', title: 'Competitors in the largest bracket they entered, whatever they placed.', cell: (r) => muted(r.biggestBracket || '—') },
    ],
    academies: [
      { key: 'name', label: 'Academy', align: 'start', cell: identityCell, grow: true },
      { key: 'wins', label: 'W–L', title: 'Combined record of every athlete from this academy.', cell: (r) => strong(record(r)) },
      { key: 'rate', label: 'Win %', title: 'Wins ÷ matches contested.', cell: (r) => strong(percent(r.rate)) },
      { key: 'finish', label: 'How they won', align: 'start', title: 'Every win, ordered from the most decisive finish to the least.', cell: barCell, wide: true },
      { key: 'submissions', label: 'Subs', title: 'Wins by submission.', cell: (r) => strong(count(r.submissions)) },
      { key: 'depth', label: 'W/athlete', title: 'Wins per athlete entered. Separates a deep team from one carried by a single competitor.', cell: (r) => muted(r.depth ? r.depth.toFixed(1) : '—') },
      ...MEDAL_COLUMNS,
      { key: 'athletes', label: 'Athletes', title: 'Athletes this academy entered who appear in the published results.', cell: (r) => muted(r.athletes) },
    ],
    brackets: [
      { key: 'name', label: 'Division', align: 'start', cell: identityCell, grow: true },
      { key: 'size', label: 'Bracket size', title: 'Competitors in the published placement list.', cell: (r) => strong(r.size) },
      { key: 'wins', label: 'Gold medal', align: 'start', title: 'Who the published results awarded gold, and the record they posted in this bracket.', cell: (r) => personCell(r.champion), wide: true },
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

  function identityCell(row) {
    const wrap = el('div', undefined, 'scwr-identity');
    const name = row.href ? el('a', row.name, 'scwr-name') : el('span', row.name, 'scwr-name');
    if (row.href) name.href = row.href;
    wrap.append(name);
    if (row.meta) wrap.append(el('span', row.meta, 'scwr-meta'));
    return wrap;
  }

  // Bar length is total wins against the leader; the ordinal ramp inside it runs
  // from the most decisive finish to the least.
  function barCell(row, ctx) {
    const wrap = el('div', undefined, 'scwr-bar');
    if (!row.wins) return wrap.append(el('span', '—', 'scwr-num scwr-num-muted')), wrap;
    const track = el('div', undefined, 'scwr-bar-track');
    track.style.width = `${Math.max(4, (row.wins / (ctx.maxWins || 1)) * 100)}%`;
    for (const type of WIN_TYPES) {
      const n = row.types[type];
      if (!n) continue;
      const seg = el('i', undefined, `scwr-seg scwr-seg-${type}`);
      seg.style.flexGrow = String(n);
      seg.title = `${n} by ${type}`;
      track.append(seg);
    }
    const legend = el('span', shortBreakdown(row.types), 'scwr-bar-legend');
    legend.title = `${row.wins} ${unit(row.wins, 'win')}: ${breakdown(row.types)}`;
    wrap.append(track, legend);
    return wrap;
  }

  function personCell(person, absent = 'Not awarded') {
    const wrap = el('div', undefined, 'scwr-identity');
    if (!person) return wrap.append(el('span', absent, 'scwr-meta')), wrap;
    const href = profileHref(person);
    const name = href ? el('a', person.name, 'scwr-name') : el('span', person.name, 'scwr-name');
    if (href) name.href = href;
    wrap.append(name);
    wrap.append(el('span', `${person.club || 'Unaffiliated'} · ${record(person)} here · ${breakdown(person.types) || 'no counted wins'}`, 'scwr-meta'));
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
  const PERSISTED = ['view', 'sort', 'direction', 'division', 'age', 'minimum', 'types', 'bracketSort'];

  // Stored values are never trusted. A column can be renamed or dropped between
  // versions, and one bad field would otherwise take the whole table down.
  function restorePrefs() {
    const saved = SCWRSite.store.get(PREFS_KEY);
    if (!saved || typeof saved !== 'object') return;
    const oneOf = (value, allowed) => (allowed.includes(value) ? value : undefined);
    const restored = {
      view: oneOf(saved.view, Object.keys(VIEWS)),
      division: oneOf(saved.division, ['all', 'gi', 'nogi']),
      age: oneOf(saved.age, ['all', 'adults', 'youth']),
      bracketSort: oneOf(saved.bracketSort, ['placement', 'size', 'wins', 'submissions']),
      direction: oneOf(saved.direction, [1, -1]),
      minimum: Number.isFinite(saved.minimum) && saved.minimum >= 0 ? Math.floor(saved.minimum) : undefined,
      types: Array.isArray(saved.types) ? WIN_TYPES.filter((t) => saved.types.includes(t)) : undefined,
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
    </div>
    <div class="scwr-tools">
      <label class="scwr-field scwr-field-grow"><span>Search</span>
        <input data-filter="search" type="search" placeholder="Name, academy or division" autocomplete="off"></label>
      <label class="scwr-field"><span>Division</span><select data-filter="division">
        <option value="all">All</option><option value="gi">Gi</option><option value="nogi">No Gi</option></select></label>
      <label class="scwr-field"><span>Age group</span><select data-filter="age">
        <option value="all">All</option><option value="adults">Adults</option>
        <option value="youth">Kids &amp; teens</option></select></label>
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
      <ul class="scwr-key" aria-label="How they won, most decisive first"></ul>
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
    const ctx = { maxWins: Math.max(1, ...rows.map((r) => r.wins || 0)) };
    const nodes = [];
    visible.forEach((row, index) => {
      const tr = el('tr', undefined, 'scwr-row');
      tr.dataset.key = row.key;
      if (index < 3 && state.direction === -1) tr.classList.add('scwr-top');
      const rank = el('td', String(index + 1), 'scwr-rank');
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
        tr.tabIndex = 0;
        tr.setAttribute('role', 'button');
        const open = state.open.has(row.key);
        tr.setAttribute('aria-expanded', String(open));
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
        ? `Nothing matches “${state.search}”. Clear the search, or widen the division and minimum-match filters.`
        : `Lower the minimum match count${state.minimum > 1 ? ` below ${state.minimum}` : ''}, or switch the division and age filters back to All.`, 'scwr-meta'));
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
      meta: `${s.club || 'Unaffiliated'} \u00b7 ${s.divisions} ${unit(s.divisions, 'division')}`,
    }),
  };

  function compute() {
    rows = SCWRModel.leaderboard(model, { ...state, table: state.view }).map(DECORATE[state.view]);
  }

  const SCOPE = { all: 'every division', adults: 'adult divisions only', youth: 'kids & teens only' };
  const TIEBREAK = 'ties go to more wins, then a higher win rate, then more golds, then A–Z';
  const EXPLAIN = {
    athletes: 'One row per athlete across every division they entered. Expand a row to see each bracket.',
    academies: 'Every athlete\'s record combined by academy. Expand a row to see who did the work.',
    brackets: 'The published gold medallist beside whoever won the most matches here under your win-type filter. Sort by Gap to find medals that match wins did not earn.',
  };

  function render({ animate = false } = {}) {
    if (!model) return;
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
      `covering ${SCOPE[state.age]}`,
      `updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ];
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

  async function fetchResults() {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    const response = await fetch(SCWRSite.url.event(EVENT_ID, 'results', 'getResults'), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(token ? { 'X-CSRF-TOKEN': token } : {}) },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Results request failed (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.eventResults) || data.isSearchResult) throw new Error('Full competition results unavailable.');
    return data.eventResults;
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
      const [results, data] = await Promise.all([
        fetchResults(), SCWRMatches.loadEvent((done, total) => { status.textContent = `Reading the match list · page ${done} of ${total}`; }, { refresh }),
      ]);
      model = SCWRModel.build(results, data.matches);
      updatedAt = data.at;
      rebuildSummaries();
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
    if (state.view === view) return;
    state.view = view;
    state.limit = 25;
    state.open.clear();
    state.sort = DEFAULT_SORT[view];
    state.direction = -1;
    for (const tab of panel.querySelectorAll('.scwr-tab')) {
      const on = tab.dataset.view === view;
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
    state[key] = key === 'minimum'
      ? Math.max(0, Math.floor(Number(event.target.value)) || 0)
      : event.target.value;
    state.limit = 25;
    savePrefs();
    render();
    if (key === 'bracketSort') { orderResults(); decorate(); }
  });

  panel.addEventListener('click', (event) => {
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
      // and "times submitted", where the best story is the smallest number.
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

  panel.addEventListener('keydown', (event) => {
    const row = event.target.closest('.scwr-row');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      row.click();
      return;
    }
    const tab = event.target.closest('.scwr-tab');
    if (!tab || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...panel.querySelectorAll('.scwr-tab')];
    const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    setView(next.dataset.view);
  });

  function syncControls() {
    for (const [key, value] of Object.entries({ division: state.division, age: state.age, minimum: state.minimum, bracketSort: state.bracketSort })) {
      const control = panel.querySelector(`[data-filter="${key}"]`);
      if (control) control.value = String(value);
    }
    for (const tab of panel.querySelectorAll('.scwr-tab')) {
      const on = tab.dataset.view === state.view;
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
