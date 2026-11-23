export const fmt = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString('en'));
const many = (n: number, word: string) => (n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : word.endsWith('ch') ? `${word}es` : `${word}s`);
export const plural = (n: number, word: string) => `${fmt(n)} ${many(n, word)}`;
export const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const ageOf = (born: number | null | undefined) => (Number.isSafeInteger(born) ? new Date().getUTCFullYear() - (born as number) : null);
export const isUpcoming = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now() - 24 * 60 * 60 * 1000;
const NAMES: Record<string, string> = { submission: 'Submission', stoppage: 'Stoppage', points: 'Points', decision: 'Decision', disqualification: 'DQ', walkover: 'Walkover', escape: 'Fastest escape', fastest_escape: 'Fastest escape' };
export const typeName = (t: string) => NAMES[t] ?? t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const winsOf = (bucket: Record<string, number> | null | undefined, counted: (t: string) => boolean) =>
  Object.entries(bucket ?? {}).reduce((n, [t, c]) => n + (counted(t) ? Number(c) || 0 : 0), 0);
// A profile's finishes, [won, lost] each, under the counted ones: its fastest escape is a career's fastest_escape.
export const recordOf = (types: Record<string, [number, number]> | undefined, counted: (t: string) => boolean) =>
  Object.entries(types ?? {}).reduce(([w, l], [t, [a, b]]) => (counted(t === 'escape' ? 'fastest_escape' : t) ? [w + a, l + b] : [w, l]), [0, 0]);
export const rate = (w: number | null | undefined, l: number | null | undefined) => (w != null && l != null && w + l ? `${Math.round((w / (w + l)) * 100)}%` : null);
export const initials = (name: string | null | undefined) => (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// The belt a division names ("Gi Adult / Male / Blue / …", "Beginner (White)"); none when it names
// several ("Advanced (Purple/Brown/Black)") or none.
export const BELT_ORDER = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
export const beltIn = (text: string | null | undefined) => {
  const named = BELT_ORDER.filter((b) => new RegExp(`\\b${b}`, 'i').test(String(text ?? '').replace(/gray/i, 'grey')));
  return named.length === 1 ? named[0] : null;
};
// The belt an athlete competed at: the one their division names, else one of their other divisions there.
export const beltAt = (divisions: (string | null | undefined)[]) => divisions.map(beltIn).find(Boolean) ?? null;
