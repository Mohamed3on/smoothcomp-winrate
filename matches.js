// Pulls the event's full match list so win rate can be recomputed per win type.
// The toplist API only exposes aggregate win/lose, which counts walkover wins.

const SCWRMatches = (() => {
const { WIN_TYPES, isYouth, eventId, url, store } = SCWRSite;
// A toplist covers one age group, so the summary is keyed by which one is on screen.
const SUMMARY_KEY = (id) => `club-summary:${id}:${location.pathname}`;

// Synchronous so a repeat visit can paint adjusted numbers on the first pass,
// with no flash of the site's own win rates.
function readCache(id = eventId()) {
  return id ? store.read(SUMMARY_KEY(id)) : null;
}

// "Won by points - 03:00" -> "points"; "Won by Disqualification (dq)" -> "disqualification"
function winType(text) {
  const t = text.replace(/\s+/g, ' ').replace(/^\s*Won\s+by\s*/i, '').split(/\s+-\s+/)[0];
  return t.trim().split(/[\s(]/)[0].toLowerCase() || 'unknown';
}

function parsePage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const row of doc.querySelectorAll('.match-row')) {
    const cat = row.previousElementSibling?.classList.contains('category-row')
      ? row.previousElementSibling.textContent.replace(/\s+/g, ' ').trim()
      : '';
    const status = row.querySelector('.eta')?.textContent.trim() ?? '';
    const clean = (s) => s.replace(/\s+/g, ' ').trim();
    const profiles = [...row.querySelectorAll('a.profile[href]')].map((a) => ({
      name: clean(a.textContent), id: SCWRSite.profileId(a.getAttribute('href')),
    }));
    const sides = [...row.querySelectorAll('.participant')].map((p) => {
      const name = clean([...p.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
      // Hidden profiles are omitted from the link list; never join by array position.
      const links = profiles.filter((a) => a.name.toLowerCase() === name.toLowerCase());
      return {
        name, userId: links.length === 1 ? links[0].id ?? null : null,
        club: p.querySelector('.club')?.textContent.trim() || null,
        won: p.querySelector('.text-success') ? winType(p.querySelector('.text-success').textContent) : null,
      };
    });
    const id = row.getAttribute('data-target')?.match(/collapse(\d+)/)?.[1];
    const bracketId = SCWRSite.bracketId(row.querySelector('a[href*="/bracket/"]')?.getAttribute('href'));
    if (sides.length) out.push({ id, bracketId, cat, status, sides });
  }
  const pages = [...doc.querySelectorAll('a[href]')].map((a) => {
    const url = new URL(a.getAttribute('href'), location.origin);
    return url.pathname.endsWith('/schedule/matchlist') ? Number(url.searchParams.get('page')) : 0;
  }).filter((p) => Number.isSafeInteger(p) && p > 0);
  return { out, lastPage: Math.max(...pages, 1) };
}

// Pages are independent, so the only limit on speed is how many requests the
// site will take at once. Run a wider pool and let throttled pages back off and
// retry rather than failing the whole load and starting over.
const POOL = 8;
const RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin' });
    } catch (error) {
      // Network blip: worth one more try, but never silently forever.
      if (attempt >= RETRIES) throw error;
      await sleep(250 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.text();
    // 429 and 5xx are the server asking us to slow down; anything else (403,
    // 404, a login redirect) will not improve by asking again.
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= RETRIES) throw new Error(`${response.status} on ${url}`);
    const after = Number(response.headers.get('Retry-After'));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 400 * 2 ** attempt);
  }
}

async function fetchAll(id, onProgress) {
  const base = url.event(id, 'schedule', 'matchlist');

  const parse = (html) => {
    const page = parsePage(html);
    if (!page.out.length) throw new Error('No match rows returned. Open the Matches page and try again.');
    if (page.out.some((m) => !m.id || !m.bracketId)) throw new Error('Match page format changed; statistics could not be verified.');
    return page;
  };
  const first = parse(await fetchPage(base));
  const batches = [first.out];
  const pages = [];
  for (let p = 2; p <= first.lastPage; p++) pages.push(p);

  let done = 1;
  onProgress?.(done, first.lastPage);
  await Promise.all(
    Array.from({ length: Math.min(POOL, pages.length) }, async () => {
      for (let p = pages.shift(); p !== undefined; p = pages.shift()) {
        // Fetch first, then parse, so a page's HTML is never held while another
        // request is still in flight on this worker.
        const html = await fetchPage(`${base}?page=${p}`);
        batches[p - 1] = parse(html).out;
        onProgress?.(++done, first.lastPage);
      }
    }),
  );
  return [...new Map(batches.flat().map((m) => [m.id, m])).values()];
}

