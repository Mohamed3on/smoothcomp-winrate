import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CalendarDaysIcon, SearchIcon, UsersIcon, XIcon } from 'lucide-react';
import { useLocation } from 'wouter';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Photo } from '@/components/stats';
import { useApi } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { date, plural } from '@/lib/format';
import { forget, keyOf, matches, useRecent, type Recent } from '@/lib/recent';
import { cn } from '@/lib/utils';

// Both sites' matches, each with its site.
interface Found {
  athletes: { site: string; user: string; name: string; club: string | null; photo: string | null; wins: number }[];
  teams: { site: string; club_id: string; club: string; athletes: number }[];
  events: { site: string; event: string; title: string; start: string | null; city: string | null }[];
}

const MOD = /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl ';
const PATH = { athlete: '/athlete/', academy: '/academy/', event: '/event/' } as const;
const rowOf = (r: Recent) => `r:${keyOf(r)}`;
// Which site a row is from, where it isn't Smoothcomp's, as the events list names it.
const Site = ({ site }: { site: string }) => site === 'ajptour.com' ? <span className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground">AJP</span> : null;
// Academies and events have no picture: a mark of what they are, in the photo's place and size.
const Mark = ({ r }: { r: Recent }) => r.kind === 'athlete' ? <Photo name={r.name} photo={r.photo ?? null} className="size-6" /> : (
  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
    {r.kind === 'academy' ? <UsersIcon className="size-3.5" /> : <CalendarDaysIcon className="size-3.5" />}
  </span>
);

