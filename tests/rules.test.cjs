// The rules every part of Mat Stats counts by (rules.js), held to the codes and labels
// Smoothcomp really sends, and the server's SQL to the same answers as the pages' JavaScript.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync('rules.js', 'utf8'), context, { filename: 'rules.js' });
const { finishOf, finishSql, detailOf, howOf, beltOf, beltsIn, isGrade } = context.SCWRRules;

const CODES = {
  submission: 'submission', submission_armbar: 'submission', 'Submission (rear naked choke)': 'submission',
  points: 'points', advantage: 'points', penalties: 'points', decision: 'decision', decision_unanimous: 'decision', referee_decision: 'decision', judges: 'decision',
  walkover: 'walkover', forfeit: 'walkover', disqualification: 'disqualification', dq: 'disqualification', 'double-dq': 'disqualification',
  stoppage: 'stoppage', tko: 'stoppage', ko: 'stoppage', 'ko-punch': 'stoppage',
  'fastest escape': 'fastest_escape', fastest_escape: 'fastest_escape', escape: 'fastest_escape',
  fullippon: 'other', vs0: 'other', other: 'other', '': 'other',
};

test('every code counts under one finish, and a finish name under itself', () => {
  for (const [code, finish] of Object.entries(CODES)) assert.equal(finishOf(code), finish, code);
  for (const finish of context.SCWRRules.FINISHES) assert.equal(finishOf(finish), finish);
});

test("the server's SQL groups every code as the pages do", () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE codes (code TEXT)');
  const insert = db.prepare('INSERT INTO codes VALUES (?)');
  for (const code of Object.keys(CODES)) insert.run(code);
  for (const { code, finish } of db.prepare(`SELECT code, ${finishSql('code')} AS finish FROM codes`).all()) assert.equal(finish, finishOf(code), code);
});

test('a finer code gives its detail; a bare one its finish', () => {
  assert.equal(detailOf('submission_armbar'), 'Submission (armbar)');
  assert.equal(detailOf('decision_unanimous'), 'Decision (unanimous)');
  assert.equal(detailOf('submission'), null);
  assert.equal(howOf('points'), 'Points');
  assert.equal(howOf('tko'), 'Stoppage');
});

test('a label names one belt, or none', () => {
  assert.equal(beltOf('Gi Adult / Male / Blue / -76 kg'), 'blue');
  assert.equal(beltOf('Beginner (Gray)'), 'grey');
  assert.equal(beltOf('Advanced (Purple/Brown/Black)'), null);
  assert.equal(beltOf('All belts'), null);
  assert.equal(beltOf(null), null);
  assert.deepEqual([...beltsIn('Purple/Brown')], ['purple', 'brown']);
  for (const field of ['Belt', 'Level', 'Rank', 'Skill level', 'Grade']) assert.ok(isGrade(field), field);
  for (const field of ['Weight', 'Age', 'Gender', 'Division']) assert.ok(!isGrade(field), field);
});

test('a division is placed by the round each side went out in, a round robin by its record', () => {
  const { placeOf, isPool, poolPlaces } = context.SCWRRules;
  assert.deepEqual([placeOf('Final', true, true), placeOf('Final', false, true), placeOf('Bronze match', true, true), placeOf('Bronze match', false, true)], [1, 2, 3, 4]);
  assert.deepEqual([placeOf('Semifinals', false, false), placeOf('Semifinals', false, true), placeOf('Quarterfinals', false, true), placeOf('16th-finals', false, true), placeOf('Semifinals', true, true)], [3, null, 5, 17, null]);
  assert.ok(isPool(['Match 1/3', 'Match 3/3']) && !isPool(['Match 1/3', 'Final']) && !isPool([]));
  // Level on wins and submissions, the one who beat the other goes first.
  const places = poolPlaces([{ key: 'a', wins: 1, subs: 0 }, { key: 'b', wins: 2, subs: 0 }, { key: 'c', wins: 1, subs: 0 }], (x, y) => x === 'c' && y === 'a');
  assert.deepEqual(JSON.parse(JSON.stringify([...places])), [['b', 1], ['c', 2], ['a', 3]]);
});

