importScripts('rules.js', 'career-cache.js');
const PREFIX = 'scwr2:';
const SESSION = 'scwr:requests';
const KINDS = ['careers', 'ranks', 'signatures'];
let serial = Promise.resolve();
let state;
async function requests() {
  state ??= (await chrome.storage.session.get([SESSION]))[SESSION] ?? { sites: {}, jobs: {} };
  for (const [name, job] of Object.entries(state.jobs)) if (job.until <= Date.now()) delete state.jobs[name];
  return state;
}
const checkpoint = () => chrome.storage.session.set({ [SESSION]: state });
const key = (site, kind, user) => `${PREFIX}${site}:${kind}:${user}`;
const validUser = (user) => typeof user === 'string' && /^\d{1,12}$/.test(user);
// Backoff doubles from 10 s to a minute. Refused this many times running, the
// browser is challenged for good, so ask only once a quarter hour.
const PAUSE = 5;
// The cache every install shares: each keeps there what it reads, once its
// whole cache, and looks up an event there before reading any profile.
const SERVER = 'https://mat-stats.mohamed3on.workers.dev';
const keep = (site, kept) => Object.values(kept).some(entries => Object.keys(entries).length) && fetch(`${SERVER}/keep`, { method: 'POST', body: JSON.stringify({ site, ...kept }) }).catch(() => {});

// Anything a page keeps that is bigger than a preference (site.js store.load/save): whole events'
// matches and their details, and athletes' event histories, in the extension's storage rather than the
// site's small localStorage, under cache:<site>:<key>. Each kind holds its latest few, by an index of
// when each was written, so the oldest go without reading them.
const CACHE = 'cache:';
const HOLD = { 'event-matches': 8, 'match-details': 8, profile: 400 };
async function cache(site, { op, key: name, entry }) {
  const kind = /^([a-z-]+):[\w.:-]{1,80}$/.exec(typeof name === 'string' ? name : '')?.[1];
  if (!Object.hasOwn(HOLD, kind)) throw new Error('Unsupported cache');
  const stored = `${CACHE}${site}:${name}`;
  if (op === 'cache-get') return { entry: (await chrome.storage.local.get([stored]))[stored] ?? null };
  if (!entry || typeof entry !== 'object') throw new Error('Bad cache entry');
  const index = `${CACHE}${site}:index:${kind}`;
  const written = { ...(await chrome.storage.local.get([index]))[index], [stored]: Date.now() };
  const gone = Object.keys(written).sort((a, b) => written[a] - written[b]).slice(0, Math.max(0, Object.keys(written).length - HOLD[kind]));
  for (const name of gone) delete written[name];
  await chrome.storage.local.set({ [stored]: entry, [index]: written });
  if (gone.length) await chrome.storage.local.remove(gone);
  return {};
}

function siteFor(sender) {
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'https:' || url.port || !Number.isInteger(sender.tab?.id)) return null;
    if (url.hostname === 'smoothcomp.com' || url.hostname.endsWith('.smoothcomp.com')) return 'smoothcomp.com';
    return url.hostname === 'ajptour.com' ? 'ajptour.com' : null;
  } catch { return null; }
}

async function put(site, kind, user, entry) {
  const cleaned = SCWRCache.clean(kind, entry);
  if (!cleaned) return;
  const name = key(site, kind, user);
  const area = kind === 'signatures' ? chrome.storage.session : chrome.storage.local;
  const old = (await area.get([name]))[name];
  if (!old || cleaned.at > old.at) await area.set({ [name]: cleaned });
  return cleaned;
}

