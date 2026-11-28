// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. Its workers.dev
// address answers only a request carrying the CRAWL_KEY secret (a lane started by hand).
import { crawl, findClubs, listEvents, placeClubs, queue, sizeEvents } from './crawl.js';
import { addBouts, purge, rebuild, record } from './worker.js';
import { ACCOUNT, DATABASE, INCLUDED, budget, checkBudget } from './budget.js';
import { keepRecent } from './stats.js';
import { rerate } from './rating.js';

const LANES = 3;

// Telegram (secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).
const tell = (env, text) => env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
  ? fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }) }).then((r) => r.ok)
  : false;

// A stall gets a Telegram message (secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID), checked hourly, at most one every six
// hours: no event finished in three hours while events wait (on 2026-11-27 none finished for eleven, unnoticed).
async function watch(env, state) {
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT (SELECT max(at) FROM crawls WHERE state = 'done') AS last,
    (SELECT count(*) FROM crawls WHERE state IN ('queued', 'reading') AND next <= ?1) AS due, (SELECT v FROM meta WHERE k = 'alert:stall') AS told`).bind(now).first();
  if (!row.due || now - (row.last ?? 0) < 3 * 3600e3 || now - (row.told ?? 0) < 6 * 3600e3) return;
  const text = `Mat Stats crawler: no event finished in ${Math.floor((now - (row.last ?? 0)) / 3600e3)} h, ${row.due} waiting (budget ${state}). https://matstats.mohamed3on.com/crawls`;
  if (await tell(env, text)) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert:stall', ?1)").bind(now).run();
}

// Slow or wasteful D1 queries get a Telegram message, checked hourly from D1's per-query analytics (CF_ANALYTICS_TOKEN): the last
// hour's reads past a day's share of the plan's paced by the hour, or a query reading over 1M rows or taking over 10 s a run, each
// told at most once in six hours (on 2026-11-28 a bad plan read ~1B rows overnight and an athlete page took 33 s, both unnoticed).
export const SLOW = { rowsPerRun: 1e6, msPerRun: 10e3, readHour: INCLUDED.read / 30 / 24 };
export function slowQueries(groups, told, now) {
  const out = [];
  const hour = groups.reduce((n, g) => n + g.sum.rowsRead, 0);
  if (hour > SLOW.readHour && now - (told.hour ?? 0) > 6 * 3600e3) out.push(['hour', `${(hour / 1e6).toFixed(0)}M rows read in the last hour (pace limit ${(SLOW.readHour / 1e6).toFixed(0)}M)`]);
  for (const g of groups) {
    const query = g.dimensions.query.replace(/\s+/g, ' ').trim();
    if (/^(ANALYZE|CREATE|DROP)\b/i.test(query) || (g.avg.rowsRead < SLOW.rowsPerRun && g.avg.queryDurationMs < SLOW.msPerRun)) continue;
    const key = query.slice(0, 120);
    if (now - (told[key] ?? 0) > 6 * 3600e3) out.push([key, `${Math.round(g.avg.rowsRead).toLocaleString('en')} rows, ${(g.avg.queryDurationMs / 1e3).toFixed(1)} s a run, ×${g.count}: ${query.slice(0, 300)}`]);
  }
  return out;
}
async function sentinel(env, now = Date.now()) {
  if (!env.CF_ANALYTICS_TOKEN) return;
  const query = `query($a: String!, $db: String!, $from: Time!) { viewer { accounts(filter: {accountTag: $a}) {
    d1QueriesAdaptiveGroups(limit: 200, filter: {databaseId: $db, datetime_geq: $from}, orderBy: [sum_rowsRead_DESC]) { count sum { rowsRead } avg { rowsRead queryDurationMs } dimensions { query } } } } }`;
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: ACCOUNT, db: DATABASE, from: new Date(now - 3600e3).toISOString() } }),
  });
  const groups = (await response.json())?.data?.viewer?.accounts?.[0]?.d1QueriesAdaptiveGroups;
  if (!Array.isArray(groups)) return console.error('sentinel: analytics unanswered', response.status);
  const told = JSON.parse((await env.DB.prepare("SELECT v FROM meta WHERE k = 'alert:slow'").first('v')) ?? '{}');
  const found = slowQueries(groups, told, now);
  if (!found.length || !(await tell(env, `Mat Stats D1:\n${found.map(([, line]) => `• ${line}`).join('\n')}`))) return;
  for (const [key] of found) told[key] = now;
  for (const key of Object.keys(told)) if (now - told[key] > 7 * 864e5) delete told[key];
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert:slow', ?1)").bind(JSON.stringify(told)).run();
}

