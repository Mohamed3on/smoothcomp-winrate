const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// The shared rules, as the manifest loads them before the page script.
const rules = () => { const context = vm.createContext({}); vm.runInContext(fs.readFileSync('rules.js', 'utf8'), context); return context.SCWRRules; };

test('division medals update during loading and only depend on their own bracket', () => {
  const source = fs.readFileSync('participants.js', 'utf8');
  const careers = {
    '1': { at: Date.now(), wins: { points: 5 }, medals: [0, 0, 0], events: 1 },
    '2': { at: Date.now(), wins: { points: 3 }, medals: [0, 0, 0], events: 1 },
  };
  let medal;
  const division = {
    textContent: 'Bracket A',
    setAttribute(name, value) { this[name] = value; },
    closest: () => ({ querySelector: () => ({ getAttribute: () => '/en/profile/1' }) }),
    querySelector: () => medal,
    insertAdjacentHTML(position, html) { medal = html ? { outerHTML: html, remove() { medal = null; } } : null; },
  };
  const context = vm.createContext({
    SCWRCache: { KEPT: 21 * 86400000 },
    SCWRRules: rules(),
    SCWRCareers: { careers, ranks: {}, fresh: u => !!careers[u], configure() {} },
    SCWRSite: { store: { get() {} }, profileId: href => href.match(/profile\/(\d+)/)?.[1] },
    document: {
      querySelectorAll: selector => selector === '#registrations .participant-td-registration > div' ? [division] : [],
      querySelector: () => ({}),
    },
  });
  // Exercise the actual ranking and paint functions, without mounting Vue or
  // making requests. Only the division node's DOM contract is supplied here.
  vm.runInContext(source.slice(0, source.indexOf('const watcher =')), context);
  vm.runInContext(source.slice(source.indexOf('let foreseen ='), source.indexOf('// Each academy with')), context);
  vm.runInContext(`
    const LEADS = ['wins', 'submission']; let order = 'wins'; let draining = Promise.resolve();
    const painter = { disconnect() {}, observe() {} }; const box = { firstChild: null }; const progress = { style: { setProperty() {} } };
    const a = { name: 'Bracket A', registrations: [{ id: 1, user_id: '1' }, { id: 2, user_id: '2' }] };
    const b = { name: 'Bracket B', registrations: [{ id: 3, user_id: '3' }] };
    vm = { all: [a, b] }; place = new Map([[1, 0], [2, 1], [3, 2]]);
  `, context);
  vm.runInContext(source.slice(source.indexOf('function paint()'), source.indexOf('let queued =')), context);
  vm.runInContext('paint()', context);
  assert.match(medal?.outerHTML ?? '', /data-medal="gold"/);
  assert.doesNotMatch(medal.outerHTML, /data-tied/);

  vm.runInContext('a.registrations.push(b.registrations[0]); paint()', context);
  assert.match(medal.outerHTML, /data-medal="gold"/);
  assert.match(medal.outerHTML, /data-tied/);

  careers['3'] = { at: Date.now(), wins: { points: 10 }, medals: [0, 0, 0], events: 1 };
  vm.runInContext('paint()', context);
  assert.match(medal.outerHTML, /data-medal="silver"/);
  assert.doesNotMatch(medal.outerHTML, /data-tied/);
});

test('shared career changes reorder an already ranked bracket', () => {
  const source = fs.readFileSync('participants.js', 'utf8');
  const careers = { '1': { wins: { points: 5 } }, '2': { wins: { points: 3 } } };
  let configured;
  const context = vm.createContext({
    SCWRCache: { KEPT: 21 * 86400000 },
    SCWRRules: rules(),
    SCWRCareers: { careers, ranks: {}, fresh: user => !!careers[user], configure(options) { configured = options; } },
    SCWRSite: { store: { get() {} } },
    document: { querySelectorAll: () => [] },
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(source.slice(0, source.indexOf('const watcher =')), context);
  vm.runInContext(`
    let order = null; function queue() {}
    const group = { name: 'A', registrations: [{ id: 1, user_id: '1' }, { id: 2, user_id: '2' }] };
    vm = { all: [group], visible: [[group]], $nextTick(done) { done(); } };
    place = new Map([[1, 0], [2, 1]]);
  `, context);
  careers['2'] = { wins: { points: 10 } };
  configured.changed(new Set(['2']));
  assert.equal(vm.runInContext('vm.all[0].registrations[0].user_id', context), '2');
  assert.equal(vm.runInContext('vm.visible[0][0].registrations[0].user_id', context), '2');
});

test('shared career changes reorder stacked bracket strengths', () => {
  const source = fs.readFileSync('participants.js', 'utf8');
  const careers = { '1': { wins: { points: 5 } }, '2': { wins: { points: 3 } } };
  let configured;
  const context = vm.createContext({
    SCWRCache: { KEPT: 21 * 86400000 },
    SCWRRules: rules(),
    SCWRCareers: { careers, ranks: {}, fresh: user => !!careers[user], configure(options) { configured = options; } },
    SCWRSite: { store: { get() {} } }, document: { querySelectorAll: () => [] }, matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(source.slice(0, source.indexOf('const watcher =')), context);
  vm.runInContext(`
    let order = null; let draining = null; stack = true; function queue() {}
    const a = { name: 'A', registrations: [{ id: 1, user_id: '1' }] };
    const b = { name: 'B', registrations: [{ id: 2, user_id: '2' }] };
    vm = { all: [a, b], visible: [[a, b]], updateResults() {}, $nextTick(done) { done(); } };
    place = new Map([[1, 0], [2, 1]]); first = new Map([['A', 0], ['B', 1]]);
  `, context);
  careers['2'] = { wins: { points: 10 } };
  configured.changed(new Set(['2']));
  assert.equal(vm.runInContext('vm.all.map(g => g.name).join()', context), 'B,A');
});
