import { Link, Route, Switch, useLocation } from 'wouter';
import { lazy, Suspense, useEffect } from 'react';
import { Search } from '@/components/search';
import { Counting, Settings, SitePicker } from '@/components/filter-bar';
import { KEPT, useFilters, usedBy } from '@/lib/filters';
import { cn } from '@/lib/utils';
import { AthletesPage } from '@/pages/athletes';
import { AcademiesPage } from '@/pages/academies';
import { EventsPage } from '@/pages/events';
// The athlete page carries the chart library, so it loads when first opened.
const AthletePage = lazy(() => import('@/pages/athlete').then((m) => ({ default: m.AthletePage })));
import { AcademyPage } from '@/pages/academy';
import { EventPage } from '@/pages/event';
import { DivisionPage } from '@/pages/division';
import { Empty } from '@/components/empty';
// Dev only: the Demo data / Worst case switch (src/dev).
const DataToggle = import.meta.env.DEV ? lazy(() => import('@/dev/data-toggle')) : null;

export function App() {
  const f = useFilters();
  const [location, navigate] = useLocation();
  useEffect(() => { scrollTo(0, 0); }, [location]);
  // Each page's address keeps only the filters it reads.
  useEffect(() => f.strip(KEPT.filter((k) => !usedBy(location).includes(k))), [location]); // eslint-disable-line react-hooks/exhaustive-deps
  const section = location.startsWith('/academ') ? 'academies' : location.startsWith('/event') ? 'events' : 'athletes';
  const pickSite = (v: string) => {
    // Ids are per site, so a profile page goes back to its list.
    const list = location.match(/^\/(athlete|academy|event)\//)?.[1];
    if (list) navigate({ athlete: '/', academy: '/academies', event: '/events' }[list] + (v === 'ajptour.com' ? '?site=ajptour.com' : ''));
    else f.set({ site: v === 'smoothcomp.com' ? null : v, country: null });
  };
  const nav = [['athletes', '/', 'Athletes'], ['academies', '/academies', 'Academies'], ['events', '/events', 'Events']] as const;
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-md">
        {/* Below lg the nav takes a second row under the logo and controls; between sm and lg the controls take a row of their own. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 px-4 sm:px-6 lg:h-14 lg:gap-x-8 lg:flex-nowrap">
          <Link href={f.link('/')} className="flex h-14 items-center gap-2 font-semibold tracking-tight whitespace-nowrap"><img src="/icon.svg" alt="" className="size-6" />Mat Stats</Link>
          <nav className="flex h-10 w-full gap-6 text-sm max-lg:order-last lg:h-full lg:w-auto">
            {nav.map(([key, href, label]) => (
              <Link key={key} href={f.link(href)} aria-current={section === key ? 'page' : undefined}
                className={cn('relative flex items-center text-muted-foreground transition-colors hover:text-foreground', section === key && 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary')}>{label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3 sm:max-lg:w-full">
            <Search f={f} />
            {/* The events list counts no records and lists both sites; every other page counts by the finishes and reads one site.
                On phones both sit in the settings sheet. */}
            {location !== '/events' && <>
              <div className="contents max-sm:hidden"><Counting f={f} /><SitePicker site={f.site} pick={pickSite} /></div>
              <div className="contents sm:hidden"><Settings f={f} pick={pickSite} /></div>
            </>}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-20 sm:px-6 sm:pt-8">
        <Switch>
          <Route path="/"><AthletesPage /></Route>
          <Route path="/athletes"><AthletesPage /></Route>
          <Route path="/academies"><AcademiesPage /></Route>
          <Route path="/events"><EventsPage /></Route>
          <Route path="/athlete/:id">{(p) => <Suspense><AthletePage key={p.id} id={p.id} /></Suspense>}</Route>
          <Route path="/academy/:id">{(p) => <AcademyPage id={p.id} />}</Route>
          <Route path="/event/:id/division">{(p) => <DivisionPage id={p.id} />}</Route>
          <Route path="/event/:id">{(p) => <EventPage id={p.id} />}</Route>
          <Route><Empty title="No page here" text="Try the athlete ranking instead." /></Route>
        </Switch>
      </main>
      {DataToggle && <Suspense><DataToggle /></Suspense>}
      <footer className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs sm:px-6 text-muted-foreground">
          Recounted by <a className="underline decoration-white/20 underline-offset-4 hover:text-foreground" href="https://chromewebstore.google.com/detail/foadjommplmenhenheolmdmkfmhjflpf">Mat Stats for Smoothcomp</a>: every install shares the careers and results it reads on Smoothcomp. Each athlete's latest career read counts; an athlete without one ranks on their results at the events read.
        </p>
      </footer>
    </div>
  );
}
