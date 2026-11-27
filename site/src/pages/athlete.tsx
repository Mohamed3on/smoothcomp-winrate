import { Fragment, useState } from 'react';
import { Link } from 'wouter';
import { ExternalLink, X } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toggle } from '@/components/ui/toggle';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Empty } from '@/components/empty';
import { BELT_COLOUR, Belt, HIDDEN, Hidden, Flag, Medals, Photo, Place, Record } from '@/components/stats';
import { useApi, type Athlete, type Bout, type Entry, type Outcome, type Past, type Profile } from '@/lib/api';
import { useFilters, type Filters } from '@/lib/filters';
import { ageOf, beltAt, date, fmt, isUpcoming, plural, typeName, winsOf } from '@/lib/format';
import { BELTS, beltOf, beltsIn, beltSplit, eventRecords, finishOf, matchFinder, normalize, showed, rivalsOf, roundOf, totals, usualDivision, weightName } from '@/lib/rules';
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
interface Bracket { sex: string | null; age: string; weight: number; belt: string | null; rank: number; of: number }
interface Data { bracket?: Bracket | null; career: Athlete | null; person: (Partial<Athlete> & { hidden: number | null }) | null; entries: Entry[]; history: Past[]; outcomes?: Outcome[]; belts?: Belts | null; profile?: Profile | null; accounts?: Account[] }
const SITE_NAME = (site: string) => (site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp');

// Every finish is counted under its group (rules.js): an older match list's "escape" is a fastest escape.
const dot = (t: string) => `var(--color-win-${finishOf(t)}, var(--color-win-other))`;
const pct = (w: number, l: number) => `${Math.round((w / (w + l)) * 100)}%`;
// A rate's hue runs from red at 40% or under, through amber, to green at 85% and over, as on the profile.
const tone = (w: number, l: number) => ({ color: `oklch(0.8 0.14 ${25 + 120 * Math.min(1, Math.max(0, (w / (w + l) - 0.4) / 0.45))})` });

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
const rivalsIn = (rows: Row[]): Rival[] => rivalsOf(rows.flatMap(meetingsOfRow).filter((m) => !walkover(m)).map((m) => ({ name: m.opponent ?? '', won: m.won, club: m.club, image: m.image })));

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
    : <a href={`https://${row.site ?? f.site}/en/event/${row.id}`} rel="noopener" className="inline-flex items-center gap-1 font-medium hover:text-primary">{title}<ExternalLink className="size-3 shrink-0 text-muted-foreground" /></a>;
}

// When each belt began (null for the first), as their profile dates them.
interface Belts { worn: string[]; starts: (number | null)[] }
// The win rate at each belt worn, highest first, as their profile splits it: an event takes the
// belt worn on its date; undated ones count only overall. The current belt shows even with no events.
interface Split { belt: string; w: number; l: number; events: number }
// Without their profile's belt timeline, each event counts at the belt its divisions name; one naming
// none takes the belt of their latest earlier event that does (or the first one after). One naming
// several ("Brown/Black") takes the lowest of them at or above that belt.
function splitByDivision(records: Records, f: Filters): Split[] | null {
  const named = records.map((r) => r.divisions.map(beltOf).find(Boolean) ?? null);
  let last = named.find(Boolean) ?? null;
  const by = new Map<string, Split>();
  records.forEach((r, i) => {
    const floor = last ? BELTS.indexOf(last) : -1;
    last = named[i] ?? r.divisions.flatMap(beltsIn).find((b) => BELTS.indexOf(b) >= floor) ?? last;
    if (!last) return;
    const t = by.get(last) ?? { belt: last, w: 0, l: 0, events: 0 };
    by.set(last, t);
    const [w, l] = recordIn(r.types, f);
    t.w += w; t.l += l; t.events++;
  });
  if (by.size < 2) return null;
  return [...by.values()].sort((x, y) => BELTS.indexOf(y.belt) - BELTS.indexOf(x.belt));
}

