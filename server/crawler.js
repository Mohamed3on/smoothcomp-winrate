// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. Its workers.dev
// address answers only a request carrying the CRAWL_KEY secret (a lane started by hand).
import { crawl, findClubs, listEvents, placeClubs, queue, sizeEvents } from './crawl.js';
import { addBouts, purge, record } from './worker.js';
import { budget, checkBudget } from './budget.js';
import { keepRecent } from './stats.js';

const LANES = 3;

// A stall gets a Telegram message (secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID), checked hourly, at most one every six
// hours: no event finished in three hours while events wait (on 2026-11-27 none finished for eleven, unnoticed).
async function watch(env, state) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const now = Date.now();
  const row = await env.DB.prepare(`SELECT (SELECT max(at) FROM crawls WHERE state = 'done') AS last,
    (SELECT count(*) FROM crawls WHERE state IN ('queued', 'reading') AND next <= ?1) AS due, (SELECT v FROM meta WHERE k = 'alert:stall') AS told`).bind(now).first();
  if (!row.due || now - (row.last ?? 0) < 3 * 3600e3 || now - (row.told ?? 0) < 6 * 3600e3) return;
  const text = `Mat Stats crawler: no event finished in ${Math.floor((now - (row.last ?? 0)) / 3600e3)} h, ${row.due} waiting (budget ${state}). https://matstats.mohamed3on.com/crawls`;
  const sent = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }) });
  if (sent.ok) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert:stall', ?1)").bind(now).run();
}

export default {
  async fetch(request, env) {
    if (!env.CRAWL_KEY || request.headers.get('x-crawl-key') !== env.CRAWL_KEY) return new Response(null, { status: 404 });
    const { pathname } = new URL(request.url);
    // Nothing is read while D1's usage is past a day's share of what the plan includes (budget.js).
    const state = await budget(env);
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
    if (at.getUTCMinutes() === 45) await watch(env, state).catch((e) => console.error('watch', e?.message));
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
