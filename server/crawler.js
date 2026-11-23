// The crawler (crawl.js) as its own Worker, run beside Smoothcomp's servers: a placement hint puts
// its requests in Cloudflare's London data center, nearest AWS eu-west-1, where Smoothcomp answered
// in about 100 ms against 250 to 850 ms from wherever a cron happens to run. Placement applies only
// to requests, so each minute's cron sends one request per lane to this same Worker. It has no
// route and no workers.dev address: nothing else can call it.
import { crawl, queue } from './crawl.js';
import { record } from './worker.js';

const LANES = 6;

export default {
  async fetch(request, env) {
    await crawl(env, record);
    return new Response(null, { status: 204 });
  },
  async scheduled(controller, env) {
    // The queue is refilled every half hour.
    if (new Date(controller.scheduledTime).getUTCMinutes() % 30 === 0) await queue(env);
    await Promise.all(Array.from({ length: LANES }, () => env.SELF.fetch('https://crawler/run')));
  },
};
