const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, memoryStorage, plain } = require('./load.cjs');

const site = (globals) => load(['site.js'], { location: { pathname: '/en/' }, ...globals })('SCWRSite');

test('links follow the reader\u2019s locale; fetched data is pinned to English', () => {
  const en = site({ location: { pathname: '/en/event/19856/results' } });
  assert.equal(en.eventId(), '19856');
  assert.equal(en.url.profile(7), '/en/profile/7');
  assert.equal(en.url.bracket(19856, 42), '/en/event/19856/bracket/42');
  assert.equal(en.url.match(99), 'https://smoothcomp.com/en/getBracketMatchData/99');
  assert.equal(en.url.data(19856, 'schedule', 'matchlist'), '/en/event/19856/schedule/matchlist');
  assert.equal(en.url.data(19856), '/en/event/19856');
  // The manifest matches every locale segment, so a Swedish reader stays in Swedish.
  const sv = site({ location: { pathname: '/sv/event/19856/results' } });
  assert.equal(sv.url.profile(7), '/sv/profile/7');
  assert.equal(sv.url.bracket(19856, 42), '/sv/event/19856/bracket/42');
  assert.equal(sv.eventId(), '19856');
  // What gets parsed does not: the win types, statuses and division names the
  // parsers expect only exist in English.
  assert.equal(sv.url.data(19856, 'schedule', 'matchlist'), '/en/event/19856/schedule/matchlist');
  // Anything that is not a two-letter segment falls back rather than guessing.
  assert.equal(site({ location: { pathname: '/event/1/results' } }).locale(), 'en');
});

test('ids come out of hrefs, and an absent one is null', () => {
  const s = site({ location: { pathname: '/en/event/1/results' } });
  assert.equal(s.bracketId('/en/event/1/bracket/553'), '553');
  assert.equal(s.profileId('https://x.smoothcomp.com/en/profile/99'), '99');
  assert.equal(s.profileId('/en/event/1/results'), null);
  assert.equal(s.bracketId(null), null);
});

test('preferences never expire; a running event goes stale in minutes', () => {
  const localStorage = memoryStorage();
  const s = site({ localStorage });
  s.store.set('prefs', { sort: 'wins' });
  assert.deepEqual(plain(s.store.get('prefs')), { sort: 'wins' });
  assert.equal(s.store.get('never-written', 'fallback'), 'fallback');

  const age = (key, ms) => {
    const entry = JSON.parse(localStorage.map.get(`scwr:${key}`));
    localStorage.map.set(`scwr:${key}`, JSON.stringify({ ...entry, at: entry.at - ms }));
  };
  const SIX_MINUTES = 6 * 60 * 1000;
  const THIRTEEN_HOURS = 13 * 60 * 60 * 1000;

  s.store.write('live', { matches: [1] }, false);
  assert.ok(s.store.read('live'));
  age('live', SIX_MINUTES);
  assert.equal(s.store.read('live'), null);

  // The same entry, marked final, is good for the rest of the day.
  s.store.write('done', { matches: [1] }, true);
  age('done', SIX_MINUTES);
  assert.ok(s.store.read('done'));
  age('done', THIRTEEN_HOURS);
  assert.equal(s.store.read('done'), null);
});

test('an entry written by an older version is ignored rather than trusted', () => {
  const localStorage = memoryStorage();
  const s = site({ localStorage });
  localStorage.map.set('scwr:old', JSON.stringify({ v: 1, at: Date.now(), final: true, matches: [] }));
  assert.equal(s.store.read('old'), null);
  // Preferences carry no version, so they survive a bump.
  localStorage.map.set('scwr:plain', JSON.stringify({ sort: 'wins' }));
  assert.deepEqual(plain(s.store.get('plain')), { sort: 'wins' });
});

test('a full disk and unreadable junk fail the store, not the page', () => {
  const full = site({ localStorage: { getItem: () => null, setItem() { throw new Error('QuotaExceeded'); } } });
  assert.doesNotThrow(() => full.store.set('x', { a: 1 }));
  assert.equal(full.store.get('x', 'fallback'), 'fallback');

  const junk = site({ localStorage: { getItem: () => '{not json', setItem() {} } });
  assert.equal(junk.store.get('x', 'fallback'), 'fallback');
  assert.equal(junk.store.read('x'), null);
});

test('the win-type vocabulary reads most decisive first, and youth is matched off the division name', () => {
  const s = site({});
  assert.deepEqual(plain(s.WIN_TYPES), ['submission', 'points', 'decision', 'disqualification', 'walkover']);
  assert.equal(s.isYouth('Gi Kids White / -30kg'), true);
  assert.equal(s.isYouth('No Gi Teens Blue'), true);
  assert.equal(s.isYouth('Gi Adult Black'), false);
  assert.equal(s.isYouth('Gi Masters 1'), false);
  // "Kids" has to lead the division name, not merely appear in it.
  assert.equal(s.isYouth('Gi Adult / Kids coaches'), false);
});
