const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Two real content-script senders share one worker and Chrome's storage contract.
// No Smoothcomp requests are sent by these concurrency and expiry checks.
function worker(storage = { local: {}, session: {} }, now = 1800000000000, shared = {}) {
  let listener;
  // The shared cache: lookups answer with `shared`, shares are only recorded.
  const posts = [];
  const fetch = async (url, { body }) => {
    posts.push({ url, ...JSON.parse(body) });
    return new Response(JSON.stringify(url.endsWith('/lookup') ? shared : {}));
  };
  const storageListeners = [];
  const replies = [];
  const area = (name) => ({
    get: async (keys) => structuredClone(keys === null ? storage[name] : Object.fromEntries(keys.filter(k => k in storage[name]).map(k => [k, storage[name][k]]))),
    set: async (given) => {
      const changes = Object.fromEntries(Object.entries(given).map(([key, value]) => [key, { oldValue: structuredClone(storage[name][key]), newValue: structuredClone(value) }]));
      Object.assign(storage[name], structuredClone(given));
      for (const fn of storageListeners) fn(changes, name);
    },
    remove: async (keys) => { for (const key of keys) delete storage[name][key]; },
    getKeys: async () => Object.keys(storage[name]),
  });
  const context = vm.createContext({ URL, Response, AbortSignal, fetch, importScripts() {}, crypto: require('node:crypto').webcrypto,
    Date: class extends Date { static now() { return now; } },
    chrome: { storage: { local: area('local'), session: area('session') }, runtime: { onMessage: { addListener(fn) { listener = fn; } }, onMessageExternal: { addListener() {} } } },
  });
  for (const file of ['rules.js', 'career-cache.js', 'background.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return {
    storage,
    posts,
    now: () => now,
    replies,
    onStorageChange: fn => storageListeners.push(fn),
    advance: (ms) => { now += ms; },
    send: (message, tab = 1, host = 'grapplingindustries.smoothcomp.com') => new Promise(resolve => {
      listener({ channel: 'scwr', ...message }, { tab: { id: tab }, documentId: `doc-${tab}`, url: `https://${host}/en/event/25902/participants` }, result => { replies.push({ op: message.op, ...structuredClone(result) }); resolve(structuredClone(result)); });
    }),
  };
}

test('tabs share profile slots spread 2.1 s apart, including after the worker restarts', async () => {
  const w = worker();
  const slots = await Promise.all(Array.from({ length: 3 }, (_, i) => w.send({ op: 'slot' }, i + 1)));
  assert.deepEqual(slots.map(s => s.wait), [0, 2100, 2100]);
  const restarted = worker(w.storage);
  assert.equal((await restarted.send({ op: 'slot' })).wait, 2100);
  restarted.advance(2100);
  assert.equal((await restarted.send({ op: 'slot' })).wait, 0);
});

function page(w, fetcher, tab = 1, event) {
  class CustomEvent extends Event { constructor(name, options) { super(name); this.detail = options.detail; } }
  const document = new EventTarget();
  const stored = {};
  const fetched = [];
  const context = vm.createContext({ document, CustomEvent, setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, Response,
    Date: class extends Date { static now() { return w.now(); } },
    location: { hostname: 'grapplingindustries.smoothcomp.com' },
    SCWRSite: { event: async () => event, store: { get: (key, fallback) => stored[key] ?? fallback, set: (key, value) => { stored[key] = value; } },
      url: { page: u => `https://smoothcomp.com/en/profile/${u}`, career: (u, s) => `https://smoothcomp.com/en/athlete/${u}/wins-and-medals${s}`, skills: (u, s) => `https://smoothcomp.com/en/athlete/${u}/skills${s}` } },
    fetch: async url => { fetched.push(url); return fetcher(url); },
  });
  const bridge = vm.createContext({ document, CustomEvent, URL, Date: class extends Date { static now() { return w.now(); } }, AbortSignal,
    location: { hostname: 'grapplingindustries.smoothcomp.com' }, fetch: async url => { fetched.push(url); return fetcher(url); },
    chrome: { runtime: { sendMessage: message => w.send(message, tab) }, storage: { onChanged: { addListener: w.onStorageChange } } } });
  vm.runInContext(fs.readFileSync('shared.js', 'utf8'), bridge);
  for (const file of ['rules.js', 'career-cache.js', 'careers.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return { api: vm.runInContext('SCWRCareers', context), fetched, context, document, CustomEvent };
}
const json = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const career = () => json({ win_method_breakdown: [{ won_by: 'submission', count: 7 }], medals: { gold: 1, silver: 0, bronze: 0 } });
const events = total => new Response(JSON.stringify({ data: [], meta: { total } }), { headers: { 'Content-Type': 'application/json' } });
const profile = w => new Response(`<athlete-profile data-data-signature="{&quot;signature&quot;:&quot;abc&quot;,&quot;expires&quot;:${Math.floor(w.now() / 1000) + 900}}"></athlete-profile>`);

test('career and belt readers share one profile request and persist without an event-wide save', async () => {
  const w = worker();
  const p = page(w, url => url.includes('/profile/') ? profile(w) : url.includes('/skills') ? json([{ name: 'BJJ', belt: 'Purple', sort_order: 1 }]) : url.includes('/past-events') ? events(29) : career());
  await Promise.all([p.api.readCareer('1'), p.api.readCareer('1'), p.api.readRank('1')]);
  assert.equal(p.fetched.filter(url => url.includes('/profile/')).length, 1);
  assert.equal(p.fetched.length, 4);
  assert.equal(p.api.careers['1'].wins.submission, 7);
  assert.equal(p.api.careers['1'].events, 29);
  assert.equal(p.api.ranks['1'].belt, 'purple');
  assert.equal((await w.send({ op: 'claim', kind: 'careers', user: '1' }, 2)).entry.wins.submission, 7);
  assert.equal(w.storage.session['scwr:requests'].sites['smoothcomp.com'].asked.length, 1);
});

test('a career read before the shown event ended is read again there, and kept elsewhere', async () => {
  const w = worker();
  const fetcher = url => url.includes('/profile/') ? profile(w) : career();
  await page(w, fetcher).api.readCareer('1');
  w.advance(24 * 60 * 60 * 1000);
  const upcoming = page(w, fetcher, 2, { end: new Date(w.now() + 1000).toISOString() });
  await upcoming.api.readCareer('1');
  assert.equal(upcoming.fetched.length, 0);
  const ended = page(w, fetcher, 3, { end: new Date(w.now() - 1000).toISOString() });
  await ended.api.ready;
  assert.equal(ended.api.fresh('1'), false);
  await ended.api.readCareer('1');
  assert.equal(ended.fetched.filter(url => url.includes('/profile/')).length, 1);
  assert.equal(ended.api.fresh('1'), true);
});

test('a career read before the last event its athlete entered ended is read again on any page', async () => {
  const shared = { careers: {} };
  const w = worker(undefined, undefined, shared);
  const fetcher = url => url.includes('/profile/') ? profile(w) : career();
  await page(w, fetcher).api.readCareer('1');
  w.advance(24 * 60 * 60 * 1000);
  shared.ended = { 1: w.now() - 1000, 2: 'x' };
  const p = page(w, fetcher, 2);
  await p.api.lookup(['1', '2']);
  assert.equal(p.api.fresh('1'), false);
  await p.api.readCareer('1');
  assert.equal(p.fetched.filter(url => url.includes('/profile/')).length, 1);
  assert.equal(p.api.fresh('1'), true);
});

test('a second tab joins completed work instead of fetching the athlete twice', async () => {
  const w = worker();
  const fetcher = url => url.includes('/profile/') ? profile(w) : career();
  const first = page(w, fetcher);
  const second = page(w, fetcher, 2);
  await Promise.all([first.api.readCareer('1'), second.api.readCareer('1')]);
  assert.equal(first.fetched.length + second.fetched.length, 3);
  assert.equal(second.api.careers['1'].wins.submission, 7);
});

test('confirmed privacy skips the career endpoint, then is rechecked after 30 days', async () => {
  const w = worker();
  let privateProfile = true;
  const p = page(w, url => url.includes('/profile/') ? privateProfile ? new Response('<h1>This profile is not public.</h1>') : profile(w) : career());
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 1);
  assert.equal(p.api.careers['1'].hidden, true);
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 1);
  w.advance(30 * 24 * 60 * 60 * 1000 + 1);
  privateProfile = false;
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 4);
  assert.equal(p.api.careers['1'].wins.submission, 7);
});

