// The results page, end to end, over events Smoothcomp actually served: the
// schedule through the loader, then the published results and the registration
// list through the model, exactly as results.js composes them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replay, memoryStorage, plain } = require('./load.cjs');

// What the page counts by default: every decided win type but walkovers.
const COUNTED = ['submission', 'points', 'decision', 'disqualification'];

async function resultsPage(name, options) {
  const page = replay(name, options);
  const { matches, final } = await page.SCWRMatches.loadEvent();
  return { ...page, final, model: page.SCWRModel.build(page.results, matches, page.participants) };
}

test('a finished event: every fought match lands on a published bracket', async () => {
  const { model, final, fetched } = await resultsPage('25901');
  // The same totals the old match-list parser produced for this event.
  assert.equal(model.athletes.size, 401);
  assert.equal(model.brackets.size, 149);
  assert.equal(model.fought, 876);
  assert.equal(model.walkovers, 168);
  // Round-robin pools link to their own bracket and join the published division
  // by name, and all 87 hidden profiles join by user: nothing fought is lost.
  assert.equal(model.unmatched, 0);
  assert.equal(model.unpublished, 0);
  // What is left over is walkovers against people the results never list.
  assert.equal(model.noShows, 49);
  // One day, its mats, then twelve mats read at once.
  assert.equal(fetched.length, 14);
  assert.equal(final, true);
});

test('a live event counts the matches already fought', async () => {
  const { model, final } = await resultsPage('29650-live');
  // Read off the match-list page, this snapshot showed 0 fought: while an event
  // runs, that page lists only the matches still to come.
  assert.equal(model.fought, 1220);
  assert.equal(model.walkovers, 82);
  assert.equal(model.unresolved, 113);
  // 212 decided matches sit in divisions Smoothcomp has not published yet, and
  // join the tables once it does; nothing in a published division goes missing.
  assert.equal(model.unpublished, 212);
  assert.equal(model.unmatched, 0);
  assert.equal(model.noShows, 59);
  assert.equal(final, false);
});

test('the leaderboards rank athletes and academies on the win types counted', async () => {
  const { model, SCWRModel } = await resultsPage('25901');
  const board = (table, types) => SCWRModel.leaderboard(model, { table, types, sort: 'wins' });
  // Ties on wins fall to golds: both 9–0 and both 9–2 athletes order by medals.
  assert.deepEqual(plain(board('athletes', COUNTED).slice(0, 5).map((a) => [a.name, a.wins, a.losses, a.golds])), [
    ['Athlete 94', 13, 2, 3], ['Athlete 120', 9, 0, 2], ['Athlete 139', 9, 0, 1], ['Athlete 160', 9, 2, 1], ['Athlete 140', 9, 2, 0],
  ]);
  assert.deepEqual(plain(board('academies', COUNTED).slice(0, 2).map((a) => [a.name, a.wins, a.losses])), [
    ['PSLPB CICERO COSTHA', 84, 49], ['Fightzone Berlin', 58, 49],
  ]);
  // Four of this athlete's seven wins were walkovers, counted only on request.
  const record = (types) => board('athletes', types).find((a) => a.name === 'Athlete 181');
  assert.deepEqual([record(COUNTED).wins, record(COUNTED).losses], [3, 3]);
  assert.deepEqual([record([...COUNTED, 'walkover']).wins, record([...COUNTED, 'walkover']).losses], [7, 3]);
});

test('the brackets view finds the one medal the match wins did not earn', async () => {
  const { model, SCWRModel } = await resultsPage('25901');
  const gaps = SCWRModel.leaderboard(model, { table: 'brackets', types: COUNTED, sort: 'gapCount' }).filter((b) => b.gapCount);
  assert.deepEqual(plain(gaps.map((b) => [b.name, b.champion.name, b.champion.wins, b.leader.name, b.leader.wins])), [
    ['Gi Adult / Male / White / Adult / -155 lbs', 'Athlete 127', 4, 'Athlete 129', 5],
  ]);
});