async function handle(message, sender) {
  const site = siteFor(sender);
  if (!site) throw new Error('Unsupported site');
  const { op, kind, user, token } = message;
  if (op === 'cache-get' || op === 'cache-set') return cache(site, message);
  if (op === 'read') {
    // Everything but the pages' caches, which are big and read only by key.
    const names = await chrome.storage.local.getKeys?.();
    const all = await chrome.storage.local.get(names ? names.filter((name) => !name.startsWith(CACHE)) : null);
    const expired = Object.entries(all).filter(([name, entry]) => name.startsWith(PREFIX) && (!Number.isFinite(entry?.at) || Date.now() - entry.at >= Math.max(SCWRCache.KEPT, entry.hidden === true ? SCWRCache.PRIVATE : 0))).map(([name]) => name);
    if (expired.length) await chrome.storage.local.remove(expired);
    const temporary = await chrome.storage.session.get(null);
    const stale = Object.entries(temporary).filter(([name, entry]) => name.startsWith(PREFIX) && !SCWRCache.fresh(entry, 'signatures')).map(([name]) => name);
    if (stale.length) await chrome.storage.session.remove(stale);
    const kept = { careers: {}, ranks: {} };
    for (const name of Object.keys(kept)) {
      for (const [id, entry] of Object.entries(all[`${site}:${name}`] ?? {})) {
        const clean = SCWRCache.clean(name, entry);
        if (validUser(id) && clean) kept[name][id] = clean;
      }
      if (all[`${site}:${name}`] && Object.keys(kept[name]).length !== Object.keys(all[`${site}:${name}`]).length) {
        await chrome.storage.local.set({ [`${site}:${name}`]: kept[name] });
      }
      const prefix = `${PREFIX}${site}:${name}:`;
      for (const [stored, entry] of Object.entries(all)) {
        if (!stored.startsWith(prefix)) continue;
        const id = stored.slice(prefix.length);
        const clean = SCWRCache.clean(name, entry);
        if (validUser(id) && Number.isFinite(entry?.at) && entry.at >= (kept[name][id]?.at ?? 0)) kept[name][id] = clean ?? { at: entry.at };
      }
    }
    if (!all[`scwr:kept:${site}`]) {
      keep(site, Object.fromEntries(Object.entries(kept).map(([name, entries]) => [name, Object.fromEntries(Object.entries(entries).filter(([, e]) => SCWRCache.clean(name, e)))])));
      await chrome.storage.local.set({ [`scwr:kept:${site}`]: true });
    }
    return kept;
  }
  if (op === 'import') {
    const given = {};
    for (const name of ['careers', 'ranks']) for (const [id, entry] of Object.entries(message[name] ?? {})) {
      const clean = SCWRCache.clean(name, entry);
      if (validUser(id) && clean) given[key(site, name, id)] = clean;
    }
    const old = await chrome.storage.local.get(Object.keys(given));
    const newer = Object.fromEntries(Object.entries(given).filter(([name, entry]) => entry.at > (old[name]?.at ?? 0)));
    if (Object.keys(newer).length) await chrome.storage.local.set(newer);
    if (!message.shared && Object.keys(newer).length) {
      const kept = { careers: {}, ranks: {} };
      for (const [name, entry] of Object.entries(newer)) { const [, , kind, id] = name.split(':'); kept[kind][id] = entry; }
      keep(site, kept);
    }
    return {};
  }
  if (op === 'peek' && KINDS.includes(kind) && validUser(user)) {
    const name = key(site, kind, user);
    const area = kind === 'signatures' ? chrome.storage.session : chrome.storage.local;
    return { entry: SCWRCache.clean(kind, (await area.get([name]))[name]) };
  }
  const data = await requests();
  const limit = data.sites[site] ??= { asked: [], held: 0, strikes: 0 };
  if (op === 'slot' || op === 'available' || op === 'delay') {
    limit.asked = limit.asked.filter(at => at + 10500 > Date.now());
    // Five profile pages per 10.5 s, spread evenly: five at once trip Cloudflare's
    // approximate counter now and then, and each refusal costs a 10 s backoff.
    const wait = Math.max(0, limit.held - Date.now(), op !== 'delay' && limit.asked.length ? limit.asked.at(-1) + 2100 - Date.now() : 0);
    if (op === 'slot' && !wait) { limit.asked.push(Date.now()); await checkpoint(); }
    return { wait, paused: limit.strikes >= PAUSE };
  }
  if (op === 'cooldown') {
    // Requests already in flight fail together: one refusal, not several.
    if (limit.held <= Date.now()) limit.strikes = Math.min(limit.strikes + 1, PAUSE);
    const backoff = limit.strikes >= PAUSE ? 15 * 60000 : Math.min(10000 * 2 ** (limit.strikes - 1), 60000);
    const rest = Math.max(backoff, Number.isFinite(message.ms) ? Math.min(message.ms, 24 * 60 * 60 * 1000) : 0);
    limit.held = Math.max(limit.held, Date.now() + rest);
    await checkpoint();
    return { wait: limit.held - Date.now() };
  }
  if (op === 'healthy') { limit.strikes = 0; await checkpoint(); return {}; }
  if (!KINDS.includes(kind) || !validUser(user)) throw new Error('Invalid career request');
  const name = key(site, kind, user);
  const owner = `${sender.tab.id}:${sender.documentId}`;
  const job = data.jobs[name];
  if (op === 'claim') {
    const area = kind === 'signatures' ? chrome.storage.session : chrome.storage.local;
    const entry = SCWRCache.clean(kind, (await area.get([name]))[name]);
    // A career asked for its event count passes over one kept without it.
    // So does a career read before the event being shown ended.
    if (entry && !(message.events && !entry.hidden && entry.events == null) && !(!entry.hidden && entry.at < message.since)) return { entry };
    if (job?.until > Date.now()) return { wait: 500 };
    const claim = { owner, token: crypto.randomUUID(), until: Date.now() + 120000 };
    data.jobs[name] = claim;
    await checkpoint();
    return { token: claim.token };
  }
  if (!job || job.owner !== owner || job.token !== token || job.until <= Date.now()) return {};
  if (op === 'renew') job.until = Date.now() + 120000;
  else if (op === 'complete') {
    const entry = await put(site, kind, user, message.entry);
    if (kind !== 'signatures' && entry) keep(site, { [kind]: { [user]: entry } });
    delete data.jobs[name];
    await checkpoint();
    return { entry };
  } else throw new Error('Unknown career operation');
  await checkpoint();
  return {};
}

