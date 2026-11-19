importScripts('career-cache.js');
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
  if (op === 'read') {
    const all = await chrome.storage.local.get(null);
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
    const wait = Math.max(0, limit.held - Date.now(), op !== 'delay' && limit.asked.length >= 5 ? limit.asked[0] + 10500 - Date.now() : 0);
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
    if (entry && !(message.events && !entry.hidden && entry.events == null)) return { entry };
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
    delete data.jobs[name];
    await checkpoint();
    return { entry };
  } else throw new Error('Unknown career operation');
  await checkpoint();
  return {};
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.channel !== 'scwr') return;
  // Storage has no compare-and-swap. Serialise claims, slots and writes here.
  serial = serial.then(() => handle(message, sender)).then(reply, error => reply({ error: error.message }));
  return true;
});
