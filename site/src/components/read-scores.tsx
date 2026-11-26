import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { get, type Bout, type Entry } from '@/lib/api';
import { finishOf, normalize, SCORELESS } from '@/lib/rules';
import { cn } from '@/lib/utils';

export const HOMES: Record<string, string> = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
// Sixteen requests in flight at most, across every event read at once: past that Smoothcomp answers no faster
// (about 40 cards a second to one reader).
let open = 0;
const waiting: (() => void)[] = [];
export async function read(url: string, moved?: (to: string) => void) {
  if (open >= 16) await new Promise<void>((go) => waiting.push(go));
  open++;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    if (r.redirected) moved?.(r.url);
    return await r.json();
  } finally { open--; waiting.shift()?.(); }
}
const all = <T, R>(items: T[], work: (x: T) => Promise<R>) => Promise.all(items.map(work));
const seconds = (t?: string) => (/^\d+:\d\d$/.test(t ?? '') ? Number(t!.split(':')[0]) * 60 + Number(t!.split(':')[1]) : null);

interface Side { id?: number; score?: number; advantage?: number; penalty?: number }
interface Card { left?: Side; right?: Side; matchInfo?: { time?: string; timeRemaining?: number } }
interface Listed { id: number; name?: string; group?: string; state?: string; wonBy?: string; bracket_id?: number; seats?: { name?: string }[] }
// A match whose score is still to read: none read yet, and not a walkover or a stoppage (rules.js SCORELESS).
export const needsScore = (b: Bout) => !b.us && !SCORELESS.includes(finishOf(b.type));
// An event to read: its results with a match still unscored (each with the athlete's name, where known), or (none named) every division.
export interface Target { site: string; event: string; entries?: (Entry & { name?: string | null })[] }

// An event's scores, read by this browser straight from the site (its JSON answers any page, no sign-in): each
// finished match's card (walkovers and stoppages left out), by the match ids stored with the matches, else the schedule's.
// What it reads goes to Mat Stats (worker.js scores), which fills the stored matches that have none, so everyone sees them.
async function readEvent({ site, event, entries }: Target, tick: (n: number) => void) {
  const home = HOMES[site], base = `${home}/en/event/${event}`;
  const open = entries?.flatMap((e) => (e.bouts ?? []).filter(needsScore).map((b) => ({ id: b.match!, name: b.stage ?? undefined, group: e.division })));
  const ours = open?.length && open.every((m) => m.id && m.name) ? [...new Map(open.map((m) => [m.id, m])).values()] : await listed(base, entries);
  tick(ours.length);
  const trio = (p: Side) => [p.score, p.advantage, p.penalty].map((n) => (Number.isSafeInteger(n) ? n! : 0));
  const matches = (await all(ours, async (m) => {
    const c: Card | null = await read(`${home}/en/getBracketMatchData/${m.id}`).catch(() => null);
    tick(-1);
    if (!c?.left?.id || !c.right?.id) return [];
    const left = c.matchInfo?.timeRemaining;
    return [{ stage: m.name, group: m.group, users: [String(c.left.id), String(c.right.id)], s: [trio(c.left), trio(c.right)],
      clock: [seconds(c.matchInfo?.time), Number.isSafeInteger(left) ? Math.round(left! / 1000) : null] }];
  })).flat();
  for (let i = 0; i < matches.length; i += 2000) {
    const r = await fetch('/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, event, matches: matches.slice(i, i + 2000) }) });
    if (!r.ok) throw new Error(String(r.status));
  }
}
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

// The finished matches the schedule lists that are still without a score: each found by its division (or bracket),
// round and opponent (one kept without its round, by both who fought it), so a card already read is never read again;
// none asked for, every division.
async function listed(base: string, entries?: Target['entries']): Promise<Listed[]> {
  const lists: Listed[] = (await schedule(base)).lists.flat();
  // A pool's numbered match is the only one of its number there; a knockout round's is told apart by the opponent,
  // spelt as either list spells them (a profile's "Hüseyin" is a registration's "Huseyin").
  const fold = (name: unknown) => normalize(name).normalize('NFD').replace(/\p{M}/gu, '');
  const key = (at: unknown, stage: string, name: unknown) => `${at}|${stage}|${/^Match \d+\//.test(stage) ? '' : fold(name)}`;
  // The opponent alone would name every match they fought there.
  const pair = (at: unknown, a: unknown, b: unknown) => `${at}||${[fold(a), fold(b)].sort().join('+')}`;
  const want = new Set(entries?.flatMap((e) => (e.bouts ?? []).filter((b) => needsScore(b) && (b.stage || e.name))
    .flatMap((b) => [normalize(e.division), ...(b.bracket ? [b.bracket] : [])].map((at) => (b.stage ? key(at, b.stage, b.opponent) : pair(at, e.name, b.opponent))))));
  const asked = (m: Listed) => m.seats?.some((s) => [normalize(m.group), m.bracket_id].some((at) => want.has(key(at, m.name!, s.name)) || want.has(pair(at, s.name, m.seats!.find((o) => o !== s)?.name))));
  const seen = new Set<number>();
  return lists.filter((m) => m?.state === 'finished' && m.name && !SCORELESS.includes(finishOf(m.wonBy)) && !seen.has(m.id) && seen.add(m.id) && (!entries || asked(m)));
}

// Reads the events' scores on a click, then the page again, past the browser's copy.
export function ReadScores({ targets, route, size = 'sm' }: { targets: Target[]; route: string | string[]; size?: 'sm' | 'lg' }) {
  const client = useQueryClient();
  const [state, setState] = useState<'idle' | 'reading' | 'error'>('idle');
  const [left, setLeft] = useState(0);
  const ask = async () => {
    setState('reading');
    setLeft(0);
    const results = await Promise.allSettled(targets.map((t) => readEvent(t, (n) => setLeft((x) => x + n))));
    await reload(client, route);
    setState(results.some((r) => r.status === 'rejected') ? 'error' : 'idle');
  };
  return (
    <Button variant="outline" size={size} onClick={ask} disabled={state === 'reading'} aria-live="polite" title="Read each match’s score and time from the site">
      <RefreshCw className={cn(state === 'reading' && 'animate-spin motion-reduce:animate-none')} />
      {state === 'reading' ? (left ? `Reading ${left} matches…` : 'Reading schedule…') : state === 'error' ? 'Some didn’t read, try again' : 'Read scores'}
    </Button>
  );
}
