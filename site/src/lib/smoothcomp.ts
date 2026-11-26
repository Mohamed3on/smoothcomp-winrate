// Smoothcomp and AJP Tour read by this browser, straight from the sites: their JSON and their pages answer any page,
// no sign-in, so what a visitor's page needs is read here and sent to Mat Stats, which only stores it.
import type { QueryClient } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { clubPlace, registeredIn } from '@/lib/rules';

export const HOMES: Record<string, string> = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
// Sixteen requests in flight at most, across everything read at once: past that Smoothcomp answers no faster
// (about 40 cards a second to one reader).
let open = 0;
const waiting: (() => void)[] = [];
async function ask<T>(url: string, as: (r: Response) => Promise<T>, json = true, moved?: (to: string) => void): Promise<T> {
  if (open >= 16) await new Promise<void>((go) => waiting.push(go));
  open++;
  try {
    const r = await fetch(url, json ? { headers: { Accept: 'application/json' } } : {});
    if (!r.ok) throw new Error(String(r.status));
    if (r.redirected) moved?.(r.url);
    return await as(r);
  } finally { open--; waiting.shift()?.(); }
}
export const read = (url: string, moved?: (to: string) => void) => ask(url, (r) => r.json(), true, moved);
const page = (url: string) => ask(url, (r) => r.text(), false);
const all = <T, R>(items: T[], work: (x: T) => Promise<R>) => Promise.all(items.map(work));

export interface Listed { id: number; name?: string; group?: string; state?: string; wonBy?: string; bracket_id?: number; seats?: { name?: string }[] }
// An event's schedule (`base` its page): each mat, and each mat's matches. An organiser's event redirects to its own
// subdomain: the rest go there, not through the redirect again.
export async function schedule(base: string) {
  const days: { id: number }[] = await read(`${base}/schedule/new/matcategories.json`, (to) => { base = to.slice(0, to.indexOf('/schedule/')); });
  const mats: { id: number }[] = (await all(days, (d) => read(`${base}/schedule/new/mats.json/${d.id}`))).flat();
  return { mats, lists: await all(mats, (m) => read(`${base}/schedule/new/mat/${m.id}/matches.json`)) as Listed[][] };
}

// Each query of the routes asked for, fetched again past the browser's copy, so the page shows what was just sent.
export const reload = (client: QueryClient, route: string | string[]) => Promise.all(client.getQueryCache().findAll({ predicate: (q) => [route].flat().includes(q.queryKey[0] as string) }).map((q) => {
  const [name, query] = q.queryKey as [string, Record<string, string>];
  return client.fetchQuery({ queryKey: q.queryKey, queryFn: () => get(name, query, { cache: 'reload' }), staleTime: 0 }).catch(() => {});
}));

// Once a visit (this tab) per key: the page's copy can be a few minutes old, so it may still ask for what was just read.
export const once = (key: string) => {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch { /* storage refused: read anyway */ }
  return true;
};
const send = (path: string, body: object) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// An upcoming event's size, as its accommodations page's menu counts it (rules.js registeredIn), sent to Mat Stats
// (worker.js size), as the crawler reads it (crawl.js sizeEvents). A page whose menu has no Athletes link says nothing.
export async function sizeEvent(site: string, event: string, url?: string | null) {
  const html = await page(`${url ? new URL(url).origin : HOMES[site]}/en/event/${event}/accommodations`);
  if (html.includes('/participants"')) await send('/size', { site, event, registered: registeredIn(html) });
}
// Where an academy's own page puts it (rules.js clubPlace; a private page, nowhere), sent to Mat Stats (worker.js place),
// as the crawler reads it (crawl.js placeClubs).
export async function placeClub(site: string, club: string) {
  const html = await page(`${HOMES[site]}/en/club/${club}`).catch((e: Error) => (e.message === '403' ? '' : Promise.reject(e)));
  await send('/place', { site, club, place: clubPlace(html) });
}
