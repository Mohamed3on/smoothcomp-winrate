// The rules every part of Mat Stats counts by: the extension's pages, the server and the stats
// site. One file, loaded three ways: as a script tag before the page scripts (manifest.json, and
// background.js imports it), and imported for its effect by the server (server/*.js) and the site
// (site/src/lib/rules.ts). It sets one global and touches nothing else, so it runs in all three.
globalThis.SCWRRules = (() => {
  // Text compared as people read it: any spacing, any case, one Unicode form.
  const normalize = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

  // How a match ended. Smoothcomp's codes come finer than its own chips name them
  // ("submission_armbar", "decision_unanimous", "double-dq", "tko", a judo "fullippon"); each
  // counts under one finish, most decisive first. A forfeit is a walkover by another name, and
  // a profile's older "escape" is a fastest escape.
  const FINISHES = ['submission', 'stoppage', 'fastest_escape', 'points', 'decision', 'disqualification', 'walkover', 'other'];
  const LABELS = { submission: 'Submission', stoppage: 'Stoppage', fastest_escape: 'Fastest escape', points: 'Points', decision: 'Decision', disqualification: 'Disqualification', walkover: 'Walkover', other: 'Other' };
  // The first finish with a pattern the code matches, else other. Patterns are SQL LIKE's
  // (% any run of characters, any case), so the server's queries group by the same rule.
  const RULES = [
    ['submission', ['sub%']],
    ['fastest_escape', ['%escape%']],
    ['walkover', ['%walk%', '%forfeit%']],
    ['disqualification', ['%dq%', '%disq%']],
    ['points', ['point%', '%advantage%', '%penalt%']],
    ['decision', ['%decision%', '%referee%', '%judge%']],
    ['stoppage', ['%stoppage%', '%ko', '%ko %', '%ko-%']],
  ];
  const like = (pattern) => new RegExp(`^${pattern.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const MATCHERS = RULES.map(([finish, patterns]) => [finish, patterns.map(like)]);
  const finishOf = (code) => {
    const w = String(code ?? '').toLowerCase();
    return MATCHERS.find(([, res]) => res.some((re) => re.test(w)))?.[0] ?? 'other';
  };
  // The same rule as a SQL expression over a column of codes.
  const finishSql = (column) => `CASE ${RULES.map(([finish, patterns]) => `WHEN ${patterns.map((p) => `${column} LIKE '${p}'`).join(' OR ')} THEN '${finish}'`).join(' ')} ELSE 'other' END`;
  // The detail a code gives: "submission_armbar" is "Submission (armbar)"; none for a bare one.
  const detailOf = (code) => {
    const w = String(code ?? '').toLowerCase();
    const kind = ['submission', 'decision', 'points'].find((k) => w.startsWith(k));
    const rest = kind && w.slice(kind.length).replace(/[^a-z]+/g, ' ').trim();
    return rest ? `${LABELS[kind]} (${rest})` : null;
  };
  // How a match ended, as a line reads it: the detail where the code gives one, else the finish.
  const howOf = (code) => detailOf(code) ?? LABELS[finishOf(code)];

  // Belts, lowest first. A label names one belt, or none: "Purple/Brown" and "All belts" name none.
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const beltsIn = (label) => BELTS.filter((b) => new RegExp(`\\b${b}`, 'i').test(String(label ?? '').replace(/gray/i, 'grey')));
  const beltOf = (label) => {
    const named = beltsIn(label);
    return named.length === 1 ? named[0] : null;
  };
  // Organisers name the registration field that grades an athlete "Belt", "Level", "Rank",
  // "Skill level" or "Grade", depending on the event and whether the division is gi or no-gi.
  const isGrade = (field) => /belt|level|rank|skill|grade/i.test(String(field ?? ''));

  return { normalize, FINISHES, LABELS, finishOf, finishSql, detailOf, howOf, BELTS, beltsIn, beltOf, isGrade };
})();
