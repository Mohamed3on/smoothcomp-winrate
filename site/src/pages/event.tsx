import { useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Ledger, type Column } from '@/components/ledger';
import { Empty } from '@/components/empty';
import { Age, Belt, Flag, Identity, Medals, Num, Photo, Place, Record } from '@/components/stats';
import { useApi, type EventEntry, type EventMeta } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { date, fmt, plural, winsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DivisionLink } from '@/pages/division';

// The medal a bracket's career ranking points to: first gold, second silver, third bronze, fourth nothing.
// A call is sure when the athlete's career is known and nobody else in the bracket has as many wins;
// a tie, or a career of their own not known, makes it a ring. Unknown rivals rank last, as in the extension.
interface Call { medal: number; sure: boolean; bracket: string; seed: number; of: number }
type Ranked = EventEntry & { career: number | null; tally: number[] | null; call: Call | null };
type Person = EventEntry & { rows: Ranked[]; w: number; l: number; best: number; career: number | null; calls: Call[] };
interface Division { name: string; rows: Ranked[]; wins: number }
interface Academy { id: string | null; name: string | null; athletes: number; g: number; s: number; b: number; w: number; l: number; career: number; expected: number[]; people: Person[] }

const MEDAL = ['gold', 'silver', 'bronze'];
const MEDAL_BG = ['bg-gold', 'bg-silver', 'bg-bronze'];
const MEDAL_RING = ['ring-gold', 'ring-silver', 'ring-bronze'];
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
function Dot({ call }: { call: Call | null }) {
  if (!call) return <i className="size-2 shrink-0 rounded-full bg-muted-foreground/25" aria-hidden />;
  const label = `${call.sure ? '' : 'Maybe '}${MEDAL[call.medal]}: ${ordinal(call.seed)} of ${call.of} by career wins in ${call.bracket}`;
  return <i title={label} aria-label={label} className={cn('size-2 shrink-0 rounded-full', call.sure ? MEDAL_BG[call.medal] : ['ring-[1.5px] ring-inset', MEDAL_RING[call.medal]])} />;
}
const Expected = ({ e }: { e: number[] }) => <Medals g={e[0]} s={e[1]} b={e[2]} />;

const NameLink = ({ e, f }: { e: EventEntry; f: Filters }) =>
  <Link href={f.link(`/athlete/${e.user}`)} className="hover:text-primary">{e.name ?? `Athlete ${e.user}`}</Link>;

