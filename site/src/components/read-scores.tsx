import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Bout, Entry } from '@/lib/api';
import { finishOf, matchFinder, SCORELESS } from '@/lib/rules';
import { cn } from '@/lib/utils';
import { HOMES, read, reload, schedule, type Listed } from '@/lib/smoothcomp';

const all = <T, R>(items: T[], work: (x: T) => Promise<R>) => Promise.all(items.map(work));
const seconds = (t?: string) => (/^\d+:\d\d$/.test(t ?? '') ? Number(t!.split(':')[0]) * 60 + Number(t!.split(':')[1]) : null);

interface Side { id?: number; score?: number; advantage?: number; penalty?: number }
interface Card { left?: Side; right?: Side; matchInfo?: { time?: string; timeRemaining?: number } }
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
// The finished matches the schedule lists that are still without a score, each found as Match identity finds it (rules.js
// matchFinder: by its division or bracket, round and either side, one kept without its round by both who fought it), so a
// card already read is never read again; none asked for, every division.
async function listed(base: string, entries?: Target['entries']): Promise<Listed[]> {
  const seen = new Set<number>();
  const open = (await schedule(base)).lists.flat().filter((m) => m?.state === 'finished' && m.name && !SCORELESS.includes(finishOf(m.wonBy)) && !seen.has(m.id) && seen.add(m.id));
  if (!entries) return open;
  const find = matchFinder(open.map((m) => ({ division: m.group, bracket: m.bracket_id, stage: m.name, sides: (m.seats ?? []).map((s) => s.name), m })));
  return [...new Set(entries.flatMap((e) => (e.bouts ?? []).filter(needsScore)
    .map((b) => find({ division: e.division, bracket: b.bracket, stage: b.stage, sides: [e.name, b.opponent] })?.m).filter((m) => m !== undefined)))];
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
