import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Count, Ledger, type Column } from '@/components/ledger';
import { Debounced, Field } from '@/components/filter-bar';
import { Empty, PageHead } from '@/components/empty';
import { PlaceFilter } from '@/components/place-filter';
import { Flag, Num } from '@/components/stats';
import { useApi, type EventRow } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import type { Dot } from '@/components/places-map';
import { date, fmt } from '@/lib/format';

// The map carries Leaflet, so it loads when first opened.
const PlacesMap = lazy(() => import('@/components/places-map'));
const items = (pairs: string[][]) => pairs.map(([value, label]) => ({ value, label }));
const WINDOWS = {
  upcoming: items([['30', 'Next 30 days'], ['90', 'Next 3 months'], ['180', 'Next 6 months'], ['365', 'Next 12 months'], ['0', 'Any time']]),
  past: items([['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months'], ['0', 'Any time']]),
};
const SPORTS = items([['', 'Gi and NoGi'], ['gi', 'Gi'], ['nogi', 'NoGi']]);
const distance = (km: number | null) => (km == null ? null : km < 1 ? '<1\u00a0km' : `${fmt(Math.round(km))}\u00a0km`);
// Where an event's name leads: its page here once read, else its page on its own site, to enter.
const HOMES = { 'smoothcomp.com': 'https://smoothcomp.com', 'ajptour.com': 'https://ajptour.com' };
const target = (e: EventRow, f: Filters) => (e.athletes ? f.linkOn(`/event/${e.event}`, e.site) : e.url ?? `${HOMES[e.site]}/en/event/${e.event}`);
// Who runs it; an AJP Tour event says so when it names no organiser.
const runBy = (e: EventRow) => e.organiser ?? (e.site === 'ajptour.com' ? 'AJP Tour' : null);

// An event's name, then where (flag, city, how far) and who runs it. One read opens here; one nobody
// with Mat Stats has opened yet goes to its page on Smoothcomp or AJP Tour, where it can be entered.
function EventCell({ e, f }: { e: EventRow; f: Filters }) {
  const title = e.title ?? `Event ${e.event}`, by = runBy(e);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {e.athletes
        ? <Link href={target(e, f)} className="font-medium break-words hover:text-primary">{title}</Link>
        : <a href={target(e, f)} target="_blank" rel="noopener" className="font-medium break-words hover:text-primary">{title}<ExternalLink className="ml-1 inline size-3 align-baseline text-muted-foreground" /></a>}
      {/* Wide screens give the distance its own column. */}
      {/* Running text, each dot held to the word before it, so a wrapped line never starts with one. */}
      <span className="text-xs text-muted-foreground">
        <Flag code={e.country?.toLowerCase() ?? null} className="mr-1.5 text-sm" />
        {e.city}{e.km != null && <span className="lg:hidden">{e.city && '\u00a0· '}{distance(e.km)}</span>}{by && <>{(e.city || e.km != null) && '\u00a0· '}{by}</>}
      </span>
    </div>
  );
}

