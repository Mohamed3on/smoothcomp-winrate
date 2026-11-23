import { useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink, X } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toggle } from '@/components/ui/toggle';
import { Empty } from '@/components/empty';
import { BELT_COLOUR, Belt, Flag, Medals, Photo, Place, Record } from '@/components/stats';
import { useApi, type Athlete, type Bout, type Entry, type Outcome, type Past, type Profile } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { ageOf, date, fmt, isUpcoming, plural, typeName, winsOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DivisionLink } from '@/pages/division';

interface Data { career: Athlete | null; person: (Partial<Athlete> & { hidden: number | null }) | null; entries: Entry[]; history: Past[]; outcomes?: Outcome[]; belts?: Belts | null; profile?: Profile | null; seen: { wins: number; losses: number; events: number } | null }

// A profile's fastest escape is a career's fastest_escape: one finish, one switch.
const keyOf = (t: string) => (t === 'escape' ? 'fastest_escape' : t);
const dot = (t: string) => `var(--color-win-${keyOf(t)}, var(--color-win-other))`;
// Opponents are known by name, as registrations change per event.
const person = (name: string | null | undefined) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const pct = (w: number, l: number) => `${Math.round((w / (w + l)) * 100)}%`;
// A rate's hue runs from red at 40% or under, through amber, to green at 85% and over, as on the profile.
const tone = (w: number, l: number) => ({ color: `oklch(0.8 0.14 ${25 + 120 * Math.min(1, Math.max(0, (w / (w + l) - 0.4) / 0.45))})` });

// Each finish they won or lost by: W–L from their profile's match lists with the results read at
// every event those don't hold; a finish only the career names
// (walkovers, the rarer ones) comes as wins alone.
interface Finish { key: string; w: number; l: number | null }
function finishes(career: Athlete | null, outcomes: Outcome[], entries: Entry[]): Finish[] {
  const by = new Map<string, Finish>();
  const add = (t: string, w: number, l: number) => {
    const was = by.get(keyOf(t));
    by.set(keyOf(t), { key: keyOf(t), w: (was?.w ?? 0) + w, l: (was?.l ?? 0) + l });
  };
  for (const o of outcomes) for (const [t, [w, l]] of Object.entries(o.out.types)) add(t, w, l);
  for (const e of unlisted(entries, outcomes)) {
    for (const [t, n] of Object.entries(e.wins ?? {})) add(t, Number(n) || 0, 0);
    for (const [t, n] of Object.entries(e.losses ?? {})) add(t, 0, Number(n) || 0);
  }
  for (const [t, n] of Object.entries(career?.types ?? {})) if (Number(n) > 0 && !by.has(keyOf(t))) by.set(keyOf(t), { key: keyOf(t), w: Number(n), l: null });
  return [...by.values()].filter((x) => x.w + (x.l ?? 0) > 0).sort((a, b) => b.w + (b.l ?? 0) - a.w - (a.l ?? 0));
}

// The divisions whose results were read at events their profile's match lists don't hold.
const unlisted = (entries: Entry[], outcomes: Outcome[]) => entries.filter((e) => e.fought && !outcomes.some((o) => o.event === e.event));