function splitByBelt(belts: Belts | null | undefined, records: Records, f: Filters): Split[] | null {
  if (!belts) return splitByDivision(records, f);
  if (belts.worn.length < 2) return null;
  return beltSplit(records, belts.worn, belts.starts).map(({ belt, types, events }) => {
    const [w, l] = recordIn(types, f);
    return { belt, w, l, events };
  });
}

function BeltSplit({ split }: { split: Split[] }) {
  return (
    <ul className="flex w-full max-w-md flex-col gap-2 lg:w-md lg:shrink-0" aria-label="Win rate at each belt">
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

// Their career as Smoothcomp lists it (or their results at the events read, where it serves none).
function CareerStats({ career, f, points }: { career: Athlete | null; f: Filters; points: Points }) {
  const fromResults = career?.source === 'results';
  const stats: [string, React.ReactNode][] = career ? [
    ['Medals', <Medals g={career.gold} s={career.silver} b={career.bronze} className="justify-start" />],
    ...(career.events != null ? [[fromResults ? 'Events read' : 'Events', career.events] as [string, React.ReactNode]] : []),
    ['Wins', career.wins],
    ...(career.events ? [['Wins per event', (career.wins / career.events).toFixed(1)] as [string, React.ReactNode]] : []),
    ...(career.wins > 0 && f.counted('submission') ? [['By submission', `${Math.round((career.submission / career.wins) * 100)}%`] as [string, React.ReactNode]] : []),
  ] : [];
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-4 border-t pt-4">
      {stats.length > 0 && <dl className="flex flex-wrap gap-x-10 gap-y-3" title={fromResults ? 'Smoothcomp serves no career for this athlete, so these are their results at the events Mat Stats has read' : `Career as Smoothcomp lists it${career?.at ? `, read ${date(new Date(career.at).toISOString())}` : ''}`}>
        {stats.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
      </dl>}
      {points.total > 0 && <dl className="flex items-center gap-x-6 gap-y-3 border-border sm:border-l sm:pl-10" title="Points on the scoreboard, theirs and their opponents', in the matches whose score was read, over the finishes counted; walkovers and stoppages have none">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Points</dt>
          <dd className="text-lg tabular-nums"><Record w={points.for} l={points.against} /></dd>
          <dd className="text-xs text-muted-foreground tabular-nums">
            {points.scored > 0 && <><span className="font-medium text-foreground/85">{diff(Math.round(((points.for - points.against) / points.scored) * 10) / 10)}</span> a match · </>}{diff(points.for - points.against)} over{points.scored === points.total ? plural(points.total, 'match') : `${fmt(points.scored)} of ${plural(points.total, 'match')}`}
          </dd>
        </div>
        {points.unscored.length > 0 && <ReadScores targets={points.unscored} route="athlete" />}
      </dl>}
    </div>
  );
}
const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    <dt className="order-first text-xs text-muted-foreground">{label}</dt>
  </div>
);
// A point differential, signed: +174, −12, ±0.
const diff = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
// Points scored and conceded over the matches whose score was read, and the events with a match still to read.
interface Points { for: number; against: number; scored: number; total: number; unscored: Target[] }

// The headline: the win rate over the finishes switched on, and those switches, each with its W–L.
function RecordBand({ fins, f, over, split, career, points }: { fins: Finish[]; f: Filters; over: string; split: Split[] | null; career: Athlete | null; points: Points }) {
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
    <Card className="gap-5 px-5 py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
      <div className="flex min-w-0 flex-col gap-4">
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
      </div>
      {split && <BeltSplit split={split} />}
      </div>
      {(career || points.total > 0) && <CareerStats career={career} f={f} points={points} />}
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

// Where they rank, as their Smoothcomp profile shows it.
function OnProfile({ p, f, id }: { p: Profile; f: Filters; id: string }) {
  const ranks = p.rankings ?? [];
  if (!ranks.length) return null;
  const profile = `${f.home}/en/profile/${id}`;
  return (
    <Card className="gap-2 px-5 py-4">
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
    const fin = r.outcome && Object.entries(r.outcome.out.types).reduce(([a, b], [t, [w, l]]) => (f.counted(finishOf(t)) ? [a + w, b + l] : [a, b]), [0, 0]);
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
      <div className="h-52 w-full [&_.recharts-surface:focus:not(:focus-visible)]:outline-none">
        <ResponsiveContainer>
          <BarChart data={points} stackOffset="sign" margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
            <XAxis dataKey="tick" interval="preserveStartEnd" minTickGap={8} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tickFormatter={(v) => String(Math.abs(v))} tick={{ fill: 'oklch(0.7 0.01 255)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke="oklch(1 0 0 / 12%)" />
            <Tooltip cursor={{ fill: 'oklch(1 0 0 / 5%)', stroke: 'none' }} isAnimationActive={false} content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as (typeof points)[number] | undefined;
              return p && (
                <div className="flex min-w-40 flex-col gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div><p className="font-medium">{p.name}</p><p className="text-muted-foreground">{p.date}</p></div>
                  <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 tabular-nums">
                    {([['Won', p.wins, p.medal], ...(lost ? [['Lost', -p.losses, 'color-mix(in oklch, var(--color-lost) 70%, transparent)']] : [])] as const).map(([label, n, bg]) => (
                      <Fragment key={label}><i className="size-2 rounded-sm" style={{ background: bg }} /><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{n}</dd></Fragment>
                    ))}
                  </dl>
                </div>
              );
            }} />
            <Bar dataKey="wins" stackId="r" maxBarSize={28} radius={[3, 3, 0, 0]}>{points.map((p, i) => <Cell key={i} fill={p.medal} />)}</Bar>
            {lost && <Bar dataKey="losses" stackId="r" maxBarSize={28} radius={[0, 0, 3, 3]} fill="var(--color-lost)" fillOpacity={0.7} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
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

// A division's club shows only where it isn't their own.
function EventsTable({ list, f, against, show, club }: { list: Row[]; f: Filters; against: Rival | null; show: Show; club: string | null }) {
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
          {list.map((row) => {
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
            return Array.from({ length: span }, (_, k) => {
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

export function AthletePage({ id }: { id: string }) {
  const f = useFilters();
  const [against, setAgainst] = useState<Rival | null>(null);
  const [show, setShow] = useState<Show>('all');
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
  const side = data.profile ? OnProfile({ p: data.profile, f, id }) : null;
  const arts = artsOf(data.profile);
  // Events by site and number, as rows() keys them.
  const records = eventRecords(outcomes.map((o) => ({ ...o, event: at(o) })), entries.map((e) => ({ ...e, event: at(e) })));
  const usual = [usualDivision(records)].map((u) => [u.age, u.weight].filter(Boolean).join(' · '))[0];
  const over = !records.length ? '' : outcomes.length ? `across ${plural(records.length, 'event')}` : `at ${plural(records.length, 'event')} read`;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-5">
        <Photo name={a.name} photo={a.photo} className="size-20 text-lg" />
        {/* basis-60 sends the buttons to their own row before the details get squeezed. */}
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{a.name ?? `Athlete ${id}`}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {(a.country || a.country_name) && <span className="inline-flex items-center gap-1.5"><Flag code={a.country} name={a.country_name} />{a.country_name ?? a.country?.toUpperCase()}</span>}
            {age != null && <span>{age} years old</span>}
            {usual && <Popover>
              <PopoverTrigger openOnHover className="cursor-help rounded-sm underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Usually {usual}</PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-64 text-xs text-muted-foreground">The age group and weight class they entered most in the year up to their latest event.</PopoverContent>
            </Popover>}
            {data.bracket && <Link href={f.link(`/athletes?${new URLSearchParams({ ...(data.bracket.sex && { sex: data.bracket.sex }), age: data.bracket.age, weight: String(data.bracket.weight), ...(data.bracket.belt && { belt: data.bracket.belt }) })}`)}
              title="Their place by wins among the athletes in their age group, weight class and belt: the rankings narrowed to them" className="text-foreground hover:text-primary">
              <b className="font-semibold tabular-nums">#{data.bracket.rank}</b> of {data.bracket.of} {bracketName(data.bracket)}
            </Link>}
            {a.hidden === 1 && <span className="inline-flex items-center gap-1.5 text-foreground/85" title={HIDDEN}><Hidden className="text-foreground/70" />Hidden profile</span>}
            {arts.size ? [...arts].map(([art, s]) => (
              <span key={art} className="inline-flex items-center gap-1.5" title={`${art}: ${plural(s.events, 'event')} on Smoothcomp`}>
                <Belt belt={s.belt.toLowerCase().replace('gray', 'grey')} /><span>{s.belt} belt{s.degree ? `, ${plural(s.degree, 'degree')}` : ''}{arts.size > 1 ? ` · ${art}` : ''}</span>
              </span>
            )) : a.belt && <span className="inline-flex items-center gap-1.5"><Belt belt={a.belt} /><span>{a.belt[0].toUpperCase()}{a.belt.slice(1)} belt</span></span>}
            {a.club && (a.club_id ? <Link href={f.link(`/academy/${a.club_id}`)} className="text-foreground hover:text-primary">{a.club}</Link> : <span>{a.club}</span>)}
            {!data.profile?.affiliations?.length && who?.affiliation && <span title="Affiliation">{who.affiliation}</span>}
            {data.profile?.affiliations?.map((c) => c.id ? <a key={c.id} href={`${f.home}/en/affiliation/${c.id}`} rel="noopener" title="Affiliation" className="hover:text-foreground">{c.name}</a> : <span key={c.name} title="Affiliation">{c.name}</span>)}
          </div>
          {accounts.length > 0 && <p className="text-sm text-muted-foreground" title="Accounts with the same name, birth year and country, counted here as one athlete">
            Also {accounts.map((x, i) => <Fragment key={`${x.site} ${x.user}`}>{i ? ', ' : ''}<Link href={f.linkOn(`/athlete/${x.user}`, x.site)} className="text-foreground hover:text-primary">{x.site === f.site ? `another ${SITE_NAME(x.site)} account` : `on ${SITE_NAME(x.site)}`}</Link>{x.club && x.club !== a.club ? ` (${x.club})` : ''}</Fragment>)}: counted here as one athlete
          </p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {lately && <ReadNow targets={month.slice(0, 3).map((r) => ({ site: r.site ?? f.site, event: r.id, title: r.title, start: r.start, city: r.city }))} route="athlete" label="Read latest events" size="lg" />}
          {(data.profile?.videos ?? 0) > 0 && <a href={`${f.home}/en/profile/${id}`} rel="noopener" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{plural(data.profile!.videos!, 'match video')}<ExternalLink /></a>}
          <a href={`${f.home}/en/profile/${id}`} rel="noopener" className={buttonVariants({ size: 'lg' })}>Profile on {SITE_NAME(f.site)}<ExternalLink /></a>
        </div>
      </header>

      {career || outcomes.length ? <RecordBand fins={finishes(career, records)} f={f} over={over} split={splitByBelt(data.belts, records, f)} career={career} points={points} />
        : <Card className="px-5 py-4 text-sm text-muted-foreground">No career or results read yet. They arrive when someone with Mat Stats opens an event this athlete is in.</Card>}

      <Form list={past} f={f} />

      {(met.length > 0 || side) && <div className="grid items-start gap-6 lg:grid-cols-2">
        {met.length > 0 && <Rivals rivals={rivals} losses={losses} pick={pick} picked={against?.key ?? null} />}
        {side}
      </div>}

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
        {shownPast.length ? <EventsTable list={shownPast} f={f} against={against} show={show} club={a.club ?? null} /> : <Card><Empty title="No past events seen yet" text="They appear once someone with Mat Stats reads this athlete's career or an event they entered." /></Card>}
      </section>
    </div>
  );
}
