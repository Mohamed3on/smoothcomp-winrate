// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. Its workers.dev
// address answers only a request carrying the CRAWL_KEY secret (a lane started by hand).
import { crawl, listEvents, placeClubs, queue } from './crawl.js';
import { addBouts, record } from './worker.js';

const LANES = 3;

export default {
  async fetch(request, env) {
    if (!env.CRAWL_KEY || request.headers.get('x-crawl-key') !== env.CRAWL_KEY) return new Response(null, { status: 404 });
    const { pathname } = new URL(request.url);
    if (pathname === '/list') await listEvents(env);
    else if (pathname === '/clubs') await placeClubs(env);
    else await crawl(env, record, addBouts);
    return new Response(null, { status: 204 });
  },
  async scheduled(controller, env) {
    // The queue is refilled every half hour.
    const at = new Date(controller.scheduledTime);
    if (at.getUTCMinutes() % 30 === 0) await queue(env);
    // The last year's events are listed once a day, before the 03:30 refill queues them.
    if (at.getUTCHours() === 3 && at.getUTCMinutes() === 15) await env.SELF.fetch('https://crawler/list', { headers: { 'x-crawl-key': env.CRAWL_KEY } });
    // Academies' pages, a few each minute, for where each academy says it is.
    await Promise.all([...Array.from({ length: LANES }, () => env.SELF.fetch('https://crawler/run', { headers: { 'x-crawl-key': env.CRAWL_KEY } })),
      env.SELF.fetch('https://crawler/clubs', { headers: { 'x-crawl-key': env.CRAWL_KEY } })]);
  },
};
