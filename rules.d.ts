// rules.js for TypeScript: the one global it sets.
declare global {
  var SCWRRules: {
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
  };
}
export {};
