// rules.js for TypeScript: the one global it sets.
type Types = Record<string, [number, number]>;
interface EventRecord { event: string; start: string | null; types: Types; divisions: string[] }
interface Rival { key: string; name: string; w: number; l: number }
interface Seed { belt?: string | null; won?: number | null; lost?: number | null; wins?: number | null; events?: number | null; gold?: number | null; submission?: number | null; points?: number | null; born?: number | null }
declare global {
  var SCWRRules: {
    rated(seed: Seed): boolean;
    seedKey(seed: Seed): number[];
    bySeed(a: Seed, b: Seed): number;
    sureSeed(seeds: Seed[], i: number): boolean;
    normalize(text: unknown): string;
    FINISHES: readonly string[];
    LABELS: Readonly<Record<string, string>>;
    finishOf(code: unknown): string;
    finishSql(column: string): string;
    detailOf(code: unknown): string | null;
    howOf(code: unknown): string;
    BELTS: readonly string[];
    beltsIn(label: unknown): string[];
    beltOf(label: unknown): string | null;
    isGrade(field: unknown): boolean;
    eventRecords(
      outcomes: { event: string | number; start?: string | null; out?: { types?: Types; faced?: { division?: string | null }[]; losses?: { division?: string | null }[] } }[],
      entries: { event: string | number; start?: string | null; division: string; wins?: Record<string, number> | null; losses?: Record<string, number> | null; fought?: number | boolean }[],
    ): EventRecord[];
    noShow(entry: { wins?: Record<string, number> | null; losses?: Record<string, number> | null }): boolean;
    playedSql(alias: string): string;
    totals(records: EventRecord[]): Types;
    beltSplit(records: EventRecord[], worn: string[], starts: (number | null)[]): { belt: string; types: Types; events: number }[];
    divisionOf(name: unknown): { age: string | null; weight: string | null };
    usualDivision(records: EventRecord[]): { age: string | null; weight: string | null; sex: string | null };
    WEIGHTS: readonly number[];
    weightName(weight: number): string;
    bracketOf(usual?: { sex?: string | null; age?: string | null; weight?: string | null }): { sex: string | null; age: string | null; weight: number | null };
    placeOf(stage: string | null | undefined, won: boolean, bronze: boolean): number | null;
    roundOf(stage: string | null | undefined): number;
    isPool(stages: (string | null | undefined)[]): boolean;
    poolPlaces<K>(rows: { key: K; wins: number; subs: number }[], beat: (a: K, b: K) => boolean): Map<K, number>;
    rivalsOf<M extends { name: string; won: boolean }>(meetings: M[]): (Omit<M, 'won'> & Rival)[];
  };
}
export {};
