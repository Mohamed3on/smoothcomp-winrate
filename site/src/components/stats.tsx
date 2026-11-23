import { Link } from 'wouter';
import { ExternalLink, Lock } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { WIN_TYPES, type Filters } from '@/lib/filters';
import { ageOf, fmt, initials, plural, typeName } from '@/lib/format';
import type { Types } from '@/lib/api';

// Regions Unicode has no flag for are drawn, sized to sit level with the emoji.
const svg = (...shapes: string[]) => `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" style="border-radius:2px">${shapes.join('')}</svg>`;
const band = (y: number, h: number, fill: string) => `<rect y="${y}" width="16" height="${h}" fill="${fill}"/>`;
const DRAWN: Record<string, string> = {
  'ru-cri': svg(band(0, 12, '#0f8f3f'), band(5.2, 1.6, '#fff'), band(6.8, 5.2, '#c8102e'), '<rect width="2.6" height="12" fill="#e8a020"/>'),
  'ru-da': svg(band(0, 12, '#0f8f3f'), band(4, 4, '#1e4fa3'), band(8, 4, '#c8102e')),
  krd: svg(band(0, 12, '#e03a3e'), band(4, 4, '#fff'), band(8, 4, '#1a8f4c'), '<circle cx="8" cy="6" r="2.1" fill="#f5c518"/>'),
};
const GLYPH: Record<string, string> = { 'gb-eng': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', 'gb-sct': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', 'gb-wls': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}', kos: '\u{1F1FD}\u{1F1F0}' };
export function Flag({ code, name, className }: { code: string | null; name?: string | null; className?: string }) {
  const c = (code ?? '').toLowerCase();
  const label = name ?? c.toUpperCase();
  if (DRAWN[c]) return <span role="img" aria-label={label} title={label} className="inline-flex" dangerouslySetInnerHTML={{ __html: DRAWN[c] }} />;
  const glyph = GLYPH[c] ?? (/^[a-z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 97)) : null);
  return glyph ? <span role="img" aria-label={label} title={label} className={cn('leading-none', className)}>{glyph}</span> : null;
}

export const BELT_COLOUR: Record<string, string> = { white: '#f4f5f6', grey: '#8d949d', yellow: '#e7bd28', orange: '#dc7627', green: '#2b8a56', blue: '#2871b8', purple: '#744ca3', brown: '#79472f', black: '#17191c' };
export function Belt({ belt, className }: { belt: string | null; className?: string }) {
  if (!belt || !BELT_COLOUR[belt]) return null;
  return (
    <span role="img" aria-label={`${belt} belt`} title={`${belt[0].toUpperCase()}${belt.slice(1)} belt`}
      className={cn('relative inline-block h-2 w-[22px] shrink-0 overflow-hidden rounded-[2px] border border-white/20', className)} style={{ background: BELT_COLOUR[belt] }}>
      <span className="absolute inset-y-0 right-[3px] w-[5px]" style={{ background: belt === 'black' ? '#b53b42' : '#17191c' }} />
    </span>
  );
}

export function Age({ born }: { born: number | null }) {
  const age = ageOf(born);
  return age == null ? null : <span title="Age, give or take a year" className="shrink-0 rounded-full bg-primary/12 px-1.5 text-[10px] font-semibold leading-4 text-primary">{age}</span>;
}