export function EventsPage() {
  const f = useFilters();
  const when = f.get('when') === 'past' ? 'past' : 'upcoming';
  const view = f.get('view') === 'map' ? 'map' : 'list';
  const days = f.get('days') || (when === 'upcoming' ? '90' : '0');
  const near = f.get('near');
  const sort = f.get('sort') === 'athletes' || (f.get('sort') === 'distance' && near) ? f.get('sort') : 'date';
  const { data, isLoading, isFetching, error, refetch } = useApi<{ rows: EventRow[] }>('events', {
    when, days, sport: f.get('sport'), min: f.get('min'), q: f.get('q'), near, km: near ? f.get('km') : '', sort, limit: 2000,
  });
  const dots = useMemo(() => (data?.rows ?? []).filter((e) => e.lat != null && e.lng != null).map((e): Dot => ({
    lat: e.lat!, lng: e.lng!, radius: e.athletes ? 7 : 5, read: !!e.athletes, title: e.title ?? `Event ${e.event}`, href: target(e, f), internal: !!e.athletes,
    about: [date(e.start), e.city, e.km != null && `${fmt(Math.round(e.km))} km`, runBy(e), e.athletes ? `${fmt(e.athletes)} athletes` : e.registered ? `${fmt(e.registered)} registered` : 'Entrants not read yet'].filter(Boolean).join(' · '),
  })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorts = items([['date', 'Date'], ...(near ? [['distance', 'Distance']] : []), ['athletes', 'Athletes']]);
  const columns: Column<EventRow>[] = [
    { key: 'date', label: 'Date', width: '9rem', compact: '6rem', align: 'start', sort: 'date', cell: (e) => <span className="text-muted-foreground">{date(e.start)}</span> },
    { key: 'event', label: 'Event', align: 'start', cell: (e) => <EventCell e={e} f={f} /> },
    // Narrow screens show the distance under the event's name already, so it stays out of the row's expansion.
    ...(near ? [{ key: 'km', label: 'Distance', width: '7rem', sort: 'distance', narrow: true, preview: true, cell: (e: EventRow) => <span className={e.km == null ? 'text-muted-foreground' : ''}>{distance(e.km) ?? '–'}</span> }] : []),
    { key: 'athletes', label: 'Athletes', width: '8rem', compact: '5.5rem', sort: 'athletes', title: 'Who entered, once someone with Mat Stats opens its entrants or results; before, how many its page counts',
      cell: (e) => (e.athletes ? <Num n={e.athletes} /> : e.registered ? <span title="Registered, as the event's own page counts them; nobody with Mat Stats has opened its entrants yet"><Num n={e.registered} dim /></span> : <span className="text-muted-foreground" title="Nobody with Mat Stats has opened its entrants yet">–</span>) },
    { key: 'divisions', label: 'Divisions', width: '8rem', narrow: true, cell: (e) => (e.athletes ? <Num n={e.divisions} /> : <span className="text-muted-foreground">–</span>) },
    { key: 'teams', label: 'Academies', width: '8rem', narrow: true, cell: (e) => (e.athletes ? <Num n={e.teams} /> : <span className="text-muted-foreground">–</span>) },
    { key: 'state', label: 'Read', width: '9rem', narrow: true, cell: (e) => e.fought ? <Badge variant="secondary">Results</Badge> : e.athletes ? <Badge variant="outline" className="border-primary/40 text-primary">Entrants</Badge> : <Badge variant="outline">Not yet</Badge> },
  ];
  const reset = () => f.set({ near: null, place: null, km: null, days: null, sport: null, min: null, q: null });
  return (
    <>
      <PageHead title="Events" aside={data && <Count n={data.rows.length} unit={data.rows.length === 1 ? 'event' : 'events'} />}
        text="Grappling events on Smoothcomp and AJP Tour: find one to enter near you or anywhere, or read how a past one went. Entrants and results show once someone with Mat Stats opens them." />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={when} onValueChange={(v) => f.set({ when: v === 'past' ? 'past' : null, days: null, sort: null })}>
              <TabsList><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList>
            </Tabs>
            <Tabs value={view} onValueChange={(v) => f.set({ view: v === 'map' ? 'map' : null })}>
              <TabsList aria-label="Show as"><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="map">Map</TabsTrigger></TabsList>
            </Tabs>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Field label="Near"><PlaceFilter f={f} /></Field>
            <Field label="When">
              <Select items={WINDOWS[when]} value={days} onValueChange={(v) => f.set({ days: v as string })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{WINDOWS[when].map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Sport">
              <Select items={SPORTS} value={f.get('sport')} onValueChange={(v) => f.set({ sport: (v as string) || null })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{SPORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Min. athletes"><Debounced f={f} name="min" label="Minimum athletes" placeholder="Any" className="w-24" /></Field>
            <Field label="Sort by">
              <Select items={sorts} value={sort} onValueChange={(v) => f.set({ sort: v === 'date' ? null : (v as string) })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{sorts.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Name or city" className="min-w-44 flex-1"><Debounced f={f} name="q" type="search" label="Filter by name or city" placeholder="Filter by name or city" className="w-full max-w-md" /></Field>
          </div>
        </div>
        {view === 'map' && !error ? (
          <Suspense fallback={<div className="h-[70svh] min-h-80 rounded-xl border bg-card" />}><PlacesMap dots={dots} f={f} /></Suspense>
        ) : <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={columns} rowKey={(e) => `${e.site}:${e.event}`}
          sort={sort} asc={sort === 'distance' || (sort === 'date' && when === 'upcoming')} onSort={(s) => f.set({ sort: s === 'date' ? null : s })}
          empty={error
            ? <Empty title="Couldn’t load the events" text="Mat Stats didn’t answer. Try again in a moment." action={{ label: 'Try again', onClick: () => refetch() }} />
            : <Empty title={when === 'upcoming' ? 'No upcoming events match' : 'No past events match'} text="Widen the distance or the dates, pick another place, or lower the minimum." action={{ label: 'Reset filters', onClick: reset }} />} />}
      </div>
    </>
  );
}