test('age and belt come from the registration list, whatever the organiser calls the grade', async () => {
  const { model, SCWRModel } = await resultsPage('25901');
  const athletes = [...model.athletes.values()];
  assert.equal(athletes.filter((a) => Number.isFinite(a.age)).length, 401);
  assert.equal(SCWRModel.leaderboard(model, { table: 'athletes', types: COUNTED, sort: 'wins', minimumAge: 18 }).length, 275);
  // This event grades gi divisions by "Belt" and no-gi by "Level"; every
  // spelling of one colour lands on one chip.
  assert.deepEqual(plain(SCWRModel.beltOptions(model).map((o) => [o.label, o.count])), [
    ['White', 257], ['Grey', 25], ['Yellow/Orange', 5], ['Blue', 71], ['Purple', 31], ['Brown', 7], ['Black', 5],
  ]);
  assert.equal(SCWRModel.leaderboard(model, { table: 'athletes', types: COUNTED, sort: 'wins', belts: ['black'] }).length, 5);
  // A competitor with no photo still ships a placeholder, which is never shown.
  assert.equal(athletes.filter((a) => /placeholder/i.test(a.logo ?? '')).length, 0);
  // This one calls it "Rank", and grades everybody all the same.
  const live = (await resultsPage('29650-live')).model;
  assert.equal([...live.athletes.values()].filter((a) => a.belt).length, live.athletes.size);
});

test('an athlete counts for their academy before it approves their registration', async () => {
  const { model, SCWRModel } = await resultsPage('25901');
  // The published results leave the academy blank until it approves the
  // registration, which the registration list already names: two of Randori
  // Pro Berlin's three athletes are still waiting. Nobody is left unaffiliated.
  const academies = SCWRModel.leaderboard(model, { table: 'academies', types: COUNTED, sort: 'wins' });
  const randori = academies.find((a) => a.name === 'Randori Pro Berlin');
  assert.deepEqual([randori.athletes, randori.wins, randori.losses], [3, 7, 6]);
  assert.equal(academies.find((a) => a.name === 'Unaffiliated'), undefined);
  // The matchups credit the same athletes: against every other academy they add
  // up to the table's 7–6, two of the wins over PSLPB CICERO COSTHA.
  const against = academies.filter((a) => a !== randori)
    .map((a) => SCWRModel.headToHead(model.matches, randori.name, a.name, COUNTED));
  assert.deepEqual([against.reduce((n, h) => n + h.a.wins, 0), against.reduce((n, h) => n + h.b.wins, 0)], [7, 6]);
  const pslpb = SCWRModel.headToHead(model.matches, randori.name, 'PSLPB CICERO COSTHA', COUNTED);
  assert.deepEqual([pslpb.a.wins, pslpb.b.wins], [2, 0]);
});

test('data is read in English whatever language the reader browses in', async () => {
  const { model, fetched } = await resultsPage('25901', { pathname: '/de/event/25901/results' });
  assert.ok(fetched.every((url) => url.startsWith('/en/')));
  assert.equal(model.fought, 876);
});

test('a finished event is read once; a live one goes stale in minutes', async () => {
  const done = memoryStorage();
  await resultsPage('25901', { localStorage: done });
  assert.equal((await resultsPage('25901', { localStorage: done })).fetched.length, 0);

  const live = memoryStorage();
  await resultsPage('29650-live', { localStorage: live });
  assert.equal((await resultsPage('29650-live', { localStorage: live })).fetched.length, 0);
  const [key, entry] = [...live.map].find(([k]) => k.startsWith('scwr:event-matches:'));
  live.map.set(key, JSON.stringify({ ...JSON.parse(entry), at: JSON.parse(entry).at - 6 * 60 * 1000 }));
  assert.equal((await resultsPage('29650-live', { localStorage: live })).fetched.length, 14);
});

test('an old, unreadable or unwritable cache never costs the reader the numbers', async () => {
  // Matches cached by the match-list parser this loader replaced.
  const old = memoryStorage();
  old.map.set('scwr:event-matches:25901', JSON.stringify({ v: 4, at: Date.now(), final: true, matches: [{ id: '1', sides: [] }] }));
  const junk = memoryStorage();
  junk.map.set('scwr:event-matches:25901', '{not json');
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  for (const localStorage of [old, junk, full]) {
    assert.equal((await resultsPage('25901', { localStorage })).model.fought, 876);
  }
});