test('403s and unexpected unsigned pages are not cached as private', async () => {
  for (const fetcher of [url => url.includes('/profile/') ? new Response('<h1>Forbidden</h1>', { status: 403 }) : career(),
    url => url.includes('/profile/') ? new Response('<h1>Something unexpected</h1>') : career(),
    url => url.includes('/profile/') ? profile({ now: () => 1800000000000 }) : new Response('Forbidden', { status: 403 })]) {
    const w = worker();
    const p = page(w, fetcher);
    await p.api.readCareer('1');
    assert.equal(p.api.fresh('1'), false);
    assert.equal(p.api.careers['1'], undefined);
    assert.equal(Object.values(w.storage.local).some(entry => entry.hidden), false);
  }
});

test('a cached career costs no slots and a belt-only read costs exactly one', async () => {
  const w = worker();
  await w.send({ op: 'import', careers: { '1': { at: w.now(), wins: {}, medals: [0, 0, 0] } }, ranks: {} });
  const p = page(w, url => url.includes('/profile/') ? profile(w) : json([]));
  await p.api.ready;
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 0);
  await p.api.readRank('1');
  assert.equal(p.fetched.length, 2);
  assert.equal(w.storage.session['scwr:requests'].sites['smoothcomp.com'].asked.length, 1);
});

