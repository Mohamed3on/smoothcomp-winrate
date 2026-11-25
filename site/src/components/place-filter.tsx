import { useEffect, useState } from 'react';
import { LocateFixed, MapPin, X } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApi } from '@/lib/api';
import type { Filters } from '@/lib/filters';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Here { lat: number | null; lng: number | null; city: string | null }
interface Place { city: string; region?: string | null; country: string | null; lat: number; lng: number; events?: number }

const RADII = [['25', 'Within 25 km'], ['50', 'Within 50 km'], ['100', 'Within 100 km'], ['250', 'Within 250 km'], ['500', 'Within 500 km'], ['', 'Any distance']].map(([value, label]) => ({ value, label }));
// About a kilometre: close enough to search around, and no closer to where the reader stands.
const at = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

// Where to look: near the reader (their connection's city, or the browser's location when they ask),
// or any town by name; then how far around it.
export function PlaceFilter({ f }: { f: Filters }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [locating, setLocating] = useState<'' | 'busy' | 'denied'>('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const { data: here } = useApi<Here>('here', {}, open, Infinity);
  const { data: found, isFetching } = useApi<{ rows: Place[] }>('places', { q: debounced, lang: navigator.language.slice(0, 2).toLowerCase() }, debounced.length >= 2);
  const name = f.get('near') ? f.get('place') || 'Chosen place' : '';
  const pick = (near: string | null, place: string | null) => {
    setOpen(false); setQ(''); setLocating('');
    f.set({ near, place, km: near ? f.get('km') || '100' : null });
  };
  const precise = () => {
    setLocating('busy');
    navigator.geolocation.getCurrentPosition((p) => pick(at(p.coords.latitude, p.coords.longitude), 'Your location'), () => setLocating('denied'), { timeout: 10_000, maximumAge: 600_000 });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), 'max-w-56 justify-start', name && 'border-primary/60 bg-primary/8 dark:bg-primary/8')}>
          <MapPin className="text-muted-foreground" /><span className="truncate">{name || 'Anywhere'}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder="Search a city" aria-label="Search a city" />
            <CommandList className="max-h-72">
              {debounced.length < 2 ? (
                <CommandGroup>
                  {here?.lat != null && here.lng != null && (
                    <CommandItem value="here" onSelect={() => pick(at(here.lat!, here.lng!), here.city ? `Near ${here.city}` : 'Near you')}>
                      <MapPin />Near me{here.city && <span className="ml-auto text-xs text-muted-foreground">{here.city}</span>}
                    </CommandItem>
                  )}
                  {'geolocation' in navigator && (
                    <CommandItem value="precise" onSelect={precise} disabled={locating === 'busy'}>
                      <LocateFixed />{locating === 'busy' ? 'Finding you…' : locating === 'denied' ? 'Location blocked: allow it, or type a city' : 'Use my precise location'}
                    </CommandItem>
                  )}
                  {name && <CommandItem value="anywhere" onSelect={() => pick(null, null)}><X />Anywhere</CommandItem>}
                </CommandGroup>
              ) : (
                <>
                  <CommandEmpty>{isFetching ? 'Searching…' : `No place called “${debounced}” found.`}</CommandEmpty>
                  {!!found?.rows.length && (
                    <CommandGroup heading="Places">
                      {found.rows.map((p) => (
                        <CommandItem key={`${p.city}|${p.lat},${p.lng}`} value={`${p.city}|${p.lat},${p.lng}`} onSelect={() => pick(at(p.lat, p.lng), p.city)}>
                          <span className="truncate">{p.city}</span>
                          <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{[p.region, p.country, p.events != null && plural(p.events, 'event')].filter(Boolean).join(' · ')}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {name && (
        <Select items={RADII} value={f.get('km')} onValueChange={(v) => f.set({ km: (v as string) || '' })}>
          <SelectTrigger className="w-40" aria-label="Distance"><SelectValue /></SelectTrigger>
          <SelectContent>{RADII.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}
