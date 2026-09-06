// Production loads these as plain script tags in manifest order, sharing globals
// through page scope. Tests do the same, in a context holding nothing but what
// the test hands it — so anything that reaches for a DOM, a clock or the network
// fails here rather than in someone's browser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(files, globals = {}) {
  const context = vm.createContext(globals);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return (name) => vm.runInContext(name, context);
}

// A Map is the whole of the localStorage contract this extension uses. `map` is
// exposed so a test can age an entry or plant one from an older version.
function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// Values built inside the sandbox carry that realm's prototypes, which strict
// deep equality rejects however identical the data is. Bring plain data across
// the boundary before comparing it.
const plain = (value) => JSON.parse(JSON.stringify(value));

module.exports = { load, memoryStorage, plain };
