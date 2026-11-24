import NumberFlow from '@number-flow/react';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Count, Ledger, type Column } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty } from '@/components/empty';
import { Belt, Identity, Medals, Photo, Place, Record, Stat } from '@/components/stats';
import { useApi, type Athlete, type EventEntry, type Types } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { beltAt, date, plural, rate, winsOf } from '@/lib/format';
import { DivisionLink } from '@/pages/division';
import { ATHLETE_SORTS, athleteColumns, resetAction } from '@/pages/athletes';

type Event = { event: string; title: string | null; start: string | null; athletes: number; fought: number; gold: number; silver: number; bronze: number; records: { wins: Types; losses: Types }[] };
interface Data {
  club: { id: string; name: string | null };
  members: (Athlete & { seen: string })[];
  events: Event[];
}

// One event's athletes from this academy, read when its row opens: their divisions and places there, and
// their record and win rate over the finish types switched on. Medallists first, then the most wins.
function EventGlance({ event, club, f }: { event: string; club: string; f: Filters }) {
  const { data } = useApi<{ entries: EventEntry[] }>('event', { site: f.site, off: f.query.off, id: event, club });
  if (!data) return <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-6 gap-y-2 pt-1">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  const people = [...Map.groupBy(data.entries, (e) => e.user).values()].map((group) => {
    const rows = group.toSorted((a, b) => (a.place ?? 999) - (b.place ?? 999));
    const w = rows.reduce((n, r) => n + winsOf(r.wins, f.counted), 0), l = rows.reduce((n, r) => n + winsOf(r.losses, f.counted), 0);
    return { ...rows[0], rows, w, l, best: rows[0].place ?? 999, belt: beltAt(rows.map((r) => r.division)) ?? rows[0].belt };
  }).sort((a, b) => a.best - b.best || b.w - a.w || a.l - b.l || (a.name ?? '').localeCompare(b.name ?? ''));
  if (!people.length) return <p className="text-sm text-muted-foreground">Nobody from this academy is listed here any more.</p>;
  return (
    <ol className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-6 gap-y-1 rounded-lg border bg-card p-3">
      {people.map((p) => (
        <li key={p.user} className="flex min-w-0 items-start gap-2 py-1 text-sm">
          <Photo name={p.name} photo={p.photo} className="size-6" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2"><Link href={f.link(`/athlete/${p.user}`)} className="min-w-0 break-words hover:text-primary">{p.name ?? `Athlete ${p.user}`}</Link><Belt belt={p.belt} /></span>
            {p.rows.map((r) => <span key={r.division} className="flex items-center gap-2 text-xs text-muted-foreground">{p.fought ? <Place p={r.place} /> : null}<DivisionLink event={event} name={r.division} f={f} className="min-w-0 break-words" /></span>)}
          </span>
          {p.fought ? <span className="flex shrink-0 flex-col items-end leading-tight" title="Win rate here, counted finishes"><span className="font-semibold">{rate(p.w, p.l) ?? '–'}</span><span className="text-xs"><Record w={p.w} l={p.l} /></span></span> : null}
        </li>
      ))}
    </ol>
  );
}

