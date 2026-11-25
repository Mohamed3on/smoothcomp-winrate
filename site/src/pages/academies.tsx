import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { Count, Ledger, type Column } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty, PageHead } from '@/components/empty';
import type { Dot } from '@/components/places-map';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Medals, Num, Photo } from '@/components/stats';
import { useApi, type Team } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { fmt, plural, rate } from '@/lib/format';
import { Roster, resetAction } from '@/pages/athletes';

// Where an academy's place comes from, said on hover.
const PLACED = { pin: 'Where its Smoothcomp page pins it', town: 'The town its Smoothcomp page names', google: 'Where Google Maps finds it: its page names no place', events: 'Where its athletes have competed most: its page names no place' };
// The map carries Leaflet, so it loads when first opened.
const PlacesMap = lazy(() => import('@/components/places-map'));
// The list comes without each academy's top athletes; a block of rows reads theirs as it is first drawn.
const BLOCK = 25;
type Query = Record<string, string | number | null | undefined>;
function TopAthletes({ rows, i, query, f }: { rows: Team[]; i: number; query: Query; f: ReturnType<typeof useFilters> }) {
  const t = rows[i];
  const clubs = rows.slice(i - (i % BLOCK), i - (i % BLOCK) + BLOCK).map((r) => r.club_id).join(',');
  const top = useApi<{ rows: Team[] }>('teams', { ...query, clubs, athletes: 1, limit: BLOCK }).data?.rows.find((r) => r.club_id === t.club_id)?.top;
  return (
    <div className="flex flex-col gap-1">
      {top ? top.map((a) => (
        <Link key={a.user} href={f.link(`/athlete/${a.user}`)} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground hover:text-primary">
          <Photo name={a.name} photo={a.photo} className="size-5" /><span className="min-w-0 break-words">{a.name ?? `Athlete ${a.user}`}</span><b className="ml-auto pl-2 font-semibold text-foreground">{a.wins}</b>
        </Link>))
        : Array.from({ length: Math.min(3, t.athletes) }, (_, k) => <Skeleton key={k} className="h-5 w-full" />)}
      {t.athletes > Math.min(3, t.athletes) && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">All {t.athletes} athletes <ChevronDown className="size-3" /></span>}
    </div>
  );
}

const SORTS: [string, string][] = [['wins', 'Total wins'], ['average', 'Wins per athlete'], ['winRate', 'Win rate'],['athletes', 'Athletes'], ['submission', 'Submissions'], ['podiums', 'Medals']];

export function AcademiesPage() {
  const f = useFilters();
  const near = f.get('near');
  // Ranked by win rate, a few athletes' short records would top the list: the minimum starts higher there.
  const least = f.query.sort === 'winRate' ? 10 : 3;
  const query = { ...f.query, near, km: near ? f.get('km') : '', athletes: f.get('athletes') || least };
  const { data, isFetching, isLoading, error, refetch } = useApi<{ rows: Team[]; total: number }>('teams', { ...query, limit: 2000, top: 0 });
  const view = f.get('view') === 'map' ? 'map' : 'list';
  // On the map a dot grows with the academy's athletes, and shines where the academy's place is its own (its page or
  // Google Maps), not the city its athletes compete in most.
  const dots = useMemo(() => (data?.rows ?? []).filter((t) => t.lat != null && t.lng != null).map((t): Dot => ({
    lat: t.lat!, lng: t.lng!, radius: Math.min(10, 3 + Math.sqrt(t.athletes) / 2), read: t.placed !== 'events', title: t.club ?? `Academy ${t.club_id}`, href: f.link(`/academy/${t.club_id}`), internal: true,
    about: [t.city, t.km != null && `${fmt(Math.round(t.km))} km`, plural(t.athletes, 'athlete'), plural(t.wins, 'win'), t.placed === 'events' && 'placed where it competes most'].filter(Boolean).join(' · '),
  })), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns: Column<Team>[] = [
    { key: 'rank', label: '#', width: '3.5rem', compact: '3rem', align: 'start', cell: (_, i) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span> },
    { key: 'club', label: 'Academy', align: 'start', cell: (t) => (
      <div className="flex flex-col gap-0.5">
        <Link href={f.link(`/academy/${t.club_id}`)} className="font-medium break-words hover:text-primary">{t.club ?? `Academy ${t.club_id}`}</Link>
        <span className="text-xs text-muted-foreground" title={t.placed ? PLACED[t.placed] : undefined}>
          {[t.city && [t.city, t.km != null && `${fmt(Math.round(t.km))} km`].filter(Boolean).join(' · '), t.entered ? `${plural(t.entered, 'event')} with results` : 'No results read yet'].filter(Boolean).join(' · ')}
        </span>
      </div>) },
    { key: 'athletes', label: 'Athletes', width: '8%', compact: '5.5rem', sort: 'athletes', title: 'Athletes who pass the filters', cell: (t) => <Num n={t.athletes} /> },
    { key: 'wins', label: 'Wins', width: '9%', compact: '5.5rem', sort: f.query.sort === 'average' ? 'average' : 'wins', title: 'Wins, and wins per athlete',
      cell: (t) => <div className="flex flex-col items-end"><Num n={t.wins} /><span className="text-xs whitespace-nowrap text-muted-foreground">{(t.wins / t.athletes).toFixed(1)} / athlete</span></div> },
    { key: 'rate', label: 'Win rate', width: '8%', compact: '5rem', sort: 'winRate', narrow: true, title: 'Its athletes’ wins over matches added up, from the same records as their own win rates (no walkovers)',
      cell: (t) => (rate(t.won, t.lost) ? <span title={`${fmt(t.won)}–${fmt(t.lost)}`}>{rate(t.won, t.lost)}</span> : <span className="text-muted-foreground">–</span>) },
    { key: 'podiums', label: 'Medals', width: '14%', sort: 'podiums', narrow: true, title: 'Medals won for this academy at the events Mat Stats has read results for', cell: (t) => <Medals g={t.podium_gold} s={t.podium_silver} b={t.podium_bronze} /> },
    { key: 'top', label: 'Top athletes', width: '22%', align: 'start', narrow: true, preview: true, cell: (_, i) => <TopAthletes rows={data!.rows} i={i} query={query} f={f} /> },
  ];
  return (
    <>
      <PageHead title="Academies" aside={<div className="flex items-center gap-4">{data && <Count n={data.total} unit={data.total === 1 ? 'academy' : 'academies'} />}
          <Tabs value={view} onValueChange={(v) => f.set({ view: v === 'map' ? 'map' : null })}>
            <TabsList aria-label="Show as"><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="map">Map</TabsTrigger></TabsList>
          </Tabs></div>}
        text="Each academy ranked by its athletes added up, careers or results, under the same filters. Open a row for every athlete behind it. An athlete counts for the academy their latest event lists; an academy sits where its own page puts it, else where Google Maps finds it, else in the city its athletes have competed in most." />
      <div className="flex flex-col gap-3">
        <FilterBar f={f} sorts={SORTS} minimumAthletes={least} place />
        {view === 'map' && !error ? (
          <Suspense fallback={<div className="h-[70svh] min-h-80 rounded-xl border bg-card" />}><PlacesMap dots={dots} f={f} /></Suspense>
        ) : <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={columns} rowKey={(t) => t.club_id} sort={f.query.sort} asc={f.query.dir === 'asc'} onSort={(s, asc) => f.set({ sort: s, dir: asc ? 'asc' : null })}
          expand={(t) => <Roster club={t.club_id} f={f} />}
          empty={error
            ? <Empty title="Couldn’t load the academies" text="Mat Stats didn’t answer. Try again in a moment." action={{ label: 'Try again', onClick: () => refetch() }} />
            : <Empty title="No academies match" text={near ? 'Widen the distance, lower the minimum athletes, or clear the belt and country.' : 'Lower the minimum athletes or the other minimums, or clear the belt and country.'} action={resetAction(f, ['near', 'place', 'km'])} />} />}
      </div>
    </>
  );
}
