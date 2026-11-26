import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { get } from '@/lib/api';
import { eventResults, knownSides, nameSides, scheduleOf } from '@/lib/rules';
import { HOMES, read, reload, schedule } from '@/lib/smoothcomp';
import { cn } from '@/lib/utils';

// An event to read, with what Mat Stats knows of it (kept with its results).
export interface Asked { site: string; event: string; title?: string | null; start?: string | null; city?: string | null }
const iso = (t?: string | number | null) => (t != null && !Number.isNaN(new Date(t).getTime()) ? new Date(t).toISOString() : null);

// An event's results, read by this browser straight from the site (its JSON answers any page, no sign-in) as the
// crawler reads one (rules.js scheduleOf, nameSides, eventResults): the schedule, then a bracket card for enough
// matches to name everyone, every card at once; those Mat Stats already knows from the matches it keeps (stats.js known,
// rules.js knownSides) need none, so an event read before is read again in seconds. They go to Mat Stats as a results
// page's do (worker.js record), which stores them; false when no match there has been fought yet.
async function readEvent({ site, event, title, start, city }: Asked, tick: (n: number) => void) {
  const home = HOMES[site];
  const [{ mats, lists }, known] = await Promise.all([schedule(`${home}/en/event/${event}`), get<Parameters<typeof knownSides>[1]>('known', { site, id: event }, { cache: 'reload' }).catch(() => undefined)]);
  const data = { ...scheduleOf(mats, lists), users: {}, tried: [] };
  if (!data.matches.some((m) => m[3])) return false;
  knownSides(data, known);
  await nameSides(data, () => Infinity, (matches) => {
    tick(matches.length);
    return Promise.all(matches.map((m) => read(`${home}/en/getBracketMatchData/${m[0]}`).catch(() => null).finally(() => tick(-1))));
  });
  const { athletes, records } = eventResults(data, start);
  const r = await fetch('/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    site, event, records, athletes, read: Date.now(), asked: true, on: !data.over, meta: { title, start: iso(start), end: iso(data.ends), city } }) });
  if (!r.ok) throw new Error(String(r.status));
  return true;
}

type State = 'idle' | 'reading' | 'none' | 'error';
// Reads the events on a click (`auto`: once, as the page opens), then the page again, past the browser's copy.
export function ReadNow({ targets, route, label, size = 'sm', auto = false }: { targets: Asked[]; route: string; label: string; size?: 'sm' | 'lg'; auto?: boolean }) {
  const client = useQueryClient();
  const [state, setState] = useState<State>('idle');
  const [left, setLeft] = useState(0);
  const started = useRef(false);
  const ask = async () => {
    setState('reading');
    setLeft(0);
    const results = await Promise.allSettled(targets.map((t) => readEvent(t, (n) => setLeft((x) => x + n))));
    await reload(client, route);
    setState(results.some((r) => r.status === 'rejected') ? 'error' : results.some((r) => r.status === 'fulfilled' && r.value) ? 'idle' : 'none');
  };
  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void ask();
  });
  return (
    <Button variant="outline" size={size} onClick={ask} disabled={state === 'reading'} aria-live="polite"
      title={`Read ${targets.length > 1 ? 'their latest events’ results' : 'this event’s results'} from the site now`}>
      <RefreshCw className={cn(state === 'reading' && 'animate-spin motion-reduce:animate-none')} />
      {state === 'reading' ? (left ? `Reading ${left} matches…` : 'Reading schedule…') : state === 'error' ? 'Didn’t go through, try again' : state === 'none' ? 'No matches fought yet' : label}
    </Button>
  );
}
