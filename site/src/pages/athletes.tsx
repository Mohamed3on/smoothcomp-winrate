import { Link } from 'wouter';
import { Count, Ledger, type Column } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty, PageHead } from '@/components/empty';
import { FromResults, Identity, Medals, Mix, Num, Photo, Record } from '@/components/stats';
import { useApi, type Athlete } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { plural, rate } from '@/lib/format';

export const ATHLETE_SORTS: [string, string][] = [['wins', 'Wins'], ['submission', 'Submissions'], ['points', 'Wins on points'], ['stoppage', 'Stoppages'], ['decision', 'Decisions'],
  ['rate', 'Submission rate'], ['winRate', 'Win rate'], ['medals', 'Medals'], ['events', 'Events entered'], ['perEvent', 'Wins per event'], ['last', 'Last competed']];
export const RESET = ['off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'country', 'sort', 'dir', 'q', 'athletes', 'active'];
export const resetAction = (f: Filters) => ({ label: 'Reset filters', onClick: () => f.set(Object.fromEntries(RESET.map((k) => [k, null]))) });
const perEvent = (a: Athlete) => (a.events ? (a.wins / a.events).toFixed(1) : '–');

export const athleteColumns = (f: Filters, club = true): Column<Athlete>[] => [
  { key: 'rank', label: '#', width: '3rem', align: 'start', cell: (_, i) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span> },
  { key: 'who', label: 'Athlete', align: 'start', cell: (a) => <Identity a={a} f={f} club={club} /> },
  { key: 'wins', label: 'Wins', width: '6%', compact: '4rem', sort: 'wins', title: 'Wins of the finish types switched on', cell: (a) => <Num n={a.wins} /> },
  { key: 'rate', label: 'Win rate', width: '8%', compact: '5rem', sort: 'winRate', title: 'Wins over matches, counted finishes, no walkovers: from their profile’s match lists where someone opened it, else their results at the events read',
    cell: (a) => (rate(a.won, a.lost) ? <div className="flex flex-col items-end"><span className="font-semibold">{rate(a.won, a.lost)}</span><span className="text-xs"><Record w={a.won!} l={a.lost!} /></span></div> : <span className="text-muted-foreground">–</span>) },
  { key: 'mix', label: 'How they won', width: '12%', align: 'start', narrow: true, cell: (a) => <Mix types={a.types} f={f} legend="short" note={<FromResults a={a} />} /> },
  { key: 'subs', label: 'Subs', width: '6%', sort: 'submission', narrow: true, title: 'Submission wins; dimmed when switched off', cell: (a) => <Num n={a.submission} dim={!f.counted('submission')} /> },
  { key: 'points', label: 'Points', width: '6%', sort: 'points', narrow: true, cell: (a) => <Num n={a.points} dim={!f.counted('points')} /> },
  { key: 'medals', label: 'Medals', width: '12%', sort: 'medals', narrow: true, title: 'Golds, then silvers, then bronzes', cell: (a) => <Medals g={a.gold} s={a.silver} b={a.bronze} /> },
  { key: 'events', label: 'Events', width: '6%', sort: 'events', narrow: true, cell: (a) => <Num n={a.events} /> },
  { key: 'per', label: 'Per event', width: '6%', sort: 'perEvent', narrow: true, title: 'Wins per event entered', cell: (a) => perEvent(a) },
  { key: 'last', label: 'Last competed', width: '9%', sort: 'last', narrow: true, title: 'The latest event they entered, as Smoothcomp lists it or Mat Stats read it', cell: (a) => <span className={a.last ? '' : 'text-muted-foreground'}>{a.last ? new Date(a.last).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '–'}</span> },
];

export function AthletesPage() {
  const f = useFilters();
  const { data, isFetching, isLoading } = useApi<{ rows: Athlete[]; total: number }>('athletes', { ...f.query, limit: 2000 });
  return (
    <>
      <PageHead title="Athletes" aside={data && <Count n={data.total} unit={data.total === 1 ? 'athlete' : 'athletes'} />}
        text="Every athlete Mat Stats has read, in one ranking: their Smoothcomp career, or their results at the events read where Smoothcomp serves no career. Choose which finishes count; walkovers start switched off." />
      <div className="flex flex-col gap-3">
        <FilterBar f={f} sorts={ATHLETE_SORTS} />
        <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={athleteColumns(f)} rowKey={(a) => a.user} sort={f.query.sort} asc={f.query.dir === 'asc'} onSort={(s, asc) => f.set({ sort: s, dir: asc ? 'asc' : null })}
          empty={<Empty title="No athletes match" text="Lower the minimums, widen the age range, switch more finish types on, or clear the belt and country." action={resetAction(f)} />} />
      </div>
    </>
  );
}

// One academy's athletes under the reader's filters, every one of them.
export function Roster({ club, f }: { club: string; f: Filters }) {
  const { data, isLoading } = useApi<{ rows: Athlete[] }>('athletes', { ...f.query, sort: 'wins', limit: 2000, club });
  if (isLoading) return <p className="py-3 text-sm text-muted-foreground">Loading athletes…</p>;
  if (!data?.rows.length) return <p className="py-3 text-sm text-muted-foreground">No athlete here passes the filters.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-1 rounded-lg border bg-card p-3">
        {data.rows.map((a, i) => (
          <li key={a.user} className="flex min-w-0 items-start gap-2 py-1 text-sm">
            <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
            <Photo name={a.name} photo={a.photo} className="size-6" />
            <Link href={f.link(`/athlete/${a.user}`)} className="min-w-0 flex-1 break-words hover:text-primary">{a.name ?? `Athlete ${a.user}`}</Link>
            <span className="shrink-0 font-semibold">{a.wins}</span>
          </li>
        ))}
      </ol>
      <Link href={f.link(`/academy/${club}`)} className="text-xs text-primary hover:underline">Academy page · {plural(data.rows.length, 'athlete')} with full stats</Link>
    </div>
  );
}