// A results page's records, a registration list and a profile go straight to the
// shared cache, with who each athlete is; none are kept here.
function record({ op, event, records, meta, athletes, read }, sender) {
  const site = siteFor(sender);
  if (!site || (op !== 'people' && !/^\d{1,9}$/.test(event)) || (op === 'record' && (!records || typeof records !== 'object'))) return;
  fetch(`${SERVER}/${op}`, { method: 'POST', body: JSON.stringify({ site, event, records, meta, athletes, read }) }).catch(() => {});
}

// A lookup waits on the network, so only its write joins the serial line.
async function lookup({ users }, sender) {
  const site = siteFor(sender);
  users = Array.isArray(users) ? users.filter(validUser).slice(0, 5000) : [];
  if (!site || !users.length) return {};
  const response = await fetch(`${SERVER}/lookup`, { method: 'POST', body: JSON.stringify({ site, users }), signal: AbortSignal.timeout(10000) });
  const given = response.ok ? await response.json() : {};
  const kept = { careers: {}, ranks: {}, seen: {}, ended: {}, records: {} };
  for (const [id, seen] of Object.entries(given.seen ?? {})) if (validUser(id) && Array.isArray(seen) && seen.length === 3 && seen.every(Number.isSafeInteger)) kept.seen[id] = seen;
  // A record is [won, lost] by finish.
  const pair = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isSafeInteger(n) && n >= 0);
  for (const [id, record] of Object.entries(given.records ?? {})) {
    if (validUser(id) && record && typeof record === 'object') kept.records[id] = Object.fromEntries(Object.entries(record).filter(([type, p]) => /^[\w -]{1,40}$/.test(type) && pair(p)));
  }
  for (const [id, end] of Object.entries(given.ended ?? {})) if (validUser(id) && Number.isSafeInteger(end) && end <= Date.now()) kept.ended[id] = end;
  for (const name of ['careers', 'ranks']) for (const [id, entry] of Object.entries(given[name] ?? {})) {
    const clean = SCWRCache.clean(name, entry);
    if (validUser(id) && clean) kept[name][id] = clean;
  }
  await (serial = serial.then(() => handle({ op: 'import', careers: kept.careers, ranks: kept.ranks, shared: true }, sender)).catch(() => {}));
  return kept;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== 'scwr') return;
  if (message.op === 'record' || message.op === 'roster' || message.op === 'people') { record(message, sender); reply({}); return; }
  if (message.op === 'shared') { lookup(message, sender).then(reply, () => reply({})); return true; }
  // Storage has no compare-and-swap. Serialise claims, slots and writes here.
  serial = serial.then(() => handle(message, sender)).then(reply, error => reply({ error: error.message }));
  return true;
});

// The Dev Reloader (../dev-reloader) asks an unpacked build to reload itself after a change:
// its fallback, toggling the extension, keeps the old manifest. Store installs carry an
// update_url and ignore it.
chrome.runtime.onMessageExternal.addListener((message, _sender, reply) => {
  if (message !== 'dev-reload' || 'update_url' in chrome.runtime.getManifest()) return;
  reply(true);
  setTimeout(() => chrome.runtime.reload(), 100);
});
