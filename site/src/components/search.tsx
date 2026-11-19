import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Photo } from '@/components/stats';
import { useApi } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { date, plural } from '@/lib/format';

interface Found {
  athletes: { user: string; name: string; club: string | null; photo: string | null }[];
  teams: { club_id: string; club: string; athletes: number }[];
  events: { event: string; title: string; start: string | null; city: string | null }[];
}

// One box for athletes, academies and events; ⌘K focuses it.
export function Search({ f }: { f: Filters }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); box.current?.querySelector('input')?.focus(); } };
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('keydown', key); addEventListener('mousedown', away);
    return () => { removeEventListener('keydown', key); removeEventListener('mousedown', away); };
  }, []);
  const { data, isFetching } = useApi<Found>('search', { site: f.site, q: debounced }, debounced.length >= 2);
  const go = (path: string) => { setOpen(false); setQ(''); navigate(f.link(path)); };
  return (
    <div ref={box} className="relative w-80">
      <Command shouldFilter={false} className="overflow-visible bg-transparent p-0">
        <CommandInput value={q} onValueChange={(v) => { setQ(v); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="Search athletes, academies, events" />
        {open && debounced.length >= 2 && (
          <CommandList className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70vh] overscroll-contain rounded-xl border bg-popover p-1 shadow-xl">
            {!isFetching && <CommandEmpty>Nothing matches “{debounced}”.</CommandEmpty>}
            {!!data?.athletes.length && <CommandGroup heading="Athletes">{data.athletes.map((a) => (
              <CommandItem key={a.user} value={`a${a.user}`} onSelect={() => go(`/athlete/${a.user}`)}>
                <Photo name={a.name} photo={a.photo} className="size-6" /><span className="truncate">{a.name}</span><span className="ml-auto truncate text-xs text-muted-foreground">{a.club}</span>
              </CommandItem>))}</CommandGroup>}
            {!!data?.teams.length && <CommandGroup heading="Academies">{data.teams.map((t) => (
              <CommandItem key={t.club_id} value={`t${t.club_id}`} onSelect={() => go(`/academy/${t.club_id}`)}>
                <span className="truncate">{t.club}</span><span className="ml-auto text-xs text-muted-foreground">{plural(t.athletes, 'athlete')}</span>
              </CommandItem>))}</CommandGroup>}
            {!!data?.events.length && <CommandGroup heading="Events">{data.events.map((e) => (
              <CommandItem key={e.event} value={`e${e.event}`} onSelect={() => go(`/event/${e.event}`)}>
                <span className="truncate">{e.title}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{date(e.start)}</span>
              </CommandItem>))}</CommandGroup>}
          </CommandList>
        )}
      </Command>
    </div>
  );
}