// Every table keeps statistics. A table rebuilt by copy and swap loses its sqlite_stat1 rows (on 2026-11-28, ~1B reads overnight:
// entries was read by its primary key), and one with none is taken for ten rows a lookup, so the planner joins it first: with
// entries analyzed and people not, an athlete page walked every account (33 s, a 503). Each missing one is put back.
async function restat(env) {
  const { results } = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%'
    AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '*_fts_*' AND name NOT IN (SELECT tbl FROM sqlite_stat1)`).all();
  for (const { name } of results) {
    await env.DB.exec(`ANALYZE ${name}`);
    console.log('analyzed', name);
  }
}

export default {
  async fetch(request, env) {
    // Cloudflare's alerts (Workers Issues, through a notification policy's webhook, secret ALERT_KEY) come to Telegram.
    if (new URL(request.url).pathname === '/alert' && env.ALERT_KEY && request.headers.get('cf-webhook-auth') === env.ALERT_KEY) {
      const body = await request.json().catch(() => ({}));
      await tell(env, `Cloudflare: ${body.name ?? body.alert_type ?? 'alert'}\n${body.text ?? JSON.stringify(body.data ?? body).slice(0, 1500)}`);
      return new Response(null, { status: 204 });
    }
    if (!env.CRAWL_KEY || request.headers.get('x-crawl-key') !== env.CRAWL_KEY) return new Response(null, { status: 404 });
    const { pathname } = new URL(request.url);
    // Nothing is read while D1's usage is past a day's share of what the plan includes (budget.js).
    const state = await budget(env);
    // Ratings are rebuilt like the rankings, while the crawler rests too: their own request, for its CPU time.
    if (pathname === '/rate') { if (state !== 'stop') await rerate(env); return new Response(null, { status: 204 }); }
    if (state !== 'ok') return new Response(null, { status: 204 });
    if (pathname === '/list') await listEvents(env);
    else if (pathname === '/clubs') await placeClubs(env);
    else if (pathname === '/sizes') await sizeEvents(env);
    else await crawl(env, record, addBouts);
    return new Response(null, { status: 204 });
  },
  async scheduled(controller, env) {
    // The queue is refilled every half hour.
    const at = new Date(controller.scheduledTime);
    // D1's usage, read every ten minutes: while it nears what the plan includes, the crawler rests (budget.js).
    if (at.getUTCMinutes() % 10 === 0) await checkBudget(env).catch((e) => console.error('budget', e?.message));
    const state = await budget(env, Date.now(), true);
    // Not during a migration (meta 'pause' gives 'stop'), while the rebuilt tables are still filling.
    if (at.getUTCMinutes() % 10 === 0 && state !== 'stop') await restat(env).catch((e) => console.error('restat', e?.message));
    if (at.getUTCMinutes() === 45) await watch(env, state).catch((e) => console.error('watch', e?.message));
    if (at.getUTCMinutes() === 50) await sentinel(env).catch((e) => console.error('sentinel', e?.message));
    // Rankings and academies catch up on the day's results once a day, even while the crawler rests (worker.js rebuild).
    if (state !== 'stop') await rebuild(env).catch((e) => console.error('rebuild', e?.message));
    // Every athlete's rating, rebuilt from every match read once a day (rating.js).
    if (at.getUTCHours() === 4 && at.getUTCMinutes() === 5 && state !== 'stop') await env.SELF.fetch('https://crawler/rate', { headers: { 'x-crawl-key': env.CRAWL_KEY } });
    if (state !== 'ok') return;
    if (at.getUTCMinutes() % 30 === 0) await queue(env);
    // The last year's events are listed once a day, before the 03:30 refill queues them.
    if (at.getUTCHours() === 3 && at.getUTCMinutes() === 15) await env.SELF.fetch('https://crawler/list', { headers: { 'x-crawl-key': env.CRAWL_KEY } });
    // The academies list's totals over those who competed in the last two years, once an hour (stats.js keepRecent).
    if (at.getUTCMinutes() === 20) for (const site of ['smoothcomp.com', 'ajptour.com']) await keepRecent(env, site).catch((e) => console.error('recent', site, e?.message));
    // What was kept of events that aren't BJJ goes, an event a minute (worker.js purge).
    await purge(env).catch((e) => console.error('purge', e?.message));
    // One academy whose page names no place, looked up on Google Maps, every ten minutes.
    if (at.getUTCMinutes() % 10 === 5) await findClubs(env);
    // Academies' pages, a few each minute, for where each academy says it is; and upcoming events' pages, for how many entered.
    await Promise.all([...Array.from({ length: LANES }, () => env.SELF.fetch('https://crawler/run', { headers: { 'x-crawl-key': env.CRAWL_KEY } })),
      ...['clubs', 'sizes'].map((path) => env.SELF.fetch(`https://crawler/${path}`, { headers: { 'x-crawl-key': env.CRAWL_KEY } }))]);
  },
};
