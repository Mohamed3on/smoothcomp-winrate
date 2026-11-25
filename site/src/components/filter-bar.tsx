import { useEffect, useState } from 'react';
import { ChevronDown, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Belt } from '@/components/stats';
import { PlaceFilter } from '@/components/place-filter';
import { useApi } from '@/lib/api';
import { WIN_TYPES, type Filters } from '@/lib/filters';
import { BELTS, WEIGHTS, weightName } from '@/lib/rules';
import { typeName } from '@/lib/format';
import { cn } from '@/lib/utils';

// The chips run from the commonest finish to the rarest, as every career read adds up; walkovers, not contests, last.
const CHIPS = ['submission', 'points', 'decision', 'disqualification', 'stoppage', 'walkover'];

export const Field = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </div>
);

// A number or text field that writes to the URL a moment after typing stops.
export function Debounced({ f, name, placeholder, className, type = 'number', label }: { f: Filters; name: string; placeholder: string; className?: string; type?: string; label: string }) {
  const [value, setValue] = useState(f.get(name));
  useEffect(() => setValue(f.get(name)), [f.get(name)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (value === f.get(name)) return;
    const timer = setTimeout(() => f.set({ [name]: value }), 300);
    return () => clearTimeout(timer);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Input aria-label={label} type={type} min={0} inputMode={type === 'number' ? 'numeric' : undefined} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} className={className} />;
}

// The finishes every record on the site counts: one control in the header, as the site picker is.
// Its label names what's left out (or, when fewer are in, what's in) and lights up off the default.
export function Counting({ f }: { f: Filters }) {
  const out = CHIPS.filter((t) => !f.counted(t));
  const on = CHIPS.filter((t) => f.counted(t));
  const label = !out.length ? 'Counts every finish' : on.length < out.length ? `Counts ${on.map(typeName).join(', ')}` : `Counts all but ${out.map(typeName).join(', ')}`;
  const changed = out.join() !== 'walkover';
  return (
    <Popover>
      <PopoverTrigger title={label} className={cn(buttonVariants({ variant: 'outline' }), 'max-w-64 min-w-0 shrink justify-start text-muted-foreground max-lg:flex-1', changed && 'border-primary/60 bg-primary/8 text-foreground dark:bg-primary/8')}>
        <span className="truncate">{label}</span><ChevronDown className="opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-max max-w-[calc(100vw-2rem)] gap-3 p-3"><Finishes f={f} /></PopoverContent>
    </Popover>
  );
}

// The finish chips, under their heading.
function Finishes({ f }: { f: Filters }) {
  const toggleType = (t: string) => {
    const off = new Set(f.off);
    if (off.has(t)) off.delete(t);
    else if (WIN_TYPES.filter((w) => !off.has(w)).length > 1) off.add(t); // never an empty allowlist
    f.set({ off: [...off].join(',') });
  };
  return (
    <>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Wins that count</span>
          <span className="text-xs text-muted-foreground">Every record, ranking and career on the site counts these.</span>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Wins that count">
        {CHIPS.map((t) => (
          <Toggle key={t} variant="outline" size="sm" pressed={f.counted(t)} onPressedChange={() => toggleType(t)}
            className="h-8 rounded-full duration-160 ease-out-strong active:scale-[0.97] motion-reduce:active:scale-100 aria-pressed:border-primary/60 aria-pressed:bg-primary/12 aria-pressed:text-foreground text-muted-foreground">
            <i className={cn('size-2 rounded-full transition-opacity', !f.counted(t) && 'opacity-35')} style={{ background: `var(--color-win-${t})` }} />
            {typeName(t)}
          </Toggle>
        ))}
        </div>
    </>
  );
}

const SITES = [{ value: 'smoothcomp.com', label: 'Smoothcomp' }, { value: 'ajptour.com', label: 'AJP Tour' }];
// The site picker: the header's select from sm up; pick does the switching.
export function SitePicker({ site, pick }: { site: string; pick: (site: string) => void }) {
  return (
    <Select items={SITES} value={site} onValueChange={(v) => pick(v as string)}>
      <SelectTrigger className="w-32" aria-label="Site"><SelectValue /></SelectTrigger>
      <SelectContent>{SITES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

// On phones the header's two controls (finishes and site) move into one sheet behind a settings button, lit when either is off its default.
export function Settings({ f, pick }: { f: Filters; pick: (site: string) => void }) {
  const changed = CHIPS.filter((t) => !f.counted(t)).join() !== 'walkover' || f.site !== 'smoothcomp.com';
  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger aria-label="Settings" className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'text-muted-foreground', changed && 'border-primary/60 bg-primary/8 text-foreground dark:bg-primary/8')}><Settings2 /></DrawerTrigger>
      <DrawerContent>
        <DrawerHeader><DrawerTitle>Settings</DrawerTitle></DrawerHeader>
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4">
          <div className="flex flex-col gap-3"><Finishes f={f} /></div>
          <div className="flex flex-col gap-3">
            <span className="font-medium">Site</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Site">
              {SITES.map((s) => (
                <Toggle key={s.value} variant="outline" size="sm" pressed={f.site === s.value} onPressedChange={() => f.site !== s.value && pick(s.value)}
                  className="h-8 rounded-full px-3 text-muted-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/12 aria-pressed:text-foreground">{s.label}</Toggle>
              ))}
            </div>
          </div>
        </div>
        <DrawerFooter><DrawerClose className={buttonVariants()}>Done</DrawerClose></DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// On an event page (event) the bar filters the entrants already loaded: no event count, recency or ranking to choose,
// and the finishes counted are the header's (Counting), not the bar's. On phones the fields open in a sheet, behind a button naming how many are set.
// A bracket: whom, the age group and the weight class an athlete usually enters (rules.js bracketOf).
const SEXES = [['', 'Anyone'], ['m', 'Men'], ['f', 'Women']].map(([value, label]) => ({ value, label }));
const AGES = [['', 'Any age group'], ...['Adult', 'Master', 'Juvenile', 'Teen', 'Kids'].map((a) => [a, a])].map(([value, label]) => ({ value, label }));
const WEIGHT_ITEMS = [{ value: '', label: 'Any weight' }, ...[...WEIGHTS, 101].map((n) => ({ value: String(n), label: weightName(n) }))];

// `bracket` adds whom, age group and weight class, on the lists that rank athletes.
export function FilterBar({ f, sorts, minimumAthletes = 0, event = false, place = false, bracket = false }: { f: Filters; sorts: [string, string][]; minimumAthletes?: number; event?: boolean; place?: boolean; bracket?: boolean }) {
  const { data: countries } = useApi<{ rows: { country: string; name: string | null; athletes: number }[] }>('countries', { site: f.site });
  const belts = new Set(f.get('belt').split(',').filter(Boolean));
  const toggleBelt = (b: string) => {
    const next = new Set(belts);
    if (next.has(b)) next.delete(b); else next.add(b);
    f.set({ belt: [...next].join(',') });
  };
  const countryItems = [{ value: '', label: 'All countries' }, ...(countries?.rows ?? []).map((c) => ({ value: c.country, label: `${c.name ?? c.country.toUpperCase()} (${c.athletes})` })).sort((a, b) => a.label.localeCompare(b.label))];
  const activeItems = [['0', 'Any time'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['24', 'Last 2 years'], ['36', 'Last 3 years']].map(([value, label]) => ({ value, label }));
  const sortItems = sorts.map(([value, label]) => ({ value, label }));
  const set = ['belt', 'sex', 'age', 'weight', 'wins', 'events', 'athletes', 'country', 'q', 'near'].filter((k) => f.get(k)).length + Number(f.query.active !== f.defaults.active) + Number(!!(f.get('agemin') || f.get('agemax')));
  const reset = () => f.set(Object.fromEntries(['belt', 'sex', 'age', 'weight', 'wins', 'events', 'agemin', 'agemax', 'country', 'sort', 'dir', 'q', 'athletes', 'active'].map((k) => [k, null])));
  const fields = <>
      <Field label="Belt">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Belt">
          {BELTS.filter((b) => !['grey', 'yellow', 'orange', 'green'].includes(b) || belts.has(b)).map((b) => (
            <Toggle key={b} variant="outline" size="sm" pressed={belts.has(b)} onPressedChange={() => toggleBelt(b)} aria-label={`${b} belt`}
              className="h-8 rounded-full px-2.5 duration-160 ease-out-strong active:scale-[0.97] motion-reduce:active:scale-100 aria-pressed:border-primary/60 aria-pressed:bg-primary/12">
              <Belt belt={b} className={cn('transition-opacity', !belts.has(b) && 'opacity-45')} />
            </Toggle>
          ))}
        </div>
      </Field>
      {bracket && <Field label="Division">
        <div className="flex gap-1.5" role="group" aria-label="Division">
          {([['sex', SEXES, 'w-28', 'Men or women'], ['age', AGES, 'w-36', 'Age group'], ['weight', WEIGHT_ITEMS, 'w-32', 'Weight class']] as const).map(([key, items, width, label]) => (
            <Select key={key} items={items} value={f.get(key)} onValueChange={(v) => f.set({ [key]: (v as string) || null })}>
              <SelectTrigger aria-label={label} className={cn(width, f.get(key) && 'border-primary/60 bg-primary/8')}><SelectValue /></SelectTrigger>
              <SelectContent>{items.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
            </Select>
          ))}
        </div>
      </Field>}
      <Field label="Age">
        <div className={cn('flex h-8 items-center rounded-lg border border-input transition-colors has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30', (f.get('agemin') || f.get('agemax')) && 'border-primary/60 bg-primary/8 dark:bg-primary/8')}>
          <Debounced f={f} name="agemin" label="Youngest age" placeholder="Any" className="h-full w-16 border-0 bg-transparent text-center shadow-none focus-visible:ring-0 dark:bg-transparent" />
          <span className="text-muted-foreground" aria-hidden>–</span>
          <Debounced f={f} name="agemax" label="Oldest age" placeholder="Any" className="h-full w-16 border-0 bg-transparent text-center shadow-none focus-visible:ring-0 dark:bg-transparent" />
        </div>
      </Field>
      <Field label="Min. wins"><Debounced f={f} name="wins" label="Minimum wins" placeholder="Any" className="w-20" /></Field>
      {!event && <Field label="Min. events"><Debounced f={f} name="events" label="Minimum events" placeholder="Any" className="w-20" /></Field>}
      {place && <Field label="Near"><PlaceFilter f={f} /></Field>}
      {!!minimumAthletes && <Field label="Min. athletes"><Debounced f={f} name="athletes" label="Minimum athletes" placeholder={String(minimumAthletes)} className="w-20" /></Field>}
      {!event && <Field label="Competed">
        <Select items={activeItems} value={f.query.active || '0'} onValueChange={(v) => f.set({ active: v === f.defaults.active ? null : (v as string) })}>
          <SelectTrigger className={cn('w-40', f.query.active !== f.defaults.active && 'border-primary/60 bg-primary/8')}><SelectValue /></SelectTrigger>
          <SelectContent>{activeItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>}
      <Field label="Country">
        <Select items={countryItems} value={f.get('country')} onValueChange={(v) => f.set({ country: (v as string) || null })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{countryItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      {!event && <Field label="Rank by">
        <Select items={sortItems} value={f.query.sort} onValueChange={(v) => f.set({ sort: v as string, dir: null })}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{sortItems.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>}
      <Field label="Name" className="min-w-44 flex-1"><Debounced f={f} name="q" type="search" label="Filter by name" placeholder={event ? 'Name, academy, country or division' : 'Filter by name'} className="w-full max-w-md" /></Field>
  </>;
  return (
    <>
      <Drawer showSwipeHandle>
        <DrawerTrigger className={cn(buttonVariants({ variant: 'outline' }), 'self-start sm:hidden', set && 'border-primary/60 bg-primary/8 dark:bg-primary/8')}>
          <SlidersHorizontal />Filters{set > 0 && <span className="text-muted-foreground">{set}</span>}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Filters</DrawerTitle></DrawerHeader>
          <div className="flex min-h-0 flex-wrap items-end gap-x-6 gap-y-4 overflow-y-auto p-4 [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklab,var(--primary)_45%,transparent)_transparent]">{fields}</div>
          <DrawerFooter className="flex-row">
            <Button variant="ghost" className="text-muted-foreground" onClick={reset}>Reset</Button>
            <DrawerClose className={cn(buttonVariants(), 'flex-1')}>Done</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border bg-card p-4 max-sm:hidden">
        {fields}
        <Button variant="ghost" className="text-muted-foreground" onClick={reset}>Reset</Button>
      </div>
    </>
  );
}
