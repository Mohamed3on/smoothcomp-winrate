// Adds a sortable "Win rate" column to Smoothcomp ranking lists (the toplist page).
const { readCache, loadMatchData, clubRecord } = SCWRMatches;
const { WIN_TYPES, eventId } = SCWRSite;

const KEYS = {
  rank: { label: 'Rank', get: (r) => r.rank, dir: 1 },
  points: { label: 'Points', get: (r) => r.points, dir: -1 },
  rate: { label: 'Win rate', get: (r) => r.rate, dir: -1 },
  wins: { label: 'Wins', get: (r) => r.wins, dir: -1 },
  losses: { label: 'Losses', get: (r) => r.losses, dir: -1 },
};

// `ref` is the academy whose match count is the comparison threshold.
// `types` are the win types that count; walkovers are excluded by default
// because they are forfeits, not contests.
const state = Object.assign(
  { key: 'wins', dir: KEYS.wins.dir, ref: '', types: WIN_TYPES.filter((t) => t !== 'walkover') },
  SCWRSite.store.get('toplist-prefs', {}),
);
let md = readCache(); // cached match data, if this event was loaded before

const save = () => SCWRSite.store.set('toplist-prefs', state);

const num = (el) => (el ? parseFloat(el.textContent.replace(/[^\d.]/g, '')) : NaN);

function read(row, idx) {
  // Once the columns are rewritten, the site's own figures live in the dataset.
  const stashed = row.dataset.scwrW !== undefined;
  const wins = stashed ? +row.dataset.scwrW : num(row.querySelector('.wins strong'));
  const losses = stashed ? +row.dataset.scwrL : num(row.querySelector('.losses strong'));
  if (isNaN(wins) || isNaN(losses)) return null;
  const total = wins + losses;
  return {
    row,
    idx,
    wins,
    losses,
    total,
    rate: total ? (wins / total) * 100 : null,
    points: num(row.querySelector('.points strong')) || 0,
    rank: num(row.querySelector('.placement')) || idx + 1,
    name: row.querySelector('.entity-name a')?.textContent.trim() || '',
    officialWins: wins,
    officialLosses: losses,
  };
}

const ABBR = {
  submission: 'sub',
  points: 'pts',
  decision: 'dec',
  disqualification: 'dq',
  walkover: 'wo',
};

// Keep the site's Wins/Losses columns in step with the selected win types, so
// sorting by them matches what is on screen. Originals are kept on the row.
function writeCounts(d, adj) {
  const w = d.row.querySelector('.wins strong');
  const l = d.row.querySelector('.losses strong');
  if (!w || !l) return;
  if (d.row.dataset.scwrW === undefined) {
    d.row.dataset.scwrW = d.officialWins;
    d.row.dataset.scwrL = d.officialLosses;
  }
  w.textContent = adj ? adj.wins : d.officialWins;
  l.textContent = adj ? adj.losses : d.officialLosses;
  const note = adj ? `Smoothcomp counts ${d.officialWins} W – ${d.officialLosses} L` : '';
  w.parentElement.title = note;
  l.parentElement.title = note;
}

// Recount every row against the selected win types. Returns new rows rather than
// editing them in place, so sorting no longer depends on the cells having been
// rendered first. Rows with no match data keep the site's own figures.
function adjust(rows) {
  return rows.map((d) => {
    const tally = md?.clubs?.[d.name];
    if (!tally) return d;
    const adj = clubRecord(tally, state.types);
    return { ...d, wins: adj.wins, losses: adj.losses, total: adj.total, adj,
      rate: adj.total ? (adj.wins / adj.total) * 100 : null };
  });
}

