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
  const kept = { careers: {}, ranks: {} };
  for (const row of results) kept[row.kind][row.user] = JSON.parse(row.entry);
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || !['/lookup', '/keep'].includes(pathname)) return json({ error: 'Not found' }, 404);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    return (pathname === '/lookup' ? lookup : keep)(env, body ?? {});
  },
  async scheduled(_, env) {
    await env.DB.prepare('DELETE FROM athletes WHERE at <= ?1').bind(Date.now() - KEPT).run();
  },
};
