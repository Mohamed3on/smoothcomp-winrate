// The page's own storage is per origin, and every organiser has its own
// subdomain. Careers and belts cost a rate-limited request each, so they are
// also kept in the extension's storage, which every Smoothcomp site shares. The
// page scripts run in the page's world and cannot reach it; this one can, and
// passes them across as events. AJP Tour numbers its athletes itself, so it
// keeps its own.
const SITE = location.hostname.endsWith('smoothcomp.com') ? 'smoothcomp.com' : location.hostname;
const NAMES = ['careers', 'ranks'];
const KEPT = 21 * 24 * 60 * 60 * 1000;
const read = async () => {
  const kept = await chrome.storage.local.get(NAMES.map((name) => `${SITE}:${name}`));
  return Object.fromEntries(NAMES.map((name) => [name, kept[`${SITE}:${name}`] ?? {}]));
};

// Any script on any organiser's page can raise these events, and what is kept
// is drawn on every other site, so only the shapes the page script writes get
// in: counts as whole numbers, a belt by name, a time not in the future.
const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const CLEAN = {
  careers: (entry) => (entry.wins && typeof entry.wins === 'object' ? {
    wins: Object.fromEntries(Object.entries(entry.wins).filter(([type, n]) => /^[\w -]{1,40}$/.test(type) && whole(n))),
    medals: [0, 1, 2].map((i) => (whole(entry.medals?.[i]) ? entry.medals[i] : 0)),
  } : {}),
  ranks: (entry) => ({ belt: BELTS.includes(entry.belt) ? entry.belt : null }),
};
const sound = (user, entry) => /^\d{1,12}$/.test(user) && Number.isFinite(entry?.at) && entry.at <= Date.now() + 60000;

document.addEventListener('scwr:ask', async () => {
  document.dispatchEvent(new CustomEvent('scwr:kept', { detail: JSON.stringify(await read()) }));
});

// Another tab may have written since, so each entry is kept at its newest; one
// write ends before the next reads, or the second would undo the first.
let writing = Promise.resolve();
document.addEventListener('scwr:keep', (event) => { writing = writing.then(() => keep(JSON.parse(event.detail))).catch(() => {}); });
async function keep(given) {
  const kept = await read();
  for (const name of NAMES) {
    for (const [user, entry] of Object.entries(given[name] ?? {})) {
      if (sound(user, entry) && entry.at > (kept[name][user]?.at ?? 0)) kept[name][user] = { at: entry.at, ...CLEAN[name](entry) };
    }
    for (const user of Object.keys(kept[name])) if (Date.now() - kept[name][user].at >= KEPT) delete kept[name][user];
  }
  await chrome.storage.local.set(Object.fromEntries(NAMES.map((name) => [`${SITE}:${name}`, kept[name]])));
}
