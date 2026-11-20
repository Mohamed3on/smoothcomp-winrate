import { useQuery } from '@tanstack/react-query';

export type Types = Record<string, number>;
export interface Athlete {
  user: string; name: string | null; club: string | null; club_id: string | null; country: string | null; country_name: string | null;
  photo: string | null; born: number | null; hidden: number | null; belt: string | null; source?: 'career' | 'results';
  wins: number; losses: number | null; submission: number; points: number; types: Types; gold: number; silver: number; bronze: number; events: number | null; at: number | null; last: string | null;
}
export interface Team {
  club_id: string; club: string | null; athletes: number; wins: number; submission: number; points: number; gold: number; silver: number; bronze: number;
  podium_gold: number; podium_silver: number; podium_bronze: number; entered: number;
  top: { user: string; name: string | null; wins: number; belt: string | null; photo: string | null; born: number | null }[];
}
export interface Entry {
  event: string; user: string; division: string; club: string | null; club_id: string | null; place: number | null; wins: Types; losses: Types; fought: number; at?: number;
  title?: string | null; start?: string | null; city?: string | null;
}
export interface Past { event: string; title: string | null; start: string | null; city: string | null; wins: number | null; gold: number; silver: number; bronze: number; known: number }
export interface EventMeta { event: string; title: string | null; start: string | null; city: string | null; country: string | null; organiser: string | null }
export interface EventRow extends EventMeta { athletes: number; divisions: number; teams: number; fought: number }
export interface EventEntry extends Entry {
  name: string | null; country: string | null; country_name: string | null; photo: string | null; hidden: number | null; born: number | null; belt: string | null;
  career_wins: number | null; career_source: 'career' | 'results' | null; career_types: string | null;
}

export async function get<T>(route: string, query: Record<string, string | number | null | undefined>): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') params.set(k, String(v));
  if (query.off === '') params.set('off', '');
  const response = await fetch(`/api/${route}?${params}`);
  if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`), { status: response.status });
  return response.json();
}

export const useApi = <T,>(route: string, query: Record<string, string | number | null | undefined>, enabled = true) =>
  useQuery({ queryKey: [route, query], queryFn: () => get<T>(route, query), enabled, staleTime: 60_000, placeholderData: (previous) => previous, retry: (n, e: { status?: number }) => e.status !== 404 && n < 2 });
