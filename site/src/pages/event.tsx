import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Ledger, type Column } from '@/components/ledger';
import { Empty } from '@/components/empty';
import { Flag, Identity, Medals, Num, Photo, Place, Record } from '@/components/stats';
import { useApi, type EventEntry, type EventMeta } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { date, fmt, plural, winsOf } from '@/lib/format';

type Person = EventEntry & { rows: EventEntry[]; w: number; l: number; best: number; career: number | null };
interface Division { name: string; rows: (EventEntry & { career: number | null })[] }
interface Academy { id: string | null; name: string | null; athletes: number; g: number; s: number; b: number; w: number; l: number; career: number }

const NameLink = ({ e, f }: { e: EventEntry; f: Filters }) =>
  <Link href={f.link(`/athlete/${e.user}`)} className="hover:text-primary">{e.name ?? `Athlete ${e.user}`}</Link>;

export function EventPage({ id }: { id: string }) {
  const f = useFilters();
  const { data, isLoading } = useApi<{ event: EventMeta; entries: EventEntry[] }>('event', { site: f.site, off: f.query.off, id });
  if (isLoading) return <Skeleton className="h-9 w-96" />;
  if (!data) return <Empty title="No event here" text="Mat Stats has nothing under this event on this site. Nobody has opened it with Mat Stats yet." />;
  const { event, entries } = data;
  const title = event.title ?? `Event ${id}`;
  document.title = `${title} · Mat Stats`;
  const fought = entries.some((e) => e.fought);
  const careerOf = (e: EventEntry) => (e.career_wins == null ? null : winsOf(JSON.parse(e.career_types ?? '{}'), f.counted));
  const people: Person[] = [...Map.groupBy(entries, (e) => e.user).values()].map((rows) => ({
    ...rows[0], rows, w: rows.reduce((n, r) => n + winsOf(r.wins, f.counted), 0), l: rows.reduce((n, r) => n + winsOf(r.losses, f.counted), 0),
    best: Math.min(...rows.map((r) => r.place ?? 999)), career: careerOf(rows[0]),
  })).sort(fought ? (a, b) => a.best - b.best || b.w - a.w || a.l - b.l : (a, b) => (b.career ?? -1) - (a.career ?? -1));
  const divisions: Division[] = [...Map.groupBy(entries, (e) => e.division)].map(([name, rows]) => ({ name, rows: rows.map((r) => ({ ...r, career: careerOf(r) })) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  const academies: Academy[] = [...Map.groupBy(entries.filter((e) => e.club_id || e.club), (e) => e.club_id ?? e.club ?? '').values()].map((rows) => ({
    id: rows[0].club_id, name: rows[0].club, athletes: new Set(rows.map((r) => r.user)).size,
    g: rows.filter((r) => r.place === 1).length, s: rows.filter((r) => r.place === 2).length, b: rows.filter((r) => r.place === 3).length,
    w: rows.reduce((n, r) => n + winsOf(r.wins, f.counted), 0), l: rows.reduce((n, r) => n + winsOf(r.losses, f.counted), 0),
    career: rows.reduce((n, r) => n + (careerOf(r) ?? 0), 0),
  })).sort(fought ? (a, b) => b.g - a.g || b.s - a.s || b.b - a.b || b.w - a.w : (a, b) => b.career - a.career || b.athletes - a.athletes);
  const matches = people.reduce((n, p) => n + p.w, 0);

  const rank = (i: number) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span>;
  const athleteColumns: Column<Person>[] = [
    { key: 'rank', label: '#', width: '3.5rem', align: 'start', cell: (_, i) => rank(i) },
    { key: 'who', label: 'Athlete', width: '34%', align: 'start', cell: (p) => <Identity a={p} f={f} /> },
    { key: 'div', label: 'Division', align: 'start', narrow: true, cell: (p) => <span className="text-xs text-muted-foreground" title={p.rows.map((r) => r.division).join('\n')}>{p.rows[0].division}{p.rows.length > 1 && ` +${p.rows.length - 1}`}</span> },
    ...(fought ? [
      { key: 'place', label: 'Place', width: '6rem', cell: (p: Person) => <Place p={p.best < 999 ? p.best : null} /> },
      { key: 'record', label: 'Record', width: '7rem', cell: (p: Person) => <Record w={p.w} l={p.l} /> },
    ] : []),
    { key: 'career', label: 'Career wins', width: '8rem', title: 'Wins of the finish types switched on: their career, or their results where Smoothcomp serves none', cell: (p) => <Num n={p.career} /> },
  ];
  const academyColumns: Column<Academy>[] = [
    { key: 'rank', label: '#', width: '3.5rem', align: 'start', cell: (_, i) => rank(i) },
    { key: 'name', label: 'Academy', align: 'start', cell: (t) => t.id ? <Link href={f.link(`/academy/${t.id}`)} className="font-medium hover:text-primary">{t.name ?? `Academy ${t.id}`}</Link> : <span className="font-medium">{t.name}</span> },
    { key: 'athletes', label: 'Athletes', width: '8rem', cell: (t) => <Num n={t.athletes} /> },
    ...(fought ? [
      { key: 'medals', label: 'Medals', width: '12rem', cell: (t: Academy) => <Medals g={t.g} s={t.s} b={t.b} /> },
      { key: 'record', label: 'Record', width: '8rem', cell: (t: Academy) => <Record w={t.w} l={t.l} /> },
    ] : [{ key: 'career', label: 'Career wins', width: '9rem', cell: (t: Academy) => <Num n={t.career} /> }]),
  ];
  const podiumColumns: Column<Division>[] = [
    { key: 'name', label: 'Division', width: '34%', align: 'start', cell: (d) => <div className="flex flex-col gap-0.5"><span className="font-medium">{d.name}</span><span className="text-xs text-muted-foreground">{plural(d.rows.length, 'athlete')}</span></div> },
    ...[1, 2, 3].map((place) => ({ key: `p${place}`, label: ['Gold', 'Silver', 'Bronze'][place - 1], align: 'start' as const, cell: (d: Division) => {
      const at = d.rows.filter((r) => r.place === place);
      return at.length ? <div className="flex flex-col gap-1">{at.map((r) => <span key={r.user} className="flex items-center gap-2"><Place p={place} /><NameLink e={r} f={f} /></span>)}</div> : <span className="text-muted-foreground">–</span>;
    } })),
  ];
  const divisionColumns: Column<Division>[] = [
    { key: 'name', label: 'Division', width: '40%', align: 'start', cell: (d) => <span className="font-medium">{d.name}</span> },
    { key: 'size', label: 'Athletes', width: '7rem', cell: (d) => <Num n={d.rows.length} /> },
    { key: 'top', label: 'Strongest entrants, by career wins', align: 'start', cell: (d) => {
      const top = d.rows.filter((r) => r.career != null).sort((a, b) => b.career! - a.career!).slice(0, 3);
      return top.length ? <div className="flex flex-col gap-1">{top.map((r) => <span key={r.user} className="flex items-center gap-2 text-xs"><Photo name={r.name} photo={r.photo} className="size-5" /><NameLink e={r} f={f} /><b className="ml-auto font-semibold">{r.career}</b></span>)}</div> : <span className="text-xs text-muted-foreground">No careers read yet</span>;
    } },
  ];
  const tabs = fought
    ? [['podiums', 'Podiums', divisions.length], ['academies', 'Academies', academies.length], ['athletes', 'Athletes', people.length]] as const
    : [['athletes', 'Athletes', people.length], ['divisions', 'Divisions', divisions.length], ['academies', 'Academies', academies.length]] as const;
  const empty = <Empty title="Nothing here" text="Nothing to show for this event yet." />;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{date(event.start)}</span>
          {event.city && <span className="inline-flex items-center gap-1.5">{event.city}<Flag code={event.country} /></span>}
          {event.organiser && <span>{event.organiser}</span>}
          <span>{fought ? `${fmt(matches)} matches won, counted finishes` : 'Entrants only, no results read yet'}</span>
          <a href={`${f.home}/en/event/${id}/${fought ? 'results' : 'participants'}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">On {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
        </div>
      </header>
      {entries.length ? (
        <Tabs defaultValue={tabs[0][0]} className="gap-4">
          <TabsList variant="line">{tabs.map(([k, label, n]) => <TabsTrigger key={k} value={k}>{label}<span className="ml-1 text-xs text-muted-foreground">{n}</span></TabsTrigger>)}</TabsList>
          <TabsContent value="podiums"><Ledger rows={divisions} loading={false} columns={podiumColumns} rowKey={(d) => d.name} empty={empty} /></TabsContent>
          <TabsContent value="academies"><Ledger rows={academies} loading={false} columns={academyColumns} rowKey={(t) => t.id ?? t.name ?? ''} empty={empty} /></TabsContent>
          <TabsContent value="athletes"><Ledger rows={people} loading={false} columns={athleteColumns} rowKey={(p) => p.user} empty={empty} /></TabsContent>
          <TabsContent value="divisions"><Ledger rows={divisions} loading={false} columns={divisionColumns} rowKey={(d) => d.name} empty={empty} /></TabsContent>
        </Tabs>
      ) : <Empty title="Nobody listed yet" text="This event's entrants arrive when someone with Mat Stats opens its participants or results page." />}
    </div>
  );
}
