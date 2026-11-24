import NumberFlow from '@number-flow/react';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Count, Ledger } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty } from '@/components/empty';
import { Identity, Medals, Record, Stat } from '@/components/stats';
import { useApi, type Athlete, type Types } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { date, plural, winsOf } from '@/lib/format';
import { ATHLETE_SORTS, athleteColumns, resetAction } from '@/pages/athletes';

interface Data {
  club: { id: string; name: string | null };
  members: (Athlete & { seen: string })[];
  events: { event: string; title: string | null; start: string | null; athletes: number; fought: number; gold: number; silver: number; bronze: number; records: { wins: Types; losses: Types }[] }[];
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
        <Card className="gap-0 overflow-hidden py-0">
          <Table><TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="w-32 pl-5">Date</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Athletes</TableHead><TableHead className="text-right">Podiums</TableHead><TableHead className="pr-5 text-right">Record</TableHead>
          </TableRow></TableHeader>
            <TableBody>{data.events.map((e) => {
              const w = e.records.reduce((n, r) => n + winsOf(r.wins, f.counted), 0);
              const l = e.records.reduce((n, r) => n + winsOf(r.losses, f.counted), 0);
              return (
                <TableRow key={e.event}>
                  <TableCell className="pl-5 text-muted-foreground">{date(e.start)}</TableCell>
                  <TableCell><Link href={f.link(`/event/${e.event}`)} className="font-medium hover:text-primary">{e.title ?? `Event ${e.event}`}</Link></TableCell>
                  <TableCell className="text-right">{e.athletes}</TableCell>
                  <TableCell className="text-right">{e.fought ? <Medals g={e.gold} s={e.silver} b={e.bronze} /> : <span className="text-xs text-muted-foreground">Entrants only</span>}</TableCell>
                  <TableCell className="pr-5 text-right">{e.fought ? <Record w={w} l={l} /> : ''}</TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        </Card>
      </TabsContent>
      </Tabs>
    </div>
  );
}