function cell(d) {
  const el = document.createElement('div');
  el.className = 'scwr-cell';
  const adj = d.adj ?? null;
  if (adj) el.classList.add('scwr-adj');
  writeCounts(d, adj);
  if (d.rate === null) {
    el.innerHTML = '<strong>&ndash;</strong><br><span class="scwr-label">Win rate</span>';
    return el;
  }
  // 35% and below reads red, 50% amber, 75% and up green.
  const hue = Math.max(0, Math.min(135, (d.rate - 35) * 3.375));
  el.style.color = `hsl(${hue} 72% 55%)`;
  if (d.name) el.dataset.name = d.name;
  el.title =
    (adj
      ? `${adj.wins} W – ${adj.losses} L · ${adj.total} matches (${state.types.join(', ')})\n` +
        `site total: ${d.officialWins} W – ${d.officialLosses} L`
      : `${d.wins} W – ${d.losses} L · ${d.total} matches`) +
    '\nClick to compare everyone against this academy';
  // Win-loss record for each selected type, e.g. "9-5 sub  4-3 pts".
  const mix = adj?.split.length
    ? '<span class="scwr-mix">' +
      adj.split
        .map(
          ([k, w, l]) =>
            `<b><span class="w">${w}</span><span class="l">${l}</span><i>${ABBR[k] ?? k}</i></b>`,
        )
        .join('') +
      '</span>'
    : '';
  el.innerHTML =
    `<strong>${Math.round(d.rate)}%</strong><br>` +
    '<span class="scwr-label">Win rate</span>' +
    `<span class="scwr-bar"><i style="width:${d.rate}%"></i></span>` +
    mix;
  return el;
}

// The win types this event actually produced, else the common ones.
const typeList = () => (md?.types?.length ? md.types : WIN_TYPES);

function toolbar(list) {
  const bar = document.createElement('div');
  bar.className = 'scwr-toolbar';
  bar.innerHTML =
    '<span class="scwr-title">Sort by</span>' +
    Object.entries(KEYS)
      .map(([k, v]) => `<button class="scwr-btn" data-k="${k}">${v.label}<i></i></button>`)
      .join('') +
    '<label class="scwr-min">Min matches vs<select></select></label>' +
    '<span class="scwr-note"></span>' +
    '<div class="scwr-types"><span class="scwr-title">Count wins by</span>' +
    '<span class="scwr-chips"></span><span class="scwr-status"></span></div>';

  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.scwr-chip');
    if (chip) {
      const t = chip.dataset.t;
      const next = state.types.includes(t)
        ? state.types.filter((x) => x !== t)
        : [...state.types, t];
      if (!next.length) return; // never leave every type off
      state.types = next;
      save();
      repaint(list);
      return;
    }
    const btn = e.target.closest('.scwr-btn');
    if (!btn) return;
    const k = btn.dataset.k;
    state.dir = state.key === k ? -state.dir : KEYS[k].dir;
    state.key = k;
    save();
    apply(list);
  });
  bar.querySelector('select').addEventListener('change', (e) => {
    setRef(list, e.target.value);
  });
  return bar;
}

function setRef(list, name) {
  state.ref = name;
  save();
  apply(list);
}

// One option per academy, most-tested first.
function fillRefs(list) {
  const sel = list.querySelector('.scwr-min select');
  sel.replaceChildren(new Option('Anyone', ''));
  list.scwrRows
    .filter((d) => d.total)
    .sort((a, b) => b.total - a.total)
    .forEach((d) => sel.append(new Option(`${d.name} · ${d.total}`, d.name)));
}

function apply(list) {
  const bar = list.querySelector('.scwr-toolbar');
  bar.querySelectorAll('.scwr-btn').forEach((b) => {
    const on = b.dataset.k === state.key;
    b.classList.toggle('is-on', on);
    b.querySelector('i').textContent = on ? (state.dir > 0 ? '↑' : '↓') : '';
  });
  const chips = bar.querySelector('.scwr-chips');
  const want = typeList();
  if (chips.dataset.built !== want.join()) {
    chips.dataset.built = want.join();
    chips.innerHTML = want
      .map((t) => `<button class="scwr-chip" data-t="${t}">${t}</button>`)
      .join('');
  }
  chips.querySelectorAll('.scwr-chip').forEach((c) => {
    c.classList.toggle('is-on', state.types.includes(c.dataset.t));
    c.disabled = !md;
  });

  const sel = bar.querySelector('select');
  sel.value = state.ref;
  if (sel.value !== state.ref) state.ref = ''; // benchmark belongs to another list

  const rows = list.scwrRows.filter((d) => d.row.isConnected);
  const min = rows.find((d) => d.name === state.ref)?.total || 0;

  // Anyone with a smaller sample than the benchmark is faded out rather than
  // removed, so the ranking stays intact.
  let below = 0;
  rows.forEach((d) => {
    const out = min > 0 && d.total < min;
    below += out;
    d.row.classList.toggle('scwr-thin', out);
    d.row.querySelector('.scwr-cell')?.classList.toggle('scwr-ref', min > 0 && d.name === state.ref);
  });
  bar.querySelector('.scwr-note').textContent = min ? `≥ ${min} matches · ${below} faded` : '';

  const { key, dir } = state;
  const get = KEYS[key].get;

  rows
    .slice()
    .sort((a, b) => {
      // Sorting by win rate, a thin sample never outranks a real one.
      if (key === 'rate') {
        const weak = (d) => (d.rate === null ? 2 : min > 0 && d.total < min ? 1 : 0);
        if (weak(a) !== weak(b)) return weak(a) - weak(b);
      }
      return (get(a) - get(b)) * dir || a.idx - b.idx;
    })
    .forEach((d) => list.appendChild(d.row));
}