export function AcademyPage({ id }: { id: string }) {
  const f = useFilters();
  const { data, isLoading } = useApi<Data>('team', { site: f.site, off: f.query.off, id });
  const ranked = useApi<{ rows: Athlete[]; total: number }>('athletes', { ...f.query, limit: 2000, club: id });
  if (isLoading) return <Skeleton className="h-9 w-80" />;
  if (!data) return <Empty title="No academy here" text="Mat Stats has nothing under this academy on this site. It may be on the other site, or nobody has read it yet." />;
  const name = data.club.name ?? `Academy ${id}`;
  document.title = `${name} · Mat Stats`;
  const members = data.members.filter((m) => m.wins != null);
  const unranked = data.members.filter((m) => m.wins == null);
  const sum = (k: 'wins' | 'gold' | 'silver' | 'bronze') => members.reduce((n, m) => n + (Number(m[k]) || 0), 0);
  const podium = (k: 'gold' | 'silver' | 'bronze') => data.events.reduce((n, e) => n + (Number(e[k]) || 0), 0);
  // Athletes or events, the tab in the address (athletes when it names none).
  const tab = f.get('tab') === 'events' ? 'events' : 'athletes';
  const tally = (e: Event): [number, number] => [e.records.reduce((n, r) => n + winsOf(r.wins, f.counted), 0), e.records.reduce((n, r) => n + winsOf(r.losses, f.counted), 0)];
  const eventColumns: Column<Event>[] = [
    { key: 'date', label: 'Date', width: '8rem', align: 'start', cell: (e) => <span className="text-muted-foreground">{date(e.start)}</span> },
    { key: 'event', label: 'Event', align: 'start', cell: (e) => <Link href={f.link(`/event/${e.event}?tab=academies&open=${id}`)} title="This academy at the event" className="font-medium hover:text-primary">{e.title ?? `Event ${e.event}`}</Link> },
    { key: 'athletes', label: 'Athletes', width: '6rem', cell: (e) => e.athletes },
    { key: 'podiums', label: 'Podiums', width: '10rem', cell: (e) => (e.fought ? <Medals g={e.gold} s={e.silver} b={e.bronze} /> : <span className="text-xs text-muted-foreground">Entrants only</span>) },
    { key: 'record', label: 'Record', width: '7rem', cell: (e) => (e.fought ? <Record w={tally(e)[0]} l={tally(e)[1]} /> : '') },
    { key: 'rate', label: 'Win rate', width: '6rem', title: 'Wins over matches here, counted finishes', cell: (e) => (e.fought ? <span className="font-semibold">{rate(...tally(e)) ?? '–'}</span> : '') },
  ];
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
        <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          <span>{plural(data.members.length, 'athlete')} seen</span>
          <a href={`${f.home}/en/club/${id}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">Academy on {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
        </div>
      </header>
      <Card className="py-0"><dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        <Stat label="Wins, counted finishes">{sum('wins').toLocaleString('en')}</Stat>
        <Stat label="Per athlete">{members.length ? (sum('wins') / members.length).toFixed(1) : '–'}</Stat>
        <Stat label="Medals"><Medals g={sum('gold')} s={sum('silver')} b={sum('bronze')} className="justify-start text-base" /></Stat>
        <Stat label="Podiums at events read"><Medals g={podium('gold')} s={podium('silver')} b={podium('bronze')} className="justify-start text-base" /></Stat>
        <Stat label="Events seen">{data.events.length}</Stat>
      </dl></Card>

      <Tabs value={tab} onValueChange={(v) => f.set({ tab: v === 'events' ? 'events' : null })} className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="athletes">Athletes<NumberFlow value={ranked.data?.total ?? members.length} className="ml-1 text-xs text-muted-foreground" /></TabsTrigger>
          <TabsTrigger value="events">Events<NumberFlow value={data.events.length} className="ml-1 text-xs text-muted-foreground" /></TabsTrigger>
        </TabsList>
      <TabsContent value="athletes" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">Every athlete here with a career or results, ranked under the filters.</p>
          {ranked.data && <Count n={ranked.data.total} unit={ranked.data.total === 1 ? 'athlete' : 'athletes'} />}
        </div>
        <FilterBar f={f} sorts={ATHLETE_SORTS} />
        <Ledger rows={ranked.data?.rows} loading={ranked.isLoading || ranked.isFetching} columns={athleteColumns(f, false)} rowKey={(a) => a.user} sort={f.query.sort} asc={f.query.dir === 'asc'} onSort={(s, asc) => f.set({ sort: s, dir: asc ? 'asc' : null })}
          empty={<Empty title="No athletes here pass the filters" text="Lower the minimums or widen the age range." action={resetAction(f)} />} />
        {unranked.length > 0 && (
          <Card className="gap-3 px-5 py-4">
            <h3 className="text-sm font-medium">Not ranked yet <span className="font-normal text-muted-foreground">· no career or results read</span></h3>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{unranked.map((m) => <Identity key={m.user} a={m} f={f} club={false} />)}</div>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="events">
        <Ledger rows={data.events} loading={false} columns={eventColumns} rowKey={(e) => e.event} expand={(e) => <EventGlance event={e.event} club={id} f={f} />}
          empty={<Empty title="No events read" text="Mat Stats hasn’t read an event with this academy in it yet." />} />
      </TabsContent>
      </Tabs>
    </div>
  );
}
