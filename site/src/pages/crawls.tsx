import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty, PageHead } from '@/components/empty';
import { Stat } from '@/components/stats';
import { get } from '@/lib/api';
import { useFilters } from '@/lib/filters';
import { date, fmt } from '@/lib/format';

interface Crawl { site: string; event: string; title: string | null; city: string | null; start: string | null; at: number; matches: number | null; named?: number | null; missed?: number | null; tried?: number | null; priority: number }
interface Data { states: Record<string, number>; hours: { hour: number; n: number }[]; reading: Crawl[]; latest: Crawl[] }

// Why an event sits where it does in the queue: crawls.priority read back through server/crawl.js RANK (3 = someone opened an
// athlete or academy that competed there; else -(4 × distance band + 1 for AJP + 2 unless an athlete we hold competed there)).
const BANDS = ['Under 100 km from Berlin', '100–350 km from Berlin', '350–700 km from Berlin', '700–1,500 km from Berlin', '1,500–3,000 km from Berlin', 'Over 3,000 km from Berlin, or place unknown'];
const why = (p: number) => {
  if (p >= 3) return 'Opened on the site: someone looked at an athlete or academy that competed there';
  if (p > 0) return 'In Germany (the queue order before 26 Nov)';
  const n = -p;
  return [BANDS[Math.min(5, Math.floor(n / 4))], n % 4 < 2 ? 'athletes we know competed' : 'no athletes we know', n % 2 ? 'AJP (after Smoothcomp)' : null].filter(Boolean).join(' · ');
};

const ago = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : date(new Date(at).toISOString());
};

// The crawler as it goes (server/stats.js crawls): what it is reading, what it finished last, and its pace over the last day.
export function CrawlsPage() {
  const f = useFilters();
  const { data, isLoading, error } = useQuery({ queryKey: ['crawls'], queryFn: () => get<Data>('crawls', {}), refetchInterval: 30_000 });
  document.title = 'Crawler · Mat Stats';
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) return <Empty title="That didn’t load" text={String((error as Error)?.message ?? 'The stats server didn’t answer. Try again in a moment.')} />;
  const now = Math.floor(Date.now() / 3600e3) * 3600e3;
  const perHour = new Map(data.hours.map((h) => [h.hour, h.n]));
  const hours = Array.from({ length: 24 }, (_, i) => { const hour = now - (23 - i) * 3600e3; return { hour, n: perHour.get(hour) ?? 0 }; });
  const top = Math.max(1, ...hours.map((h) => h.n));
  const day = hours.reduce((n, h) => n + h.n, 0);
  const event = (c: Crawl) => (
    <Link href={f.linkOn(`/event/${c.event}`, c.site)} className="font-medium hover:text-primary">{c.title ?? `Event ${c.event}`}</Link>
  );
  const where = (c: Crawl) => [c.city, date(c.start), c.site === 'ajptour.com' ? 'AJP Tour' : null].filter(Boolean).join(' · ');
  const order = (c: Crawl) => <span className="text-xs text-muted-foreground">Why: {why(c.priority)}</span>;
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Crawler" text="Events the server reads itself. Events someone opened on the site come first. After that the queue goes by distance from Berlin, then events where athletes we know competed, then Smoothcomp before AJP, then newest first. Refreshes every 30 seconds." />
      <Card className="py-0"><dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x">
        <Stat label="Finished, last 24 hours">{fmt(day)}</Stat>
        <Stat label="Reading now">{fmt(data.states.reading ?? 0)}</Stat>
        <Stat label="Queued">{fmt(data.states.queued ?? 0)}</Stat>
        <Stat label="Finished in all">{fmt(data.states.done ?? 0)}</Stat>
      </dl></Card>
      <section aria-label="Events finished per hour" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Per hour, last 24 hours</h2>
        <div className="flex h-24 items-end gap-1">
          {hours.map((h) => (
            <div key={h.hour} className="flex h-full flex-1 items-end" title={`${new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${plural(h.n)}`}>
              <div className={h.n ? 'w-full rounded-t-sm bg-primary' : 'h-px w-full bg-border'} style={h.n ? { height: `${(h.n / top) * 100}%` } : undefined} />
            </div>
          ))}
        </div>
      </section>
      {data.reading.length > 0 && <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Reading now</h2>
        <Card className="gap-0 py-0">{data.reading.map((c) => (
          <div key={`${c.site} ${c.event}`} className="flex flex-col gap-1.5 border-b px-5 py-3 text-sm last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">{event(c)}<span className="text-xs text-muted-foreground tabular-nums">{fmt(c.tried)} of {fmt(c.matches)} matches asked · {ago(c.at)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, ((c.tried ?? 0) / Math.max(1, c.matches ?? 0)) * 100)}%` }} /></div>
            <span className="text-xs text-muted-foreground">{where(c)}</span>{order(c)}
          </div>
        ))}</Card>
      </section>}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Latest finished</h2>
        <Card className="gap-0 overflow-hidden py-0"><Table>
          <TableHeader><TableRow>
            <TableHead className="w-28 pl-5">Finished</TableHead><TableHead>Event</TableHead>
            <TableHead className="w-24 text-right">Matches</TableHead><TableHead className="w-28 pr-5 text-right">Athletes named</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.latest.map((c) => (
            <TableRow key={`${c.site} ${c.event}`}>
              <TableCell className="pl-5 align-top text-muted-foreground" title={new Date(c.at).toLocaleString()}>{ago(c.at)}</TableCell>
              <TableCell className="whitespace-normal"><div className="flex flex-col gap-0.5">{event(c)}<span className="text-xs text-muted-foreground">{where(c)}</span>{order(c)}</div></TableCell>
              <TableCell className="text-right align-top tabular-nums">{fmt(c.matches)}</TableCell>
              <TableCell className="pr-5 text-right align-top tabular-nums" title={c.missed ? `${fmt(c.missed)} sides left unnamed` : undefined}>{fmt(c.named)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></Card>
      </section>
    </div>
  );
}

const plural = (n: number) => `${fmt(n)} event${n === 1 ? '' : 's'}`;
