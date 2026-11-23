import { Link } from 'wouter';
import NumberFlow from '@number-flow/react';
import { ExternalLink } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty } from '@/components/empty';
import { Belt, Flag, Keys, Medals, Mix, Photo, Place, Record, Stat } from '@/components/stats';
import { useApi, type Athlete, type Entry, type Outcome, type Past } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { ageOf, date, isUpcoming, plural, rate, recordOf, typeName, winsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Data { career: Athlete | null; person: (Partial<Athlete> & { hidden: number | null }) | null; entries: Entry[]; history: Past[]; outcomes: Outcome[]; seen: { wins: number; losses: number; events: number } | null }

// One event as the page shows it: what Smoothcomp lists, joined to the divisions Mat Stats read
// and to the record their profile's match lists gave.
interface Row { id: string; start: string | null; title: string | null; city: string | null; listed?: Past; read?: Entry[]; outcome?: Outcome }
function rows(entries: Entry[], history: Past[], outcomes: Outcome[]): Row[] {
  const byEvent = new Map<string, Row>();
  for (const h of history) byEvent.set(h.event, { id: h.event, start: h.start, title: h.title, city: h.city, listed: h });
  for (const o of outcomes) {
    const row = byEvent.get(o.event) ?? { id: o.event, start: o.start, title: o.title, city: null };
    byEvent.set(o.event, { ...row, outcome: o });
  }
  for (const e of entries) {
    const row = byEvent.get(e.event) ?? { id: e.event, start: e.start ?? null, title: e.title ?? null, city: e.city ?? null };
    row.read = [...(row.read ?? []), e];
    row.start ??= e.start ?? null; row.title ??= e.title ?? null;
    byEvent.set(e.event, row);
  }
  return [...byEvent.values()].sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
}

function EventLink({ row, f }: { row: Row; f: Filters }) {
  const title = row.title ?? `Event ${row.id}`;
  return row.read || row.listed?.known
    ? <Link href={f.link(`/event/${row.id}`)} className="font-medium hover:text-primary">{title}</Link>
    : <a href={`${f.home}/en/event/${row.id}`} rel="noopener" className="inline-flex items-center gap-1 font-medium hover:text-primary">{title}<ExternalLink className="size-3 text-muted-foreground" /></a>;
}

function EventsTable({ list, f }: { list: Row[]; f: Filters }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="table-fixed">
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-28 pl-5">Date</TableHead><TableHead className="w-[30%]">Event</TableHead><TableHead>Division</TableHead>
          <TableHead className="w-36 text-right">Place or medals</TableHead><TableHead className="w-24 pr-5 text-right">Record</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {list.map((row) => {
            const read = row.read?.filter((e) => e.fought) ?? [];
            const divisions = row.read ?? [];
            const span = Math.max(divisions.length, 1);
            return Array.from({ length: span }, (_, k) => {
              const e = divisions[k];
              return (
                <TableRow key={`${row.id}-${k}`} className={cn(k < span - 1 && 'border-b-0')}>
                  <TableCell className="pl-5 align-top text-muted-foreground">{k ? '' : date(row.start)}</TableCell>
                  <TableCell className="align-top whitespace-normal">{k ? '' : <div className="flex flex-col gap-0.5"><EventLink row={row} f={f} />{row.city && <span className="text-xs text-muted-foreground">{row.city}</span>}</div>}</TableCell>
                  <TableCell className="align-top whitespace-normal text-muted-foreground">{e ? <>{e.division}{e.club && <span className="block text-xs">{e.club}</span>}</> : ''}</TableCell>
                  <TableCell className="text-right align-top">
                    {e?.fought ? <Place p={e.place} /> : !k && row.listed && (row.listed.gold || row.listed.silver || row.listed.bronze) && !read.length
                      ? <Medals g={row.listed.gold} s={row.listed.silver} b={row.listed.bronze} /> : e && !e.fought ? <span className="text-xs text-muted-foreground">Entered</span> : <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="pr-5 text-right align-top">
                    {e?.fought ? <Record w={winsOf(e.wins, f.counted)} l={winsOf(e.losses, f.counted)} />
                      : !k && row.outcome && !read.length ? <Record w={recordOf(row.outcome.out.types, f.counted)[0]} l={recordOf(row.outcome.out.types, f.counted)[1]} />
                      : !k && row.listed?.wins != null && !read.length ? <span><b className="font-semibold">{row.listed.wins}</b> <span className="text-xs text-muted-foreground">{row.listed.wins === 1 ? 'win' : 'wins'}</span></span> : ''}
                  </TableCell>
                </TableRow>
              );
            });
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function Upcoming({ list, f }: { list: Row[]; f: Filters }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {list.map((row) => (
        <Card key={row.id} className="gap-2 px-5 py-4">
          <div className="flex items-baseline justify-between gap-3"><EventLink row={row} f={f} /><span className="shrink-0 text-sm text-primary">{date(row.start)}</span></div>
          {row.city && <span className="text-xs text-muted-foreground">{row.city}</span>}
          {row.read?.length ? <ul className="flex flex-col gap-1 text-sm text-muted-foreground">{row.read.map((e) => <li key={e.division}>{e.division}</li>)}</ul>
            : <span className="text-sm text-muted-foreground">Registered; divisions show once the participants page is read.</span>}
        </Card>
      ))}
    </div>
  );
}

// Wins at each past event Smoothcomp lists, oldest first, coloured by the best medal there.
function Form({ list }: { list: Row[] }) {
  const points = list.filter((r) => r.listed?.wins != null).reverse().map((r) => ({
    name: r.title ?? '', date: date(r.start), tick: r.start ? new Date(r.start).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : '–', wins: r.listed!.wins!, medal: r.listed!.gold ? 'var(--color-gold)' : r.listed!.silver ? 'var(--color-silver)' : r.listed!.bronze ? 'var(--color-bronze)' : 'var(--color-win-decision)',
  }));
  if (points.length < 2) return null;
  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-sm font-medium">Wins per event</h3>
        <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Bar colour: the best medal won there">
          {[['bg-gold', 'Gold'], ['bg-silver', 'Silver'], ['bg-bronze', 'Bronze'], ['bg-win-decision', 'No medal']].map(([bg, label]) => <li key={label} className="inline-flex items-center gap-1.5"><i className={`size-2 rounded-sm ${bg}`} />{label}</li>)}
        </ul>
      </div>
      <div className="h-44 max-w-full" style={{ width: Math.max(points.length * 52 + 40, 280) }}>
        <ResponsiveContainer>
          <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
            <XAxis dataKey="tick" interval="preserveStartEnd" minTickGap={8} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={{ stroke: 'oklch(1 0 0 / 10%)' }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'oklch(1 0 0 / 5%)' }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(_, p) => (p[0] ? `${p[0].payload.name} · ${p[0].payload.date}` : '')} formatter={(v) => [v, 'Wins']} />
            <Bar dataKey="wins" radius={[3, 3, 0, 0]} maxBarSize={32}>{points.map((p, i) => <Cell key={i} fill={p.medal} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Losses({ list, f }: { list: Row[]; f: Filters }) {
  const losses = list.flatMap((row) => (row.outcome?.out.losses ?? []).filter((l) => f.counted(l.type === 'escape' ? 'fastest_escape' : l.type)).map((l) => ({ row, l })));
  if (!losses.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Losses</h2>
        <p className="text-sm text-muted-foreground">Every loss on the counted finishes at the events their profile’s match lists gave, newest first.</p>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="table-fixed">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="w-28 pl-5">Date</TableHead><TableHead className="w-[26%]">Event</TableHead><TableHead className="w-[26%]">Lost to</TableHead>
            <TableHead className="w-36">How</TableHead><TableHead className="pr-5">Division</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {losses.map(({ row, l }, i) => (
              <TableRow key={`${row.id}-${i}`}>
                <TableCell className="pl-5 align-top text-muted-foreground">{date(row.start)}</TableCell>
                <TableCell className="align-top whitespace-normal"><EventLink row={row} f={f} /></TableCell>
                <TableCell className="align-top whitespace-normal">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Photo name={l.opponent} photo={l.image} className="size-7" />
                    <div className="flex min-w-0 flex-col"><span className="break-words">{l.opponent ?? 'Unknown'}</span>{l.club && <span className="text-xs text-muted-foreground break-words">{l.club}</span>}</div>
                  </div>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <span className="inline-flex items-center gap-1.5"><i className="size-2 shrink-0 rounded-full" style={{ background: `var(--color-win-${l.type}, var(--color-win-other))` }} />{l.how || typeName(l.type)}</span>
                </TableCell>
                <TableCell className="pr-5 align-top whitespace-normal text-muted-foreground">{l.division}{l.stage && <span className="block text-xs">{l.stage}</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

// Each finish won and lost, from their profile's match lists.
function ByFinish({ outcomes, f }: { outcomes: Outcome[]; f: Filters }) {
  const totals = new Map<string, [number, number]>();
  for (const o of outcomes) for (const [t, [w, l]] of Object.entries(o.out.types)) {
    const [a, b] = totals.get(t) ?? [0, 0];
    totals.set(t, [a + w, b + l]);
  }
  if (!totals.size) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">
      <span className="text-xs text-muted-foreground">Won–lost by finish</span>
      {[...totals].sort(([, a], [, b]) => b[0] + b[1] - a[0] - a[1]).map(([t, [w, l]]) => {
        const on = f.counted(t === 'escape' ? 'fastest_escape' : t);
        return (
          <span key={t} className={cn('inline-flex items-center gap-1.5', !on && 'text-muted-foreground line-through decoration-white/20')} title={on ? undefined : 'Not counted: switched off in the filters'}>
            <i className="size-2 rounded-full" style={{ background: `var(--color-win-${t}, var(--color-win-other))` }} />{typeName(t)} <Record w={w} l={l} />
          </span>
        );
      })}
    </div>
  );
}

export function AthletePage({ id }: { id: string }) {
  const f = useFilters();
  const { data, isLoading, error } = useApi<Data>('athlete', { site: f.site, off: f.query.off, id });
  if (isLoading) return <div className="flex items-center gap-5"><Skeleton className="size-20 rounded-full" /><Skeleton className="h-8 w-64" /></div>;
  if (!data) return <Empty title={(error as { status?: number })?.status === 404 ? 'No athlete here' : 'That didn’t load'} text={(error as { status?: number })?.status === 404 ? 'Mat Stats has nothing under this athlete on this site. They may be on the other site, or nobody has read them yet.' : 'The stats server didn’t answer. Try again in a moment.'} />;
  const { career, person, entries, history, outcomes = [] } = data;
  const a = { ...(person ?? {}), ...(career ?? {}), name: person?.name ?? career?.name ?? null, born: person?.born ?? career?.born ?? null } as Athlete & { hidden: number | null };
  document.title = `${a.name ?? `Athlete ${id}`} · Mat Stats`;
  const all = rows(entries, history, outcomes);
  const upcoming = all.filter((r) => isUpcoming(r.start) && !r.read?.some((e) => e.fought));
  const past = all.filter((r) => !upcoming.includes(r));
  const age = ageOf(a.born);
  const fromResults = career?.source === 'results';
  const winRate = rate(career?.won, career?.lost);
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center gap-5">
        <Photo name={a.name} photo={a.photo} className="size-20 text-lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{a.name ?? `Athlete ${id}`}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {(a.country || a.country_name) && <span className="inline-flex items-center gap-1.5"><Flag code={a.country} name={a.country_name} />{a.country_name ?? a.country?.toUpperCase()}</span>}
            {age != null && <span>{age} years old</span>}
            {a.belt && <span className="inline-flex items-center gap-1.5"><Belt belt={a.belt} /><span>{a.belt[0].toUpperCase()}{a.belt.slice(1)} belt</span></span>}
            {a.club && (a.club_id ? <Link href={f.link(`/academy/${a.club_id}`)} className="text-foreground hover:text-primary">{a.club}</Link> : <span>{a.club}</span>)}
            <a href={`${f.home}/en/profile/${id}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">Profile on {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
          </div>
        </div>
      </header>

      {career ? (
        <section className="flex flex-col gap-3">
          <Card className="py-0"><dl className={cn('grid grid-cols-2 divide-border sm:grid-cols-3 lg:divide-x', winRate ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
            <Stat label={fromResults ? 'Record, counted finishes' : 'Wins, counted finishes'}>{fromResults ? <Record w={career.wins} l={career.losses ?? 0} /> : <NumberFlow value={career.wins} />}</Stat>
            {winRate && <Stat label="Win rate" note={fromResults ? undefined : <Record w={career.won!} l={career.lost!} />}>{winRate}</Stat>}
            <Stat label="Submissions" note={career.wins && f.counted('submission') ? `${Math.round((career.submission / career.wins) * 100)}% of wins` : undefined}><NumberFlow value={career.submission} /></Stat>
            <Stat label="Medals"><Medals g={career.gold} s={career.silver} b={career.bronze} className="justify-start text-base" /></Stat>
            <Stat label={fromResults ? 'Events read' : 'Events entered'}>{career.events == null ? '–' : <NumberFlow value={career.events} />}</Stat>
            <Stat label="Wins per event">{career.events ? (career.wins / career.events).toFixed(1) : '–'}</Stat>
          </dl></Card>
          <Card className="gap-3 px-5 py-4">
            <Mix types={career.types} f={f} large legend={false} />
            <Keys types={career.types} f={f} />
            <ByFinish outcomes={outcomes} f={f} />
            <p className="text-xs text-muted-foreground">{fromResults
              ? `From results: Smoothcomp serves no career for this ${a.hidden ? 'profile, which it marks not public' : 'athlete yet'}, so these are their wins, losses and placements at the ${plural(career.events ?? 0, 'event')} Mat Stats has read.`
              : `Career as Smoothcomp lists it${career.at ? `, read ${date(new Date(career.at).toISOString())}` : ''}. ${outcomes.length ? `Win rate and losses from their profile’s match lists at ${plural(outcomes.length, 'event')}; walkovers never count there.` : 'Smoothcomp lists no career losses; they arrive once someone with Mat Stats opens this profile.'}`}</p>
          </Card>
          <Form list={past} />
        </section>
      ) : (
        <Card className="px-5 py-4 text-sm text-muted-foreground">No career or results read yet. They arrive when someone with Mat Stats opens an event this athlete is in.</Card>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Upcoming</h2>
          <Upcoming list={upcoming} f={f} />
        </section>
      )}

      <Losses list={past} f={f} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Past events</h2>
          <p className="text-sm text-muted-foreground">{history.length ? 'Every event Smoothcomp lists, with its wins and medals. ' : ''}Where Mat Stats read the results: each division, its place and the W–L; elsewhere the W–L their profile gave. Counting the finishes switched on.</p>
        </div>
        {past.length ? <EventsTable list={past} f={f} /> : <Card><Empty title="No past events seen yet" text="They appear once someone with Mat Stats reads this athlete's career or an event they entered." /></Card>}
      </section>
    </div>
  );
}
