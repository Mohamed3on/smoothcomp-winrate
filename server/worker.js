// The career cache every install shares. Installs keep what they read here and
// look up a whole event at once; each one cleans what it gets (career-cache.js),
// so the worker only bounds what it stores.
const KEPT = 30 * 24 * 60 * 60 * 1000; // the longest career-cache.js keeps anything
const SITES = ['smoothcomp.com', 'ajptour.com'];
const KINDS = ['careers', 'ranks'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
const validUser = user => /^\d{1,12}$/.test(user);

async function lookup(env, { site, users }) {
  if (!SITES.includes(site) || !Array.isArray(users) || users.length > 5000 || !users.every(u => typeof u === 'string' && validUser(u))) return json({ error: 'Bad lookup' }, 400);
  const { results } = await env.DB.prepare('SELECT user, kind, entry FROM athletes WHERE site = ?1 AND at > ?2 AND user IN (SELECT value FROM json_each(?3))')
    .bind(site, Date.now() - KEPT, JSON.stringify(users)).all();
  const kept = { careers: {}, ranks: {}, seen: {} };
  for (const row of results) kept[row.kind][row.user] = JSON.parse(row.entry);
  // What results pages have shown of each athlete, event by event, walkovers aside.
  const seen = await env.DB.prepare('SELECT user, sum(wins) wins, sum(losses) losses, count(*) events FROM records WHERE site = ?1 AND user IN (SELECT value FROM json_each(?2)) GROUP BY user')
    .bind(site, JSON.stringify(users)).all();
  for (const row of seen.results) kept.seen[row.user] = [row.wins, row.losses, row.events];
  return json(kept);
}

async function keep(env, body) {
  if (!SITES.includes(body.site)) return json({ error: 'Bad site' }, 400);
  const rows = KINDS.flatMap(kind => Object.entries(body[kind] ?? {}).map(([user, entry]) => ({ user, kind, entry })))
    .filter(({ user, entry }) => validUser(user) && Number.isFinite(entry?.at) && entry.at <= Date.now() + 60000 && JSON.stringify(entry).length <= 1000);
  if (rows.length > 20000) return json({ error: 'Too many' }, 413);
  // One statement for the lot; an entry only replaces an older one.
  await env.DB.prepare(`INSERT INTO athletes (site, user, kind, at, entry)
    SELECT ?1, value ->> 'user', value ->> 'kind', value ->> '$.entry.at', value ->> 'entry' FROM json_each(?2) WHERE true
    ON CONFLICT (site, user, kind) DO UPDATE SET at = excluded.at, entry = excluded.entry WHERE excluded.at > athletes.at`)
    .bind(body.site, JSON.stringify(rows)).run();
  return json({});
}

// A results page's records for its event; the latest read of an event replaces the last.
async function record(env, { site, event, records }) {
  if (!SITES.includes(site) || !/^\d{1,9}$/.test(event) || typeof records !== 'object' || !records) return json({ error: 'Bad record' }, 400);
  const rows = Object.entries(records).filter(([user, r]) => validUser(user) && Array.isArray(r) && r.length === 2 && r.every(n => Number.isSafeInteger(n) && n >= 0 && n < 100));
  if (rows.length > 5000) return json({ error: 'Too many' }, 413);
  await env.DB.prepare(`INSERT OR REPLACE INTO records (site, event, user, wins, losses, at)
    SELECT ?1, ?2, value ->> 0, value ->> 1, value ->> 2, ?3 FROM json_each(?4)`)
    .bind(site, event, Date.now(), JSON.stringify(rows.map(([user, [wins, losses]]) => [user, wins, losses]))).run();
  return json({});
}

const ROUTES = { '/lookup': lookup, '/keep': keep, '/record': record };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || !ROUTES[pathname]) return json({ error: 'Not found' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    return ROUTES[pathname](env, body ?? {});
  },
  async scheduled(_, env) {
    await env.DB.prepare('DELETE FROM athletes WHERE at <= ?1').bind(Date.now() - KEPT).run();
  },
};
