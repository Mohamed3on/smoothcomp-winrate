import { Fragment, useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink, X } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Empty } from '@/components/empty';
import { BELT_COLOUR, Belt, HIDDEN, Hidden, Flag, Medals, Photo, Place, Record } from '@/components/stats';
import { useApi, type Athlete, type Bout, type Entry, type Outcome, type Past, type Profile } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { ageOf, beltAt, date, fmt, isUpcoming, plural, rate, typeName, winsOf } from '@/lib/format';
import { BELTS, beltOf, beltsIn, beltSplit, eventRecords, finishOf, matchFinder, normalize, pointsLine, winTone, showed, rivalsOf, roundOf, totals, usualDivision, weightName, bracketOf } from '@/lib/rules';
import { cn } from '@/lib/utils';
import { useMedia } from '@/lib/media';
import { DivisionLink } from '@/pages/division';
import { ReadNow } from '@/components/read-now';
import { needsScore, ReadScores, type Target } from '@/components/read-scores';
import { useRemember } from '@/lib/recent';

// A bracket in words: "brown-belt master men at −85 kg", "adults at −70 kg", "teen girls at −53 kg".
function bracketName(b: Bracket) {
  const young = b.age === 'Kids' || b.age === 'Teen';
  const whom = b.sex ? (b.sex === 'm' ? (young ? 'boys' : 'men') : (young ? 'girls' : 'women')) : null;
  const age = b.age === 'Kids' ? (whom ? '' : 'kids') : whom ? (b.age === 'Adult' ? '' : b.age.toLowerCase()) : `${b.age.toLowerCase()}s`;
  return [b.belt && `${b.belt}-belt`, age, whom].filter(Boolean).join(' ') + ` at ${weightName(b.weight)}`;
}