test('one tab owns a career; completed work is immediately available in another', async () => {
  const w = worker();
  const job = { kind: 'careers', user: '123' };
  const owner = await w.send({ op: 'claim', ...job });
  assert.ok(owner.token);
  assert.ok((await w.send({ op: 'claim', ...job }, 2)).wait > 0);
  const entry = { at: 1800000000000, wins: { submission: 7 }, medals: [1, 2, 0] };
  await w.send({ op: 'complete', ...job, token: owner.token, entry });
  assert.deepEqual((await w.send({ op: 'claim', ...job }, 2)).entry, entry);
  assert.equal(Object.values(w.storage.local).filter(e => e?.wins).length, 1);
});

test('private profiles expire after 30 days while public careers stay for three weeks', async () => {
  const w = worker();
  for (const [user, entry] of [['1', { at: 1800000000000, hidden: true }], ['2', { at: 1800000000000, wins: {}, medals: [0, 0, 0] }]]) {
    const job = { kind: 'careers', user };
    const { token } = await w.send({ op: 'claim', ...job });
    await w.send({ op: 'complete', ...job, token, entry });
  }
  w.advance(21 * 24 * 60 * 60 * 1000 + 1);
  assert.ok((await w.send({ op: 'claim', kind: 'careers', user: '1' })).entry.hidden);
  assert.ok((await w.send({ op: 'claim', kind: 'careers', user: '2' })).token);
  w.advance(9 * 24 * 60 * 60 * 1000);
  assert.ok((await w.send({ op: 'claim', kind: 'careers', user: '1' })).token);
});

test('a vanished tab cannot keep a career claimed indefinitely', async () => {
  const w = worker();
  const job = { kind: 'careers', user: '1' };
  const first = await w.send({ op: 'claim', ...job });
  w.advance(121000);
  const next = await w.send({ op: 'claim', ...job }, 2);
  assert.ok(next.token);
  assert.notEqual(first.token, next.token);
  await w.send({ op: 'complete', ...job, token: first.token, entry: { at: 1800000121000, hidden: true } });
  assert.ok((await w.send({ op: 'claim', ...job }, 3)).wait > 0);
});

test('cooldowns are shared; AJP and lookalike hosts cannot interfere with Smoothcomp', async () => {
  const w = worker();
  await w.send({ op: 'cooldown', ms: 30000 });
  assert.equal((await w.send({ op: 'slot' }, 2)).wait, 30000);
  assert.equal((await w.send({ op: 'slot' }, 3, 'ajptour.com')).wait, 0);
  assert.ok((await w.send({ op: 'slot' }, 4, 'notsmoothcomp.com')).error);
});

test('refusals in flight count once, and five running pause reading for a quarter hour', async () => {
  const w = worker();
  await Promise.all([1, 2, 3].map(tab => w.send({ op: 'cooldown' }, tab)));
  assert.deepEqual(await w.send({ op: 'slot' }), { wait: 10000, paused: false });
  for (const ms of [10000, 20000, 40000, 60000]) {
    w.advance(ms);
    await w.send({ op: 'cooldown' });
  }
  assert.deepEqual(await w.send({ op: 'available' }), { wait: 15 * 60000, paused: true });
  w.advance(15 * 60000);
  assert.deepEqual(await w.send({ op: 'slot' }), { wait: 0, paused: true });
  await w.send({ op: 'healthy' });
  assert.deepEqual(await w.send({ op: 'available' }), { wait: 2100, paused: false });
});

