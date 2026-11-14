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

document.addEventListener('scwr:ask', async () => {
  document.dispatchEvent(new CustomEvent('scwr:kept', { detail: JSON.stringify(await read()) }));
});

// Another tab may have written since, so each entry is kept at its newest.
document.addEventListener('scwr:keep', async (event) => {
  const kept = await read();
  for (const name of NAMES) {
    for (const [user, entry] of Object.entries(JSON.parse(event.detail)[name] ?? {})) {
      if (entry.at > (kept[name][user]?.at ?? 0)) kept[name][user] = entry;
    }
    for (const user of Object.keys(kept[name])) if (Date.now() - kept[name][user].at >= KEPT) delete kept[name][user];
  }
  chrome.storage.local.set(Object.fromEntries(NAMES.map((name) => [`${SITE}:${name}`, kept[name]])));
});
