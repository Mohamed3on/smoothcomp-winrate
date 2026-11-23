import { useLocation, useSearchParams } from 'wouter';

export const WIN_TYPES = ['submission', 'stoppage', 'points', 'decision', 'disqualification', 'walkover'] as const;
// The keys that travel with every link, so following one keeps the ranking's terms.
export const KEPT = ['site', 'off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'country', 'athletes', 'active'] as const;
// The kept keys each page reads: a link, and the page's own address, carry only those.
export const usedBy = (path: string): readonly string[] =>
  path.startsWith('/events') ? ['site']
  : path.startsWith('/athlete/') || /^\/event\/[^/]+\/division/.test(path) ? ['site', 'off']
  : path.startsWith('/event/') ? ['site', 'off', 'belt', 'wins', 'agemin', 'agemax', 'country']
  : KEPT;
// A query string with plain commas, and without walkovers alone off, which is the default anyway.
const tidy = (p: URLSearchParams) => {
  if (p.get('off') === 'walkover') p.delete('off');
  const s = p.toString().replaceAll('%2C', ',');
  return s ? `?${s}` : '';
};

export function useFilters() {
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const get = (key: string) => params.get(key) ?? '';
  // Only walkovers start uncounted; nobody is filtered out until the reader sets a minimum.
  const off = new Set((params.has('off') ? get('off') : 'walkover').split(',').filter(Boolean));
  const site = get('site') === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com';
  const set = (changes: Record<string, string | null>) => {
    // The live address, not this render's: a debounced field writes after others may have.
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) if (v == null || (v === '' && k !== 'off')) next.delete(k); else next.set(k, v);
    const to = tidy(next);
    if (to !== window.location.search) navigate(window.location.pathname + to, { replace: true });
  };
  const query = {
    site, off: [...off].join(','), belt: get('belt'), wins: get('wins'), events: get('events'), agemin: get('agemin'), agemax: get('agemax'),
    country: get('country'), active: get('active'), sort: get('sort') || 'wins', dir: get('dir'), q: get('q'),
  };
  // A path with the reader's filters carried along, after any query of its own.
  const link = (path: string) => {
    const [base, own] = path.split('?');
    const keep = new URLSearchParams(own);
    for (const k of usedBy(base)) if (params.has(k) && (params.get(k) || k === 'off')) keep.set(k, params.get(k)!);
    return base + tidy(keep);
  };
  return { params, get, set, off, counted: (type: string) => !off.has(type), site, query, link, home: site === 'ajptour.com' ? 'https://ajptour.com' : 'https://smoothcomp.com' };
}
export type Filters = ReturnType<typeof useFilters>;
