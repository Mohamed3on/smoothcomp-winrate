import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Ledger, type Column } from '@/components/ledger';
import { Empty } from '@/components/empty';
import { Identity, Num, Place, Record } from '@/components/stats';
import { useApi, type Bout, type EventEntry, type EventMeta } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { date, plural, winsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MatchLine, type Meeting } from '@/pages/athlete';

// A division's own page, wherever a division is named. Its name rides in the query: names hold slashes.
export const divisionHref = (event: string, name: string) => `/event/${event}/division?name=${encodeURIComponent(name.trim())}`;
export function DivisionLink({ event, name, f, className }: { event: string; name: string; f: Filters; className?: string }) {
  return <Link href={f.link(divisionHref(event, name))} className={cn('hover:text-primary', className)}>{name.trim()}</Link>;
}

type Row = EventEntry & { bouts?: Bout[] | null };

// One division: everyone in it by place (then record), each with the matches they fought there.
export function DivisionPage({ id }: { id: string }) {
  const f = useFilters();
  const name = (f.params.get('name') ?? '').trim();
  const { data, isLoading } = useApi<{ event: EventMeta; entries: Row[] }>('division', { site: f.site, off: f.query.off, id, name });
  if (isLoading) return <Skeleton className="h-9 w-96" />;
  if (!data) return <Empty title="No division here" text="Mat Stats has nobody under this division at this event." />;
  const { event } = data;
  const title = event.title ?? `Event ${id}`;
  document.title = `${name} · ${title} · Mat Stats`;
  const rows = data.entries.map((e) => ({ ...e, w: winsOf(e.wins, f.counted), l: winsOf(e.losses, f.counted) }))
    .sort((a, b) => (a.place ?? 999) - (b.place ?? 999) || b.w - a.w || a.l - b.l || (a.name ?? '').localeCompare(b.name ?? ''));
  const fought = rows.some((r) => r.fought);
  const matchesOf = (r: Row): Meeting[] => (r.bouts ?? []).map((b) => ({ won: b.won, opponent: b.opponent, club: b.club, image: null, type: b.type, how: b.how ?? undefined, stage: b.stage, user: b.user, us: b.us, them: b.them, clock: b.clock }));
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'place', label: 'Place', width: '5rem', align: 'start', cell: (r) => <Place p={r.place} /> },
    { key: 'who', label: 'Athlete', align: 'start', cell: (r) => <Identity a={r} f={f} /> },
    ...(fought ? [{ key: 'record', label: 'Record', width: '7rem', cell: (r: (typeof rows)[number]) => <Record w={r.w} l={r.l} /> }] : []),
    { key: 'career', label: 'Career wins', width: '8rem', title: 'Wins of the finish types switched on: their career, or their results where Smoothcomp serves none', cell: (r) => <Num n={r.career_wins} /> },
  ];
  const matches = (r: Row) => {
    const list = matchesOf(r);
    return list.length
      ? <ul className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">{list.map((m, i) => <MatchLine key={i} m={m} f={f} divisions={false} />)}</ul>
      : <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">No matches read for them here.</p>;
  };
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{name}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <Link href={f.link(`/event/${id}`)} className="font-medium text-foreground hover:text-primary">{title}</Link>
          <span>{date(event.start)}</span>
          {event.city && <span>{event.city}</span>}
          <span>{plural(rows.length, 'athlete')}</span>
          <a href={`${f.home}/en/event/${id}/${fought ? 'results' : 'participants'}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">On {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
        </div>
      </header>
      <Ledger rows={rows} loading={false} columns={columns} rowKey={(r) => r.user} empty={<Empty title="Nobody here" text="Nobody is listed in this division." />} expand={fought ? matches : undefined} />
    </div>
  );
}
