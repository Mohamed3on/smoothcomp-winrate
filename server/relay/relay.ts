// The crawler's requests to Smoothcomp, made from the Hetzner box: Smoothcomp refuses Cloudflare Workers
// the match lists and bracket cards (403, since 2026-11-25). Reached through the box's Cloudflare Tunnel
// at RELAY_HOST; answers only with the crawler's key, and fetches only Smoothcomp's and AJP's pages.
// Deployed as /opt/sc-relay/relay.ts (systemd sc-relay.service), RELAY_KEY in /opt/sc-relay/.env.
const KEY = process.env.RELAY_KEY;
if (!KEY) throw new Error('RELAY_KEY missing');
const ALLOWED = (host: string) => host === 'smoothcomp.com' || host.endsWith('.smoothcomp.com') || host === 'ajptour.com';
// Backup, used as little as it can be: PROXY (Decodo residential) is billed per GB. Only Cloudflare's block page
// (not another 403, such as a private event's) turns it on; while on, the box is tried again once a minute, and
// the first answer it gets turns it off.
const PROXY = process.env.PROXY;
let proxied = false, tried = 0;
const blocked = async (r: Response) => r.status === 403 && /Attention Required|cf-error-details/.test(await r.clone().text());
async function get(url: URL, headers: Record<string, string>) {
  const via = (proxy?: string) => fetch(url, { headers, redirect: 'manual', proxy, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (PROXY && proxied && Date.now() - tried < 60e3) return via(PROXY);
  tried = Date.now();
  const r = await via();
  if (!r || !PROXY) return r;
  if (!(await blocked(r))) {
    if (proxied) console.log('the box is answered again: proxy off');
    proxied = false;
    return r;
  }
  if (!proxied) console.log('the box is blocked: proxy on');
  proxied = true;
  return via(PROXY);
}

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 8791),
  async fetch(req) {
    if (req.headers.get('x-relay-key') !== KEY) return new Response(null, { status: 401 });
    let url: URL;
    try { url = new URL(new URL(req.url).searchParams.get('url') ?? ''); } catch { return new Response(null, { status: 400 }); }
    if (url.protocol !== 'https:' || !ALLOWED(url.hostname)) return new Response(null, { status: 400 });
    const headers = { 'User-Agent': req.headers.get('user-agent') ?? '', Accept: req.headers.get('accept') ?? '*/*' };
    // Redirects (smoothcomp.com to an organiser's subdomain) are followed only within the allowed hosts.
    for (let hops = 0; hops < 5; hops++) {
      const r = await get(url, headers);
      if (!r) return new Response(null, { status: 502 });
      const next = r.status >= 300 && r.status < 400 && r.headers.get('location');
      if (!next) return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('content-type') ?? '' } });
      url = new URL(next, url);
      if (url.protocol !== 'https:' || !ALLOWED(url.hostname)) return new Response(null, { status: 400 });
    }
    return new Response(null, { status: 508 });
  },
});