test('old ambiguous hidden entries are discarded and simultaneous saves survive', async () => {
  const w = worker();
  await Promise.all([
    w.send({ op: 'import', careers: { '1': { at: 1800000000000 }, '2': { at: 1800000000000, wins: {}, medals: [0, 0, 0] } }, ranks: {} }),
    w.send({ op: 'import', careers: { '3': { at: 1800000000000, hidden: true } }, ranks: {} }, 2),
  ]);
  const kept = await w.send({ op: 'read' });
  assert.deepEqual(Object.keys(kept.careers).sort(), ['2', '3']);
});

test('expired privacy does not resurrect an older public cache from another organiser', async () => {
  const w = worker({ local: {
    'smoothcomp.com:careers': { '1': { at: 1799999999000, wins: { points: 9 }, medals: [0, 0, 0] } },
    'scwr2:smoothcomp.com:careers:1': { at: 1800000000000, hidden: true },
  }, session: {} });
  w.advance(30 * 24 * 60 * 60 * 1000 + 1);
  const p = page(w, url => url.includes('/profile/') ? profile(w) : career());
  await p.api.ready;
  assert.equal(p.api.fresh('1'), false);
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 3);
  assert.equal(p.api.careers['1'].wins.submission, 7);
});

test('cleanup keeps private profiles through 30 days while removing expired public data', async () => {
  const now = 1800000000000;
  const old = now - 22 * 86400000;
  const tombstone = now - 25 * 86400000;
  const w = worker({ local: {
    'scwr2:smoothcomp.com:careers:1': { at: old, wins: {}, medals: [0, 0, 0] },
    'scwr2:smoothcomp.com:careers:2': { at: tombstone, hidden: true },
  }, session: {
    'scwr2:smoothcomp.com:signatures:1': { at: now - 100000, signature: 'abc', expires: now / 1000 - 1 },
  } });
  await w.send({ op: 'read' });
  assert.equal(w.storage.local['scwr2:smoothcomp.com:careers:1'], undefined);
  assert.equal(w.storage.session['scwr2:smoothcomp.com:signatures:1'], undefined);
  assert.equal(w.storage.local['scwr2:smoothcomp.com:careers:2'].at, tombstone);
  w.advance(6 * 86400000);
  await w.send({ op: 'read' });
  assert.equal(w.storage.local['scwr2:smoothcomp.com:careers:2'], undefined);
});

test('page events cannot forge a global cooldown', async () => {
  const w = worker();
  const p = page(w, () => career());
  await p.api.ready;
  const response = new Promise(resolve => {
    const listener = event => { const result = JSON.parse(event.detail); if (result.id === 900000) { p.document.removeEventListener('scwr:response', listener); resolve(result); } };
    p.document.addEventListener('scwr:response', listener);
  });
  p.document.dispatchEvent(new p.CustomEvent('scwr:request', { detail: JSON.stringify({ id: 900000, op: 'cooldown', ms: 86400000 }) }));
  assert.ok((await response).error);
  assert.equal((await w.send({ op: 'slot' }, 2)).wait, 0);
});

