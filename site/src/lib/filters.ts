import { useSyncExternalStore } from 'react';
import { useLocation, useSearchParams } from 'wouter';

export const WIN_TYPES = ['submission', 'stoppage', 'points', 'decision', 'disqualification', 'walkover'] as const;
// The keys that travel with every link, so following one keeps the ranking's terms.
export const KEPT = ['site', 'off', 'belt', 'wins', 'events', 'agemin', 'agemax', 'country', 'athletes', 'active', 'near', 'place', 'km'] as const;
// A place to look around (near: "lat,lng", place: its name) and how far (km), shared by events and academies.
const PLACE = ['near', 'place', 'km'];
// The kept keys each page reads: a link, and the page's own address, carry only those.
export const usedBy = (path: string): readonly string[] =>
  // Events list both sites at once.
  path.startsWith('/events') ? PLACE
  : path.startsWith('/athlete/') || /^\/event\/[^/]+\/division/.test(path) ? ['site', 'off']
  : path.startsWith('/event/') ? ['site', 'off', 'belt', 'wins', 'agemin', 'agemax', 'country']
  : path.startsWith('/academies') ? KEPT
  : KEPT.filter((k) => !PLACE.includes(k));
// A query string with plain commas, and without walkovers alone off, which is the default anyway.
const tidy = (p: URLSearchParams) => {
  if (p.get('off') === 'walkover') p.delete('off');
  const s = p.toString().replaceAll('%2C', ',');
  return s ? `?${s}` : '';
};

// The reader's own settings, kept in this browser: a kept key the address leaves out reads from here,
// so the site opens as they left it, while a link that names a key still shows what it names.
const SAVED = 'mat-stats:filters';
let saved: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(SAVED) ?? '{}') ?? {}; } catch { return {}; } })();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const save = (changes: Record<string, string | null>) => {
  const next = { ...saved };
  for (const [k, v] of Object.entries(changes)) if ((KEPT as readonly string[]).includes(k)) { if (v == null || (v === '' && k !== 'off')) delete next[k]; else next[k] = v; }
  saved = next;
  try { localStorage.setItem(SAVED, JSON.stringify(saved)); } catch { /* private mode: the address still holds them */ }
  listeners.forEach((l) => l());
};

export function useFilters() {
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const kept = useSyncExternalStore(subscribe, () => saved);
  const has = (key: string) => params.has(key) || key in kept;
  const get = (key: string) => params.get(key) ?? kept[key] ?? '';
  // Only walkovers start uncounted; nobody is filtered out until the reader sets a minimum.
  const off = new Set((has('off') ? get('off') : 'walkover').split(',').filter(Boolean));
  const site = get('site') === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com';
  const set = (changes: Record<string, string | null>) => {
    save(changes);
    // The live address, not this render's: a debounced field writes after others may have.
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) if (v == null || (v === '' && k !== 'off')) next.delete(k); else next.set(k, v);
    const to = tidy(next);
    if (to !== window.location.search) navigate(window.location.pathname + to, { replace: true });
  };
  // Takes keys out of the address alone, leaving the reader's kept settings as they are.
  const strip = (keys: readonly string[]) => {
    const next = new URLSearchParams(window.location.search);
    for (const k of keys) next.delete(k);
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
  // A path on the given site's data, whatever site the reader is on: an event from the list of both.
  const linkOn = (path: string, on: string) => {
    const [base, own] = link(path).split('?');
    const keep = new URLSearchParams(own);
    // Left out only when the page would read that site anyway: without it, a kept AJP setting would win.
    if (on === (kept.site === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com')) keep.delete('site'); else keep.set('site', on);
    return base + tidy(keep);
  };
  return { params, get, set, strip, off, counted: (type: string) => !off.has(type), site, query, link, linkOn, home: site === 'ajptour.com' ? 'https://ajptour.com' : 'https://smoothcomp.com' };
}
export type Filters = ReturnType<typeof useFilters>;