test('a bracket seeds by win rate where a record is known, then wins per event', () => {
  const { bySeed, sureSeed } = context.SCWRRules;
  const seeds = {
    rate: { won: 18, lost: 2, wins: 18, events: 10 },           // 90%
    deep: { won: 30, lost: 10, wins: 40, events: 10 },          // 75%, though 4 wins per event
    same: { won: 36, lost: 4, wins: 36, events: 9 },            // 90% over more matches
    career: { wins: 30, events: 10 },                           // no record: 3 per event
    partial: { won: 0, lost: 1, wins: 17, events: 16 },         // a partial record: by wins per event
    unknown: {},
  };
  const order = Object.keys(seeds).sort((a, b) => bySeed(seeds[a], seeds[b]));
  assert.deepEqual(JSON.parse(JSON.stringify(order)), ['same', 'rate', 'deep', 'career', 'partial', 'unknown']);
  const list = order.map((k) => seeds[k]);
  assert.deepEqual(list.map((_, i) => sureSeed(list, i)), [true, true, true, true, true, false]);
  // Experience counts: a long strong record outranks a short better one.
  assert.ok(bySeed({ won: 229, lost: 79, wins: 229 }, { won: 23, lost: 4, wins: 23 }) < 0);
  assert.ok(bySeed({ won: 62, lost: 29 }, { won: 5, lost: 1 }) < 0);
  assert.equal(sureSeed([{ won: 1, lost: 1 }, { won: 2, lost: 2 }, { won: 1, lost: 1 }], 0), false);
  // A short perfect record doesn't outrank a long strong one.
  assert.ok(bySeed({ won: 9, lost: 2 }, { won: 2, lost: 0 }) < 0);
  assert.ok(bySeed({ won: 20, lost: 2 }, { won: 9, lost: 2 }) < 0);
});

const pick = ({ age, weight }) => ({ age, weight });

// Division names as organisers on both sites write them (read from D1, 2026-11-25).
const DIVISIONS = {
  "Men's GI / Blue / Master 2 / 85KG": ['Master 2', '−85 kg'],
  'Adult Gi / Master 1 (30+) / White / -79kg / Men': ['Master 1', '−79 kg'],
  'Gi Adult / Male / Blue / Senior (40+) / Over 230 lbs': ['Master', '+230 lbs'],
  'Masculino / Branca / Master 3 (41+) / 100,50 kg (Super Pesado)': ['Master 3', '−100.5 kg'],
  'Kids Masculino / Cinza / Junior 1  /  9-10 anos / de 30,3 até 33,2 kg (Pena)': ['Kids', '−33.2 kg'],
  'Kids Masculino / Branca / Teens /  13-15 anos / acima de 73,0 kg (Pesadíssimo)': ['Teen', '+73 kg'],
  'Youth Men\'s GI / White Belt / Teen (14-17 yrs) / -66 kg': ['Teen', '−66 kg'],
  'No Gi Kids / Boys / Pre Teen (10 - 11 yrs) / Gray / Feather II (Up to 75 lbs)': ['Kids', '−75 lbs'],
  'Gi Juveniles - Adults / Male / Adult (18+) / White / Light Feather (Up to 145 lbs)': ['Adult', '−145 lbs'],
  'Juvenil Feminino / Branca / 56,50 kg (Leve)': ['Juvenile', '−56.5 kg'],
  'Infanto Juvenil 1 / MASCULINO / BRANCA+CINZA / Infanto-Juvenil 1 / PESADO': ['Teen', 'Pesado'],
  'Gi--- Male Divisions / Adult / White / 145.1 - 155 Lbs': ['Adult', '−155 lbs'],
  'Men Gi / Purple / 190 - 199.9 (Cruiser Weight) / Adult': ['Adult', '−199.9'],
  'Men No-Gi / Intermediate / 200 & Over (Heavy Weight) / Director (40+)': ['Master', '+200'],
  'Absolute Gi Men / 18 & above / Blue': ['Adult', 'Open'],
  'TEEN NO - GI FEMALE / Grey / 68+ kg': ['Teen', '+68 kg'],
  'Prva borba / Men / Seniori / -70 kg B': ['Adult', '−70 kg'],
  'BU13 -46': ['Kids', null],
  'Men Gi / Purple / Middle Weight (80 Kg to 84.9 Kg) / Master (30+)': ['Master', '−84.9 kg'],
  'Men +18y NOGI / Professional / Masters 35+ / -77 kg': ['Master', '−77 kg'],
  'No-Gi Grappling / Male / 10-11 / Beginner / -79lbs': ['Kids', '−79 lbs'],
  'Pro Grappling / Male / Pro Grappling II (Up to 999 lbs)': [null, 'Open'],
  'C - Group E - Northern Long Weapon': [null, null],
  'TOURNOI NOGI U17/JUNIORS/SENIORS/MASTERS / Senior / Masculin / −84 HOMME / White belt': ['Adult', null],
  'Juvenile Boys No-Gi / White / Juvenile 2 / +86,5+ (Ultra heavy)': ['Juvenile', null],
};

test("a division's name gives its age group and weight class", () => {
  const { divisionOf } = context.SCWRRules;
  for (const [name, [age, weight]] of Object.entries(DIVISIONS)) assert.deepEqual((({ age, weight }) => ({ age, weight }))(divisionOf(name)), { age, weight }, name);
});