test('a real throttle or challenge pauses other tabs, then retries without caching privacy', async () => {
  for (const refusal of [() => new Response('Too many requests', { status: 429, headers: { 'Retry-After': '30' } }),
    () => new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge' } })]) {
    const w = worker();
    const send = w.send;
    let blocked;
    w.send = async (...args) => {
      const result = await send(...args);
      if (args[0].op === 'cooldown') {
        blocked = (await send({ op: 'slot' }, 2)).wait;
        w.advance(blocked + 1);
      }
      return result;
    };
    let attempts = 0;
    const p = page(w, url => url.includes('/profile/') ? ++attempts === 1 ? refusal() : profile(w) : career());
    await p.api.readCareer('1');
    assert.ok(blocked >= 10000);
    assert.equal(attempts, 2);
    assert.equal(p.api.careers['1'].wins.submission, 7);
    assert.equal(p.api.careers['1'].hidden, undefined);
  }
});

test('a transient initial worker failure recovers without reloading the page', async () => {
  const w = worker();
  const send = w.send;
  let failed = false;
  w.send = (...args) => {
    if (args[0].op === 'read' && !failed) { failed = true; return Promise.reject(new Error('Worker restarting')); }
    return send(...args);
  };
  const p = page(w, url => url.includes('/profile/') ? profile(w) : career());
  await p.api.readCareer('1');
  assert.equal(p.api.careers['1'].wins.submission, 7);
});

test('scrolling during a slot wait selects the newly visible pending athlete without spending a slot', async () => {
  const w = worker();
  await Promise.all(Array.from({ length: 5 }, () => w.send({ op: 'slot' })));
  const p = page(w, () => career());
  let visible = new Set(['1']);
  p.api.configure({ priority: () => visible, changed() {} });
  const pending = new Set(['1', '2']);
  const next = p.api.next(pending, () => true);
  while (!w.replies.some(r => r.op === 'available' && r.wait > 0)) await new Promise(setImmediate);
  visible = new Set(['2']);
  w.advance(10500);
  assert.equal(await next, '2');
  assert.deepEqual([...pending], ['1']);
  assert.equal(p.fetched.length, 0);
  const slots = await Promise.all(Array.from({ length: 6 }, () => w.send({ op: 'slot' })));
  assert.equal(slots.filter(r => r.wait === 0).length, 1);
});

test('another tab broadcasts completed careers through the isolated bridge', async () => {
  const w = worker();
  const first = page(w, url => url.includes('/profile/') ? profile(w) : career());
  const second = page(w, url => url.includes('/profile/') ? profile(w) : career(), 2);
  await Promise.all([first.api.ready, second.api.ready]);
  let updated;
  first.api.configure({ priority: () => new Set(), changed(users) { if (users?.size) updated = [...users]; } });
  await second.api.readCareer('1');
  assert.equal(first.fetched.length, 0);
  assert.equal(first.api.careers['1'].wins.submission, 7);
  assert.deepEqual(updated, ['1']);
});

test('a career kept without its event count is read again only when the count is asked for', async () => {
  const w = worker({ local: { 'scwr2:smoothcomp.com:careers:1': { at: 1800000000000, wins: { points: 9 }, medals: [0, 0, 0] } }, session: {} });
  let failEvents = true;
  const p = page(w, url => url.includes('/profile/') ? profile(w) : url.includes('/past-events') ? (failEvents ? new Response('', { status: 404 }) : events(12)) : career());
  await p.api.ready;
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 0);
  w.advance(1000);
  await p.api.readCareer('1', true);
  assert.equal(p.fetched.length, 3);
  assert.equal(p.api.careers['1'].wins.submission, 7);
  assert.equal(p.api.careers['1'].events, undefined);
  failEvents = false;
  w.advance(1000);
  await p.api.readCareer('1', true);
  assert.equal(p.api.careers['1'].events, 12);
  assert.equal((await w.send({ op: 'claim', kind: 'careers', user: '1', events: true }, 2)).entry.events, 12);
});

test('the shared cache answers for the event before any profile is read, and keeps each new career', async () => {
  const w = worker(undefined, undefined, { careers: { 1: { at: 1800000000000, wins: { points: 3 }, medals: [1, 0, 0], events: 2 } } });
  const p = page(w, url => url.includes('/profile/') ? profile(w) : url.includes('/past-events') ? events(4) : career());
  await p.api.ready;
  p.api.lookup(['1', '2']);
  await p.api.readCareer('1');
  assert.equal(p.fetched.length, 0);
  assert.equal(p.api.careers['1'].wins.points, 3);
  assert.deepEqual(w.posts[0], { url: 'https://mat-stats.mohamed3on.workers.dev/lookup', site: 'smoothcomp.com', users: ['1', '2'] });
  await p.api.readCareer('2');
  const kept = w.posts.filter(post => post.url.endsWith('/keep'));
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].careers['2'].wins, { submission: 7 });
});

test('a kept cache goes to the shared cache once, and careers it already had are not sent back', async () => {
  const kept = { at: 1800000000000, wins: { points: 9 }, medals: [0, 0, 0] };
  const w = worker({ local: { 'scwr2:smoothcomp.com:careers:1': kept }, session: {} }, undefined, { careers: { 2: { ...kept, at: 1800000000001 } } });
  await w.send({ op: 'read' });
  await w.send({ op: 'read' });
  await w.send({ op: 'shared', users: ['2'] });
  assert.deepEqual(w.posts.map(post => post.url.split('/').pop()), ['keep', 'lookup']);
  assert.deepEqual(w.posts[0].careers, { 1: kept });
});

