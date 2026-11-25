import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { get, type Entry } from '@/lib/api';
import { normalize } from '@/lib/rules';
import { cn } from '@/lib/utils';

const HOMES: Record<string, string> = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
// Eight requests in flight at most, across every event read at once.
let open = 0;
const waiting: (() => void)[] = [];
async function read(url: string, moved?: (to: string) => void) {
  if (open >= 8) await new Promise<void>((go) => waiting.push(go));
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
interface Listed { id: number; name?: string; group?: string; state?: string; wonBy?: string; bracket_id?: number }
// An event to read: its divisions with a match still unscored, or (none named) every division.
export interface Target { site: string; event: string; entries?: Entry[] }

// An event's scores, read by this browser straight from the site (its JSON answers any page, no sign-in): each
// finished match's card (a walkover has no score), by the match ids stored with the matches, else the schedule's.
// What it reads goes to Mat Stats (worker.js scores), which fills the stored matches that have none, so everyone sees them.
async function readEvent({ site, event, entries }: Target, tick: (n: number) => void) {
  const home = HOMES[site], base = `${home}/en/event/${event}`;
  const open = entries?.flatMap((e) => (e.bouts ?? []).filter((b) => !b.us && b.type !== 'walkover').map((b) => ({ id: b.match!, name: b.stage ?? undefined, group: e.division })));
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
// The finished matches the schedule lists for the divisions asked for, found by every bracket their matches name
// (pools and the knockout after are two), else by name; none named, every division.
async function listed(base: string, entries?: Entry[]): Promise<Listed[]> {
  // An organiser's event redirects to its own subdomain: the rest go there, not through the redirect again.
  const days: { id: number }[] = await read(`${base}/schedule/new/matcategories.json`, (to) => { base = to.slice(0, to.indexOf('/schedule/')); });
  const mats: { id: number }[] = (await all(days, (d) => read(`${base}/schedule/new/mats.json/${d.id}`))).flat();
  const lists: Listed[] = (await all(mats, (m) => read(`${base}/schedule/new/mat/${m.id}/matches.json`))).flat();
  const brackets = new Set(entries?.flatMap((e) => e.bouts ?? []).map((b) => b.bracket).filter(Boolean));
  const names = new Set(entries?.map((e) => normalize(e.division)));
  const seen = new Set<number>();
  return lists.filter((m) => m?.state === 'finished' && m.name && m.wonBy !== 'walkover' && !seen.has(m.id) && seen.add(m.id)
    && (!entries || brackets.has(Number(m.bracket_id)) || names.has(normalize(m.group ?? ''))));
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
    await Promise.all(client.getQueryCache().findAll({ predicate: (q) => [route].flat().includes(q.queryKey[0] as string) }).map((q) => {
      const [name, query] = q.queryKey as [string, Record<string, string>];
      return client.fetchQuery({ queryKey: q.queryKey, queryFn: () => get(name, query, { cache: 'reload' }), staleTime: 0 }).catch(() => {});
    }));
    setState(results.some((r) => r.status === 'rejected') ? 'error' : 'idle');
  };
  return (
    <Button variant="outline" size={size} onClick={ask} disabled={state === 'reading'} aria-live="polite" title="Read each match’s score and time from the site">
      <RefreshCw className={cn(state === 'reading' && 'animate-spin motion-reduce:animate-none')} />
      {state === 'reading' ? (left ? `Reading ${left} matches…` : 'Reading schedule…') : state === 'error' ? 'Some didn’t read, try again' : 'Read scores'}
    </Button>
  );
}
