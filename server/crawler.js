// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. Its workers.dev
// address answers only a request carrying the CRAWL_KEY secret (a lane started by hand).
import { crawl, queue } from './crawl.js';
import { record } from './worker.js';

const LANES = 3;

export default {
  async fetch(request, env) {
    if (!env.CRAWL_KEY || request.headers.get('x-crawl-key') !== env.CRAWL_KEY) return new Response(null, { status: 404 });
    await crawl(env, record);
    return new Response(null, { status: 204 });
  },
  async scheduled(controller, env) {
    // The queue is refilled every half hour.
    if (new Date(controller.scheduledTime).getUTCMinutes() % 30 === 0) await queue(env);
    await Promise.all(Array.from({ length: LANES }, () => env.SELF.fetch('https://crawler/run', { headers: { 'x-crawl-key': env.CRAWL_KEY } })));
  },
};