// One palette for athletes, academies and events, opened from the header's box or with ⌘K.
export function Search({ f }: { f: Filters }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const searching = debounced.length >= 2;
  const { data, isFetching } = useApi<Found>('search', { site: f.site, off: [...f.off].join(','), q: debounced }, searching);
  // Waiting on the debounce or the answer: the box spins and the last query's results dim until this one's land.
  const pending = q.trim().length >= 2 && (q.trim() !== debounced || isFetching);
  // What was opened before, on either site: all of it on an empty box, and what the typed words match, at once, above what the server finds.
  const typed = q.trim();
  const all = useRecent();
  const recent = typed ? (typed.length >= 2 ? all.filter((r) => matches(r.name, typed)).slice(0, 4) : []) : all.slice(0, 8);
  const shown = (site: string, kind: Recent['kind'], id: string) => recent.some((r) => keyOf(r) === keyOf({ site, kind, id }));
  const athletes = data?.athletes.filter((a) => !shown(a.site, 'athlete', a.user)) ?? [];
  const teams = data?.teams.filter((t) => !shown(t.site, 'academy', t.club_id)) ?? [];
  const events = data?.events.filter((e) => !shown(e.site, 'event', e.event)) ?? [];
  // Shift+Backspace (or Delete) takes the highlighted recent row away, and the highlight moves to the row after it.
  const remove = (r: Recent) => {
    const i = recent.indexOf(r);
    const next = recent[i + 1] ?? recent[i - 1];
    // Moved first: cmdk sends the highlight to the top when the highlighted row goes.
    if (next) flushSync(() => setSelected(rowOf(next)));
    forget(r);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete') && recent.find((x) => rowOf(x) === selected);
    if (r) { e.preventDefault(); remove(r); }
  };
  const live = searching && typed.length >= 2;
  const stale = cn('transition-opacity duration-150 ease-out', pending && 'opacity-60');
  const go = (path: string, site: string) => { setOpen(false); setQ(''); navigate(f.linkOn(path, site)); };
  return (
    <>
      {/* Typing on the box starts the search with that letter. */}
      {/* Below md only the icon shows. */}
      {/* iOS raises the keyboard only for a focus inside the tap, and base-ui focuses a frame later: render the dialog now and focus its box here. */}
      <button type="button" onClick={() => { flushSync(() => setOpen(true)); input.current?.focus(); }} aria-label="Search athletes, academies, events"
        onKeyDown={(e) => { if (e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setQ(e.key); setOpen(true); } }}
        className="flex size-8 items-center justify-center gap-2 rounded-lg border border-input/30 bg-input/30 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:w-48 md:justify-start md:px-2 lg:w-80">
        <SearchIcon className="size-4 shrink-0 md:opacity-50" />
        <span className="truncate max-md:hidden">Search athletes, academies, events</span>
        <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-xs max-md:hidden">{MOD}K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find an athlete, academy or event." className="sm:max-w-xl">
        <Command shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown}>
          <CommandInput ref={input} value={q} onValueChange={setQ} loading={pending} placeholder="Search athletes, academies, events" />
          {(live || !!recent.length) && (
            <CommandList aria-busy={pending} className="max-h-[50vh] overscroll-contain">
              {live && !pending && <CommandEmpty>{debounced.split(/\s+/).some((w) => [...w].length >= 3) ? <>Nothing matches “{debounced}”.</> : 'Type 3 letters of a name to find athletes and academies.'}</CommandEmpty>}
              {!!recent.length && <CommandGroup heading="Recent">{recent.map((r) => (
                <CommandItem key={rowOf(r)} value={rowOf(r)} onSelect={() => go(PATH[r.kind] + r.id, r.site)} aria-keyshortcuts="Shift+Backspace Shift+Delete">
                  <Mark r={r} /><span className="truncate">{r.name}</span><Site site={r.site} /><span className="ml-auto truncate text-xs text-muted-foreground">{r.sub}</span>
                  {/* Shown on the row under the pointer or keys; keeps the input focused, so the arrows go on working. */}
                  <button type="button" tabIndex={-1} aria-label={`Remove ${r.name} from recent`} title="Remove from recent (⇧⌫)"
                    onPointerDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); remove(r); }}
                    className="relative -my-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-150 ease-out group-data-selected/command-item:opacity-100 before:absolute before:-inset-1 hover:bg-foreground/10 hover:text-foreground">
                    <XIcon className="size-3.5" />
                  </button>
                </CommandItem>))}</CommandGroup>}
              {live && !!athletes.length && <CommandGroup heading="Athletes" className={stale}>{athletes.map((a) => (
                <CommandItem key={a.site + a.user} value={`a:${a.site}:${a.user}`} onSelect={() => go(`/athlete/${a.user}`, a.site)}>
                  <Photo name={a.name} photo={a.photo} className="size-6" /><span className="truncate">{a.name}</span><Site site={a.site} /><span className="ml-auto truncate text-xs text-muted-foreground">{a.club}</span>
                  {!!a.wins && <span className="shrink-0 text-xs tabular-nums">{plural(a.wins, 'win')}</span>}
                </CommandItem>))}</CommandGroup>}
              {live && !!teams.length && <CommandGroup heading="Academies" className={stale}>{teams.map((t) => (
                <CommandItem key={t.site + t.club_id} value={`t:${t.site}:${t.club_id}`} onSelect={() => go(`/academy/${t.club_id}`, t.site)}>
                  <span className="truncate">{t.club}</span><Site site={t.site} /><span className="ml-auto shrink-0 text-xs text-muted-foreground">{plural(t.athletes, 'athlete')}</span>
                </CommandItem>))}</CommandGroup>}
              {live && !!events.length && <CommandGroup heading="Events" className={stale}>{events.map((e) => (
                <CommandItem key={e.site + e.event} value={`e:${e.site}:${e.event}`} onSelect={() => go(`/event/${e.event}`, e.site)}>
                  <span className="truncate">{e.title}</span><Site site={e.site} /><span className="ml-auto shrink-0 text-xs text-muted-foreground">{date(e.start)}</span>
                </CommandItem>))}</CommandGroup>}
            </CommandList>
          )}
        </Command>
      </CommandDialog>
    </>
  );
}