// One person's accounts read as one: entries, history and outcomes carry the site of the account they came from.
interface Account { site: string; user: string; name: string | null; club: string | null }
// Their place by wins in their bracket (whom, age group, weight class, belt), as the rankings narrowed to it order them.
interface Bracket { sex: string | null; age: string; weight: number; belt: string | null; rank: number; of: number; rated?: { rank: number; of: number } | null }
interface Data { bracket?: Bracket | null; career: Athlete | null; person: (Partial<Athlete> & { hidden: number | null }) | null; entries: Entry[]; history: Past[]; outcomes?: Outcome[]; belts?: Belts | null; profile?: Profile | null; accounts?: Account[] }
const SITE_NAME = (site: string) => (site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp');

// Every finish is counted under its group (rules.js): an older match list's "escape" is a fastest escape.
const dot = (t: string) => `var(--color-win-${finishOf(t)}, var(--color-win-other))`;
// A rate's hue runs from red at 40% or under, through amber, to green at 85% and over, as on the profile.
const tone = (w: number, l: number) => ({ color: winTone(w, l) });

// Their record event by event, as the rankings count it (rules.js eventRecords).
type Records = ReturnType<typeof eventRecords>;
// W–L over the finishes counted.
const recordIn = (types: Record<string, [number, number]>, f: Filters) =>
  Object.entries(types).reduce(([w, l], [t, [a, b]]) => (f.counted(t) ? [w + a, l + b] : [w, l]), [0, 0]);

// Each finish they won or lost by, as their record gives it; a finish only the career names
// (the rarer ones) comes as wins alone.
interface Finish { key: string; w: number; l: number | null }
function finishes(career: Athlete | null, records: Records): Finish[] {
  const by = new Map<string, Finish>(Object.entries(totals(records)).map(([key, [w, l]]) => [key, { key, w, l }]));
  for (const [t, n] of Object.entries(career?.types ?? {})) if (Number(n) > 0 && !by.has(finishOf(t))) by.set(finishOf(t), { key: finishOf(t), w: Number(n), l: null });
  return [...by.values()].filter((x) => x.w + (x.l ?? 0) > 0).sort((a, b) => b.w + (b.l ?? 0) - a.w - (a.l ?? 0));
}

// Every match the profile's lists give, in the order fought: each win (its finish too from v 2),
// each loss with its finish. A loss the match list names twice is matched once.
export interface Meeting { site?: string; won: boolean; opponent: string | null; club: string | null; image: string | null; type?: string; how?: string; division?: string | null; stage?: string | null; user?: string | null; us?: Bout['us']; them?: Bout['them']; clock?: Bout['clock'] }
function meetingsOf(o: Outcome | undefined): Meeting[] {
  if (!o) return [];
  const losses = [...o.out.losses];
  const out: Meeting[] = (o.out.faced ?? []).map((m) => {
    if (m.won) return { won: true, opponent: m.name, club: m.club, image: m.image, type: m.type, how: m.how, division: m.division, stage: m.stage, user: m.user };
    const i = losses.findIndex((l) => normalize(l.opponent) === normalize(m.name));
    return i < 0 ? { won: false, opponent: m.name, club: m.club, image: m.image, user: m.user } : { ...losses.splice(i, 1)[0], won: false };
  });
  return [...out, ...losses.map((l) => ({ ...l, won: false }))];
}
// An event's matches: their profile's match list where it was read, else the matches the results
// read there give, each division's in the order fought. The match lists don't name an opponent's
// account: the server finds it among their divisions' entrants, else the results read there give it.
const meetingsOfRow = (r: Row): Meeting[] => {
  if (!r.outcome) return boutsOf(r);
  const bouts = boutsOf(r);
  const ids = new Map(bouts.map((m) => [normalize(m.opponent), m.user]));
  // Each takes from the read match that is the same one (rules.js matchFinder: the same round and opponent, or where either
  // names no round, the only one against them with that result) its score, and the finish and round a profile list from before v 2 leaves out.
  // One without its round against someone they met twice there with that result can't tell the two apart: it takes the first not taken.
  const theirs = (m: Meeting) => ({ stage: m.stage, sides: [null, m.opponent], won: m.won });
  const find = matchFinder(bouts.map((b) => ({ ...theirs(b), b })));
  const taken = new Set<Meeting>();
  const out = meetingsOf(r.outcome).map((m) => {
    const found = find(theirs(m))?.b ?? (m.stage ? undefined : bouts.find((b) => !taken.has(b) && b.won === m.won && normalize(b.opponent) === normalize(m.opponent) && (!m.type || b.type === m.type)));
    const b = found && !taken.has(found) ? (taken.add(found), found) : undefined;
    return { ...m, site: r.site, user: m.user ?? ids.get(normalize(m.opponent)), type: m.type ?? b?.type, how: m.how ?? b?.how, stage: m.stage ?? b?.stage, us: b?.us, them: b?.them, clock: b?.clock };
  });
  // The match list isn't in the order fought (a Final can come before the pool's last match): each
  // division in turn, its rounds in order, as the crawler keeps them.
  const divisions = [...new Set(out.map((m) => m.division))];
  return out.sort((a, b) => divisions.indexOf(a.division) - divisions.indexOf(b.division) || roundOf(a.stage) - roundOf(b.stage));
};
const boutsOf = (r: Row): Meeting[] => (r.read ?? []).filter((e) => e.fought).flatMap((e) => (e.bouts ?? []).map((b) => ({
    site: r.site, won: b.won, opponent: b.opponent, club: b.club, image: null, type: b.type, how: b.how ?? undefined, division: e.division, stage: b.stage, user: b.user, us: b.us, them: b.them, clock: b.clock,
  })));
// A match's score as the scoreboard ended it: points, then advantages and penalties where any were
// given; a finish before the bell says when.
function scoreOf(m: Meeting): string | null {
  if (!m.us || !m.them) return null;
  const parts = [`${m.us[0]}–${m.them[0]}`];
  if (m.us[1] || m.them[1]) parts.push(`adv ${m.us[1]}–${m.them[1]}`);
  if (m.us[2] || m.them[2]) parts.push(`pen ${m.us[2]}–${m.them[2]}`);
  const [t, left] = m.clock ?? [];
  if (t && left) parts.push(`at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  return parts.join(' · ');
}
// A match counts under the finishes switched on; a win from before v 2 names none, so it always shows.
const countedMatch = (m: Meeting, f: Filters) => !m.type || f.counted(finishOf(m.type));
type Show = 'all' | 'won' | 'lost';

// A walkover is no meeting: it never counts in a head-to-head.
const walkover = (m: Meeting) => !!m.type && finishOf(m.type) === 'walkover';
// Everyone who beat them more than once (rules.js rivalsOf), the newest meeting giving the club and photo.
interface Rival { key: string; name: string; club: string | null; image: string | null; w: number; l: number }
// Smoothcomp names every removed account "Unknown User": many people under one name, so none of them is a rival.
const unnamed = (m: Meeting) => /^unknown user$/i.test(m.opponent?.trim() ?? '');
const rivalsIn = (rows: Row[]): Rival[] => rivalsOf(rows.flatMap(meetingsOfRow).filter((m) => !walkover(m) && !unnamed(m)).map((m) => ({ name: m.opponent ?? '', won: m.won, club: m.club, image: m.image })));

// One event as the page shows it: what Smoothcomp lists, joined to the divisions Mat Stats read
// and to the record their profile's match lists gave.
interface Row { id: string; site?: string; start: string | null; title: string | null; city: string | null; listed?: Past; read?: Entry[]; outcome?: Outcome }
// An event is one site's: the two number theirs apart.
const at = (x: { site?: string; event: string }) => `${x.site} ${x.event}`;
function rows(entries: Entry[], history: Past[], outcomes: Outcome[]): Row[] {
  const byEvent = new Map<string, Row>();
  for (const h of history) byEvent.set(at(h), { id: h.event, site: h.site, start: h.start, title: h.title, city: h.city, listed: h });
  for (const o of outcomes) {
    const row = byEvent.get(at(o)) ?? { id: o.event, site: o.site, start: o.start, title: o.title, city: null };
    byEvent.set(at(o), { ...row, outcome: o });
  }
  for (const e of entries) {
    const row = byEvent.get(at(e)) ?? { id: e.event, site: e.site, start: e.start ?? null, title: e.title ?? null, city: e.city ?? null };
    row.read = [...(row.read ?? []), e];
    row.start ??= e.start ?? null; row.title ??= e.title ?? null;
    byEvent.set(at(e), row);
  }
  return [...byEvent.values()].sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
}

function EventLink({ row, f }: { row: Row; f: Filters }) {
  const title = row.title ?? `Event ${row.id}`;
  return row.read || row.listed?.known
    ? <Link href={f.linkOn(`/event/${row.id}`, row.site ?? f.site)} className="font-medium hover:text-primary">{title}</Link>
    : <a href={`https://${row.site ?? f.site}/en/event/${row.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium hover:text-primary">{title}<ExternalLink className="size-3 shrink-0 text-muted-foreground" /></a>;
}

// When each belt began (null for the first), as their profile dates them.
interface Belts { worn: string[]; starts: (number | null)[] }
// The win rate at each belt worn, highest first, as their profile splits it: an event takes the
// belt worn on its date; undated ones count only overall. The current belt shows even with no events.
interface Split { belt: string; w: number; l: number; events: number }
// The belt each event counts at, by its key (site and number). With their profile's belt timeline, the belt
// worn on its date (an undated event counts only overall). Without it, the belt its divisions name; one naming
// none takes the belt of their latest earlier event that does (or the first one after), and one naming several
// ("Brown/Black") the lowest of them at or above that belt.
function beltsAt(belts: Belts | null | undefined, records: Records): Map<string, string> {
  const by = new Map<string, string>();
  if (belts) {
    for (const r of records) {
      const t = Date.parse(r.start ?? '');
      if (!Number.isNaN(t)) by.set(r.event, belts.worn[belts.starts.findLastIndex((s) => (s ?? -Infinity) <= t)] ?? belts.worn[0]);
    }
    return by;
  }
  const named = records.map((r) => r.divisions.map(beltOf).find(Boolean) ?? null);
  let last = named.find(Boolean) ?? null;
  records.forEach((r, i) => {
    const floor = last ? BELTS.indexOf(last) : -1;
    last = named[i] ?? r.divisions.flatMap(beltsIn).find((b) => BELTS.indexOf(b) >= floor) ?? last;
    if (last) by.set(r.event, last);
  });
  return by;
}
function splitByDivision(records: Records, f: Filters, era: Map<string, string>): Split[] | null {
  const by = new Map<string, Split>();
  for (const r of records) {
    const belt = era.get(r.event);
    if (!belt) continue;
    const t = by.get(belt) ?? { belt, w: 0, l: 0, events: 0 };
    by.set(belt, t);
    const [w, l] = recordIn(r.types, f);
    t.w += w; t.l += l; t.events++;
  }
  if (by.size < 2) return null;
  return [...by.values()].sort((x, y) => BELTS.indexOf(y.belt) - BELTS.indexOf(x.belt));
}

function splitByBelt(belts: Belts | null | undefined, records: Records, f: Filters, era: Map<string, string>): Split[] | null {
  if (!belts) return splitByDivision(records, f, era);
  if (belts.worn.length < 2) return null;
  return beltSplit(records, belts.worn, belts.starts).map(({ belt, types, events }) => {
    const [w, l] = recordIn(types, f);
    return { belt, w, l, events };
  });
}
const splitLabel = ({ belt, w, l, events }: Split) => !events ? `No events at ${belt} yet` : `${w + l ? `${rate(w, l)} of matches won` : 'No matches by these finishes'} at ${belt}: ${plural(w, 'win')} and ${l} loss${l === 1 ? '' : 'es'} in ${plural(events, 'event')}`;
const capital = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

// Their belt drawn as worn: the rank bar near its end (red on a black belt), a white stripe a degree.
function BeltBar({ belt, degree }: { belt: string; degree: number | null }) {
  if (!BELT_COLOUR[belt]) return null;
  return (
    <span role="img" aria-label={`${capital(belt)} belt${degree ? `, ${plural(degree, 'degree')}` : ''}`}
      className="relative inline-block h-3 w-24 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-white/20 ring-inset" style={{ background: BELT_COLOUR[belt] }}>
      <span className="absolute inset-y-0 right-2.5 flex w-7 justify-center gap-[3px]" style={{ background: belt === 'black' ? '#b53b42' : '#17191c' }}>
        {Array.from({ length: Math.min(degree ?? 0, 6) }, (_, i) => <i key={i} className="w-0.5 bg-white/90" />)}
      </span>
    </span>
  );
}

// Their belts along the timeline: each run of events at one belt as wide as its events, the first run of
// each belt naming its win rate; a belt worn with no event yet closes the row.
export interface Era { belt: string; n: number }
function Eras({ eras, split }: { eras: Era[]; split: Split[] }) {
  const named = new Set<string>();
  const items = [...eras, ...split.filter((s) => !eras.some((e) => e.belt === s.belt)).map((s) => ({ belt: s.belt, n: 0 }))];
  return (
    <ul className="flex gap-1" aria-label="Win rate at each belt">
      {items.map(({ belt, n }, i) => {
        const s = split.find((x) => x.belt === belt);
        const first = !named.has(belt);
        named.add(belt);
        return (
          <li key={i} title={s && splitLabel(s)} style={n ? { flex: `${n} 1 0` } : undefined} className={cn('flex min-w-0 flex-col gap-1.5', !n && 'shrink-0')}>
            <i className={cn('h-1.5 rounded-full ring-1 ring-white/15 ring-inset', !n && 'opacity-50')} style={{ background: BELT_COLOUR[belt] }} />
            {first && s && <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
              <span className="text-foreground/85">{capital(belt)}</span>
              {s.events ? <>
                {s.w + s.l > 0 && <b className="font-semibold" style={tone(s.w, s.l)}>{rate(s.w, s.l)}</b>}
                <Record w={s.w} l={s.l} /><span>{plural(s.events, 'event')}</span>
              </> : <span>no events yet</span>}
            </span>}
          </li>
        );
      })}
    </ul>
  );
}

// Under this many matches a record says little: its ring stays grey and says so.
const FEW = 20;

// Their record as a ring: the share won in green, the share lost in red, the rate inside.
function Ring({ w, l, few }: { w: number; l: number; few: boolean }) {
  const r = 52, round = 2 * Math.PI * r, arc = round * 0.75, gap = w && l ? 3 : 0;
  const won = (w / (w + l)) * arc;
  const part = (from: number, length: number, colour: string) => length > 0 && (
    <circle cx="64" cy="64" r={r} fill="none" stroke={colour} strokeWidth="9" strokeDasharray={`${length} ${round}`} strokeDashoffset={-from} />
  );
  const dim = (c: string) => (few ? `color-mix(in oklch, ${c} 30%, var(--color-muted))` : c);
  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full rotate-[135deg]" aria-hidden>
        {part(0, arc, 'var(--color-muted)')}
        {part(0, won - gap / 2, dim('var(--color-won)'))}
        {part(won + gap / 2, arc - won - gap / 2, dim('var(--color-lost)'))}
      </svg>
      <span className="absolute inset-0 grid place-items-center pb-1 text-4xl font-semibold tracking-tight" style={few ? undefined : tone(w, l)}>{rate(w, l)}</span>
    </div>
  );
}

// How they win and how they lose, finish by finish on one scale: wins grow left, losses right.
// Each row switches its finish in or out of the record; one always stays counted.
function Finishes({ fins, f, toggle, last }: { fins: Finish[]; f: Filters; toggle: (key: string) => void; last: boolean }) {
  const most = Math.max(1, ...fins.flatMap((x) => [x.w, x.l ?? 0]));
  const cols = 'grid grid-cols-[2.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)_2.5rem] items-center gap-x-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem_minmax(0,1fr)_2.5rem]';
  const bar = (key: string, n: number, side: 'won' | 'lost') => n > 0 && (
    <i className={cn('block h-2.5', side === 'won' ? 'ml-auto rounded-l-[3px]' : 'rounded-r-[3px]')} style={{ width: `${Math.max((n / most) * 100, 2)}%`, background: dot(key) }} />
  );
  return (
    <div className="flex min-w-0 flex-col" role="group" aria-label="Finishes counted">
      <div className={cn(cols, 'pb-1.5 text-xs whitespace-nowrap text-muted-foreground')}><span /><span className="text-right">Won by</span><span /><span>Lost by</span><span /></div>
      {fins.map((x) => {
        const on = f.counted(x.key);
        const what = `${typeName(x.key)}: ${plural(x.w, 'win')}${x.l == null ? ' (losses by it not read)' : ` and ${x.l} loss${x.l === 1 ? '' : 'es'}`}`;
        return (
          <button key={x.key} type="button" aria-pressed={on} onClick={() => toggle(x.key)}
            title={on ? (last ? `${what}. One finish always stays counted` : `${what}. Counted: click to leave it out`) : `${what}. Not counted: click to count it`}
            className={cn(cols, 'h-8 rounded-md text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring max-sm:h-11')}>
            <span className={cn('text-right font-semibold', on && x.w ? 'text-won' : 'text-muted-foreground')}>{fmt(x.w)}</span>
            <span className={cn('transition-opacity', !on && 'opacity-25')}>{bar(x.key, x.w, 'won')}</span>
            <span className={cn('truncate text-center font-medium', !on && 'text-muted-foreground line-through decoration-muted-foreground/60')}>{typeName(x.key)}</span>
            <span className={cn('transition-opacity', !on && 'opacity-25')}>{x.l != null && bar(x.key, x.l, 'lost')}</span>
            <span className={cn('font-semibold', on && x.l ? 'text-lost' : 'text-muted-foreground')}>{x.l == null ? '–' : fmt(x.l)}</span>
          </button>
        );
      })}
    </div>
  );
}

// Where they stand in their bracket: by rating where rated (it orders a bracket better than wins: 70.0% of
// matches against 65.9%), by wins beside it; the rating itself explained on hover.
function Standing({ bracket, career, f, profile, id }: { bracket: Bracket | null | undefined; career: Athlete | null; f: Filters; profile: Profile | null | undefined; id: string }) {
  const rating = career?.rating != null ? career : null;
  const ranks = profile?.rankings ?? [];
  if (!bracket && !rating && !ranks.length) return null;
  const to = (sort?: string) => f.link(`/athletes?${new URLSearchParams({ ...(sort && { sort }), ...(bracket?.sex && { sex: bracket.sex }), ...(bracket && { age: bracket.age, weight: String(bracket.weight) }), ...(bracket?.belt && { belt: bracket.belt }) })}`);
  const strength = rating && `How strong they are from whom they beat and lost to at the events read: ${rating.mean} ± ${3 * (rating.doubt ?? 0)} from ${plural(rating.rated ?? 0, 'match')}, ranked at the lower end`;
  const rated = bracket?.rated && rating ? bracket.rated : null;
  return (
    <div className="flex flex-col gap-2 lg:w-72">
      {bracket && <Link href={to(rated ? 'rating' : undefined)} className="group flex flex-col gap-0.5"
        title={rated ? 'Their place by rating among the athletes rated in their age group, weight class and belt' : 'Their place by wins among the athletes in their age group, weight class and belt: the rankings narrowed to them'}>
        <span className="flex items-baseline gap-2">
          <b className="text-4xl font-semibold tracking-tight tabular-nums group-hover:text-primary">#{fmt((rated ?? bracket).rank)}</b>
          <span className="text-sm text-muted-foreground">of {fmt((rated ?? bracket).of)} {rated ? 'rated' : 'by wins'}</span>
        </span>
        <span className="text-sm text-foreground/85">{bracketName(bracket)}</span>
      </Link>}
      {rated && <Link href={to()} title="Their place by wins among the athletes in their age group, weight class and belt" className="text-sm text-muted-foreground hover:text-foreground">
        <b className="font-semibold text-foreground tabular-nums">#{fmt(bracket!.rank)}</b> of {fmt(bracket!.of)} by wins
      </Link>}
      {rating && <Popover>
        <PopoverTrigger openOnHover className="cursor-help self-start rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Rating <b className="font-semibold text-foreground tabular-nums">{rating.rating}</b>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground">
          {strength}.{!bracket && <> <Link href={f.link('/athletes?sort=rating')} className="text-foreground hover:text-primary">Rankings by rating</Link></>}
        </PopoverContent>
      </Popover>}
      {ranks.length > 0 && <OnSmoothcomp ranks={ranks} more={profile?.ranked ?? 0} f={f} id={id} first={!bracket && !rating} />}
    </div>
  );
}

// Points on the scoreboard, theirs against their opponents', as a split bar.
function Scoreboard({ points }: { points: Points }) {
  const line = pointsLine(points.for, points.against, points.scored, points.total);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" title="Points on the scoreboard, theirs and their opponents', in the matches whose score was read, over the finishes counted; walkovers and stoppages have none">
      <span className="text-sm text-muted-foreground">Scoreboard</span>
      <span className="text-base"><Record w={points.for} l={points.against} /></span>
      {points.for + points.against > 0 && <span className="flex h-1.5 w-28 gap-px overflow-hidden rounded-full" aria-hidden>
        <i className="bg-won" style={{ flex: points.for }} /><i className="bg-lost" style={{ flex: points.against }} />
      </span>}
      <span className="text-xs text-muted-foreground tabular-nums">{line.each && <><b className="font-medium text-foreground/85">{line.each}</b> a match · </>}{line.total} over {line.over}</span>
      {points.unscored.length > 0 && <ReadScores targets={points.unscored} route="athlete" />}
    </div>
  );
}
// Points scored and conceded over the matches whose score was read, and the events with a match still to read.
interface Points { for: number; against: number; scored: number; total: number; unscored: Target[] }

