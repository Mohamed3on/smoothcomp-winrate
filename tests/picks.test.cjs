// The participants page's bracket picks: labels from four organisers, then one
// real event (Grappling Industries Berlin, 25902, mid-registration) as the
// signed-in athlete saw it — a 31-year-old white belt man weighing 82 kg, who is
// "1" there, with every career the page would read already tallied.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

// picks.js is pure, so it runs in this realm and its values compare directly.
const SCWRPicks = vm.runInThisContext(`${fs.readFileSync(path.join(__dirname, '..', 'picks.js'), 'utf8')}\nSCWRPicks`, { filename: 'picks.js' });
const event = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', '25902-picks.json.gz'))));
const values = new Map(event.categories.map((c) => [c.id, c]));
// Biggest first, as the page orders them.
const groups = [...event.groups].sort((a, b) => b.registrations.length - a.registrations.length);
const tally = (user) => event.tallies[user] ?? null;
const me = { id: '1', gender: 'M', belt: 'white', age: 31, weight: 82, tally: tally('1') };
const LB = 0.45359237;

test('labels read the same whichever organiser wrote them', () => {
  const read = (category_name, name, bounds = {}) => SCWRPicks.demand({ category_name, name, ...bounds });
  const kg = (min, max) => ({ datatype: 'weight', datatype_weight_unit: 'kg', weight_minimum: min, weight_maximum: max });
  // Grappling Industries: pounds, colours inside levels, ages in words.
  assert.deepEqual(read('Weight', '-185 lbs'), { weight: [0, 185 * LB] });
  assert.deepEqual(read('Weight', 'Over 230 lbs'), { weight: [230 * LB, Infinity] });
  assert.deepEqual(read('Level', 'Beginner (White)'), { belts: ['white'] });
  assert.deepEqual(read('Level', 'Advanced (Purple/Brown/Black)'), { belts: ['purple', 'brown', 'black'] });
  assert.deepEqual(read('Division', 'Masters & Seniors'), { age: [30, Infinity] });
  assert.deepEqual(read('Division', 'Adult'), { age: [18, Infinity] });
  assert.deepEqual(read('Division', '14 - 15 years (Male)'), { age: [14, 15] });
  assert.deepEqual(read('Gender', 'Male'), {});
  // ADCC: levels go by experience, so they say nothing of a belt.
  assert.equal(read('Rank', 'Beginner'), null);
  assert.deepEqual(read('Age', 'Master 2 (age 35+)'), { age: [35, Infinity] });
  assert.deepEqual(read('Age ', '+40 years'), { age: [40, Infinity] });
  assert.deepEqual(read('Weight', '-76,0 kg', kg(null, '76.00')), { weight: [0, 76] });
  assert.deepEqual(read('Weight', '+99 kg', kg(null, null)), { weight: [99, Infinity] });
  // AJP: named ages, and weights that are ceilings without saying so.
  assert.deepEqual(read('Age', 'Master 1'), { age: [30, Infinity] });
  assert.deepEqual(read('Age', 'Teen'), { age: [0, 17] });
  assert.deepEqual(read('Age', 'Amateur'), { age: [18, Infinity] });
  assert.deepEqual(read('Belt', 'Brown / Black'), { belts: ['brown', 'black'] });
  assert.deepEqual(read('Weight', '77KG', kg(null, '77.00')), { weight: [0, 77] });
  // JJLG: both bounds set, and an open class.
  assert.deepEqual(read('Weight', '-77,00 kg', kg('69.00', '77.00')), { weight: [69, 77] });
  assert.deepEqual(read('Weight', 'Open Weight'), { weight: [0, Infinity] });
  assert.deepEqual(read('Age', 'Youth (16-17y.o.)'), { age: [16, 17] });
});

test('an athlete may enter their own class, both disciplines, and every absolute', () => {
  const names = SCWRPicks.eligible(groups, values, me).map((g) => g.name);
  assert.deepEqual(names.sort(), [
    'Absolute Gi / Male / White / Adult',
    'Absolute No Gi - All Levels / Male / Adult',
    'Absolute No Gi - All Levels / Male / Masters & Seniors',
    'Gi Adult / Male / White / Adult / -185 lbs',
    'Gi Adult / Male / White / Master (30+) / -185 lbs',
    'No Gi Adult / Male / Beginner (White) / Adult / -185 lbs',
    'No Gi Adult / Male / Beginner (White) / Master (30+) / -185 lbs',
  ]);
  // Lighter, the class beneath; at 29, no Masters bracket.
  const light = SCWRPicks.eligible(groups, values, { ...me, weight: 77, age: 29 }).map((g) => g.name);
  assert.ok(light.includes('Gi Adult / Male / White / Adult / -170 lbs'));
  assert.ok(!light.some((name) => /-185|Master \(30\+\)|Masters/.test(name)));
});

test('the panel lists the biggest brackets the athlete would top-seed', () => {
  const { top, closest } = SCWRPicks.picks(SCWRPicks.eligible(groups, values, me), me, tally);
  assert.deepEqual(me.tally, [13, 9, 3]);
  assert.deepEqual(top.map((s) => [s.group.name, s.size, s.rival, s.hidden, s.entered]), [
    ['No Gi Adult / Male / Beginner (White) / Adult / -185 lbs', 16, 5, 2, true],
    ['Gi Adult / Male / White / Master (30+) / -185 lbs', 9, 5, 1, true],
    ['No Gi Adult / Male / Beginner (White) / Master (30+) / -185 lbs', 6, 4, 1, false],
  ]);
  assert.equal(closest, null);
});

test('with nothing to top-seed, the closest bracket stands in', () => {
  const novice = { ...me, tally: [3, 1, 1] };
  const { top, closest } = SCWRPicks.picks(SCWRPicks.eligible(groups, values, novice), novice, tally);
  assert.equal(top.length, 0);
  assert.equal(closest.group.name, 'No Gi Adult / Male / Beginner (White) / Master (30+) / -185 lbs');
  assert.equal(closest.rival, 4);
});

test('a label nothing can read counts only where the athlete entered under it', () => {
  const values = new Map([
    [1, { category_name: 'Rank', name: 'Beginner' }],
    [2, { category_name: 'Rank', name: 'Intermediate' }],
  ]);
  const bracket = (value, user) => ({ name: `Rank ${value}`, entry_id: 1, registrations: [{ user_id: user, gender: 'M', categories: [{ category_value_id: value }] }] });
  const names = SCWRPicks.eligible([bracket(1, 1), bracket(2, 2)], values, me).map((g) => g.name);
  assert.deepEqual(names, ['Rank 1']);
});