export function Photo({ name, photo, className }: { name: string | null; photo: string | null; className?: string }) {
  return (
    <Avatar className={cn('size-8 shrink-0', className)}>
      {photo && <AvatarImage src={photo} alt="" referrerPolicy="no-referrer" loading="lazy" className="photo object-cover" />}
      <AvatarFallback className="text-[10px] font-semibold tracking-wide text-muted-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

interface Person { user: string; name: string | null; club?: string | null; club_id?: string | null; country?: string | null; country_name?: string | null; photo: string | null; belt?: string | null; born?: number | null; hidden?: number | null }
// An athlete who hides their Smoothcomp profile: their career can't be read, so they rank on their results.
export const HIDDEN = 'Hidden profile on Smoothcomp: their career can’t be read, so Mat Stats counts the results it has read for them';
export function Hidden({ className }: { className?: string }) {
  return <Lock role="img" aria-label={HIDDEN} className={cn('size-3 shrink-0 text-muted-foreground', className)}><title>{HIDDEN}</title></Lock>;
}
export function Identity({ a, f, club = true }: { a: Person; f: Filters; club?: boolean }) {
  const on = `Profile on ${f.site === 'ajptour.com' ? 'AJP Tour' : 'Smoothcomp'}`;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Photo name={a.name} photo={a.photo} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Link href={f.link(`/athlete/${a.user}`)} className={cn('font-medium break-words hover:text-primary', !a.name && 'italic text-muted-foreground')}>
            {a.name ?? `Athlete ${a.user}`}
          </Link>
          {a.hidden === 1 && <Hidden />}
          <a href={`${f.home}/en/profile/${a.user}`} rel="noopener" title={on} aria-label={on}
            className="-m-1 shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><ExternalLink className="size-3" /></a>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Flag code={a.country ?? null} name={a.country_name} className="text-sm" />
          <Belt belt={a.belt ?? null} />
          <Age born={a.born ?? null} />
          {club && a.club && (a.club_id
            ? <Link href={f.link(`/academy/${a.club_id}`)} className="min-w-0 break-words hover:text-primary">{a.club}</Link>
            : <span className="min-w-0 break-words">{a.club}</span>)}
        </div>
      </div>
    </div>
  );
}

const colour = (t: string) => `var(--color-win-${(WIN_TYPES as readonly string[]).includes(t) ? t : 'other'})`;
const ordered = (types: Types) => Object.entries(types ?? {}).filter(([, n]) => Number(n) > 0)
  .sort(([a], [b]) => ((WIN_TYPES as readonly string[]).indexOf(a) + 1 || 99) - ((WIN_TYPES as readonly string[]).indexOf(b) + 1 || 99));

// Every counted win, most decisive finish first: the extension's ramp.
export function Mix({ types, f, large = false, legend = true }: { types: Types; f: Filters; large?: boolean; legend?: boolean }) {
  const shown = ordered(types).filter(([t]) => f.counted(t));
  if (!shown.length) return <span className="text-xs text-muted-foreground">No counted wins</span>;
  const title = shown.map(([t, c]) => `${typeName(t)} ${c}`).join(' · ');
  return (
    <div className="flex min-w-0 flex-col gap-1" title={title}>
      <div role="img" aria-label={title} className={cn('flex gap-px overflow-hidden rounded-full bg-muted', large ? 'h-2.5' : 'h-1.5')}>
        {shown.map(([t, c]) => <i key={t} className="block min-w-0.5" style={{ flex: Number(c), background: colour(t) }} />)}
      </div>
      {legend && <div className="text-xs text-muted-foreground">{shown.slice(0, 3).map(([t, c], i) => <span key={t}>{i ? ' · ' : ''}<b className="font-semibold text-foreground/80">{c}</b> {typeName(t).toLowerCase()}</span>)}</div>}
    </div>
  );
}
export function Keys({ types, f }: { types: Types; f: Filters }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {ordered(types).map(([t, c]) => (
        <span key={t} className={cn('inline-flex items-center gap-1.5', !f.counted(t) && 'text-muted-foreground line-through decoration-white/20')} title={f.counted(t) ? undefined : 'Not counted: switched off in the filters'}>
          <i className="size-2 rounded-full" style={{ background: colour(t) }} />{typeName(t)} <b className="font-semibold">{c}</b>
        </span>
      ))}
    </div>
  );
}

export function Medals({ g, s, b, className }: { g: number; s: number; b: number; className?: string }) {
  const counts = [['bg-gold', Number(g) || 0, 'gold'], ['bg-silver', Number(s) || 0, 'silver'], ['bg-bronze', Number(b) || 0, 'bronze']] as const;
  return (
    <span className={cn('inline-flex items-center justify-end gap-3 font-medium', className)} aria-label={counts.map(([, n, k]) => `${n} ${k}`).join(', ')}>
      {counts.map(([bg, n, k]) => (
        <span key={k} className={cn('inline-flex min-w-7 items-center justify-end gap-1.5', !n && 'font-normal text-muted-foreground/70')}>
          <i className={cn('size-1.5 rounded-full', bg, !n && 'opacity-35')} />{fmt(n)}
        </span>
      ))}
    </span>
  );
}

export function Record({ w, l }: { w: number; l: number }) {
  return <span className="whitespace-nowrap font-semibold"><span className={w ? 'text-won' : 'text-muted-foreground'}>{w}</span><span className="px-0.5 text-muted-foreground">–</span><span className={l ? 'text-lost' : 'text-muted-foreground'}>{l}</span></span>;
}

export function Place({ p }: { p: number | null }) {
  if (!p) return <span className="text-muted-foreground">–</span>;
  const style = p === 1 ? 'bg-gold/15 text-gold' : p === 2 ? 'bg-silver/15 text-silver' : p === 3 ? 'bg-bronze/15 text-bronze' : 'bg-muted text-muted-foreground';
  return <span title={p === 1 ? 'Gold' : p === 2 ? 'Silver' : p === 3 ? 'Bronze' : `Placed ${p}`} className={cn('inline-grid h-5 min-w-6 place-items-center rounded-md px-1.5 text-xs font-bold', style)}>{p}</span>;
}

export function FromResults({ a }: { a: { source?: string; wins: number; losses: number | null; events: number | null } }) {
  if (a.source !== 'results') return null;
  return <div className="text-xs text-muted-foreground" title="Smoothcomp serves no career for this athlete, so these are their results at the events Mat Stats has read">From {plural(a.events ?? 0, 'event')} read</div>;
}

export const Num = ({ n, dim = false }: { n: number | null | undefined; dim?: boolean }) =>
  <span className={cn('font-semibold', (!n || dim) && 'font-normal text-muted-foreground')}>{fmt(n)}</span>;

export function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <dd className="text-xl font-semibold tracking-tight">{children}{note && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{note}</span>}</dd>
      <dt className="order-first text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
