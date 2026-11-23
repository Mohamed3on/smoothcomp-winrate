import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Ledger, type Column } from '@/components/ledger';
import { Empty, PageHead } from '@/components/empty';
import { Num } from '@/components/stats';
import { useApi, type EventRow } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { date, isUpcoming } from '@/lib/format';

export function EventsPage() {
  const f = useFilters();
  const { data, isLoading, isFetching } = useApi<{ rows: EventRow[] }>('events', { site: f.site, limit: 2000 });
  const columns: Column<EventRow>[] = [
    { key: 'date', label: 'Date', width: '9rem', compact: '6rem', align: 'start', cell: (e) => <span className="text-muted-foreground">{date(e.start)}</span> },
    { key: 'event', label: 'Event', align: 'start', cell: (e) => (
      <div className="flex flex-col gap-0.5">
        <Link href={f.link(`/event/${e.event}`)} className="font-medium hover:text-primary">{e.title ?? `Event ${e.event}`}</Link>
        <span className="text-xs text-muted-foreground">{[e.city, e.organiser].filter(Boolean).join(' · ')}</span>
      </div>) },
    { key: 'athletes', label: 'Athletes', width: '8rem', compact: '4.5rem', cell: (e) => <Num n={e.athletes} /> },
    { key: 'divisions', label: 'Divisions', width: '8rem', narrow: true, cell: (e) => <Num n={e.divisions} /> },
    { key: 'teams', label: 'Academies', width: '8rem', narrow: true, cell: (e) => <Num n={e.teams} /> },
    { key: 'state', label: 'Read', width: '9rem', narrow: true, cell: (e) => e.fought ? <Badge variant="secondary">Results</Badge> : isUpcoming(e.start) ? <Badge variant="outline" className="border-primary/40 text-primary">Upcoming</Badge> : <Badge variant="outline">Entrants</Badge> },
  ];
  return (
    <>
      <PageHead title="Events" text="Every event an install has opened on Smoothcomp, newest first. Events with results carry podiums and records; the rest list who entered." />
      <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={columns} rowKey={(e) => e.event}
        empty={<Empty title="No events yet" text="An event appears here once someone with Mat Stats opens its results or participants page on Smoothcomp." />} />
    </>
  );
}