export function EventPage({ id }: { id: string }) {
  const f = useFilters();
  const [teamSort, setTeamSort] = useState('expected');
  const [bracketSort, setBracketSort] = useState('wins');
  const { data, isLoading } = useApi<{ event: EventMeta; entries: EventEntry[] }>('event', { site: f.site, off: f.query.off, id });
  if (isLoading) return <Skeleton className="h-9 w-96" />;
  if (!data) return <Empty title="No event here" text="Mat Stats has nothing under this event on this site. Nobody has opened it with Mat Stats yet." />;
  const { event } = data;
  const read = (rows: EventEntry[]) => Math.max(0, ...rows.map((e) => e.at ?? 0));
  const results = data.entries.filter((e) => e.fought), registered = data.entries.filter((e) => !e.fought);
  // Results arrive while the registration list still stands: until the event is a few days
  // past, registrants without a result are still to fight; after that they didn't show.
  const live = results.length > 0 && registered.length > 0 && !!event.start && Date.parse(event.start) > Date.now() - 3 * 864e5;
  const entries = results.length && !live ? results : data.entries;
  const title = event.title ?? `Event ${id}`;
  document.title = `${title} · Mat Stats`;
  const fought = results.length > 0;
  const stamp = (t: number) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // Most counted wins first, then most by submission, most on points, the younger athlete; unknown careers last.
  const tallyOf = (e: EventEntry) => {
    if (e.career_wins == null) return null;
    const t: Record<string, number> = JSON.parse(e.career_types ?? '{}');
    return [winsOf(t, f.counted), f.counted('submission') ? Number(t.submission) || 0 : 0, f.counted('points') ? Number(t.points) || 0 : 0];
  };
  const key = (r: Ranked) => [...(r.tally ?? [-1, -1, -1]), r.born ?? -Infinity];
  const byCareer = (a: Ranked, b: Ranked) => key(a).reduce((o, x, i) => o || key(b)[i] - x, 0) || a.user.localeCompare(b.user);
  const divisions: Division[] = [...Map.groupBy(entries, (e) => e.division.trim())].map(([name, list]) => {
    const rows: Ranked[] = list.map((r) => ({ ...r, tally: tallyOf(r), career: tallyOf(r)?.[0] ?? null, call: null })).sort(byCareer);
    const decided = rows.some((r) => r.place != null);
    if (decided) rows.sort((a, b) => (a.place ?? 999) - (b.place ?? 999) || byCareer(a, b));
    rows.forEach((r, i) => {
      if (i < 3 && !decided && (!fought || live)) r.call = { medal: i, bracket: name, seed: i + 1, of: rows.length, sure: rows.length === 1 || (r.career != null && rows.every((o, j) => j === i || o.career !== r.career)) };
    });
    return { name, rows, wins: rows.reduce((n, r) => n + (r.career ?? 0), 0) };
  });
  const calls = Map.groupBy(divisions.flatMap((d) => d.rows.filter((r) => r.call)), (r) => r.user);
  const people: Person[] = [...Map.groupBy(divisions.flatMap((d) => d.rows), (e) => e.user).values()].map((rows) => ({
    ...rows[0], rows, w: rows.reduce((n, r) => n + winsOf(r.wins, f.counted), 0), l: rows.reduce((n, r) => n + winsOf(r.losses, f.counted), 0),
    best: Math.min(...rows.map((r) => r.place ?? 999)), career: rows[0].career,
    calls: (calls.get(rows[0].user) ?? []).map((r) => r.call!).sort((a, b) => a.medal - b.medal),
  })).sort(fought ? (a, b) => a.best - b.best || b.w - a.w || a.l - b.l : (a, b) => byCareer(a.rows[0], b.rows[0]));
  const academies: Academy[] = [...Map.groupBy(people.filter((p) => p.club_id || p.club), (p) => p.club_id ?? p.club ?? '').values()].map((ps) => {
    const rows = ps.flatMap((p) => p.rows);
    const expected = [0, 1, 2].map((m) => ps.reduce((n, p) => n + p.calls.filter((c) => c.medal === m).length, 0));
    return {
      id: ps[0].club_id, name: ps[0].club, athletes: ps.length, people: ps, expected,
      g: rows.filter((r) => r.place === 1).length, s: rows.filter((r) => r.place === 2).length, b: rows.filter((r) => r.place === 3).length,
      w: ps.reduce((n, p) => n + p.w, 0), l: ps.reduce((n, p) => n + p.l, 0), career: ps.reduce((n, p) => n + (p.career ?? 0), 0),
    };
  });
  const medalOrder = (a: number[], b: number[]) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  academies.sort(fought ? (a, b) => medalOrder([a.g, a.s, a.b], [b.g, b.s, b.b]) || b.w - a.w
    : teamSort === 'expected' ? (a, b) => medalOrder(a.expected, b.expected) || b.career - a.career : (a, b) => b.career - a.career || b.athletes - a.athletes);
  divisions.sort(fought || bracketSort === 'athletes' ? (a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name)
    : (a, b) => b.wins - a.wins || b.wins / b.rows.length - a.wins / a.rows.length || a.name.localeCompare(b.name));
  const matches = people.reduce((n, p) => n + p.w, 0);

  const rank = (i: number) => <span className={i < 3 ? 'font-semibold' : 'text-muted-foreground'}>{i + 1}</span>;
  const athleteColumns: Column<Person>[] = [
    { key: 'rank', label: '#', width: '3.5rem', align: 'start', cell: (_, i) => rank(i) },
    { key: 'who', label: 'Athlete', width: '34%', align: 'start', cell: (p) => <Identity a={p} f={f} /> },
    { key: 'div', label: fought ? 'Division' : 'Brackets', align: 'start', narrow: true, cell: (p) => fought
      ? <span className="text-xs text-muted-foreground" title={p.rows.map((r) => r.division).join('\n')}><DivisionLink event={id} name={p.rows[0].division} f={f} />{p.rows.length > 1 && ` +${p.rows.length - 1}`}</span>
      : <ul className="flex flex-col gap-1 text-xs text-muted-foreground">{p.rows.map((r) => <li key={r.division} className="flex items-center gap-2"><Dot call={r.call} /><span className="min-w-0 break-words">{r.division.trim()}</span></li>)}</ul> },
    ...(fought ? [
      { key: 'place', label: 'Place', width: '6rem', cell: (p: Person) => <Place p={p.best < 999 ? p.best : null} /> },
      { key: 'record', label: 'Record', width: '7rem', cell: (p: Person) => <Record w={p.w} l={p.l} /> },
    ] : []),
    ...(fought && !live ? [] : [{ key: 'expected', label: 'Expected', width: '11rem', title: 'Medals their brackets point to, by career wins', cell: (p: Person) => <Expected e={[0, 1, 2].map((m) => p.calls.filter((c) => c.medal === m).length)} /> }]),
    { key: 'career', label: 'Career wins', width: '8rem', title: 'Wins of the finish types switched on: their career, or their results where Smoothcomp serves none', cell: (p) => <Num n={p.career} /> },
  ];
  const academyColumns: Column<Academy>[] = [
    { key: 'rank', label: '#', width: '3.5rem', align: 'start', cell: (_, i) => rank(i) },
    { key: 'name', label: 'Academy', align: 'start', cell: (t) => t.id ? <Link href={f.link(`/academy/${t.id}`)} className="font-medium hover:text-primary">{t.name ?? `Academy ${t.id}`}</Link> : <span className="font-medium">{t.name}</span> },
    { key: 'athletes', label: 'Athletes', width: '8rem', cell: (t) => <Num n={t.athletes} /> },
    ...(fought ? [
      { key: 'medals', label: 'Medals', width: '12rem', cell: (t: Academy) => <Medals g={t.g} s={t.s} b={t.b} /> },
      { key: 'record', label: 'Record', width: '8rem', cell: (t: Academy) => <Record w={t.w} l={t.l} /> },
      ...(live ? [{ key: 'expected', label: 'Still expected', width: '12rem', title: 'Medals the brackets not yet decided point to, by career wins', cell: (t: Academy) => <Expected e={t.expected} /> }] : []),
    ] : [
      { key: 'expected', label: 'Expected medals', width: '12rem', sort: 'expected', title: 'Rank by the medals their brackets point to, by career wins', cell: (t: Academy) => <Expected e={t.expected} /> },
      { key: 'career', label: 'Career wins', width: '9rem', sort: 'career', title: "Rank by their entrants' career wins added up", cell: (t: Academy) => <Num n={t.career} /> },
    ]),
  ];
  const roster = (t: Academy) => (
    <ol className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-6 gap-y-1 rounded-lg border bg-card p-3">
      {t.people.map((p, i) => (
        <li key={p.user} className="flex min-w-0 items-start gap-2 py-1 text-sm">
          <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
          <Photo name={p.name} photo={p.photo} className="size-6" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2"><NameLink e={p} f={f} /><Belt belt={p.belt} /><Age born={p.born} /></span>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">{p.rows.map((r) => <span key={r.division} className="inline-flex items-center gap-1.5"><Dot call={r.call} />{r.division.trim()}</span>)}</span>
          </span>
          <span className="shrink-0 font-semibold">{p.career ?? '–'}</span>
        </li>
      ))}
    </ol>
  );
  const bracket = (d: Division) => (
    <ol className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-6 gap-y-1 rounded-lg border bg-card p-3">
      {d.rows.map((r, i) => (
        <li key={r.user} className="flex min-w-0 items-center gap-2 py-1 text-sm">
          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
          <Dot call={r.call} />
          <Photo name={r.name} photo={r.photo} className="size-6" />
          <span className="flex min-w-0 flex-1 flex-col"><NameLink e={r} f={f} /><span className="truncate text-xs text-muted-foreground">{r.club}</span></span>
          <span className="shrink-0 font-semibold">{r.career ?? '–'}</span>
        </li>
      ))}
    </ol>
  );
  const podiumColumns: Column<Division>[] = [
    { key: 'name', label: 'Division', width: '34%', align: 'start', cell: (d) => <div className="flex flex-col gap-0.5"><DivisionLink event={id} name={d.name} f={f} className="font-medium" /><span className="text-xs text-muted-foreground">{plural(d.rows.length, 'athlete')}</span></div> },
    ...[1, 2, 3].map((place) => ({ key: `p${place}`, label: ['Gold', 'Silver', 'Bronze'][place - 1], align: 'start' as const, cell: (d: Division) => {
      const at = d.rows.filter((r) => r.place === place);
      return at.length ? <div className="flex flex-col gap-1">{at.map((r) => <span key={r.user} className="flex items-center gap-2"><Place p={place} /><NameLink e={r} f={f} /></span>)}</div> : <span className="text-muted-foreground">–</span>;
    } })),
  ];
  const divisionColumns: Column<Division>[] = [
    { key: 'name', label: 'Division', width: '40%', align: 'start', cell: (d) => <DivisionLink event={id} name={d.name} f={f} className="font-medium" /> },
    { key: 'size', label: 'Athletes', width: '7rem', sort: 'athletes', cell: (d) => <Num n={d.rows.length} /> },
    { key: 'wins', label: 'Career wins', width: '9rem', sort: 'wins', title: "Rank by the entrants' career wins added up", cell: (d) => <div className="flex flex-col items-end"><Num n={d.wins} /><span className="text-xs text-muted-foreground">{fmt(Math.round(d.wins / d.rows.length))} per athlete</span></div> },
    { key: 'top', label: fought ? 'Podium, or the expected one by career wins' : 'Expected podium, by career wins', align: 'start', cell: (d) => (
      <div className="flex flex-col gap-1">{d.rows.slice(0, 3).map((r) => <span key={r.user} className="flex items-center gap-2 text-xs">{r.place != null ? <Place p={r.place} /> : <Dot call={r.call} />}<Photo name={r.name} photo={r.photo} className="size-5" /><NameLink e={r} f={f} /><b className="ml-auto font-semibold">{r.career ?? '–'}</b></span>)}</div>
    ) },
  ];
  const tabs = fought
    ? [['podiums', 'Podiums', divisions.length], ['academies', 'Academies', academies.length], ['athletes', 'Athletes', people.length], ...(live ? [['divisions', 'Brackets', divisions.length] as const] : [])] as const
    : [['athletes', 'Athletes', people.length], ['divisions', 'Brackets', divisions.length], ['academies', 'Academies', academies.length]] as const;
  const empty = <Empty title="Nothing here" text="Nothing to show for this event yet." />;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{date(event.start)}</span>
          {event.city && <span className="inline-flex items-center gap-1.5">{event.city}<Flag code={event.country} /></span>}
          {event.organiser && <span>{event.organiser}</span>}
          <span>{fought ? `${fmt(matches)} matches won, counted finishes${live ? `; ${plural(new Set(registered.filter((e) => !results.some((r) => r.user === e.user)).map((e) => e.user)).size, 'athlete')} still to fight` : ''}` : 'Entrants only, no results read yet'}</span>
          <span title="When someone with Mat Stats last opened the event's pages">
            {fought && <>Results as of {stamp(read(results))}</>}{fought && live && ' · '}{(!fought || live) && registered.length > 0 && <>Entrants as of {stamp(read(registered))}</>}
          </span>
          <a href={`${f.home}/en/event/${id}/${fought ? 'results' : 'participants'}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">On {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
        </div>
      </header>
      {entries.length ? (
        <Tabs defaultValue={tabs[0][0]} className="gap-4">
          <TabsList variant="line">{tabs.map(([k, label, n]) => <TabsTrigger key={k} value={k}>{label}<span className="ml-1 text-xs text-muted-foreground">{n}</span></TabsTrigger>)}</TabsList>
          <TabsContent value="podiums"><Ledger rows={divisions} loading={false} columns={podiumColumns} rowKey={(d) => d.name} empty={empty} /></TabsContent>
          <TabsContent value="academies"><Ledger rows={academies} loading={false} columns={academyColumns} rowKey={(t) => t.id ?? t.name ?? ''} empty={empty} sort={fought ? undefined : teamSort} onSort={setTeamSort} expand={roster} /></TabsContent>
          <TabsContent value="athletes"><Ledger rows={people} loading={false} columns={athleteColumns} rowKey={(p) => p.user} empty={empty} /></TabsContent>
          <TabsContent value="divisions"><Ledger rows={divisions} loading={false} columns={divisionColumns} rowKey={(d) => d.name} empty={empty} sort={bracketSort} onSort={setBracketSort} expand={bracket} /></TabsContent>
        </Tabs>
      ) : <Empty title="Nobody listed yet" text="This event's entrants arrive when someone with Mat Stats opens its participants or results page." />}
    </div>
  );
}
