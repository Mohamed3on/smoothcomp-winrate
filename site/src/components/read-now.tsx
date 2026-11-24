import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type State = 'idle' | 'asking' | 'reading' | 'none' | 'recent' | 'error';
const SAY: Record<State, string> = { idle: '', asking: 'Asking…', reading: 'Reading…', none: 'Nothing started to read', recent: 'Read minutes ago', error: 'Didn’t go through, try again' };

// Has the server read results now (worker.js readNow): the event, or the athlete's last events of the month,
// go to the front of the crawl queue and a crawler lane starts. The page then asks again every 35 seconds
// (past the 30 the browser keeps a copy) for five minutes, as a big event arrives in parts.
export function ReadNow({ site, event, user, route, label, size = 'sm' }: { site: string; event?: string; user?: string; route: string; label: string; size?: 'sm' | 'lg' }) {
  const client = useQueryClient();
  const [state, setState] = useState<State>('idle');
  useEffect(() => {
    if (state !== 'reading') return;
    const tick = setInterval(() => client.invalidateQueries({ queryKey: [route] }), 35e3);
    const end = setTimeout(() => setState('idle'), 5 * 60e3);
    return () => { clearInterval(tick); clearTimeout(end); };
  }, [state, client, route]);
  const ask = async () => {
    setState('asking');
    const r = await fetch('/read-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, event, user }) }).catch(() => null);
    const body: { events: string[]; found?: number } | null = r?.ok ? await r.json().catch(() => null) : null;
    setState(!body ? 'error' : body.events.length ? 'reading' : body.found ? 'recent' : 'none');
  };
  const busy = state === 'asking' || state === 'reading';
  return (
    <Button variant="outline" size={size} onClick={ask} disabled={busy} aria-live="polite"
      title={state === 'reading' ? 'Results show here as they arrive, usually within a minute or two' : `Mat Stats reads ${event ? 'this event’s results' : 'their latest events'} from the site now, instead of waiting for its turn`}>
      <RefreshCw className={cn(busy && 'animate-spin motion-reduce:animate-none')} />{SAY[state] || label}
    </Button>
  );
}
