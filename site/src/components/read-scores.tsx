import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { get, type Entry } from '@/lib/api';
import { normalize } from '@/lib/rules';
import { cn } from '@/lib/utils';

const HOMES: Record<string, string> = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
const read = (url: string) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
// Six at a time, as the crawler asks.
async function each<T, R>(items: T[], work: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } }));
  return out;
}
const seconds = (t?: string) => (/^\d+:\d\d$/.test(t ?? '') ? Number(t!.split(':')[0]) * 60 + Number(t!.split(':')[1]) : null);

interface Side { id?: number; score?: number; advantage?: number; penalty?: number }
interface Card { left?: Side; right?: Side; matchInfo?: { time?: string; timeRemaining?: number } }

// A division's scores, read by this browser straight from the site (its JSON answers any page, no sign-in):
// the event's schedule for the division's match ids, then each finished match's card. What it reads is sent to
// Mat Stats (worker.js scores), which fills the stored matches that have none, so everyone sees them.
async function readScores(site: string, event: string, e: Entry) {
  const home = HOMES[site], base = `${home}/en/event/${event}`;
  const days: { id: number }[] = await read(`${base}/schedule/new/matcategories.json`);
  const mats: { id: number }[] = (await each(days, (d) => read(`${base}/schedule/new/mats.json/${d.id}`))).flat();
  const lists: { id: number; name?: string; group?: string; state?: string; bracket_id?: number }[] = (await each(mats, (m) => read(`${base}/schedule/new/mat/${m.id}/matches.json`))).flat();
  const bracket = e.bouts?.find((b) => b.bracket)?.bracket;
  const seen = new Set<number>();
  const ours = lists.filter((m) => m?.state === 'finished' && m.name && (bracket ? Number(m.bracket_id) === bracket : normalize(m.group ?? '') === normalize(e.division)) && !seen.has(m.id) && seen.add(m.id));
  const cards: (Card | null)[] = await each(ours, (m) => read(`${home}/en/getBracketMatchData/${m.id}`).catch(() => null));
  const trio = (p: Side) => [p.score, p.advantage, p.penalty].map((n) => (Number.isSafeInteger(n) ? n! : 0));
  const matches = ours.flatMap((m, i) => {
    const c = cards[i];
    if (!c?.left?.id || !c.right?.id) return [];
    const left = c.matchInfo?.timeRemaining;
    return [{ stage: m.name, users: [String(c.left.id), String(c.right.id)], s: [trio(c.left), trio(c.right)],
      clock: [seconds(c.matchInfo?.time), Number.isSafeInteger(left) ? Math.round(left! / 1000) : null] }];
  });
  if (!matches.length) throw new Error('none');
  const r = await fetch('/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, event, division: e.division, matches }) });
  if (!r.ok) throw new Error(String(r.status));
}

type State = 'idle' | 'reading' | 'error';
// Under a division's matches when some have no score: reads them on a click, then the page again, past the browser's copy.
export function ReadScores({ site, event, entry, route }: { site: string; event: string; entry: Entry; route: string }) {
  const client = useQueryClient();
  const [state, setState] = useState<State>('idle');
  const ask = async () => {
    setState('reading');
    try {
      await readScores(site, event, entry);
      await Promise.all(client.getQueryCache().findAll({ queryKey: [route] }).map((q) => {
        const [, query] = q.queryKey as [string, Record<string, string>];
        return client.fetchQuery({ queryKey: q.queryKey, queryFn: () => get(route, query, { cache: 'reload' }), staleTime: 0 });
      }));
      setState('idle');
    } catch { setState('error'); }
  };
  return (
    <button type="button" onClick={ask} disabled={state === 'reading'} title="Read each match’s score and time from the site"
      className="inline-flex items-center gap-1 self-start rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-60">
      <RefreshCw className={cn('size-3', state === 'reading' && 'animate-spin motion-reduce:animate-none')} />
      {state === 'reading' ? 'Reading scores…' : state === 'error' ? 'Couldn’t read scores, try again' : 'Read scores'}
    </button>
  );
}
