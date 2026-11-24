import { Link } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { Count, Ledger, type Column } from '@/components/ledger';
import { FilterBar } from '@/components/filter-bar';
import { Empty, PageHead } from '@/components/empty';
import { Medals, Num, Photo } from '@/components/stats';
import { useApi, type Team } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { fmt, plural } from '@/lib/format';
import { Roster, resetAction } from '@/pages/athletes';

const SORTS: [string, string][] = [['wins', 'Total wins'], ['average', 'Wins per athlete'], ['athletes', 'Athletes'], ['submission', 'Submissions'], ['podiums', 'Medals']];

export function AcademiesPage() {
  const f = useFilters();
  const near = f.get('near');
  const { data, isFetching, isLoading, error, refetch } = useApi<{ rows: Team[]; total: number }>('teams', { ...f.query, near, km: near ? f.get('km') : '', athletes: f.get('athletes') || 3, limit: 2000 });
  const columns: Column<Team>[] = [
    { key: 'rank', label: '#', width: '3.5rem', compact: '3rem', align: 'start', cell: (_, i) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span> },
    { key: 'club', label: 'Academy', align: 'start', cell: (t) => (
      <div className="flex flex-col gap-0.5">
        <Link href={f.link(`/academy/${t.club_id}`)} className="font-medium break-words hover:text-primary">{t.club ?? `Academy ${t.club_id}`}</Link>
        <span className="text-xs text-muted-foreground" title={t.city ? `Where its athletes have competed most` : undefined}>
          {[t.city && [t.city, t.km != null && `${fmt(Math.round(t.km))} km`].filter(Boolean).join(' · '), t.entered ? `${plural(t.entered, 'event')} with results` : 'No results read yet'].filter(Boolean).join(' · ')}
        </span>
      </div>) },
    { key: 'athletes', label: 'Athletes', width: '8%', compact: '5.5rem', sort: 'athletes', title: 'Athletes who pass the filters', cell: (t) => <Num n={t.athletes} /> },
    { key: 'wins', label: 'Wins', width: '8%', compact: '4.5rem', sort: 'wins', cell: (t) => <Num n={t.wins} /> },
    { key: 'avg', label: 'Per athlete', width: '9%', sort: 'average', narrow: true, cell: (t) => (t.wins / t.athletes).toFixed(1) },
    { key: 'podiums', label: 'Medals', width: '14%', sort: 'podiums', narrow: true, title: 'Medals won for this academy at the events Mat Stats has read results for', cell: (t) => <Medals g={t.podium_gold} s={t.podium_silver} b={t.podium_bronze} /> },
    { key: 'top', label: 'Top athletes', width: '22%', align: 'start', narrow: true, preview: true, cell: (t) => (
      <div className="flex flex-col gap-1">
        {t.top.map((a) => (
          <Link key={a.user} href={f.link(`/athlete/${a.user}`)} className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground hover:text-primary">
            <Photo name={a.name} photo={a.photo} className="size-5" /><span className="min-w-0 break-words">{a.name ?? `Athlete ${a.user}`}</span><b className="ml-auto pl-2 font-semibold text-foreground">{a.wins}</b>
          </Link>))}
        {t.athletes > t.top.length && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">All {t.athletes} athletes <ChevronDown className="size-3" /></span>}
      </div>) },
  ];
  return (
    <>
      <PageHead title="Academies" aside={data && <Count n={data.total} unit={data.total === 1 ? 'academy' : 'academies'} />}
        text="Each academy ranked by its athletes added up, careers or results, under the same filters. Open a row for every athlete behind it. An athlete counts for the academy their latest event lists; an academy sits in the city its athletes have competed in most." />
      <div className="flex flex-col gap-3">
        <FilterBar f={f} sorts={SORTS} minimumAthletes place />
        <Ledger rows={data?.rows} loading={isLoading || isFetching} columns={columns} rowKey={(t) => t.club_id} sort={f.query.sort} asc={f.query.dir === 'asc'} onSort={(s, asc) => f.set({ sort: s, dir: asc ? 'asc' : null })}
          expand={(t) => <Roster club={t.club_id} f={f} />}
          empty={error
            ? <Empty title="Couldn’t load the academies" text="Mat Stats didn’t answer. Try again in a moment." action={{ label: 'Try again', onClick: () => refetch() }} />
            : <Empty title="No academies match" text={near ? 'Widen the distance, lower the minimum athletes, or clear the belt and country.' : 'Lower the minimum athletes or the other minimums, or clear the belt and country.'} action={resetAction(f, ['near', 'place', 'km'])} />} />
      </div>
    </>
  );
}
