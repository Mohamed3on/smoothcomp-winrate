import { useSyncExternalStore } from 'react';

// The athletes this browser opened last, newest first, so search can offer them again.
export interface Recent { site: string; user: string; name: string; club: string | null; photo: string | null }

const KEY = 'mat-stats:recent';
const KEEP = 20;
let recent: Recent[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') ?? []; } catch { return []; } })();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const write = (next: Recent[]) => {
  recent = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: kept for this visit */ }
  listeners.forEach((l) => l());
};
const other = (r: Recent, site: string, user: string) => r.site !== site || r.user !== user;

export const remember = (r: Recent) => {
  if (recent[0] && !other(recent[0], r.site, r.user) && JSON.stringify(recent[0]) === JSON.stringify(r)) return;
  write([r, ...recent.filter((x) => other(x, r.site, r.user))].slice(0, KEEP));
};
export const forget = (site: string, user: string) => write(recent.filter((x) => other(x, site, user)));
export const useRecent = (site: string) => useSyncExternalStore(subscribe, () => recent).filter((r) => r.site === site);

// Accents and case aside, whether a name holds every word of the query.
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const matches = (name: string, q: string) => { const n = fold(name); return fold(q).split(/\s+/).filter(Boolean).every((w) => n.includes(w)); };