// Every match the profile's lists give, in the order fought: each win (its finish too from v 2),
// each loss with its finish. A loss the match list names twice is matched once.
export interface Meeting { won: boolean; opponent: string | null; club: string | null; image: string | null; type?: string; how?: string; division?: string | null; stage?: string | null; user?: string | null; us?: Bout['us']; them?: Bout['them']; clock?: Bout['clock'] }
function meetingsOf(o: Outcome | undefined): Meeting[] {
  if (!o) return [];
  const losses = [...o.out.losses];
  const out: Meeting[] = (o.out.faced ?? []).map((m) => {
    if (m.won) return { won: true, opponent: m.name, club: m.club, image: m.image, type: m.type, how: m.how, division: m.division, stage: m.stage };
    const i = losses.findIndex((l) => person(l.opponent) === person(m.name));
    return i < 0 ? { won: false, opponent: m.name, club: m.club, image: m.image } : { ...losses.splice(i, 1)[0], won: false };
  });
  return [...out, ...losses.map((l) => ({ ...l, won: false }))];
}
// An event's matches: their profile's match list where it was read, else the matches the results
// read there give, each division's in the order fought.
const meetingsOfRow = (r: Row): Meeting[] => r.outcome ? meetingsOf(r.outcome)
  : (r.read ?? []).filter((e) => e.fought).flatMap((e) => (e.bouts ?? []).map((b) => ({
    won: b.won, opponent: b.opponent, club: b.club, image: null, type: b.type, how: b.how ?? undefined, division: e.division, stage: b.stage, user: b.user, us: b.us, them: b.them, clock: b.clock,
  })));
// A match's score as the scoreboard ended it: points, then advantages and penalties where any were
// given; a finish before the bell says when (the match length less the time left).
function scoreOf(m: Meeting): string | null {
  if (!m.us || !m.them) return null;
  const parts = [`${m.us[0]}–${m.them[0]}`];
  if (m.us[1] || m.them[1]) parts.push(`adv ${m.us[1]}–${m.them[1]}`);
  if (m.us[2] || m.them[2]) parts.push(`pen ${m.us[2]}–${m.them[2]}`);
  const [length, left] = m.clock ?? [];
  if (length && left) { const t = length - left; parts.push(`at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`); }
  return parts.join(' · ');
}
// A match counts under the finishes switched on; a win from before v 2 names none, so it always shows.
const countedMatch = (m: Meeting, f: Filters) => !m.type || f.counted(keyOf(m.type));
type Show = 'all' | 'won' | 'lost';

// Everyone who beat them more than once, with the whole head-to-head; the newest meeting
// gives the club and photo. Furthest behind first.
interface Rival { key: string; name: string; club: string | null; image: string | null; w: number; l: number }
function rivalsOf(rows: Row[]): Rival[] {
  const met = new Map<string, Rival>();
  for (const m of rows.flatMap(meetingsOfRow)) {
    const key = person(m.opponent);
    if (!key) continue;
    if (!met.has(key)) met.set(key, { key, name: m.opponent!, club: m.club, image: m.image, w: 0, l: 0 });
    met.get(key)![m.won ? 'w' : 'l']++;
  }
  return [...met.values()].filter((r) => r.l > 1).sort((a, b) => b.l - b.w - (a.l - a.w) || b.l - a.l);
}

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
    : <a href={`${f.home}/en/event/${row.id}`} rel="noopener" className="inline-flex items-center gap-1 font-medium hover:text-primary">{title}<ExternalLink className="size-3 shrink-0 text-muted-foreground" /></a>;
}

// When each belt began (null for the first), as their profile dates them.
interface Belts { worn: string[]; starts: (number | null)[] }
// The win rate at each belt worn, highest first, as their profile splits it: an event takes the
// belt worn on its date; undated ones count only overall. The current belt shows even with no events.
interface Split { belt: string; w: number; l: number; events: number }
function splitByBelt(belts: Belts | null | undefined, outcomes: Outcome[], entries: Entry[], f: Filters): Split[] | null {
  if (!belts || belts.worn.length < 2) return null;
  const beltOf = (start: string | null | undefined) => {
    const t = Date.parse(start ?? "");
    return Number.isNaN(t) ? null : belts.worn[belts.starts.findLastIndex((s) => (s ?? -Infinity) <= t)] ?? belts.worn[0];
  };
  const by = new Map(belts.worn.map((b) => [b, { belt: b, w: 0, l: 0, events: 0 }]));
  const add = (start: string | null | undefined, pairs: [string, number, number][], event: boolean) => {
    const t = by.get(beltOf(start) ?? "");
    if (!t) return;
    for (const [type, w, l] of pairs) if (f.counted(keyOf(type))) { t.w += w; t.l += l; }
    if (event) t.events++;
  };
  for (const o of outcomes) add(o.start, Object.entries(o.out.types).map(([t, [w, l]]) => [t, w, l]), true);
  const seen = new Set<string>();
  if (outcomes.length) for (const e of unlisted(entries, outcomes)) {
    add(e.start, [...Object.entries(e.wins ?? {}).map(([t, n]): [string, number, number] => [t, Number(n) || 0, 0]), ...Object.entries(e.losses ?? {}).map(([t, n]): [string, number, number] => [t, 0, Number(n) || 0])], !seen.has(e.event));
    seen.add(e.event);
  }
  const current = belts.worn[belts.worn.length - 1];
  return [...by.values()].filter((t) => t.belt === current || t.events).reverse();
}

