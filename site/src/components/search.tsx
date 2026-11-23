import { useEffect, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { useLocation } from 'wouter';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Photo } from '@/components/stats';
import { useApi } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { date, plural } from '@/lib/format';

interface Found {
  athletes: { user: string; name: string; club: string | null; photo: string | null; wins: number }[];
  teams: { club_id: string; club: string; athletes: number }[];
  events: { event: string; title: string; start: string | null; city: string | null }[];
}

const MOD = /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl ';

// One palette for athletes, academies and events, opened from the header's box or with ⌘K.
export function Search({ f }: { f: Filters }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const searching = debounced.length >= 2;
  const { data, isFetching } = useApi<Found>('search', { site: f.site, off: [...f.off].join(','), q: debounced }, searching);
  const go = (path: string) => { setOpen(false); setQ(''); navigate(f.link(path)); };
  return (
    <>
      {/* Typing on the box starts the search with that letter. */}
      <button type="button" onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setQ(e.key); setOpen(true); } }}
        className="flex h-8 w-80 items-center gap-2 rounded-lg border border-input/30 bg-input/30 px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <SearchIcon className="size-4 shrink-0 opacity-50" />
        <span className="truncate">Search athletes, academies, events</span>
        <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-xs">{MOD}K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find an athlete, academy or event." className="sm:max-w-xl">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search athletes, academies, events" />
          {/* Results show only for the query they answer, not a shorter one's leftovers. */}
          {searching && (
            <CommandList className="max-h-[50vh] overscroll-contain">
              {!isFetching && <CommandEmpty>Nothing matches “{debounced}”.</CommandEmpty>}
              {!!data?.athletes.length && <CommandGroup heading="Athletes">{data.athletes.map((a) => (
                <CommandItem key={a.user} value={`a${a.user}`} onSelect={() => go(`/athlete/${a.user}`)}>
                  <Photo name={a.name} photo={a.photo} className="size-6" /><span className="truncate">{a.name}</span><span className="ml-auto truncate text-xs text-muted-foreground">{a.club}</span>
                  {!!a.wins && <span className="shrink-0 text-xs tabular-nums">{plural(a.wins, 'win')}</span>}
                </CommandItem>))}</CommandGroup>}
              {!!data?.teams.length && <CommandGroup heading="Academies">{data.teams.map((t) => (
                <CommandItem key={t.club_id} value={`t${t.club_id}`} onSelect={() => go(`/academy/${t.club_id}`)}>
                  <span className="truncate">{t.club}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{plural(t.athletes, 'athlete')}</span>
                </CommandItem>))}</CommandGroup>}
              {!!data?.events.length && <CommandGroup heading="Events">{data.events.map((e) => (
                <CommandItem key={e.event} value={`e${e.event}`} onSelect={() => go(`/event/${e.event}`)}>
                  <span className="truncate">{e.title}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{date(e.start)}</span>
                </CommandItem>))}</CommandGroup>}
            </CommandList>
          )}
        </Command>
      </CommandDialog>
    </>
  );
}
