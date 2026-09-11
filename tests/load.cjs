// Production loads these as plain script tags in manifest order, sharing globals
// through page scope. Tests do the same, in a context holding nothing but what
// the test hands it, against events Smoothcomp actually served. Each fixture is
// a recording of the requests the extension makes, trimmed to the fields it
// reads, with every competitor renamed ("Athlete 12") and renumbered.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

// A Map is the whole of the localStorage contract this extension uses. `map` is
// exposed so a test can age an entry or plant one from an older version.
function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

// Loads the extension's scripts for one recorded event, answering their
// requests from the recording and noting every one they make.
function replay(name, { pathname, localStorage = memoryStorage() } = {}) {
  const event = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json.gz`))));
  const fetched = [];
  const context = vm.createContext({
    location: { pathname: pathname ?? `/en/event/${event.event}/results` },
    localStorage,
    fetch: async (url) => {
      fetched.push(url);
      const body = event.responses[url];
      return body ? { ok: true, json: async () => body } : { ok: false, status: 404 };
    },
  });
  for (const file of ['site.js', 'matches.js', 'model.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  const read = (expression) => vm.runInContext(expression, context);
  return { ...event, fetched, localStorage, SCWRMatches: read('SCWRMatches'), SCWRModel: read('SCWRModel') };
}

// Values built inside the sandbox carry that realm's prototypes, which strict
// deep equality rejects however identical the data is. Bring plain data across
// the boundary before comparing it.
const plain = (value) => JSON.parse(JSON.stringify(value));

module.exports = { replay, memoryStorage, plain };
