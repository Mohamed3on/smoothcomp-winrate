// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. Its workers.dev
// address answers only a request carrying the CRAWL_KEY secret (a lane started by hand).
import { crawl, findClubs, listEvents, placeClubs, queue, sizeEvents } from './crawl.js';
import { addBouts, record } from './worker.js';
import { budget, checkBudget } from './budget.js';
import { keepRecent } from './stats.js';

const LANES = 3;

export default {
  async fetch(request, env) {
    if (!env.CRAWL_KEY || request.headers.get('x-crawl-key') !== env.CRAWL_KEY) return new Response(null, { status: 404 });
    const { pathname, searchParams } = new URL(request.url);
    // Nothing is read while D1's usage is past what the plan includes (budget.js), but past a day's share
    // (slow) the events someone on the site asked for (worker.js readNow) still are, as uploads still are.
    const state = await budget(env);
    if (state === 'stop' || (state === 'slow' && pathname !== '/run')) return new Response(null, { status: 204 });
    if (pathname === '/list') await listEvents(env);
    else if (pathname === '/clubs') await placeClubs(env);
    else if (pathname === '/sizes') await sizeEvents(env);
    // ?for: a short lane the site started (worker.js readNow), ended within the 30 seconds it may run.
    else await crawl(env, record, addBouts, Number(searchParams.get('for')) || undefined, state !== 'ok');
    return new Response(null, { status: 204 });
  },
  async scheduled(controller, env) {
    // The queue is refilled every half hour.
    const at = new Date(controller.scheduledTime);
    // D1's usage, read every ten minutes: while it nears what the plan includes, the crawler rests (budget.js).
    if (at.getUTCMinutes() % 10 === 0) await checkBudget(env).catch((e) => console.error('budget', e?.message));
    const state = await budget(env, Date.now(), true);
    if (state === 'stop') return;
    // Past a day's share, one lane a minute for the events asked for alone.
    if (state === 'slow') return void await env.SELF.fetch('https://crawler/run', { headers: { 'x-crawl-key': env.CRAWL_KEY } });
    if (at.getUTCMinutes() % 30 === 0) await queue(env);
    // The last year's events are listed once a day, before the 03:30 refill queues them.
    if (at.getUTCHours() === 3 && at.getUTCMinutes() === 15) await env.SELF.fetch('https://crawler/list', { headers: { 'x-crawl-key': env.CRAWL_KEY } });
    // The academies list's totals over those who competed in the last two years, once an hour (stats.js keepRecent).
    if (at.getUTCMinutes() === 20) for (const site of ['smoothcomp.com', 'ajptour.com']) await keepRecent(env, site).catch((e) => console.error('recent', site, e?.message));
    // One academy whose page names no place, looked up on Google Maps, every ten minutes.
    if (at.getUTCMinutes() % 10 === 5) await findClubs(env);
    // Academies' pages, a few each minute, for where each academy says it is; and upcoming events' pages, for how many entered.
    await Promise.all([...Array.from({ length: LANES }, () => env.SELF.fetch('https://crawler/run', { headers: { 'x-crawl-key': env.CRAWL_KEY } })),
      ...['clubs', 'sizes'].map((path) => env.SELF.fetch(`https://crawler/${path}`, { headers: { 'x-crawl-key': env.CRAWL_KEY } }))]);
  },
};