test('the usual division is the most entered over the year to the latest event, open weight aside', () => {
  const { usualDivision } = context.SCWRRules;
  const at = (start, ...divisions) => ({ start, divisions });
  const usual = usualDivision([
    at('2023-03-01', 'Gi / Adult / -94 kg', 'Gi / Adult / -94 kg'),
    at('2023-05-01', 'Gi / Adult / -94 kg'),
    at('2025-01-10', 'Gi / Master 1 (30+) / -85 kg', 'No-Gi / Master 1 (30+) / -85 kg', 'Absolute / Master 1 / Open Weight'),
    at('2025-06-01', 'Gi / Master 1 (30+) / -77 kg'),
    at('2025-11-01', 'Gi / Master 1 (30+) / -77 kg'),
  ]);
  assert.deepEqual(pick(usual), { age: 'Master 1', weight: '−77 kg' });
  // A tie goes to the newer.
  assert.deepEqual(pick(usualDivision([at('2025-01-01', 'Adult / -85 kg'), at('2025-02-01', 'Master 1 / -77 kg')])), { age: 'Master 1', weight: '−77 kg' });
  assert.deepEqual(pick(usualDivision([])), { age: null, weight: null });
});

test('a limit with no unit is not a usual weight', () => {
  const { usualDivision } = context.SCWRRules;
  const at = (start, ...divisions) => ({ start, divisions });
  assert.deepEqual(pick(usualDivision([at('2025-01-01', 'Men Gi / Purple / 190 - 199.9 (Cruiser Weight) / Adult')])), { age: 'Adult', weight: null });
  assert.deepEqual(pick(usualDivision([at('2025-01-01', 'Men Gi / 190 - 199.9 / Adult'), at('2025-02-01', 'Gi / Adult / -85 kg')])), { age: 'Adult', weight: '−85 kg' });
});

test('one class drawn differently counts as one: −84.9 kg, −185 lbs and −84 kg', () => {
  const { usualDivision } = context.SCWRRules;
  const at = (start, ...divisions) => ({ start, divisions });
  // Athlete 1296744's year: −185 lbs alone at three events, −84.9 kg at two, −84 kg at one: the class is theirs at all six.
  const usual = usualDivision([
    at('2025-12-01', 'Gi Adult / Male / Blue / Master (30+) / -185 lbs'), at('2026-03-14', 'Gi Adult / Male / Blue / Master (30+) / -185 lbs'),
    at('2026-10-10', 'Gi Adult / Male / Blue / Master (30+) / -185 lbs'), at('2026-01-24', 'Gi / Male / Blue / Adult / -84 kg'),
    at('2026-05-23', 'Men Gi / Purple / Middle Weight (80 Kg to 84.9 Kg) / Master (30+)'), at('2026-11-14', 'Men Gi / Purple / Middle Weight (80 Kg to 84.9 Kg) / Master (30+)'),
    at('2026-09-12', 'Men Gi / Blue / Cruiser Weight (85 Kg to 89.9 Kg) / Adult'),
  ]);
  assert.deepEqual(pick(usual), { age: 'Master', weight: '−185 lbs' });
});

test('a bracket is whom, the age group without its level, and the nearest weight class', () => {
  const { bracketOf, weightName } = context.SCWRRules;
  const of = (age, weight, sex = 'm') => ({ ...bracketOf({ sex, age, weight }) });
  assert.deepEqual(of('Master 1', '−84.9 kg'), { sex: 'm', age: 'Master', weight: 85 });
  assert.deepEqual(of('Master', '−185 lbs'), { sex: 'm', age: 'Master', weight: 85 });
  assert.deepEqual(of('Adult', '−82.3 kg'), { sex: 'm', age: 'Adult', weight: 80 });
  assert.deepEqual(of('Adult', '−120 kg'), { sex: 'm', age: 'Adult', weight: 101 });
  assert.deepEqual(of('Adult', '+100.5 kg'), { sex: 'm', age: 'Adult', weight: 101 });
  assert.deepEqual(of('Adult', '+94 kg'), { sex: 'm', age: 'Adult', weight: 100 });
  assert.deepEqual(of('Adult', '−53.5 kg', 'f'), { sex: 'f', age: 'Adult', weight: 53 });
  assert.deepEqual(of('Kids', '−33.2 kg', null), { sex: null, age: 'Kids', weight: 35 });
  assert.deepEqual(of('Teen', 'Pesado'), { sex: 'm', age: 'Teen', weight: null });
  assert.deepEqual({ ...bracketOf() }, { sex: null, age: null, weight: null });
  assert.equal(weightName(85), '−85 kg');
  assert.equal(weightName(101), '+100 kg');
});
