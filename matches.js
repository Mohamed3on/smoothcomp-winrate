// Reads every match of the event off its schedule, so the results page can
// recount each record by how it was won. Smoothcomp's own counters fold
// walkovers into wins.

const SCWRMatches = (() => {
const { eventId, url, store } = SCWRSite;

// One scheduled match in the shape every consumer reads. The win type is
// Smoothcomp's own code, so nothing is read out of prose, and a seat still
// waiting on another result ("Loser from 1-91") is not a side. A side names its
// registration, not its user: only the registration list knows that.
const toMatch = (m) => ({
  id: String(m.id),
  bracketId: String(m.bracket_id),
  cat: m.group ?? '',
  finished: m.state === 'finished',
  sides: m.seats.filter((s) => s.type === 'registration').map((s) => ({
    name: s.name, registrationId: String(s.event_registration_id), club: s.club || null,
    won: s.isWinner ? m.wonBy : null,
  })),
});

// 429 and 5xx are the server asking us to slow down, and a dropped connection
// is worth another go; anything else (403, 404, a login redirect) will not
// improve by asking again.
async function fetchJSON(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { credentials: 'same-origin' }).catch(() => null);
    if (response?.ok) return response.json();
    const retryable = !response || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw new Error(`${response?.status ?? 'Network error'} on ${url}`);
    const wait = Number(response?.headers.get('Retry-After')) * 1000 || 400 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

// The event as Smoothcomp's own schedule reads it: its days, each day's mats,
// then every mat's matches at once. Unlike the match-list page, it keeps
// finished matches while the event is live, and names each division exactly as
// the published results do. A match moved to another mat mid-read is kept once.
async function fetchAll(id, onProgress) {
  const get = (...path) => fetchJSON(url.data(id, 'schedule', 'new', ...path));
  const days = await get('matcategories.json');
  const mats = (await Promise.all(days.map((day) => get('mats.json', day.id)))).flat();
  let done = 0;
  const found = await Promise.all(mats.map(async (mat) => {
    const list = await get('mat', mat.id, 'matches.json');
    onProgress?.(++done, mats.length);
    return list;
  }));
  const matches = found.flat().map(toMatch);
  return [...new Map(matches.map((m) => [m.id, m])).values()];
}

// A finished event is kept for the day; one still running, for minutes.
async function loadEvent(onProgress, { refresh = false } = {}) {
  const id = eventId();
  if (!id) throw new Error('No competition ID found.');
  const key = `event-matches:${id}`;
  const hit = refresh ? null : store.read(key);
  if (hit?.matches?.length) return hit;
  const matches = await fetchAll(id, onProgress);
  return store.write(key, { matches }, matches.every((m) => m.finished));
}

return { loadEvent };
})();
