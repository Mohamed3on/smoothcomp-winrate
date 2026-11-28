// rules.js for TypeScript: the one global it sets.
type Types = Record<string, [number, number]>;
interface EventRecord { event: string; start: string | null; types: Types; divisions: string[] }
interface Rival { key: string; name: string; w: number; l: number }
// An event's schedule as rules.js scheduleOf keeps it, and what reading it gives (nameSides, eventResults).
type Side = [registration: number, won: boolean, name: string | null, club: string | null, country: string | null, affiliation: string | null];
type Match = [id: number, division: string, stage: string, finish: string | null, sides: Side[], bracket: number | null];
interface Card { left?: Record<string, unknown> | null; right?: Record<string, unknown> | null; matchInfo?: { time?: string; timeRemaining?: number } }
interface Read { matches: Match[]; over: boolean; ends: number | null; users: Record<string, unknown>; tried: number[]; missed?: number[]; cards?: Record<string, unknown> }
// An event of an athlete as rules.js Outcome makes and cleans it (site lib/api.ts Outcome is the kept shape).
interface OutcomeOut { v?: number; types: Types; losses: Record<string, unknown>[]; faced: Record<string, unknown>[]; extra?: boolean; absent?: boolean }
type Listed = { wins?: number | null; medals?: Record<string, number | null | undefined> | (number | null)[] | null } | null | undefined;
// One record of a match, as Match identity compares them: each part where the record knows it.
interface MatchRecord { id?: number | string | null; event?: number | string | null; division?: string | null; bracket?: number | null; stage?: string | null; sides?: unknown[]; won?: boolean | null }
interface Seed { belt?: string | null; won?: number | null; lost?: number | null; wins?: number | null; events?: number | null; gold?: number | null; submission?: number | null; points?: number | null; born?: number | null; academy?: [won: number, lost: number] | null; strength?: number | null }
declare global {
  var SCWRRules: {
    rated(seed: Seed): boolean;
    seedKey(seed: Seed): number[];
    bySeed(a: Seed, b: Seed): number;
    byRating<T>(sorted: T[], seedOf: (row: T) => Seed): T[];
    sureSeed(seeds: Seed[], i: number): boolean;
    normalize(text: unknown): string;
    FINISHES: readonly string[];
    LABELS: Readonly<Record<string, string>>;
    finishOf(code: unknown): string;
    finishSql(column: string): string;
    SCORELESS: string[];
    winRate(won: number | null | undefined, lost: number | null | undefined): string | null;
    winTone(won: number, lost: number): string;
    flag(code: string | null | undefined): string | null;
    pointsLine(pointsFor: number, pointsAgainst: number, scored: number, total: number): { each: string | null; total: string; over: string };
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
    matchFinder<M extends MatchRecord>(list: M[]): (match: MatchRecord) => M | undefined;
    Outcome: {
      fromMatchList(event: { matches?: Record<string, unknown> } | null | undefined, name: unknown, listed: Listed): OutcomeOut;
      fromBouts(divisions: { division: string; bouts?: Record<string, unknown>[] | null }[], listed: Listed): OutcomeOut;
      clean(out: unknown): OutcomeOut;
    };
    photo(url: unknown): string | null;
    words(text: unknown, max: number): string | null;
    regOf(id: unknown): number | null;
    ACADEMY_OWN: readonly string[];
    overAt(event: { ends?: number | null; start?: string | null } | null | undefined): number | null;
    overSql(alias: string): string;
    wonNothingSql(alias: string): string;
    presentSql(alias: string): string;
    missedSql(alias: string): string;
    showed(entries: { wins?: Record<string, number> | null; losses?: Record<string, number> | null; fought?: number | boolean }[], outcome?: { out?: { absent?: boolean } } | null): boolean;
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
    unplaced(entry: { wins?: Record<string, number> | null; losses?: Record<string, number> | null }): boolean;
    divisionResults<K>(stages: (string | null | undefined)[], options?: { placed?: boolean; fought?: boolean }): {
      of(key: K): void;
      add(winner: K | null | undefined, loser: K | null | undefined, finish: string, stage: string | null | undefined, id: number | string): void;
      done(): Map<K, { wins: Record<string, number>; losses: Record<string, number>; place: number | null }>;
    };
    poolPlaces<K>(rows: { key: K; wins: number; subs: number }[], beat: (a: K, b: K) => boolean): Map<K, number>;
    scheduleOf(mats: unknown[], lists: unknown[]): { matches: Match[]; over: boolean; ends: number | null };
    knownSides(data: Read, known?: { matches?: [number | null, string, boolean, string, number[] | null, number[] | null, (number | null)[] | null, string?, string?, string?][]; people?: Record<string, Record<string, unknown>> }): void;
    nameSides(data: Read, room: () => number, read: (matches: Match[]) => Promise<(Card | Error | null)[]>): Promise<void>;
    eventResults(data: Read, start?: string | null): { athletes: Record<string, unknown>; records: Record<string, [number, number]> };
    registeredIn(html: string): number | null;
    clubPlace(html: string): { lat: number | null; lng: number | null; city: string | null; country: string | null; address: string | null } | null;
    rivalsOf<M extends { name: string; won: boolean }>(meetings: M[]): (Omit<M, 'won'> & Rival)[];
  };
}
export {};
