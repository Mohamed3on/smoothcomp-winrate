import { useEffect, useSyncExternalStore } from 'react';

// The athletes, academies and events this browser opened last, newest first, so search can offer them again.
export type Kind = 'athlete' | 'academy' | 'event';
export interface Recent { site: string; kind: Kind; id: string; name: string; sub: string | null; photo?: string | null }

const KEY = 'mat-stats:recent';
const KEEP = 30;
// Entries kept before academies and events joined were athletes, under `user` and `club`.
type Old = Partial<Recent> & { user?: string; club?: string | null };
let recent: Recent[] = (() => {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Old[]).map((r) => r.kind ? r as Recent : { site: r.site!, kind: 'athlete', id: r.user!, name: r.name!, sub: r.club ?? null, photo: r.photo ?? null }); } catch { return []; }
})();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const write = (next: Recent[]) => {
  recent = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: kept for this visit */ }
  listeners.forEach((l) => l());
};

export const keyOf = (r: Pick<Recent, 'site' | 'kind' | 'id'>) => `${r.site}:${r.kind}:${r.id}`;
export const forget = (r: Recent) => write(recent.filter((x) => keyOf(x) !== keyOf(r)));
export const useRecent = () => useSyncExternalStore(subscribe, () => recent);
// A page notes what it shows once its own data is in (null until then).
export function useRemember(r: Recent | null) {
  const json = r && JSON.stringify(r);
  useEffect(() => {
    if (!json) return;
    const next: Recent = JSON.parse(json);
    if (recent[0] && JSON.stringify(recent[0]) === json) return;
    write([next, ...recent.filter((x) => keyOf(x) !== keyOf(next))].slice(0, KEEP));
  }, [json]);
}

// Accents and case aside, whether a name holds every word of the query.
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const matches = (name: string, q: string) => { const n = fold(name); return fold(q).split(/\s+/).filter(Boolean).every((w) => n.includes(w)); };