// The headline: their record as a ring over the finishes switched on, how they win and lose by each finish,
// and where they stand; under it, the scoreboard.
function RecordBand({ fins, f, over, overWhy, career, points, bracket, profile, id }: { fins: Finish[]; f: Filters; over: string; overWhy?: string; career: Athlete | null; points: Points; bracket: Bracket | null | undefined; profile: Profile | null | undefined; id: string }) {
  const on = fins.filter((x) => f.counted(x.key));
  const rated = on.filter((x) => x.l != null);
  const [w, l] = rated.reduce(([a, b], x) => [a + x.w, b + (x.l ?? 0)], [0, 0]);
  const few = w + l < FEW;
  const toggle = (key: string) => {
    const off = new Set(f.off);
    if (off.has(key)) off.delete(key);
    else if (on.length > 1) off.add(key); // one finish always stays counted
    f.set({ off: [...off].join(',') });
  };
  return (
    <Card className="gap-6 p-6">
      <div className="grid items-center gap-x-10 gap-y-8 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex items-center gap-5">
          {w + l ? <>
            <Ring w={w} l={l} few={few} />
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-3xl tracking-tight"><Record w={w} l={l} /></span>
              <span className={cn('text-sm text-muted-foreground', overWhy && 'cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-4')} title={overWhy}>{plural(w + l, 'match')}{over && ` ${over}`}</span>
              {few && <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground/85" title={`Under ${FEW} matches, a win rate says little yet`}>Small sample</span>}
            </div>
          </> : rated.length || !on.length ? <span className="text-muted-foreground">No matches by these finishes</span> : (
            <div className="flex max-w-64 flex-col gap-1">
              <span className="text-5xl font-semibold tracking-tight">{fmt(on.reduce((n, x) => n + x.w, 0))}</span>
              <span className="text-sm text-muted-foreground">wins · losses arrive once someone opens their Smoothcomp profile with Mat Stats</span>
            </div>
          )}
        </div>
        {fins.length > 0 && <div className="lg:border-x lg:px-10"><Finishes fins={fins} f={f} toggle={toggle} last={on.length === 1} /></div>}
        <Standing bracket={bracket} career={career} f={f} profile={profile} id={id} />
      </div>
      {points.total > 0 && <div className="border-t pt-4"><Scoreboard points={points} /></div>}
    </Card>
  );
}

// Each art's highest belt on their Smoothcomp profile, with every event at any of its belts.
function artsOf(p: Profile | null | undefined) {
  const arts = new Map<string, { belt: string; degree: number | null; order: number; events: number }>();
  for (const s of p?.skills ?? []) {
    const was = arts.get(s.name);
    const events = (was?.events ?? 0) + (s.competed ?? 0);
    arts.set(s.name, !was || (s.order ?? 0) > was.order ? { belt: s.belt, degree: s.degree, order: s.order ?? 0, events } : { ...was, events });
  }
  return arts;
}

// A ranking's name as written, unless it is written in capitals ("RANKING GERAL ADULTO"): then in title case.
const tidy = (name: string) => (/\p{Lu}/u.test(name) && name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : name);

// Where they rank on Smoothcomp, as their profile shows it: a federation's ranking opens it.
function OnSmoothcomp({ ranks, more, f, id, first }: { ranks: NonNullable<Profile['rankings']>; more: number; f: Filters; id: string; first: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1.5', !first && 'mt-1 border-t pt-3')}>
      <h3 className="text-xs text-muted-foreground">On Smoothcomp</h3>
      <ul className="flex flex-col gap-0.5">
        {ranks.map((r) => {
          const body = <>
            <b className="w-14 shrink-0 font-semibold tabular-nums">#{fmt(r.placement)}</b>
            <span className="min-w-0 break-words text-muted-foreground">{tidy(r.name)}{r.owner && <span className="text-muted-foreground/80"> · {r.owner}</span>}</span>
          </>;
          return (
            <li key={`${r.toplist}-${r.name}`}>
              {r.type === 'federation' && r.ownerId && r.toplist
                ? <a href={`${f.home}/en/federation/${r.ownerId}/ranking/${r.toplist}`} target="_blank" rel="noopener" className="-mx-1.5 flex items-baseline gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">{body}</a>
                : <div className="flex items-baseline gap-2 py-1 text-sm">{body}</div>}
            </li>
          );
        })}
      </ul>
      {more > ranks.length && <a href={`${f.home}/en/profile/${id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">All {more} rankings on Smoothcomp<ExternalLink className="size-3" /></a>}
    </div>
  );
}

// Who beat them more than once. Furthest behind leads; each opens every match between them.
function Rivals({ rivals, losses, pick, picked }: { rivals: Rival[]; losses: number; pick: (r: Rival | null) => void; picked: string | null }) {
  const behind = Math.max(0, ...rivals.map((r) => r.l - r.w));
  return (
    <Card className="gap-3 px-5 py-4">
      <h2 className="text-sm font-medium">Lost most to</h2>
      {!rivals.length ? <p className="text-sm text-muted-foreground">{losses > 1 ? 'No one has beaten them twice.' : 'No one has beaten them more than once.'}</p> : (
        <ul className="grid gap-x-10 gap-y-1 lg:grid-cols-2">
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

// A best place there as its medal's colour; none in the neutral grey.
const MEDAL = ['var(--color-gold)', 'var(--color-silver)', 'var(--color-bronze)'];
const medalColour = (place: number | null) => (place ? MEDAL[place - 1] : 'var(--color-win-other)');
// Under this many events each gets a tile, not a bar.
const TILES = 6;

// Their past events, oldest first: the medals over them, then W–L at each (a chart, or a tile each when
// there are few), wins up coloured by the best medal there, losses down; their belts run underneath.
function Form({ list, f, career, era, split }: { list: Row[]; f: Filters; career: Athlete | null; era: Map<string, string>; split: Split[] | null }) {
  const points = list.filter((r) => r.outcome || r.read?.some((e) => e.fought) || r.listed?.wins != null).reverse().map((r) => {
    const fin = r.outcome && Object.entries(r.outcome.out.types).reduce(([a, b], [t, [w, l]]) => (f.counted(finishOf(t)) ? [a + w, b + l] : [a, b]), [0, 0]);
    const read = r.read?.filter((e) => e.fought) ?? [];
    const best = Math.min(...read.map((e) => e.place ?? 99));
    return {
      name: r.title ?? '', date: date(r.start), start: r.start ? Date.parse(r.start) : NaN, year: r.start ? String(new Date(r.start).getFullYear()) : '', belt: era.get(at({ site: r.site, event: r.id })),
      wins: fin ? fin[0] : read.length ? read.reduce((n, e) => n + winsOf(e.wins, f.counted), 0) : r.listed!.wins!,
      losses: fin ? -fin[1] : -read.reduce((n, e) => n + winsOf(e.losses, f.counted), 0),
      place: r.listed?.gold || best === 1 ? 1 : r.listed?.silver || best === 2 ? 2 : r.listed?.bronze || best === 3 ? 3 : null,
    };
  }).map((p, i, all) => ({ ...p, tick: p.year && p.year !== all[i - 1]?.year ? p.year : '' })); // the year under its first event
  const medals = career ? [career.gold, career.silver, career.bronze].map(Number) : [1, 2, 3].map((n) => points.filter((p) => p.place === n).length);
  if (!points.length && !medals.some(Boolean)) return null;
  const podium = points.filter((p) => p.place).length;
  // The last 12 months on their own, where some of their events are older.
  const lately = points.filter((p) => p.start >= Date.now() - 365 * 864e5);
  const recent = lately.length && lately.length < points.length ? lately.reduce(([w, l], p) => [w + p.wins, l - p.losses], [0, 0]) : null;
  const lost = points.some((p) => p.losses);
  // Each run of events at one belt, an undated event staying in the run before it.
  const eras = split && points.reduce<Era[]>((runs, p) => {
    const belt = p.belt ?? runs.at(-1)?.belt ?? split.at(-1)!.belt;
    if (runs.at(-1)?.belt === belt) runs.at(-1)!.n++; else runs.push({ belt, n: 1 });
    return runs;
  }, []);
  const tiles = points.length < TILES;
  return (
    <Card className="min-w-0 gap-5 p-6">
      <h2 className="sr-only">Medals and results per event</h2>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
          <ul className="flex items-baseline gap-6" title={career && career.source !== 'results' ? 'Medals as Smoothcomp lists them' : 'Medals at the events Mat Stats read'}>
            {(['gold', 'silver', 'bronze'] as const).map((k, i) => (
              <li key={k} className="inline-flex items-baseline gap-2">
                <i className={cn('size-2.5 self-center rounded-full', !medals[i] && 'opacity-35')} style={{ background: MEDAL[i] }} />
                <b className={cn('text-2xl font-semibold tracking-tight tabular-nums', !medals[i] && 'text-muted-foreground')} style={medals[i] ? { color: MEDAL[i] } : undefined}>{fmt(medals[i])}</b>
                <span className="text-sm text-muted-foreground">{k}</span>
              </li>
            ))}
          </ul>
          {points.length > 0 && <span className="text-sm text-muted-foreground">on the podium at <b className="font-semibold text-foreground">{podium}</b> of {plural(points.length, 'event')}</span>}
          {recent && <span className="text-sm text-muted-foreground" title="Their record at the events of the last 12 months">last 12 months <Record w={recent[0]} l={recent[1]} /></span>}
        </div>
        {!tiles && <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Bar colour: the best medal won there">
          {[['var(--color-win-other)', 'No medal'], ...(lost ? [['color-mix(in oklch, var(--color-lost) 70%, transparent)', 'Lost']] : [])].map(([bg, label]) => <li key={label} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-sm" style={{ background: bg }} />{label}</li>)}
        </ul>}
      </div>
      {points.length > 0 && (tiles ? <Tiles points={points} /> : (
        <div className="h-52 w-full [&_.recharts-surface:focus:not(:focus-visible)]:outline-none">
          <ResponsiveContainer>
            <BarChart data={points} stackOffset="sign" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="tick" interval={0} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis width={32} allowDecimals={false} tickFormatter={(v) => String(Math.abs(v))} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke="oklch(1 0 0 / 12%)" />
              <Tooltip cursor={{ fill: 'oklch(1 0 0 / 5%)', stroke: 'none' }} isAnimationActive={false} content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as (typeof points)[number] | undefined;
                return p && (
                  <div className="flex min-w-40 flex-col gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    <div><p className="font-medium">{p.name}</p><p className="text-muted-foreground">{p.date}</p></div>
                    <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 tabular-nums">
                      {([['Won', p.wins, medalColour(p.place)], ...(lost ? [['Lost', -p.losses, 'color-mix(in oklch, var(--color-lost) 70%, transparent)']] : [])] as const).map(([label, n, bg]) => (
                        <Fragment key={label}><i className="size-2 rounded-sm" style={{ background: bg }} /><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{n}</dd></Fragment>
                      ))}
                    </dl>
                  </div>
                );
              }} />
              <Bar dataKey="wins" stackId="r" maxBarSize={28} radius={[3, 3, 0, 0]}>{points.map((p, i) => <Cell key={i} fill={medalColour(p.place)} />)}</Bar>
              {lost && <Bar dataKey="losses" stackId="r" maxBarSize={28} radius={[0, 0, 3, 3]} fill="var(--color-lost)" fillOpacity={0.7} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}
      {/* The chart's bars start after its 32px axis; tiles fill the width. */}
      {eras && split && <div className={tiles ? undefined : 'pl-8'}><Eras eras={eras} split={split} /></div>}
    </Card>
  );
}

// A few events, a tile each: the date and name, the best place, the record, and a pip a match.
function Tiles({ points }: { points: { name: string; date: string; wins: number; losses: number; place: number | null }[] }) {
  return (
    <ol className="grid max-sm:divide-y sm:grid-cols-[repeat(var(--n),minmax(0,1fr))] sm:divide-x" style={{ '--n': points.length } as React.CSSProperties}>
      {points.map((p, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-2.5 max-sm:py-5 max-sm:first:pt-0 max-sm:last:pb-0 sm:px-6 sm:first:pl-0 sm:last:pr-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{p.date}</span>
            <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Place p={p.place} />
            <span className="text-lg"><Record w={p.wins} l={-p.losses} /></span>
          </div>
          <span className="flex flex-wrap gap-1" role="img" aria-label={`${plural(p.wins, 'win')}, ${-p.losses} lost`}>
            {Array.from({ length: p.wins }, (_, k) => <i key={`w${k}`} className="size-2.5 rounded-[2px]" style={{ background: medalColour(p.place) }} />)}
            {Array.from({ length: -p.losses }, (_, k) => <i key={`l${k}`} className="size-2.5 rounded-[2px] bg-lost/70" />)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The belt they competed at, beside a division; a blank of the same width where none is named.
const AtBelt = ({ belt }: { belt: string | null }) => (belt
  ? <span className="mt-[5px] inline-flex" title={`${belt[0].toUpperCase()}${belt.slice(1)} belt at the time`}><Belt belt={belt} /></span>
  : <span className="w-[22px] shrink-0" aria-hidden />);

// Knockout rounds read as a chip, tinted by the medal the match decided; pool numbering ("Match 2/14") stays plain.
function Stage({ m }: { m: Meeting }) {
  const s = m.stage!;
  const chip = /^final/i.test(s) ? ['Final', m.won ? 'bg-gold/15 text-gold' : 'bg-silver/15 text-silver']
    : /bronze/i.test(s) ? ['Bronze match', m.won ? 'bg-bronze/15 text-bronze' : 'bg-muted text-foreground/85']
    : /^semi/i.test(s) ? ['Semifinal', 'bg-muted text-foreground/85']
    : /^quarter/i.test(s) ? ['Quarterfinal', 'bg-muted text-foreground/85'] : null;
  return chip ? <span className={cn('rounded px-1.5 py-px font-medium', chip[1])}>{chip[0]}</span> : <span>{m.type ? '· ' : ''}{s}</span>;
}

// A match the record leaves out (walkovers, or a finish switched off) is dimmed, its result uncoloured.
export function MatchLine({ m, f, divisions }: { m: Meeting; f: Filters; divisions: boolean }) {
  const off = !!m.type && !f.counted(finishOf(m.type));
  return (
    <li className={cn('flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sm', off && 'opacity-50')} title={off ? 'Not counted in the record' : undefined}>
      <Photo name={m.opponent} photo={m.image} className="size-6" />
      <span className={cn('shrink-0 text-xs font-semibold', off ? 'text-muted-foreground' : m.won ? 'text-won' : 'text-lost')}>{m.won ? 'Beat' : 'Lost to'}</span>
      <span className="min-w-0 grow basis-32 break-words">{m.user ? <Link href={f.linkOn(`/athlete/${m.user}`, m.site ?? f.site)} className="font-medium hover:text-primary">{m.opponent ?? 'Unknown opponent'}</Link> : <span className="font-medium">{m.opponent ?? 'Unknown opponent'}</span>}{m.club && <span className="text-muted-foreground"> · {m.club}</span>}</span>
      <span className="ml-auto flex max-w-[55%] flex-wrap items-center justify-end gap-x-1.5 pl-3 text-right text-xs text-muted-foreground">
        {m.type && <><i className="size-2 rounded-full" style={{ background: dot(m.type) }} /><span className="text-foreground/85">{m.how || typeName(m.type)}</span></>}
        {scoreOf(m) && <span className="tabular-nums">· {scoreOf(m)}</span>}
        {m.stage && <Stage m={m} />}
        {divisions && m.division && <span>· {m.division}</span>}
      </span>
    </li>
  );
}

// The year an event began, '' where undated.
const yearOf = (r: Row | undefined) => (r?.start ? String(new Date(r.start).getFullYear()) : '');

// A division's club shows only where it isn't their own.
function EventsTable({ list, f, against, show, club, years }: { list: Row[]; f: Filters; against: Rival | null; show: Show; club: string | null; years: boolean }) {
  // Phones drop the date and division columns, so the match list spans event, place and record.
  const phone = !useMedia('(width >= 40rem)');
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="table-fixed">
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-28 pl-5 max-sm:hidden">Date</TableHead><TableHead className="max-sm:pl-3 sm:w-[30%]">Event</TableHead><TableHead className="max-sm:hidden">Division</TableHead>
          <TableHead className="w-20 text-right sm:w-36">Place<span className="max-sm:hidden"> or medals</span></TableHead><TableHead className="w-16 pr-3 text-right sm:w-24 sm:pr-5">Record</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {list.map((row, i) => {
            const year = yearOf(row);
            const head = years && year !== yearOf(list[i - 1]) && (
              <TableRow key={`y${year}`} id={`year-${year || 'undated'}`} className="scroll-mt-20 bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={5} className="py-2 pl-5 max-sm:pl-3">
                  <span className="font-semibold">{year || 'Undated'}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{plural(list.filter((r) => yearOf(r) === year).length, 'event')}</span>
                </TableCell>
              </TableRow>
            );
            const read = row.read?.filter((e) => e.fought) ?? [];
            const all = meetingsOfRow(row);
            const shown = all.filter((m) => (!against || normalize(m.opponent) === against.key) && (show === 'all' || m.won === (show === 'won')));
            // Divisions read from the results, else the ones the match lists name.
            const named = [...new Set(all.map((m) => m.division).filter(Boolean))] as string[];
            const divisions: (Entry | string[])[] = row.read?.length ? row.read : [named];
            const span = Math.max(divisions.length, 1);
            // Each division's matches sit under its own row; matches naming none of them go under the last.
            const names = divisions.map((d) => (Array.isArray(d) ? null : normalize(d.division)));
            const under = Map.groupBy(shown, (m) => { const i = span > 1 ? names.indexOf(normalize(m.division)) : 0; return i < 0 ? span - 1 : i; });
            const fin = row.outcome && Object.entries(row.outcome.out.types).reduce(([a, b], [t, [w, l]]) => (f.counted(finishOf(t)) ? [a + w, b + l] : [a, b]), [0, 0]);
            return [head, ...Array.from({ length: span }, (_, k) => {
                const d = divisions[k];
                const e = d && !Array.isArray(d) ? d : undefined;
                const division = e
                  ? <><span className="flex items-start gap-2"><AtBelt belt={beltOf(e.division) ?? beltAt([...(row.read ?? []).map((x) => x.division), ...named])} /><DivisionLink event={row.id} name={e.division} f={f} site={row.site} /></span>{e.club && normalize(e.club) !== normalize(club) && <span className="block pl-[30px] text-xs">{e.club}</span>}</>
                  : Array.isArray(d) ? d.map((x) => <span key={x} className="flex items-start gap-2"><AtBelt belt={beltOf(x) ?? beltAt(d)} />{x}</span>) : '';
                const ms = under.get(k) ?? [];
                return [
                  <TableRow key={`${row.id}-${k}`} className={cn((k < span - 1 || ms.length) && 'border-b-0', 'hover:bg-transparent')}>
                    <TableCell className="pl-5 align-top text-muted-foreground max-sm:hidden">{k ? '' : date(row.start)}</TableCell>
                    <TableCell className="align-top whitespace-normal max-sm:pl-3">{k ? '' : <div className="flex items-start gap-3">{row.listed?.image && <img src={row.listed.image} alt="" loading="lazy" className="mt-0.5 hidden aspect-[16/9] w-16 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10 lg:block" />}<div className="flex min-w-0 flex-col gap-0.5"><EventLink row={row} f={f} />{row.city && <span className="text-xs text-muted-foreground">{row.city}</span>}<span className="text-xs text-muted-foreground sm:hidden">{date(row.start)}</span></div></div>}
                      {division && <div className={cn('text-muted-foreground sm:hidden', !k && 'mt-2')}>{division}</div>}</TableCell>
                    <TableCell className="align-top whitespace-normal text-muted-foreground max-sm:hidden">{division}</TableCell>
                    <TableCell className="text-right align-top">
                      {e?.fought ? <Place p={e.place} /> : !k && row.listed && (row.listed.gold || row.listed.silver || row.listed.bronze) && !read.length
                        ? <Medals g={row.listed.gold} s={row.listed.silver} b={row.listed.bronze} className="flex-wrap" /> : e && !e.fought ? <span className="text-xs text-muted-foreground">Entered</span> : <span className="text-muted-foreground">{k ? '' : '–'}</span>}
                    </TableCell>
                    <TableCell className="pr-3 text-right align-top sm:pr-5">
                      {e?.fought ? <Record w={winsOf(e.wins, f.counted)} l={winsOf(e.losses, f.counted)} />
                        : !k && fin && !read.length ? <Record w={fin[0]} l={fin[1]} />
                        : !k && row.listed?.wins != null && !read.length ? <span><b className="font-semibold">{row.listed.wins}</b> <span className="text-xs text-muted-foreground">{row.listed.wins === 1 ? 'win' : 'wins'}</span></span> : ''}
                    </TableCell>
                  </TableRow>,
                  ms.length > 0 && (
                    <TableRow key={`${row.id}-m${k}`} className={cn(k < span - 1 && 'border-b-0', 'hover:bg-transparent')}>
                      <TableCell className="max-sm:hidden" />
                      <TableCell colSpan={phone ? 3 : 4} className="pt-0 pr-3 pb-3 whitespace-normal max-sm:pl-3 sm:pr-5">
                        <ul className="flex flex-col gap-1.5 border-t border-dashed border-border pt-2.5">
                          {ms.map((m, i) => <MatchLine key={i} m={m} f={f} divisions={span === 1 && named.length > 1} />)}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })];
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
          {row.read?.length ? <ul className="flex flex-col gap-1 text-sm text-muted-foreground">{row.read.map((e) => <li key={e.division} className={e.approved === 0 ? 'opacity-60' : undefined}>{e.division}{e.approved === 0 && ' · not approved'}</li>)}</ul>
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
  const [unapproved, setUnapproved] = useState(false);
  const { data, isLoading, error, isPlaceholderData } = useApi<Data>('athlete', { site: f.site, off: f.query.off, active: f.query.active, id }, true, 0);
  // Opened here, so search offers it again first.
  const name = !isPlaceholderData && (data?.person?.name ?? data?.career?.name);
  useRemember(name ? { site: f.site, kind: 'athlete', id, name, sub: data?.person?.club ?? data?.career?.club ?? null, photo: data?.person?.photo ?? data?.career?.photo ?? null } : null);
  if (isLoading) return <div className="flex items-center gap-5"><Skeleton className="size-20 rounded-full" /><Skeleton className="h-8 w-64" /></div>;
  if (!data) return <Empty title={(error as { status?: number })?.status === 404 ? 'No athlete here' : 'That didn’t load'} text={(error as { status?: number })?.status === 404 ? 'Mat Stats has nothing under this athlete on this site. They may be on the other site, or nobody has read them yet.' : 'The stats server didn’t answer. Try again in a moment.'} />;
  const { career, person: who, accounts = [] } = data;
  // An event they didn't show at (rules.js showed: walkovers alone, or listed with no match there and no results saying they fought) is left out whole.
  const held = Map.groupBy(data.entries, at), outcomeAt = new Map((data.outcomes ?? []).map((o) => [at(o), o]));
  const skip = new Set([...held.keys(), ...outcomeAt.keys()].filter((k) => !showed(held.get(k) ?? [], outcomeAt.get(k))));
  const [entries, history, outcomes] = [data.entries.filter((e) => !skip.has(at(e))), data.history.filter((h) => !skip.has(at(h))), (data.outcomes ?? []).filter((o) => !skip.has(at(o)))];
  const a = { ...(who ?? {}), ...(career ?? {}), name: who?.name ?? career?.name ?? null, born: who?.born ?? career?.born ?? null } as Athlete & { hidden: number | null };
  // With no belt read for them, the highest one their divisions name.
  a.belt ??= (BELTS.findLast((b) => entries.some((e) => beltOf(e.division) === b)) ?? null) as Athlete["belt"];
  document.title = `${a.name ?? `Athlete ${id}`} · Mat Stats`;
  const all = rows(entries, history, outcomes);
  const upcoming = all.filter((r) => isUpcoming(r.start) && !r.read?.some((e) => e.fought));
  const past = all.filter((r) => !upcoming.includes(r));
  // Registrations the organiser hasn't approved yet (participants.js reads it) wait behind a toggle; an event with only those goes with them.
  const waiting = upcoming.flatMap((r) => r.read?.filter((e) => e.approved === 0) ?? []).length;
  const listed = unapproved ? upcoming : upcoming.flatMap((r) => { const read = r.read?.filter((e) => e.approved !== 0); return read?.length === 0 ? [] : [{ ...r, read }]; });
  // An event begun in the last 30 days with no results read yet: their last three of the month are read on asking (read-now.tsx).
  const month = all.filter((r) => r.start && Date.parse(r.start) <= Date.now() && Date.parse(r.start) >= Date.now() - 30 * 864e5);
  const lately = month.some((r) => !r.read?.some((e) => e.fought));
  // Their events with a match read but not its score, each with the divisions that have one.
  const unscored = past.flatMap((r) => {
    const open = (r.read ?? []).filter((e) => e.bouts?.some(needsScore));
    return open.length ? [{ site: r.site ?? f.site, event: r.id, entries: open.map((e) => ({ ...e, name: a.name })) }] : [];
  });
  const counted = past.flatMap((r) => (r.read ?? []).flatMap((e) => e.bouts ?? [])).filter((b) => b.type !== 'walkover' && f.counted(finishOf(b.type)));
  const scored = counted.filter((b) => b.us && b.them);
  // Out of the matches with a score read or still to read: a stoppage's is never read (rules.js SCORELESS).
  const points: Points = { for: scored.reduce((n, b) => n + b.us![0], 0), against: scored.reduce((n, b) => n + b.them![0], 0), scored: scored.length, total: counted.filter((b) => b.us || needsScore(b)).length, unscored };
  const age = ageOf(a.born);
  const rivals = rivalsIn(all.filter((r) => !isUpcoming(r.start) || r.read?.some((e) => e.fought)));
  const met = past.flatMap(meetingsOfRow);
  const losses = met.filter((m) => !m.won).length;
  const pick = (r: Rival | null) => { setAgainst(r); if (r) document.getElementById('events')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const matches = met.filter((m) => (against ? normalize(m.opponent) === against.key && !walkover(m) : countedMatch(m, f)));
  const won = matches.filter((m) => m.won).length;
  // Won or lost alone lists just those matches, event by event; all keeps every event. The lists keep the
  // finish types switched off too: only the counts and records leave them out.
  const shownPast = past.filter((r) => (show === 'all' && !against) || meetingsOfRow(r).some((m) => (!against || normalize(m.opponent) === against.key) && (show === 'all' || m.won === (show === 'won'))));
  const arts = artsOf(data.profile);
  const years = [...new Set(shownPast.map(yearOf))];
  // Events by site and number, as rows() keys them.
  const records = eventRecords(outcomes.map((o) => ({ ...o, event: at(o) })), entries.map((e) => ({ ...e, event: at(e) })));
  const era = beltsAt(data.belts, records);
  const division = usualDivision(records);
  // A class in pounds reads as the kg class it falls in, as their bracket names it.
  const cls = /lbs$/.test(division.weight ?? '') ? bracketOf({ weight: division.weight }).weight : null;
  const kg = cls ? weightName(cls) : division.weight;
  const usual = [division.age, kg].filter(Boolean).join(' · ');
  const fought = past.filter((r) => r.outcome || r.read?.some((e) => e.fought) || r.listed?.wins != null).length;
  const over = !records.length ? '' : records.length < fought ? `across ${records.length} of ${plural(fought, 'event')}` : outcomes.length ? `across ${plural(records.length, 'event')}` : `at ${plural(records.length, 'event')} read`;
  const overWhy = records.length && records.length < fought ? `At the other ${plural(fought - records.length, 'event')} no match was read, only the wins Smoothcomp lists there, so the record leaves them out` : undefined;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-5">
        <Photo name={a.name} photo={a.photo} className="size-20 text-lg" />
        {/* basis-60 sends the buttons to their own row before the details get squeezed. */}
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{a.name ?? `Athlete ${id}`}</h1>
          {(arts.size > 0 || a.belt) && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {arts.size ? [...arts].map(([art, s]) => (
              <span key={art} className="inline-flex items-center gap-2.5" title={`${art}: ${plural(s.events, 'event')} on Smoothcomp`}>
                <BeltBar belt={s.belt.toLowerCase().replace('gray', 'grey')} degree={s.degree} /><span>{s.belt} belt{s.degree ? `, ${plural(s.degree, 'degree')}` : ''}{arts.size > 1 ? ` · ${art}` : ''}</span>
              </span>
            )) : a.belt && <span className="inline-flex items-center gap-2.5"><BeltBar belt={a.belt} degree={null} /><span>{capital(a.belt)} belt</span></span>}
          </div>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {(a.country || a.country_name) && <span className="inline-flex items-center gap-1.5"><Flag code={a.country} name={a.country_name} />{a.country_name ?? a.country?.toUpperCase()}</span>}
            {age != null && <span>{age} years old</span>}
            {a.club && (a.club_id ? <Link href={f.link(`/academy/${a.club_id}`)} className="text-foreground hover:text-primary">{a.club}</Link> : <span>{a.club}</span>)}
            {!data.profile?.affiliations?.length && who?.affiliation && <span title="Affiliation">{who.affiliation}</span>}
            {data.profile?.affiliations?.map((c) => c.id ? <a key={c.id} href={`${f.home}/en/affiliation/${c.id}`} target="_blank" rel="noopener" title="Affiliation" className="hover:text-foreground">{c.name}</a> : <span key={c.name} title="Affiliation">{c.name}</span>)}
            {usual && <Popover>
              <PopoverTrigger openOnHover className="cursor-help rounded-sm underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Usually {usual}</PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-64 text-xs text-muted-foreground">The age group and weight class they entered most in the year up to their latest event{kg !== division.weight ? ` (entered as ${division.weight})` : ''}.</PopoverContent>
            </Popover>}
            {a.hidden === 1 && <span className="inline-flex items-center gap-1.5 text-foreground/85" title={HIDDEN}><Hidden className="text-foreground/70" />Hidden profile</span>}
          </div>
          {accounts.length > 0 && <p className="text-sm text-muted-foreground" title="Accounts with the same name, birth year and country, counted here as one athlete">
            Also {accounts.map((x, i) => <Fragment key={`${x.site} ${x.user}`}>{i ? ', ' : ''}<Link href={f.linkOn(`/athlete/${x.user}`, x.site)} className="text-foreground hover:text-primary">{x.site === f.site ? `another ${SITE_NAME(x.site)} account` : `on ${SITE_NAME(x.site)}`}</Link>{x.club && x.club !== a.club ? ` (${x.club})` : ''}</Fragment>)}: counted here as one athlete
          </p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {lately && <ReadNow targets={month.slice(0, 3).map((r) => ({ site: r.site ?? f.site, event: r.id, title: r.title, start: r.start, city: r.city }))} route="athlete" label="Read latest events" size="lg" />}
          {(data.profile?.videos ?? 0) > 0 && <a href={`${f.home}/en/profile/${id}`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{plural(data.profile!.videos!, 'match video')}<ExternalLink /></a>}
          <a href={`${f.home}/en/profile/${id}`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'outline', size: 'lg' })}>Profile on {SITE_NAME(f.site)}<ExternalLink /></a>
        </div>
      </header>

      {career || outcomes.length ? <RecordBand fins={finishes(career, records)} f={f} over={over} overWhy={overWhy} career={career} points={points} bracket={data.bracket} profile={data.profile} id={id} />
        : <Card className="px-5 py-4 text-sm text-muted-foreground">No career or results read yet. They arrive when someone with Mat Stats opens an event this athlete is in.</Card>}

      <Form list={past} f={f} career={career} era={era} split={splitByBelt(data.belts, records, f, era)} />

      {met.length > 0 && <Rivals rivals={rivals} losses={losses} pick={pick} picked={against?.key ?? null} />}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Upcoming</h2>
            {waiting > 0 && (
              <button type="button" aria-pressed={unapproved} onClick={() => setUnapproved(!unapproved)}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-input px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/15 aria-pressed:text-foreground">
                Not approved<b className="font-semibold text-foreground">{waiting}</b>
              </button>
            )}
          </div>
          {listed.length > 0 ? <Upcoming list={listed} f={f} /> : <p className="text-sm text-muted-foreground">Only registrations the organiser hasn’t approved yet.</p>}
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
          {years.length > 1 && <nav aria-label="Jump to a year" className="flex flex-wrap gap-0.5 text-sm">
            {years.map((y) => <button key={y} type="button" onClick={() => document.getElementById(`year-${y || 'undated'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="rounded-md px-1.5 py-0.5 text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{y || 'Undated'}</button>)}
          </nav>}
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
        {shownPast.length ? <EventsTable list={shownPast} f={f} against={against} show={show} club={a.club ?? null} years={years.length > 1} /> : <Card><Empty title="No past events seen yet" text="They appear once someone with Mat Stats reads this athlete's career or an event they entered." /></Card>}
      </section>
    </div>
  );
}
