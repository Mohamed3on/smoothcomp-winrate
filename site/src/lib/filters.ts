import { useSearchParams } from 'wouter';

export const WIN_TYPES = ['submission', 'stoppage', 'points', 'decision', 'disqualification', 'walkover'] as const;
export const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'] as const;
// The keys that travel with every link, so following one keeps the ranking's terms.
export const KEPT = ['site', 'off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'country', 'athletes', 'active'] as const;

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(key) ?? '';
  // Only walkovers start uncounted; nobody is filtered out until the reader sets a minimum.
  const off = new Set((params.has('off') ? get('off') : 'walkover').split(',').filter(Boolean));
  const site = get('site') === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com';
  const set = (changes: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) if (v == null || (v === '' && k !== 'off')) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });
  const query = {
    site, off: [...off].join(','), belt: get('belt'), wins: get('wins'), events: get('events'), agemin: get('agemin'), agemax: get('agemax'),
    country: get('country'), active: get('active'), sort: get('sort') || 'wins', dir: get('dir'), q: get('q'),
  };
  // A path with the reader's filters carried along, after any query of its own.
  const link = (path: string) => {
    const [base, own] = path.split('?');
    const keep = new URLSearchParams(own);
    for (const k of KEPT) if (params.has(k) && (params.get(k) || k === 'off')) keep.set(k, params.get(k)!);
    const q = keep.toString();
    return q ? `${base}?${q}` : base;
  };
  return { params, get, set, off, counted: (type: string) => !off.has(type), site, query, link, home: site === 'ajptour.com' ? 'https://ajptour.com' : 'https://smoothcomp.com' };
}
export type Filters = ReturnType<typeof useFilters>;
