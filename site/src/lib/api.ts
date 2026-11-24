import { useQuery } from '@tanstack/react-query';

export type Types = Record<string, number>;
export interface Athlete {
  user: string; name: string | null; club: string | null; club_id: string | null; country: string | null; country_name: string | null;
  photo: string | null; born: number | null; hidden: number | null; belt: string | null; affiliation?: string | null; source?: 'career' | 'results';
  wins: number; losses: number | null; won: number | null; lost: number | null; submission: number; points: number; types: Types; gold: number; silver: number; bronze: number; events: number | null; at: number | null; last: string | null;
}
export interface Team {
  club_id: string; club: string | null; city: string | null; club_country: string | null; km: number | null; athletes: number; wins: number; submission: number; points: number; gold: number; silver: number; bronze: number;
  podium_gold: number; podium_silver: number; podium_bronze: number; entered: number;
  top: { user: string; name: string | null; wins: number; belt: string | null; photo: string | null; born: number | null }[];
}
export interface Entry {
  event: string; user: string; division: string; club: string | null; club_id: string | null; place: number | null; wins: Types; losses: Types; fought: number; at?: number;
  title?: string | null; start?: string | null; city?: string | null; bouts?: Bout[] | null;
}
// One match of a division, as the results read give it: won or lost, its finish, who they met and in which round.
export interface Bout {
  won: boolean; type: string; how: string | null; opponent: string | null; user: string | null; club: string | null; stage: string | null;
  // Their score and their opponent's, as [points, advantages, penalties]; the clock as [length, left] in seconds.
  us?: [number, number, number]; them?: [number, number, number]; clock?: [number | null, number | null];
}
export interface Past { event: string; title: string | null; start: string | null; city: string | null; wins: number | null; gold: number; silver: number; bronze: number; known: number; image?: string | null }
// What else their Smoothcomp profile shows, as it last sent it.
export interface Club { id: number | null; name: string; city: string | null; country: string | null; logo: string | null }
export interface Profile {
  skills?: { name: string; belt: string; degree: number | null; competed: number | null; order: number | null }[];
  rankings?: { placement: number; name: string; owner: string | null; ownerId: number | null; type: 'federation' | 'event' | null; toplist: number | null }[];
  ranked?: number; academies?: Club[]; affiliations?: Club[]; videos?: number;
}
// One settled event as the athlete's profile match lists gave it: [won, lost] per finish, and each loss.
export interface Loss { type: string; how: string; opponent: string | null; club: string | null; division: string | null; image: string | null; reg: number | null; bracket: number | null; stage: string | null; user?: string | null }
// Everyone met there; a win names its finish, division and round too (from v 2).
export interface Faced { name: string; club: string | null; image: string | null; reg: number | null; won: boolean; type?: string; how?: string; division?: string | null; bracket?: number | null; stage?: string | null; user?: string | null }
export interface Outcome { event: string; start: string | null; title: string | null; out: { v?: 2; types: Record<string, [number, number]>; losses: Loss[]; faced: Faced[]; extra?: boolean } }
export interface EventMeta { event: string; title: string | null; start: string | null; city: string | null; country: string | null; organiser: string | null; ends?: number | null }
export interface EventRow extends EventMeta { athletes: number; divisions: number; teams: number; fought: number; lat: number | null; lng: number | null; url: string | null; km: number | null }
export interface EventEntry extends Entry {
  name: string | null; country: string | null; country_name: string | null; photo: string | null; hidden: number | null; born: number | null; belt: string | null;
  career_wins: number | null; career_source: 'career' | 'results' | null; career_types: string | null; career_won?: number | null; career_lost?: number | null; career_events?: number | null;
}

export async function get<T>(route: string, query: Record<string, string | number | null | undefined>): Promise<T> {
  // Dev only: ?data= answers from a fixture instead (src/dev/fixtures.ts); the build drops this branch.
  if (import.meta.env.DEV) {
    const state = new URLSearchParams(location.search).get('data');
    const found = state ? (await import('@/dev/fixtures')).fixture(route, state) : undefined;
    if (found !== undefined) return found as T;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') params.set(k, String(v));
  if (query.off === '') params.set('off', '');
  const response = await fetch(`/api/${route}?${params}`);
  if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`), { status: response.status });
  return response.json();
}

export const useApi = <T,>(route: string, query: Record<string, string | number | null | undefined>, enabled = true, staleTime = 60_000) =>
  useQuery({ queryKey: [route, query], queryFn: () => get<T>(route, query), enabled, staleTime, placeholderData: (previous) => previous, retry: (n, e: { status?: number }) => e.status !== 404 && n < 2 });