let pending = null;
async function loadEvent(onProgress, { refresh = false } = {}) {
  const id = eventId();
  if (!id) throw new Error('No competition ID found.');
  const key = `event-matches:${id}`;
  if (!refresh) {
    const hit = store.read(key);
    if (hit && Array.isArray(hit.matches) && hit.matches.length) return hit;
  }
  if (pending) return pending;
  pending = (async () => {
    const matches = await fetchAll(id, onProgress);
    return store.write(key, { matches }, matches.every((m) => m.status === 'Finished'));
  })();
  try { return await pending; } finally { pending = null; }
}

// Tally wins/losses per club per win type, for one category filter.
function tally(matches, keep) {
  const clubs = {};
  const slot = (c) => (clubs[c] ??= { w: {}, l: {} });
  for (const m of matches) {
    if (!keep(m.cat)) continue;
    const win = m.sides.find((s) => s.won);
    if (!win) continue;
    if (win.club) slot(win.club).w[win.won] = (slot(win.club).w[win.won] ?? 0) + 1;
    for (const s of m.sides) {
      if (s !== win && s.club) slot(s.club).l[win.won] = (slot(s.club).l[win.won] ?? 0) + 1;
    }
  }
  return clubs;
}

// A toplist covers only part of the event (Adults vs Kids & Teens). Rather than
// guess from its title, pick the category filter that best reproduces the win
// counts the page is already showing.
function pickScope(matches, official) {
  const options = [
    ['adults', (c) => !isYouth(c)],
    ['youth', isYouth],
    ['all', () => true],
  ];
  let best = null;
  for (const [name, keep] of options) {
    const clubs = tally(matches, keep);
    let hits = 0;
    for (const [club, wins] of official) {
      const t = clubs[club];
      if (t && Object.values(t.w).reduce((a, b) => a + b, 0) === wins) hits++;
    }
    if (!best || hits > best.hits) best = { name, hits, clubs };
  }
  return best;
}

// One club's record restricted to the win types on screen, plus the per-type
// split the toplist prints beside it. Shares the allowlist rule with the
// results page so both surfaces count a walkover the same way.
function clubRecord(tally, types) {
  const pick = (bucket) => types.reduce((n, type) => n + (bucket[type] ?? 0), 0);
  const wins = pick(tally.w);
  const losses = pick(tally.l);
  // Keep WIN_TYPES order so the breakdown reads the same on every row.
  const split = WIN_TYPES.filter((t) => types.includes(t) && (tally.w[t] || tally.l[t]))
    .map((t) => [t, tally.w[t] ?? 0, tally.l[t] ?? 0]);
  return { wins, losses, total: wins + losses, split };
}

async function loadMatchData(official, onProgress) {
  const id = eventId();
  if (!id) return null;

  const cached = readCache(id);
  if (cached) return cached;

  const { matches } = await loadEvent(onProgress);
  const best = pickScope(matches, official);
  // Other sports use other win types (ippon, tko, ...) - keep whatever shows up.
  const seen = new Set();
  for (const m of matches) {
    const w = m.sides.find((s) => s.won);
    if (w) seen.add(w.won);
  }
  const rank = (t) => (WIN_TYPES.indexOf(t) < 0 ? WIN_TYPES.length : WIN_TYPES.indexOf(t));
  return store.write(SUMMARY_KEY(id), {
    scope: best.name,
    types: [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    matched: best.hits,
    total: official.size,
    clubs: best.clubs,
  }, matches.length > 0 && matches.every((m) => m.status === 'Finished'));
}

return { readCache, loadMatchData, loadEvent, parsePage, winType, tally, pickScope, clubRecord };
})();