test('a results page sends its records, and the lookup brings back what was seen of each athlete', async () => {
  const w = worker(undefined, undefined, { careers: {}, ranks: {}, seen: { 3: [4, 1, 2], 4: [1, 'x', 1] } });
  await w.send({ op: 'record', event: '25902', records: { 3: [2, 0] } }, 1, 'smoothcomp.com');
  assert.deepEqual(w.posts[0], { url: 'https://mat-stats.mohamed3on.workers.dev/record', site: 'smoothcomp.com', event: '25902', records: { 3: [2, 0] } });
  const p = page(w, () => { throw new Error('no reads'); });
  p.api.lookup(['3', '4']);
  await p.api.next(new Set(), () => true);
  assert.equal(JSON.stringify(p.api.seen), '{"3":[4,1,2]}');
});

test('careers are read down the list shown, then on screen, then the rest', async () => {
  const w = worker();
  const p = page(w, () => career());
  p.api.configure({ priority: () => new Set(['1']), listed: () => ['9', '3', '2'], changed() {} });
  const pending = new Set(['1', '2', '3']);
  assert.equal(await p.api.next(pending, () => true), '3');
  p.api.configure({ priority: () => new Set(['2']), listed: () => [], changed() {} });
  w.advance(2100);
  assert.equal(await p.api.next(pending, () => true), '2');
});

test('only the first page of past events is read, and its rows are shared as the athlete history', async () => {
  const w = worker();
  const past = url => new Response(JSON.stringify({ data: [{ id: url.includes('page=2') ? 2 : 1, title: 'Open', start_date: '2026-01-01T00:00:00+00:00', city: 'Berlin', wins: 3, medals: { gold: 1, silver: 0, bronze: 0 } }], meta: { total: 6, last_page: 2 } }));
  const read = [];
  const p = page(w, url => url.includes('/profile/') ? profile(w) : url.includes('/past-events') ? (read.push(url), past(url)) : career());
  await p.api.readCareer('1');
  await new Promise(done => setTimeout(done, 20));
  const shared = w.posts.find(post => post.url.endsWith('/people') && post.athletes?.['1']?.history);
  assert.deepEqual(shared.athletes['1'].history.map(e => [e.event, e.wins, e.medals]), [['1', 3, [1, 0, 0]]]);
  assert.equal(read.length, 1);
  assert.equal(p.api.careers['1'].events, 6);
});

// A page's store (site.js) through the real bridge (shared.js) to the real worker: big things live in the
// extension, one store per site, each kind holding its latest few; careers are read without them.
test("a page keeps big things in the extension's storage, per site, each kind holding its latest few", async () => {
  const w = worker();
  class CustomEvent extends Event { constructor(name, options) { super(name); this.detail = options.detail; } }
  const tab = (host, id) => {
    const document = new EventTarget();
    const bridge = vm.createContext({ document, CustomEvent, URL, Date, AbortSignal, location: { hostname: host }, fetch: async () => { throw new Error('no fetch'); },
      chrome: { runtime: { sendMessage: message => w.send(message, id, host) }, storage: { onChanged: { addListener() {} } } } });
    vm.runInContext(fs.readFileSync('shared.js', 'utf8'), bridge);
    const context = vm.createContext({ document, CustomEvent, setTimeout, clearTimeout, location: { pathname: '/en/event/1/results', hostname: host } });
    for (const file of ['rules.js', 'site.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    return vm.runInContext('SCWRSite.store', context);
  };
  const smoothcomp = tab('grapplingindustries.smoothcomp.com', 1);
  const ajp = tab('ajptour.com', 2);
  smoothcomp.write('event-matches:1', { matches: ['a'] }, true);
  for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10]) { w.advance(1000); await smoothcomp.save(`event-matches:${id}`, { v: 9, at: w.now(), final: true, matches: [id] }); }
  assert.equal((await smoothcomp.load('event-matches:10')).matches[0], 10);
  // The newest eight stay; the two written first are gone.
  assert.equal(await smoothcomp.load('event-matches:1'), null);
  assert.equal(await smoothcomp.load('event-matches:2'), null);
  assert.deepEqual(Object.keys(w.storage.local).filter(k => k.startsWith('cache:smoothcomp.com:event-matches:')).length, 8);
  // Another site keeps its own.
  assert.equal(await ajp.load('event-matches:10'), null);
  // Only the kinds the worker knows.
  assert.equal(await smoothcomp.load('passwords:1'), null);
  // A career beside the caches still reads, and the caches don't come with it.
  await w.send({ op: 'import', careers: { 7: { at: w.now(), wins: { submission: 1 }, medals: [0, 0, 0] } } });
  const read = await w.send({ op: 'read' });
  assert.deepEqual(Object.keys(read.careers), ['7']);
});
