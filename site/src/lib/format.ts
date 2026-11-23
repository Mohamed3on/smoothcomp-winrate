import { beltOf, LABELS } from './rules';

export const fmt = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString('en'));
const many = (n: number, word: string) => (n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : word.endsWith('ch') ? `${word}es` : `${word}s`);
export const plural = (n: number, word: string) => `${fmt(n)} ${many(n, word)}`;
export const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const ageOf = (born: number | null | undefined) => (Number.isSafeInteger(born) ? new Date().getUTCFullYear() - (born as number) : null);
export const isUpcoming = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now() - 24 * 60 * 60 * 1000;
const NAMES: Record<string, string> = { ...LABELS, disqualification: 'DQ' };
export const typeName = (t: string) => NAMES[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const winsOf = (bucket: Record<string, number> | null | undefined, counted: (t: string) => boolean) =>
  Object.entries(bucket ?? {}).reduce((n, [t, c]) => n + (counted(t) ? Number(c) || 0 : 0), 0);
export const rate = (w: number | null | undefined, l: number | null | undefined) => (w != null && l != null && w + l ? `${Math.min(Math.max(Math.round((w / (w + l)) * 100), w ? 1 : 0), l ? 99 : 100)}%` : null);
export const initials = (name: string | null | undefined) => (name ?? '').split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

// The belt an athlete competed at: the one their division names ("Gi Adult / Male / Blue / …"; none for
// "Advanced (Purple/Brown/Black)"), else one of their other divisions there.
export const beltAt = (divisions: (string | null | undefined)[]) => divisions.map(beltOf).find(Boolean) ?? null;