// The site's Vue app drops foreign nodes when it patches, so the toolbar can
// vanish while the rows survive. Both need checking.
const stale = (list) =>
  !list.querySelector(':scope > .scwr-toolbar') ||
  list.querySelector(':scope > .well:not(:has(.scwr-cell))') ||
  [...list.children].filter((el) => el.classList.contains('well')).length !==
    list.scwrRows?.length;

function paint(rows) {
  rows.forEach((d, i) => {
    d.idx = i;
    d.row.querySelector('.scwr-cell')?.remove();
    // Inside the points block, ahead of the mobile expand chevron.
    const stats = d.row.querySelector('.stats-points');
    const c = cell(d);
    if (stats) stats.insertBefore(c, stats.querySelector('.collapse-button'));
    else d.row.appendChild(c);
  });
}

// Rebuild the cells (win-type selection changed or match data arrived).
function repaint(list) {
  if (!list.scwrRows) return;
  const fresh = adjust([...list.children]
    .filter((el) => el.classList.contains('well'))
    .map(read)
    .filter(Boolean));
  paint(fresh);
  list.scwrRows = fresh;
  fillRefs(list);
  apply(list);
}

function enhance(list) {
  if (!stale(list)) return;
  const wells = [...list.children].filter((el) => el.classList.contains('well'));

  const rows = adjust(wells.map(read).filter(Boolean));
  if (!rows.length) return;

  paint(rows);
  list.scwrRows = rows;
  if (!list.querySelector(':scope > .scwr-toolbar')) list.prepend(toolbar(list));
  if (!list.scwrBound) {
    list.scwrBound = true;
    list.addEventListener('click', (e) => {
      const c = e.target.closest('.scwr-cell[data-name]');
      if (c) setRef(list, c.dataset.name === state.ref ? '' : c.dataset.name);
    });
  }
  fillRefs(list);
  apply(list);
  ensureMatchData(list);
}

let loading = false;
function setStatus(list, text) {
  const el = list.querySelector('.scwr-status');
  if (el) el.textContent = text;
}

// Fetch the event's matches once, then recompute every win rate from them.
async function ensureMatchData(list) {
  if (loading || !eventId()) return;
  if (md) {
    setStatus(list, `${md.matched}/${md.total} teams matched`);
    return; // already served from cache before the first paint
  }
  loading = true;
  setStatus(list, 'loading matches…');
  try {
    const official = new Map(list.scwrRows.map((d) => [d.name, d.officialWins]));
    md = await loadMatchData(official, (done, total) => setStatus(list, `loading matches ${done}/${total}`));
    if (md) {
      const fresh = (md.types ?? []).filter((t) => !WIN_TYPES.includes(t) && t !== 'walkover');
      if (fresh.length) {
        state.types = [...new Set([...state.types, ...fresh])];
        save();
      }
      setStatus(list, `${md.matched}/${md.total} teams matched`);
      repaint(list);
    } else {
      setStatus(list, '');
    }
  } catch (e) {
    setStatus(list, 'match data unavailable');
    console.warn('[scwr] match data failed', e);
  } finally {
    loading = false;
  }
}

const watch = () => observer.observe(document.body, { childList: true, subtree: true });

let queued = false;
function run() {
  queued = false;
  // Cheap bail-out: unrelated widgets keep the observer busy.
  const lists = [...document.querySelectorAll('.ranking-list-detail')];
  if (!lists.some(stale)) return;
  observer.disconnect();
  lists.forEach(enhance);
  watch();
}

const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(run);
});

watch();
run();