function BeltSplit({ split }: { split: Split[] }) {
  return (
    <ul className="flex max-w-md flex-col gap-2" aria-label="Win rate at each belt">
      {split.map(({ belt, w, l, events }) => {
        const label = !events ? `No events at ${belt} yet` : `${w + l ? `${pct(w, l)} of matches won` : "No matches by these finishes"} at ${belt}: ${plural(w, "win")} and ${l} loss${l === 1 ? "" : "es"} in ${plural(events, "event")}`;
        return (
          <li key={belt} title={label} aria-label={label} className="grid grid-cols-[22px_3rem_1fr_4.5rem] items-center gap-3">
            <Belt belt={belt} />
            <b className="text-right font-semibold tabular-nums" style={w + l ? tone(w, l) : undefined}>{w + l ? pct(w, l) : <span className="text-muted-foreground">–</span>}</b>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              {w + l > 0 && <span className="block h-full rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]" style={{ width: `${(w / (w + l)) * 100}%`, background: BELT_COLOUR[belt] }} />}
            </span>
            <span className="text-right text-sm">{w + l ? <Record w={w} l={l} /> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

// The headline: the win rate over the finishes switched on, and those switches, each with its W–L.
function RecordBand({ fins, f, over, split }: { fins: Finish[]; f: Filters; over: string; split: Split[] | null }) {
  const on = fins.filter((x) => f.counted(x.key));
  const rated = on.filter((x) => x.l != null);
  const [w, l] = rated.reduce(([a, b], x) => [a + x.w, b + (x.l ?? 0)], [0, 0]);
  const toggle = (key: string) => {
    const off = new Set(f.off);
    if (off.has(key)) off.delete(key);
    else if (on.length > 1) off.add(key); // one finish always stays counted
    f.set({ off: [...off].join(',') });
  };
  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {w + l ? <>
          <span className="text-5xl font-semibold tracking-tight" style={tone(w, l)}>{pct(w, l)}</span>
          <span className="text-muted-foreground">win rate</span>
          <span className="text-xl"><Record w={w} l={l} /></span>
          <span className="text-sm text-muted-foreground">{over}</span>
        </> : rated.length || !on.length ? <span className="text-muted-foreground">No matches by these finishes</span> : <>
          <span className="text-5xl font-semibold tracking-tight">{on.reduce((n, x) => n + x.w, 0)}</span>
          <span className="text-muted-foreground">wins</span>
          <span className="text-sm text-muted-foreground">· losses arrive once someone opens their Smoothcomp profile with Mat Stats</span>
        </>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Finishes counted">
        {fins.map((x) => (
          <Toggle key={x.key} variant="outline" size="sm" pressed={f.counted(x.key)} onPressedChange={() => toggle(x.key)}
            className="h-7 gap-1.5 rounded-full px-2.5 text-muted-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/12 aria-pressed:text-foreground">
            <i className={cn('size-2 rounded-full transition-opacity', !f.counted(x.key) && 'opacity-35')} style={{ background: dot(x.key) }} />
            <span className="font-medium">{typeName(x.key)}</span>
            <span className={cn('text-xs', !f.counted(x.key) && 'opacity-60')}>{x.l == null ? <><b className="font-semibold">{x.w}</b> {x.w === 1 ? 'win' : 'wins'}</> : <Record w={x.w} l={x.l} />}</span>
          </Toggle>
        ))}
      </div>
      {split && <BeltSplit split={split} />}
    </Card>
  );
}

// The belt in each art and where they rank, as their Smoothcomp profile shows them.
function OnProfile({ p, f, id }: { p: Profile; f: Filters; id: string }) {
  // Each art's highest belt, with every event at any of its belts.
  const arts = new Map<string, { belt: string; degree: number | null; order: number; events: number }>();
  for (const s of p.skills ?? []) {
    const was = arts.get(s.name);
    const events = (was?.events ?? 0) + (s.competed ?? 0);
    arts.set(s.name, !was || (s.order ?? 0) > was.order ? { belt: s.belt, degree: s.degree, order: s.order ?? 0, events } : { ...was, events });
  }
  const ranks = p.rankings ?? [];
  if (!arts.size && !ranks.length) return null;
  const profile = `${f.home}/en/profile/${id}`;
  return (
    <Card className="gap-4 px-5 py-4">
      {arts.size > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{arts.size === 1 ? 'Belt' : 'Belts'}</h2>
          <ul className="flex flex-col gap-2">
            {[...arts].map(([art, a]) => (
              <li key={art} className="flex items-center gap-3">
                <Belt belt={a.belt.toLowerCase().replace('gray', 'grey')} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{a.belt}{a.degree ? <span className="text-muted-foreground"> · {plural(a.degree, 'degree')}</span> : null}</span>
                  <span className="text-xs text-muted-foreground">{art}</span>
                </span>
                <span className="text-sm text-muted-foreground">{plural(a.events, 'event')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ranks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Rankings</h2>
          <ul className="flex flex-col gap-1">
            {ranks.map((r) => {
              const body = <>
                <span className="inline-grid h-6 w-16 shrink-0 place-items-center rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums">#{fmt(r.placement)}</span>
                <span className="flex min-w-0 flex-col"><span className="text-sm font-medium break-words">{r.name}</span>{r.owner && <span className="text-xs text-muted-foreground">{r.owner}</span>}</span>
              </>;
              return (
                <li key={`${r.toplist}-${r.name}`}>
                  {r.type === 'federation' && r.ownerId && r.toplist
                    ? <a href={`${f.home}/en/federation/${r.ownerId}/ranking/${r.toplist}`} rel="noopener" className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">{body}</a>
                    : <div className="flex items-center gap-3 py-1.5">{body}</div>}
                </li>
              );
            })}
          </ul>
          {(p.ranked ?? 0) > ranks.length && <a href={profile} rel="noopener" className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">All {p.ranked} rankings on Smoothcomp<ExternalLink className="size-3" /></a>}
        </section>
      )}
    </Card>
  );
}

// Who beat them more than once. Furthest behind leads; each opens every match between them.
function Rivals({ rivals, losses, pick, picked }: { rivals: Rival[]; losses: number; pick: (r: Rival | null) => void; picked: string | null }) {
  const behind = Math.max(0, ...rivals.map((r) => r.l - r.w));
  return (
    <Card className="gap-3 px-5 py-4">
      <h2 className="text-sm font-medium">Lost most to</h2>
      {!rivals.length ? <p className="text-sm text-muted-foreground">{losses > 1 ? 'No one has beaten them twice.' : 'No one has beaten them more than once.'}</p> : (
        <ul className="flex flex-col gap-1">
          {rivals.map((r) => {
            const lead = behind > 0 && r.l - r.w === behind;
            return (
              <li key={r.key}>
                <button type="button" aria-pressed={picked === r.key} onClick={() => pick(picked === r.key ? null : r)} title={`Every match against ${r.name}`}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/12">
                  <Photo name={r.name} photo={r.image} className={lead ? 'size-10' : 'size-7'} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('break-words', lead ? 'font-semibold' : 'text-sm font-medium')}>{r.name}</span>
                    {r.club && <span className="text-xs text-muted-foreground break-words">{r.club}</span>}
                  </span>
                  <span className={lead ? 'text-lg' : 'text-sm'}><Record w={r.w} l={r.l} /></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// W–L at each past event, oldest first: wins up, coloured by the best medal there; losses down.
function Form({ list, f }: { list: Row[]; f: Filters }) {
  const points = list.filter((r) => r.outcome || r.read?.some((e) => e.fought) || r.listed?.wins != null).reverse().map((r) => {
    const fin = r.outcome && Object.entries(r.outcome.out.types).reduce(([a, b], [t, [w, l]]) => (f.counted(keyOf(t)) ? [a + w, b + l] : [a, b]), [0, 0]);
    const read = r.read?.filter((e) => e.fought) ?? [];
    const best = Math.min(...read.map((e) => e.place ?? 99));
    return {
      name: r.title ?? '', date: date(r.start), tick: r.start ? new Date(r.start).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : '–',
      wins: fin ? fin[0] : read.length ? read.reduce((n, e) => n + winsOf(e.wins, f.counted), 0) : r.listed!.wins!,
      losses: fin ? -fin[1] : -read.reduce((n, e) => n + winsOf(e.losses, f.counted), 0),
      medal: (r.listed?.gold || best === 1) ? 'var(--color-gold)' : (r.listed?.silver || best === 2) ? 'var(--color-silver)' : (r.listed?.bronze || best === 3) ? 'var(--color-bronze)' : 'var(--color-win-decision)',
    };
  });
  if (points.length < 2) return null;
  const lost = points.some((p) => p.losses);
  return (
    <Card className="min-w-0 gap-3 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-medium">{lost ? 'Won and lost per event' : 'Wins per event'}</h2>
        <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Bar colour: the best medal won there">
          {[['bg-gold', 'Gold'], ['bg-silver', 'Silver'], ['bg-bronze', 'Bronze'], ['bg-win-decision', 'No medal'], ...(lost ? [['bg-lost/70', 'Lost']] : [])].map(([bg, label]) => <li key={label} className="inline-flex items-center gap-1.5"><i className={`size-2 rounded-sm ${bg}`} />{label}</li>)}
        </ul>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer>
          <BarChart data={points} stackOffset="sign" margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
            <XAxis dataKey="tick" interval="preserveStartEnd" minTickGap={8} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tickFormatter={(v) => String(Math.abs(v))} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="oklch(1 0 0 / 12%)" />
            <Tooltip cursor={{ fill: 'oklch(1 0 0 / 5%)' }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(_, p) => (p[0] ? `${p[0].payload.name} · ${p[0].payload.date}` : '')} formatter={(v, key) => [Math.abs(Number(v)), key === 'wins' ? 'Won' : 'Lost']} />
            <Bar dataKey="wins" stackId="r" maxBarSize={28} radius={[3, 3, 0, 0]}>{points.map((p, i) => <Cell key={i} fill={p.medal} />)}</Bar>
            {lost && <Bar dataKey="losses" stackId="r" maxBarSize={28} radius={[0, 0, 3, 3]} fill="var(--color-lost)" fillOpacity={0.7} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function MatchLine({ m, f, divisions }: { m: Meeting; f: Filters; divisions: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 text-sm">
      <Photo name={m.opponent} photo={m.image} className="size-6" />
      <span className={cn('shrink-0 text-xs font-semibold', m.won ? 'text-won' : 'text-lost')}>{m.won ? 'Beat' : 'Lost to'}</span>
      <span className="min-w-0 break-words">{m.user ? <Link href={f.link(`/athlete/${m.user}`)} className="font-medium hover:text-primary">{m.opponent ?? 'Unknown opponent'}</Link> : <span className="font-medium">{m.opponent ?? 'Unknown opponent'}</span>}{m.club && <span className="text-muted-foreground"> · {m.club}</span>}</span>
      <span className="ml-auto flex max-w-[55%] flex-wrap items-center justify-end gap-x-1.5 pl-3 text-right text-xs text-muted-foreground">
        {m.type && <><i className="size-2 rounded-full" style={{ background: dot(m.type) }} /><span className="text-foreground/85">{m.how || typeName(m.type)}</span></>}
        {scoreOf(m) && <span className="tabular-nums">· {scoreOf(m)}</span>}
        {m.stage && <span>{m.type ? '· ' : ''}{m.stage}</span>}
        {divisions && m.division && <span>· {m.division}</span>}
      </span>
    </li>
  );
}

function EventsTable({ list, f, against, show }: { list: Row[]; f: Filters; against: Rival | null; show: Show }) {
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
            const all = meetingsOfRow(row);
            const shown = all.filter((m) => (against ? person(m.opponent) === against.key : countedMatch(m, f)) && (show === 'all' || m.won === (show === 'won')));
            // Divisions read from the results, else the ones the match lists name.
            const named = [...new Set(all.map((m) => m.division).filter(Boolean))] as string[];
            const divisions: (Entry | string[])[] = row.read?.length ? row.read : [named];
            const span = Math.max(divisions.length, 1);
            const fin = row.outcome && Object.entries(row.outcome.out.types).reduce(([a, b], [t, [w, l]]) => (f.counted(keyOf(t)) ? [a + w, b + l] : [a, b]), [0, 0]);
            return [
              ...Array.from({ length: span }, (_, k) => {
                const d = divisions[k];
                const e = d && !Array.isArray(d) ? d : undefined;
                return (
                  <TableRow key={`${row.id}-${k}`} className={cn((k < span - 1 || shown.length) && 'border-b-0', 'hover:bg-transparent')}>
                    <TableCell className="pl-5 align-top text-muted-foreground">{k ? '' : date(row.start)}</TableCell>
                    <TableCell className="align-top whitespace-normal">{k ? '' : <div className="flex items-start gap-3">{row.listed?.image && <img src={row.listed.image} alt="" loading="lazy" className="mt-0.5 hidden aspect-[16/9] w-16 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10 lg:block" />}<div className="flex min-w-0 flex-col gap-0.5"><EventLink row={row} f={f} />{row.city && <span className="text-xs text-muted-foreground">{row.city}</span>}</div></div>}</TableCell>
                    <TableCell className="align-top whitespace-normal text-muted-foreground">{e ? <><DivisionLink event={row.id} name={e.division} f={f} />{e.club && <span className="block text-xs">{e.club}</span>}</> : Array.isArray(d) ? d.map((x) => <span key={x} className="block">{x}</span>) : ''}</TableCell>
                    <TableCell className="text-right align-top">
                      {e?.fought ? <Place p={e.place} /> : !k && row.listed && (row.listed.gold || row.listed.silver || row.listed.bronze) && !read.length
                        ? <Medals g={row.listed.gold} s={row.listed.silver} b={row.listed.bronze} /> : e && !e.fought ? <span className="text-xs text-muted-foreground">Entered</span> : <span className="text-muted-foreground">{k ? '' : '–'}</span>}
                    </TableCell>
                    <TableCell className="pr-5 text-right align-top">
                      {e?.fought ? <Record w={winsOf(e.wins, f.counted)} l={winsOf(e.losses, f.counted)} />
                        : !k && fin && !read.length ? <Record w={fin[0]} l={fin[1]} />
                        : !k && row.listed?.wins != null && !read.length ? <span><b className="font-semibold">{row.listed.wins}</b> <span className="text-xs text-muted-foreground">{row.listed.wins === 1 ? 'win' : 'wins'}</span></span> : ''}
                    </TableCell>
                  </TableRow>
                );
              }),
              shown.length > 0 && (
                <TableRow key={`${row.id}-m`} className="hover:bg-transparent">
                  <TableCell />
                  <TableCell colSpan={4} className="pt-0 pr-5 pb-3 whitespace-normal">
                    <ul className="flex flex-col gap-1.5 border-t border-dashed border-border pt-2.5">{shown.map((m, i) => <MatchLine key={i} m={m} f={f} divisions={(row.read?.length ?? named.length) > 1} />)}</ul>
                  </TableCell>
                </TableRow>
              ),
            ];
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

export function AthletePage({ id }: { id: string }) {
  const f = useFilters();
  const [against, setAgainst] = useState<Rival | null>(null);
  const [show, setShow] = useState<Show>('all');
  const { data, isLoading, error } = useApi<Data>('athlete', { site: f.site, off: f.query.off, id }, true, 0);
  if (isLoading) return <div className="flex items-center gap-5"><Skeleton className="size-20 rounded-full" /><Skeleton className="h-8 w-64" /></div>;
  if (!data) return <Empty title={(error as { status?: number })?.status === 404 ? 'No athlete here' : 'That didn’t load'} text={(error as { status?: number })?.status === 404 ? 'Mat Stats has nothing under this athlete on this site. They may be on the other site, or nobody has read them yet.' : 'The stats server didn’t answer. Try again in a moment.'} />;
  const { career, person: who, entries, history, outcomes = [] } = data;
  const a = { ...(who ?? {}), ...(career ?? {}), name: who?.name ?? career?.name ?? null, born: who?.born ?? career?.born ?? null } as Athlete & { hidden: number | null };
  document.title = `${a.name ?? `Athlete ${id}`} · Mat Stats`;
  const all = rows(entries, history, outcomes);
  const upcoming = all.filter((r) => isUpcoming(r.start) && !r.read?.some((e) => e.fought));
  const past = all.filter((r) => !upcoming.includes(r));
  const age = ageOf(a.born);
  const fromResults = career?.source === 'results';
  const rivals = rivalsOf(all.filter((r) => !isUpcoming(r.start) || r.read?.some((e) => e.fought)));
  const met = past.flatMap(meetingsOfRow);
  const losses = met.filter((m) => !m.won).length;
  const pick = (r: Rival | null) => { setAgainst(r); if (r) document.getElementById('events')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const matches = met.filter((m) => (against ? person(m.opponent) === against.key : countedMatch(m, f)));
  const won = matches.filter((m) => m.won).length;
  // Won or lost alone lists just those matches, event by event; all keeps every event.
  const shownPast = past.filter((r) => (show === 'all' && !against) || meetingsOfRow(r).some((m) => (against ? person(m.opponent) === against.key : countedMatch(m, f)) && (show === 'all' || m.won === (show === 'won'))));
  const side = data.profile ? OnProfile({ p: data.profile, f, id }) : null;
  const rated = outcomes.length + new Set(unlisted(entries, outcomes).map((e) => e.event)).size;
  const over = !rated ? '' : outcomes.length ? `across ${plural(rated, 'event')}` : `at ${plural(rated, 'event')} read`;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-5">
        <Photo name={a.name} photo={a.photo} className="size-20 text-lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{a.name ?? `Athlete ${id}`}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {(a.country || a.country_name) && <span className="inline-flex items-center gap-1.5"><Flag code={a.country} name={a.country_name} />{a.country_name ?? a.country?.toUpperCase()}</span>}
            {age != null && <span>{age} years old</span>}
            {a.belt && <span className="inline-flex items-center gap-1.5"><Belt belt={a.belt} /><span>{a.belt[0].toUpperCase()}{a.belt.slice(1)} belt</span></span>}
            {a.club && (a.club_id ? <Link href={f.link(`/academy/${a.club_id}`)} className="text-foreground hover:text-primary">{a.club}</Link> : <span>{a.club}</span>)}
            {!data.profile?.affiliations?.length && who?.affiliation && <span title="Affiliation">{who.affiliation}</span>}
            {data.profile?.affiliations?.map((c) => c.id ? <a key={c.id} href={`${f.home}/en/affiliation/${c.id}`} rel="noopener" title="Affiliation" className="hover:text-foreground">{c.name}</a> : <span key={c.name} title="Affiliation">{c.name}</span>)}
            <a href={`${f.home}/en/profile/${id}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">Profile on {f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}<ExternalLink className="size-3" /></a>
            {(data.profile?.videos ?? 0) > 0 && <a href={`${f.home}/en/profile/${id}`} rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">{plural(data.profile!.videos!, 'match video')}<ExternalLink className="size-3" /></a>}
          </div>
          {career && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground" title={fromResults ? 'Smoothcomp serves no career for this athlete, so these are their results at the events Mat Stats has read' : `Career as Smoothcomp lists it${career.at ? `, read ${date(new Date(career.at).toISOString())}` : ''}`}>
              <Medals g={career.gold} s={career.silver} b={career.bronze} className="text-foreground" />
              {career.events != null && <span><b className="font-semibold text-foreground">{career.events}</b> {fromResults ? (career.events === 1 ? 'event read' : 'events read') : career.events === 1 ? 'event' : 'events'}</span>}
              <span><b className="font-semibold text-foreground">{career.wins}</b> {career.wins === 1 ? 'win' : 'wins'}</span>
              {career.events ? <span><b className="font-semibold text-foreground">{(career.wins / career.events).toFixed(1)}</b> per event</span> : null}
              {career.wins > 0 && f.counted('submission') && <span><b className="font-semibold text-foreground">{Math.round((career.submission / career.wins) * 100)}%</b> by submission</span>}
            </div>
          )}
        </div>
      </header>

      {career || outcomes.length ? <RecordBand fins={finishes(career, outcomes, entries)} f={f} over={over} split={splitByBelt(data.belts, outcomes, entries, f)} />
        : <Card className="px-5 py-4 text-sm text-muted-foreground">No career or results read yet. They arrive when someone with Mat Stats opens an event this athlete is in.</Card>}

      <div className={cn('grid items-start gap-6', (met.length > 0 || side) && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
        {(met.length > 0 || side) && <div className="flex min-w-0 flex-col gap-6">
          {met.length > 0 && <Rivals rivals={rivals} losses={losses} pick={pick} picked={against?.key ?? null} />}
          {side}
        </div>}
        <Form list={past} f={f} />
      </div>

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Upcoming</h2>
          <Upcoming list={upcoming} f={f} />
        </section>
      )}

      <section id="events" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{against ? 'Every match against' : 'Events'}</h2>
          {against ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/12 py-0.5 pr-1 pl-1">
              <Photo name={against.name} photo={against.image} className="size-6" />
              <span className="text-sm font-medium">{against.name}</span><Record w={against.w} l={against.l} />
              <button type="button" onClick={() => setAgainst(null)} aria-label="Show every event" className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-3.5" /></button>
            </span>
          ) : <span className="text-sm text-muted-foreground">{past.length}</span>}
          {matches.length > 0 && (
            <div className="ml-auto flex rounded-full border border-input p-0.5" role="group" aria-label="Matches shown">
              {([['all', 'All matches', matches.length], ['won', 'Won', won], ['lost', 'Lost', matches.length - won]] as const).map(([key, label, n]) => (
                <button key={key} type="button" aria-pressed={show === key} onClick={() => setShow(key)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/15 aria-pressed:text-foreground">
                  {label}<b className={cn('font-semibold', key === 'won' ? 'text-won' : key === 'lost' ? 'text-lost' : 'text-foreground')}>{n}</b>
                </button>
              ))}
            </div>
          )}
        </div>
        {shownPast.length ? <EventsTable list={shownPast} f={f} against={against} show={show} /> : <Card><Empty title="No past events seen yet" text="They appear once someone with Mat Stats reads this athlete's career or an event they entered." /></Card>}
      </section>
    </div>
  );
}
