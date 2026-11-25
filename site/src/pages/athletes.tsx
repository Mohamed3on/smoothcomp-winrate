import { Link } from 'wouter';
import { Count, Ledger, type Column } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty, PageHead } from '@/components/empty';
import { FromResults, Identity, Medals, Mix, Num, Photo, SHORT } from '@/components/stats';
import { useApi, type Athlete } from '@/lib/api';
import { useFilters, WIN_TYPES, type Filters } from '@/lib/filters';
import { plural, rate, typeName } from '@/lib/format';
import { cn } from '@/lib/utils';

export const ATHLETE_SORTS: [string, string][] = [['wins', 'Wins'], ['submission', 'Submissions'], ['points', 'Wins on points'], ['stoppage', 'Stoppages'], ['decision', 'Decisions'],
  ['rate', 'Submission rate'], ['winRate', 'Win rate'], ['losses', 'Losses'], ['medals', 'Medals'], ['events', 'Events entered'], ['perEvent', 'Wins per event'], ['last', 'Last competed']];
// The finishes a ranking can name: a win's (its type) or a loss's (lost_ and its type).
const FINISHES = [...WIN_TYPES, 'fastest_escape', 'other'] as string[];
export const RESET = ['off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'sex', 'age', 'weight', 'country', 'sort', 'dir', 'q', 'athletes', 'active'];
export const resetAction = (f: Filters, also: string[] = []) => ({ label: 'Reset filters', onClick: () => f.set(Object.fromEntries([...RESET, ...also].map((k) => [k, null]))) });
const perEvent = (a: Athlete) => (a.events ? (a.wins / a.events).toFixed(1) : '–');


// A total beside the bar of its finishes; on phones (in a row's expansion), above it.
const Tally = ({ n, children }: { n: number | null; children: React.ReactNode }) => (
  <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-1"><span className="w-9 shrink-0 text-right max-sm:w-auto max-sm:text-left"><Num n={n} /></span><div className="min-w-0 flex-1">{children}</div></div>
);

export const athleteColumns = (f: Filters, club = true): Column<Athlete>[] => {
  // A ranking by one finish (the submission rate a submission's) names it in its column's header and legend;
  // a finish named in a legend ranks by it when clicked.
  const sort = f.query.sort;
  const won = sort === 'rate' ? 'submission' : FINISHES.includes(sort) ? sort : undefined;
  const lost = sort.startsWith('lost_') && FINISHES.includes(sort.slice(5)) ? sort.slice(5) : undefined;
  const short = (t: string) => SHORT[t] ?? typeName(t).toLowerCase();
  const rank = (s: string) => f.set({ sort: s, dir: null });
  return [
  { key: 'rank', label: '#', width: '3.5rem', compact: '3rem', align: 'start', cell: (_, i) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span> },
  { key: 'who', label: 'Athlete', align: 'start', cell: (a) => <Identity a={a} f={f} club={club} /> },
  { key: 'rate', label: 'Win rate', width: '6.5rem', compact: '5rem', sort: 'winRate', title: 'Wins over matches, counted finishes, no walkovers: from their profile’s match lists where someone opened it, else their results at the events read',
    cell: (a) => (rate(a.won, a.lost) ? <span className="font-semibold" title={`${a.won}–${a.lost}`}>{rate(a.won, a.lost)}</span> : <span className="text-muted-foreground">–</span>) },
  // Phones show the total alone; how the wins and losses came opens under the row.
  { key: 'wins', label: 'Wins', phone: '4rem', phoneOnly: true, sort: won ? sort : 'wins', title: 'Wins of the finish types switched on', cell: (a) => <Num n={a.wins} /> },
  { key: 'won', label: won ? `How they won · ${sort === 'rate' ? 'sub rate' : short(won)}` : 'How they won', width: '14rem', compact: '11rem', narrow: 'sm', align: 'start', sort: won ? sort : 'wins',
    title: 'Wins of the finish types switched on, and how they came',
    cell: (a) => <Tally n={a.wins}>{a.wins > 0 && <Mix types={a.types} f={f} legend="short" focus={won} pick={rank} note={<FromResults a={a} />} />}</Tally> },
  { key: 'lost', label: lost ? `How they lost · ${short(lost)}` : 'How they lost', width: '12rem', compact: '9rem', narrow: 'sm', align: 'start', sort: lost ? sort : 'losses', title: 'Losses of the finish types switched on, from the same record as the win rate',
    cell: (a) => <Tally n={a.lost}>{!!a.lost && a.lost_types && <Mix types={a.lost_types} f={f} legend="short" focus={lost} pick={(t) => rank(`lost_${t}`)} />}</Tally> },
  { key: 'medals', label: 'Medals', width: '9rem', sort: 'medals', narrow: true, title: 'Golds, then silvers, then bronzes', cell: (a) => <Medals g={a.gold} s={a.silver} b={a.bronze} /> },
  { key: 'events', label: 'Events', width: '7%', sort: sort === 'perEvent' ? 'perEvent' : 'events', narrow: 'xl', title: 'Events entered, and wins per event',
    cell: (a) => <div className="flex flex-col items-end"><Num n={a.events} />{!!a.events && <span className="text-xs whitespace-nowrap text-muted-foreground">{perEvent(a)} / event</span>}</div> },
  { key: 'last', label: 'Last competed', width: '9%', sort: 'last', narrow: 'xl', title: 'The latest event they entered, as Smoothcomp lists it or Mat Stats read it', cell: (a) => <span className={cn('whitespace-nowrap', !a.last && 'text-muted-foreground')}>{a.last ? new Date(a.last).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '–'}</span> },
];
};

export function AthletesPage() {
  const f = useFilters();
  const { data, isFetching, isLoading, error, refetch } = useApi<{ rows: Athlete[] }>('athletes', { ...f.query, limit: 2000, part: 'rows' });
  // The count reads every athlete, the page a slice: asked for once the page is in, so the two never queue for the database together.
  const { data: count } = useApi<{ total: number }>('athletes', { ...f.query, part: 'total' }, !!data && !isFetching);
  return (
    <>
      <PageHead title="Athletes" aside={count && <Count n={count.total} unit={count.total === 1 ? 'athlete' : 'athletes'} />}
        text="Every athlete Mat Stats has read, in one ranking: their Smoothcomp career, or their results at the events read where Smoothcomp serves no career. Choose which finishes count; walkovers start switched off." />
      <div className="flex flex-col gap-3">
        <FilterBar f={f} sorts={ATHLETE_SORTS} bracket />
        <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={athleteColumns(f)} rowKey={(a) => a.user} sort={f.query.sort} asc={f.query.dir === 'asc'} onSort={(s, asc) => f.set({ sort: s, dir: asc ? 'asc' : null })}
          empty={error ? <Empty title="Couldn’t load the ranking" text="Mat Stats didn’t answer. Try again in a moment." action={{ label: 'Try again', onClick: () => refetch() }} /> : <Empty title="No athletes match" text="Lower the minimums, widen the age range, switch more finish types on, or clear the belt and country." action={resetAction(f)} />} />
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
